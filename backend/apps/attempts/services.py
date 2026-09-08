from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from math import ceil
from random import SystemRandom
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.exams.models import Exam, Question, QuestionOption
from apps.organizations.models import SchoolMembership
from apps.users.models import StudentProfile, User

from .models import ExamAttempt, StudentAnswer


def student_matches_exam_audience(student: User, exam: Exam) -> bool:
    """Apply school isolation first, then the grade/class audience selected by the teacher."""
    teacher_school_id = SchoolMembership.objects.filter(user=exam.teacher).values_list("school_id", flat=True).first()
    if teacher_school_id:
        student_school_id = SchoolMembership.objects.filter(user=student).values_list("school_id", flat=True).first()
        if student_school_id != teacher_school_id:
            return False
    if not exam.grade and not exam.class_name:
        return True
    profile = StudentProfile.objects.filter(user=student).only("grade", "class_name").first()
    if profile is None:
        return False
    if exam.grade and profile.grade != exam.grade:
        return False
    return not exam.class_name or profile.class_name == exam.class_name


def exam_availability(exam: Exam, student: User, *, now: datetime | None = None) -> str | None:
    """Return a student dashboard state, or None when this exam must not be shown."""
    now = now or timezone.now()
    if exam.status in {Exam.Status.DRAFT, Exam.Status.ARCHIVED} or not student_matches_exam_audience(student, exam):
        return None
    if exam.status == Exam.Status.COMPLETED:
        return "completed"
    if exam.status not in {Exam.Status.SCHEDULED, Exam.Status.ACTIVE}:
        return None
    if exam.start_at and now < exam.start_at:
        return "upcoming"
    if exam.end_at and now >= exam.end_at:
        return "completed"
    # A scheduled exam becomes startable once its schedule opens even if an external scheduler
    # has not yet promoted the teacher-visible status to ACTIVE.
    return "available"


def is_exam_startable(exam: Exam, student: User, *, now: datetime | None = None) -> bool:
    return exam_availability(exam, student, now=now) == "available"


def attempt_expires_at(attempt: ExamAttempt) -> datetime | None:
    """Duration is authoritative, with an exam end time acting as an earlier hard cap."""
    if not attempt.started_at:
        return None
    expires_at = attempt.started_at + timedelta(minutes=attempt.exam.duration_minutes)
    if attempt.exam.end_at and attempt.exam.end_at < expires_at:
        return attempt.exam.end_at
    return expires_at


def attempt_timing(attempt: ExamAttempt, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or timezone.now()
    expires_at = attempt_expires_at(attempt)
    remaining_seconds = None
    if expires_at is not None:
        remaining_seconds = max(0, ceil((expires_at - now).total_seconds()))
    return {
        "server_time": now,
        "expires_at": expires_at,
        "remaining_seconds": remaining_seconds,
    }


def attempt_question_ids(attempt: ExamAttempt) -> list[str]:
    """Use the persisted snapshot; backfill a deterministic snapshot for legacy rows."""
    if attempt.question_order:
        return [str(question_id) for question_id in attempt.question_order]
    question_ids = [str(question_id) for question_id in attempt.exam.questions.order_by("order").values_list("id", flat=True)]
    attempt.question_order = question_ids
    attempt.save(update_fields=("question_order", "updated_at"))
    return question_ids


def _locked_attempt(attempt_id: Any) -> ExamAttempt:
    return (
        ExamAttempt.objects.select_for_update()
        .select_related("exam", "exam__settings", "student")
        .get(pk=attempt_id)
    )


def _validate_start_access(exam: Exam, student: User, now: datetime) -> None:
    if not is_exam_startable(exam, student, now=now):
        # Keep the public message intentionally broad: inaccessible exams should not disclose targeting details.
        raise ValidationError({"exam": ["This exam is not available to start."]})
    if not exam.questions.exists():
        raise ValidationError({"exam": ["This exam is not available to start."]})


def start_attempt(exam_id: Any, student: User) -> tuple[ExamAttempt, bool]:
    """Start one active attempt, reusing an existing valid one for duplicate start requests."""
    with transaction.atomic():
        exam = Exam.objects.select_for_update().select_related("settings").get(pk=exam_id)
        now = timezone.now()
        _validate_start_access(exam, student, now)

        active_attempt = (
            ExamAttempt.objects.select_for_update()
            .filter(exam=exam, student=student, status=ExamAttempt.Status.IN_PROGRESS)
            .order_by("-started_at", "-created_at")
            .first()
        )
        if active_attempt is not None:
            active_attempt = finalize_expired_attempt(active_attempt, now=now)
            if active_attempt.status == ExamAttempt.Status.IN_PROGRESS:
                return active_attempt, False

        attempt_count = ExamAttempt.objects.filter(exam=exam, student=student).count()
        if attempt_count >= exam.settings.max_attempts:
            raise ValidationError({"exam": ["The maximum number of attempts has been reached."]})

        question_ids = list(exam.questions.order_by("order").values_list("id", flat=True))
        if exam.settings.randomize_questions:
            SystemRandom().shuffle(question_ids)
        attempt = ExamAttempt(
            exam=exam,
            student=student,
            attempt_number=attempt_count + 1,
            status=ExamAttempt.Status.IN_PROGRESS,
            started_at=now,
            last_activity_at=now,
            question_order=[str(question_id) for question_id in question_ids],
        )
        attempt.full_clean()
        attempt.save()
        return attempt, True


def _answer_has_value(question: Question, answer: StudentAnswer | None) -> bool:
    if answer is None:
        return False
    if question.type in {
        Question.Type.MULTIPLE_CHOICE,
        Question.Type.MULTIPLE_ANSWER,
        Question.Type.TRUE_FALSE,
    }:
        return bool(answer._selected_option_ids)  # type: ignore[attr-defined]
    text = answer.answer_data.get("text") if isinstance(answer.answer_data, dict) else None
    return isinstance(text, str) and bool(text.strip())


def _answer_choice_ids(answer: StudentAnswer | None) -> set[str]:
    if answer is None:
        return set()
    return {str(option_id) for option_id in answer._selected_option_ids}  # type: ignore[attr-defined]


def _grade_attempt(attempt: ExamAttempt, *, finalized_at: datetime) -> "ExamResult":
    """Persist deterministic automatic grading; written/unconfigured short answers stay pending."""
    # Deferred import avoids a models import cycle while keeping grading close to attempt lifecycle logic.
    from apps.results.models import ExamResult

    ordered_ids = attempt_question_ids(attempt)
    questions_by_id = {
        str(question.id): question
        for question in Question.objects.filter(exam=attempt.exam)
        .prefetch_related("options")
        .order_by("order")
    }
    answers = (
        StudentAnswer.objects.filter(attempt=attempt)
        .select_related("question")
        .prefetch_related("selected_options")
    )
    answers_by_question = {str(answer.question_id): answer for answer in answers}
    for answer in answers_by_question.values():
        answer._selected_option_ids = [option.id for option in answer.selected_options.all()]  # type: ignore[attr-defined]

    score = Decimal("0.00")
    total_marks = Decimal("0.00")
    correct_count = incorrect_count = unanswered_count = pending_manual_count = 0
    for question_id in ordered_ids:
        question = questions_by_id.get(question_id)
        if question is None:
            # A teacher should not delete content from a live exam; skipped here prevents a broken old row from crashing finalization.
            continue
        total_marks += question.marks
        answer = answers_by_question.get(question_id)
        if not _answer_has_value(question, answer):
            unanswered_count += 1
            continue

        if question.type == Question.Type.WRITTEN:
            if answer.manual_score is None:
                pending_manual_count += 1
            else:
                score += answer.manual_score
            continue

        if question.type == Question.Type.SHORT_ANSWER:
            expected_answers = question.configuration.get("expected_answers", [])
            if not expected_answers:
                if answer.manual_score is None:
                    pending_manual_count += 1
                else:
                    score += answer.manual_score
                continue
            answer_text = str(answer.answer_data.get("text", "")).strip()
            case_sensitive = bool(question.configuration.get("case_sensitive", False))
            comparable_answer = answer_text if case_sensitive else answer_text.casefold()
            comparable_expected = {
                item.strip() if case_sensitive else item.strip().casefold() for item in expected_answers
            }
            is_correct = comparable_answer in comparable_expected
        else:
            selected_ids = _answer_choice_ids(answer)
            correct_ids = {str(option.id) for option in question.options.all() if option.is_correct}
            # Multiple-answer uses deliberate full-credit-only exact-set matching; other choice types do too.
            is_correct = selected_ids == correct_ids

        if is_correct:
            correct_count += 1
            score += question.marks
        else:
            incorrect_count += 1

    percentage = None
    if total_marks > 0 and pending_manual_count == 0:
        percentage = (score * Decimal("100") / total_marks).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    visibility = attempt.exam.settings.result_visibility
    result_status = {
        "immediate": ExamResult.Status.PUBLISHED,
        "pending": ExamResult.Status.PENDING,
        "hidden": ExamResult.Status.HIDDEN,
    }[visibility]
    result, _ = ExamResult.objects.update_or_create(
        attempt=attempt,
        defaults={
            "status": result_status,
            "score": score,
            "percentage": percentage,
            "correct_count": correct_count,
            "incorrect_count": incorrect_count,
            "unanswered_count": unanswered_count,
            "pending_manual_grading_count": pending_manual_count,
            "computed_at": finalized_at,
            "published_at": finalized_at if result_status == ExamResult.Status.PUBLISHED else None,
        },
    )
    return result


def finalize_expired_attempt(attempt: ExamAttempt, *, now: datetime | None = None) -> ExamAttempt:
    """Our expiry strategy: save current work, mark EXPIRED, grade it, and never discard answers."""
    now = now or timezone.now()
    if attempt.status != ExamAttempt.Status.IN_PROGRESS:
        return attempt
    expires_at = attempt_expires_at(attempt)
    if expires_at is None or now < expires_at:
        return attempt

    attempt.status = ExamAttempt.Status.EXPIRED
    attempt.submitted_at = now
    attempt.last_activity_at = now
    attempt.save(update_fields=("status", "submitted_at", "last_activity_at", "updated_at"))
    _grade_attempt(attempt, finalized_at=now)
    return attempt


def _ensure_active_locked_attempt(attempt_id: Any, student: User) -> ExamAttempt:
    attempt = _locked_attempt(attempt_id)
    if attempt.student_id != student.id:
        raise ValidationError({"attempt": ["This exam session is not available."]})
    attempt = finalize_expired_attempt(attempt)
    if attempt.status != ExamAttempt.Status.IN_PROGRESS:
        raise ValidationError({"attempt": ["This exam session can no longer be changed."]})
    return attempt


def _validate_attempt_question(attempt: ExamAttempt, question: Question) -> None:
    if question.exam_id != attempt.exam_id or str(question.id) not in attempt_question_ids(attempt):
        raise ValidationError({"question": ["This question is not part of the exam session."]})


def _save_answer_for_locked_attempt(
    attempt: ExamAttempt,
    question: Question,
    answer_data: dict[str, Any],
) -> StudentAnswer:
    _validate_attempt_question(attempt, question)
    answer, _ = StudentAnswer.objects.get_or_create(
        attempt=attempt,
        question=question,
        defaults={"answer_data": {}, "is_flagged": False},
    )

    if "selected_option_ids" in answer_data:
        option_ids = answer_data["selected_option_ids"]
        options = list(QuestionOption.objects.filter(question=question, id__in=option_ids))
        if len(options) != len(option_ids):
            raise ValidationError({"selected_option_ids": ["Each option must belong to this question."]})
        answer.answer_data = {}
        answer.save(update_fields=("answer_data", "updated_at"))
        answer.selected_options.set(options)
    else:
        answer.answer_data = {"text": answer_data.get("text", "")}
        answer.save(update_fields=("answer_data", "updated_at"))
        answer.selected_options.clear()
    return answer


def save_answer(attempt_id: Any, student: User, question: Question, answer_data: dict[str, Any]) -> StudentAnswer:
    with transaction.atomic():
        attempt = _ensure_active_locked_attempt(attempt_id, student)
        answer = _save_answer_for_locked_attempt(attempt, question, answer_data)
        attempt.last_activity_at = timezone.now()
        attempt.save(update_fields=("last_activity_at", "updated_at"))
        return answer


def save_answers_batch(
    attempt_id: Any,
    student: User,
    updates: list[tuple[Question, dict[str, Any]]],
) -> list[StudentAnswer]:
    """All-or-nothing batch autosave extension point for reconnect/retry flows."""
    with transaction.atomic():
        attempt = _ensure_active_locked_attempt(attempt_id, student)
        answers = [_save_answer_for_locked_attempt(attempt, question, answer_data) for question, answer_data in updates]
        attempt.last_activity_at = timezone.now()
        attempt.save(update_fields=("last_activity_at", "updated_at"))
        return answers


def set_question_flag(attempt_id: Any, student: User, question: Question, *, is_flagged: bool) -> StudentAnswer:
    with transaction.atomic():
        attempt = _ensure_active_locked_attempt(attempt_id, student)
        _validate_attempt_question(attempt, question)
        answer, _ = StudentAnswer.objects.get_or_create(
            attempt=attempt,
            question=question,
            defaults={"answer_data": {}, "is_flagged": is_flagged},
        )
        if answer.is_flagged != is_flagged:
            answer.is_flagged = is_flagged
            answer.save(update_fields=("is_flagged", "updated_at"))
        attempt.last_activity_at = timezone.now()
        attempt.save(update_fields=("last_activity_at", "updated_at"))
        return answer


def submit_attempt(attempt_id: Any, student: User) -> tuple[ExamAttempt, "ExamResult"]:
    """Finalize once; repeated submit calls safely return the existing finalized result."""
    from apps.results.models import ExamResult

    with transaction.atomic():
        attempt = _locked_attempt(attempt_id)
        if attempt.student_id != student.id:
            raise ValidationError({"attempt": ["This exam session is not available."]})

        attempt = finalize_expired_attempt(attempt)
        if attempt.status in {ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED}:
            # Legacy/admin-created finalized rows may predate result generation; repair them safely once.
            result = ExamResult.objects.filter(attempt=attempt).first()
            if result is None:
                result = _grade_attempt(attempt, finalized_at=attempt.submitted_at or timezone.now())
            return attempt, result
        if attempt.status != ExamAttempt.Status.IN_PROGRESS:
            raise ValidationError({"attempt": ["This exam session cannot be submitted."]})

        now = timezone.now()
        attempt.status = ExamAttempt.Status.SUBMITTED
        attempt.submitted_at = now
        attempt.last_activity_at = now
        attempt.save(update_fields=("status", "submitted_at", "last_activity_at", "updated_at"))
        return attempt, _grade_attempt(attempt, finalized_at=now)


def refresh_attempt_if_expired(attempt_id: Any, student: User) -> ExamAttempt:
    """Used by read endpoints so stale sessions cannot remain IN_PROGRESS indefinitely."""
    with transaction.atomic():
        attempt = _locked_attempt(attempt_id)
        if attempt.student_id != student.id:
            raise ValidationError({"attempt": ["This exam session is not available."]})
        return finalize_expired_attempt(attempt)
