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

from .models import AttemptEvent, ExamAttempt, StudentAnswer


class AudienceContext:
    """Per-request cache of the facts the audience rule needs.

    `exam_availability()` used to issue two membership/profile queries per candidate exam for the same
    student; with a dashboard of several exams that was the dominant cost of the busiest student route.
    """

    __slots__ = ("student_school_id", "grade", "class_name")

    def __init__(self, student: User) -> None:
        self.student_school_id = (
            SchoolMembership.objects.filter(user=student).values_list("school_id", flat=True).first()
        )
        profile = StudentProfile.objects.filter(user=student).only("grade", "class_name").first()
        self.grade = profile.grade if profile else None
        self.class_name = profile.class_name if profile else None

    def matches(self, exam: Exam) -> bool:
        teacher_school_id = getattr(exam.teacher, "_school_id_cache", _MISSING)
        if teacher_school_id is _MISSING:
            teacher_school_id = SchoolMembership.objects.filter(user=exam.teacher).values_list("school_id", flat=True).first()
            # Cached on the loaded instance for the lifetime of this request only.
            setattr(exam.teacher, "_school_id_cache", teacher_school_id)
        if teacher_school_id and teacher_school_id != self.student_school_id:
            return False
        if not exam.grade and not exam.class_name:
            return True
        if self.grade is None and self.class_name is None:
            return False
        if exam.grade and self.grade != exam.grade:
            return False
        return not exam.class_name or self.class_name == exam.class_name


class _Missing:
    pass


_MISSING = _Missing()


def student_matches_exam_audience(student: User, exam: Exam, *, context: AudienceContext | None = None) -> bool:
    """Apply school isolation first, then the grade/class audience selected by the teacher."""
    context = context or AudienceContext(student)
    return context.matches(exam)


def exam_availability(
    exam: Exam,
    student: User,
    *,
    now: datetime | None = None,
    audience: AudienceContext | None = None,
) -> str | None:
    """Return a student dashboard state, or None when this exam must not be shown."""
    now = now or timezone.now()
    if exam.status in {Exam.Status.DRAFT, Exam.Status.ARCHIVED} or not student_matches_exam_audience(
        student, exam, context=audience
    ):
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


def is_exam_startable(
    exam: Exam, student: User, *, now: datetime | None = None, audience: AudienceContext | None = None
) -> bool:
    return exam_availability(exam, student, now=now, audience=audience) == "available"


def compute_attempt_deadline(exam: Exam, started_at: datetime) -> datetime:
    """The deadline an attempt is given when it starts: duration, capped by the exam window."""
    expires_at = started_at + timedelta(minutes=exam.duration_minutes)
    if exam.end_at and exam.end_at < expires_at:
        return exam.end_at
    return expires_at


def attempt_expires_at(attempt: ExamAttempt) -> datetime | None:
    """The snapshotted deadline is authoritative; legacy rows fall back to the live exam duration.

    Deriving the deadline from `exam.duration_minutes` (the previous behaviour) meant that any teacher
    edit to the duration silently re-cut the time of every student mid-answer, and could expire an
    attempt while they were typing. Snapshotting it makes the running session immutable while still
    letting `extend_exam_time` widen it explicitly.
    """
    if attempt.expires_at is not None:
        return attempt.expires_at
    if not attempt.started_at:
        return None
    return compute_attempt_deadline(attempt.exam, attempt.started_at)


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


def build_option_order(exam: Exam) -> dict[str, list[str]]:
    """Per-attempt option order snapshot; only choice questions, never true/false.

    True/false keeps its fixed `درست`/`نادرست` positions because the student mapping is positional by
    contract (option 0 is true). Grading always matches on option UUIDs, so order can never change a
    score.
    """
    if not exam.settings.randomize_options:
        return {}
    order: dict[str, list[str]] = {}
    choice_types = {Question.Type.MULTIPLE_CHOICE, Question.Type.MULTIPLE_ANSWER}
    for question in exam.questions.prefetch_related("options").all():
        if question.type not in choice_types:
            continue
        option_ids = [str(option.id) for option in question.options.order_by("order")]
        if len(option_ids) > 1:
            SystemRandom().shuffle(option_ids)
            order[str(question.id)] = option_ids
    return order


def apply_option_order(attempt: ExamAttempt, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reorder the already student-safe option payloads to this attempt's snapshot order.

    Ids that are missing from the snapshot (an option the teacher added after this attempt started)
    keep their relative position at the end, so nobody loses an option mid-exam.
    """
    snapshot = attempt.option_order or {}
    if not snapshot:
        return payloads
    for payload in payloads:
        order = snapshot.get(str(payload.get("id")))
        if not order:
            continue
        rank = {str(option_id): index for index, option_id in enumerate(order)}
        payload["options"] = sorted(payload["options"], key=lambda option: rank.get(str(option["id"]), len(rank)))
    return payloads




class AttemptConflict(Exception):
    """A write was rejected because another session, or a newer revision, already owns the attempt."""

    def __init__(self, message: str, *, code: str = "conflict", **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.extra = extra


def _locked_attempt(attempt_id: Any) -> ExamAttempt:
    return (
        ExamAttempt.objects.select_for_update()
        .select_related("exam", "exam__settings", "student")
        .get(pk=attempt_id)
    )


# Starting with less than this left would burn an attempt on an unanswerable paper.
MIN_STARTABLE_SECONDS = 60


def _validate_start_access(exam: Exam, student: User, now: datetime) -> None:
    if not is_exam_startable(exam, student, now=now):
        # Keep the public message intentionally broad: inaccessible exams should not disclose targeting details.
        raise ValidationError({"exam": ["This exam is not available to start."]})
    if not exam.questions.exists():
        raise ValidationError({"exam": ["This exam is not available to start."]})
    # The window the attempt would actually get, not the nominal duration: an exam that closes in 20
    # seconds gives a fresh attempt 20 seconds, which is a lost attempt rather than an exam.
    deadline = compute_attempt_deadline(exam, now)
    left = (deadline - now).total_seconds()
    if left < MIN_STARTABLE_SECONDS:
        raise ValidationError({
            "exam": [f"This exam closes in under {MIN_STARTABLE_SECONDS // 60} minute and cannot be started now."],
            "seconds_left": int(max(0, left)),
        })


def start_attempt(exam_id: Any, student: User, *, client_session: str = "") -> tuple[ExamAttempt, bool]:
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
                # A refresh or a second tab reuses the attempt; claiming it is an explicit action so an
                # accidental duplicate cannot quietly take ownership away.
                if client_session and active_attempt.client_session != client_session:
                    adopt_client_session(active_attempt, client_session, reason="start")
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
            # The deadline is frozen here: later edits to duration/end time must not re-cut a live session.
            expires_at=compute_attempt_deadline(exam, now),
            question_order=[str(question_id) for question_id in question_ids],
            option_order=build_option_order(exam),
            client_session=client_session[:64],
        )
        attempt.full_clean()
        attempt.save()
        return attempt, True


def unanswered_question_ids(attempt: ExamAttempt) -> list[str]:
    """Question ids in this attempt's snapshot that hold no value yet."""
    ordered_ids = attempt_question_ids(attempt)
    questions = {
        str(question.id): question
        for question in Question.objects.filter(pk__in=ordered_ids).prefetch_related("options")
    }
    answers = {
        str(answer.question_id): answer
        for answer in StudentAnswer.objects.filter(attempt=attempt).prefetch_related("selected_options")
    }
    for answer in answers.values():
        answer._selected_option_ids = [option.id for option in answer.selected_options.all()]  # type: ignore[attr-defined]
    missing: list[str] = []
    for question_id in ordered_ids:
        question = questions.get(question_id)
        if question is None:
            continue
        if not _answer_has_value(question, answers.get(question_id)):
            missing.append(question_id)
    return missing


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


def record_attempt_event(attempt: ExamAttempt, kind: str, *, detail: dict[str, Any] | None = None) -> None:
    """Append a server-time activity signal. Never used to punish, only to inform the teacher."""
    AttemptEvent.objects.create(attempt=attempt, kind=kind, detail=detail or {})


def adopt_client_session(attempt: ExamAttempt, client_session: str, *, reason: str) -> bool:
    """Move attempt ownership to `client_session`; returns True when it was a real handover."""
    client_session = (client_session or "")[:64]
    if not client_session or attempt.client_session == client_session:
        return False
    previous = attempt.client_session
    attempt.client_session = client_session
    attempt.session_switch_count = (attempt.session_switch_count or 0) + 1
    attempt.save(update_fields=("client_session", "session_switch_count", "updated_at"))
    record_attempt_event(attempt, AttemptEvent.Kind.SESSION_SWITCH, detail={"reason": reason, "previous_seen": bool(previous)})
    return True


def session_is_locked_by_other(attempt: ExamAttempt, client_session: str, *, ttl_seconds: int = 45) -> bool:
    """True when another browser session wrote to this attempt very recently."""
    if not client_session or not attempt.client_session or attempt.client_session == client_session:
        return False
    idle = (timezone.now() - attempt.last_activity_at).total_seconds()
    return idle < ttl_seconds


def heartbeat(attempt_id: Any, student: User, *, client_session: str = "") -> dict[str, Any]:
    """Cheap liveness ping: the client's clock is re-synchronised without the full attempt payload."""
    with transaction.atomic():
        attempt = _locked_attempt(attempt_id)
        if attempt.student_id != student.id:
            raise ValidationError({"attempt": ["This exam session is not available."]})
        attempt = finalize_expired_attempt(attempt)
        if attempt.status == ExamAttempt.Status.IN_PROGRESS:
            other_session = session_is_locked_by_other(attempt, client_session)
            if not other_session and client_session:
                adopt_client_session(attempt, client_session, reason="heartbeat")
            attempt.last_activity_at = timezone.now()
            attempt.save(update_fields=("last_activity_at", "updated_at"))
        else:
            other_session = False
        timing = attempt_timing(attempt)
        return {
            **timing,
            "status": attempt.status,
            "answer_revision": attempt.answer_revision,
            "session_locked_by_other": other_session,
            "question_count": len(attempt_question_ids(attempt)),
        }


def claim_session(attempt_id: Any, student: User, *, client_session: str) -> dict[str, Any]:
    """Explicit takeover: a student pressing "continue here" moves the attempt to this tab."""
    with transaction.atomic():
        attempt = _locked_attempt(attempt_id)
        if attempt.student_id != student.id:
            raise ValidationError({"attempt": ["This exam session is not available."]})
        attempt = finalize_expired_attempt(attempt)
        if attempt.status != ExamAttempt.Status.IN_PROGRESS:
            raise ValidationError({"attempt": ["This exam session can no longer be changed."]})
        adopt_client_session(attempt, client_session, reason="claimed")
        attempt.last_activity_at = timezone.now()
        attempt.save(update_fields=("last_activity_at", "updated_at"))
    return {**attempt_timing(attempt), "status": attempt.status, "answer_revision": attempt.answer_revision}


def record_client_signal(attempt_id: Any, student: User, *, kind: str, detail: dict[str, Any] | None = None) -> None:
    """Store a browser-reported signal. The client supplies no timestamps and no verdicts."""
    with transaction.atomic():
        attempt = _locked_attempt(attempt_id)
        if attempt.student_id != student.id:
            raise ValidationError({"attempt": ["This exam session is not available."]})
        if attempt.status != ExamAttempt.Status.IN_PROGRESS:
            return
        allowed = {
            AttemptEvent.Kind.TAB_HIDDEN,
            AttemptEvent.Kind.TAB_VISIBLE,
            AttemptEvent.Kind.DISCONNECTED,
            AttemptEvent.Kind.RECONNECTED,
        }
        if kind not in allowed:
            raise ValidationError({"kind": ["This signal is not recorded."]})
        record_attempt_event(attempt, kind, detail=(detail or {}) if isinstance(detail, dict) else {})


def close_exam_attempts(exam: Exam, *, reason: str = "exam_closed") -> int:
    """Finalize every open attempt of an exam the teacher ended or archived.

    Saved answers are graded, never discarded: ending an exam closes the writing window, it does not
    delete the work students already submitted.
    """
    closed = 0
    now = timezone.now()
    open_ids = list(
        ExamAttempt.objects.filter(exam=exam, status=ExamAttempt.Status.IN_PROGRESS).order_by("pk").values_list("id", flat=True)
    )
    for attempt_id in open_ids:
        attempt = _locked_attempt(attempt_id)
        if attempt.status != ExamAttempt.Status.IN_PROGRESS:
            continue
        deadline = attempt_expires_at(attempt)
        still_in_window = deadline is None or deadline > now
        attempt.expires_at = now
        attempt.status = ExamAttempt.Status.EXPIRED
        attempt.submitted_at = now
        attempt.last_activity_at = now
        attempt.save(update_fields=("expires_at", "status", "submitted_at", "last_activity_at", "updated_at"))
        if still_in_window:
            record_attempt_event(attempt, AttemptEvent.Kind.EXAM_CLOSED, detail={"reason": reason})
        _grade_attempt(attempt, finalized_at=now)
        closed += 1
    return closed


def shift_open_attempt_deadlines(exam: Exam, minutes: int) -> int:
    """Push the deadline of attempts that are still writing when the teacher grants extra time."""
    if minutes <= 0:
        return 0
    from django.db.models import Q

    now = timezone.now()
    open_attempts = ExamAttempt.objects.filter(exam=exam, status=ExamAttempt.Status.IN_PROGRESS)
    # Rows created before the snapshot column existed are backfilled so they also benefit.
    legacy = open_attempts.filter(expires_at__isnull=True).exclude(started_at__isnull=True)
    for attempt in legacy:
        attempt.expires_at = compute_attempt_deadline(attempt.exam, attempt.started_at)
        attempt.save(update_fields=("expires_at", "updated_at"))
    updated = 0
    for attempt in open_attempts.filter(Q(expires_at__gt=now)).order_by("pk"):
        attempt.expires_at = attempt.expires_at + timedelta(minutes=minutes)
        attempt.save(update_fields=("expires_at", "updated_at"))
        updated += 1
    return updated


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
    correct_count = incorrect_count = unanswered_count = pending_manual_count = manual_count = 0
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
            manual_count += 1
            if answer.manual_score is None:
                pending_manual_count += 1
            else:
                score += answer.manual_score
            continue

        if question.type == Question.Type.SHORT_ANSWER:
            expected_answers = question.configuration.get("expected_answers", [])
            if not expected_answers:
                manual_count += 1
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
    existing = ExamResult.objects.filter(attempt=attempt).first()
    published_already = existing is not None and existing.status == ExamResult.Status.PUBLISHED
    if published_already:
        # Re-grading (a later manual score, a repaired legacy row) must not pull a result back out of
        # the student's hands: publication is only ever reversed on purpose.
        result_status = ExamResult.Status.PUBLISHED
    defaults = {
        "status": result_status,
        "score": score,
        "percentage": percentage,
        # The denominator is frozen with the score so a later marks edit cannot contradict the result.
        "maximum_score": total_marks,
        "correct_count": correct_count,
        "incorrect_count": incorrect_count,
        "unanswered_count": unanswered_count,
        "pending_manual_grading_count": pending_manual_count,
        "manual_grading_count": manual_count,
        "computed_at": finalized_at,
        "published_at": (existing.published_at if published_already and existing.published_at else (finalized_at if result_status == ExamResult.Status.PUBLISHED else None)),
        "revised_at": finalized_at if published_already else None,
    }
    result, _ = ExamResult.objects.update_or_create(attempt=attempt, defaults=defaults)
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


def _ensure_active_locked_attempt(
    attempt_id: Any, student: User, *, client_session: str = "", expected_revision: int | None = None
) -> ExamAttempt:
    """Lock the attempt and prove the caller may still write to it.

    Two guards, both server-side, both required by real failure modes:
      * session guard — a second tab cannot quietly overwrite the answers of the tab that is writing;
      * revision guard — a retried or offline-queued request cannot land on top of a newer answer.
    Neither is trusted from the client for *time*; the deadline is still ours.
    """
    attempt = _locked_attempt(attempt_id)
    if attempt.student_id != student.id:
        raise ValidationError({"attempt": ["This exam session is not available."]})
    attempt = finalize_expired_attempt(attempt)
    if attempt.status != ExamAttempt.Status.IN_PROGRESS:
        raise AttemptConflict(
            "This exam session can no longer be changed.",
            code="attempt_finalized",
            status=attempt.status,
            submitted_at=attempt.submitted_at,
        )
    if client_session and session_is_locked_by_other(attempt, client_session):
        raise AttemptConflict(
            "This exam is open in another browser window that is still writing.",
            code="another_session_active",
            last_activity_at=attempt.last_activity_at,
        )
    if expected_revision is not None and expected_revision < attempt.answer_revision:
        record_attempt_event(
            attempt,
            AttemptEvent.Kind.STALE_WRITE_REJECTED,
            detail={"expected": expected_revision, "current": attempt.answer_revision},
        )
        raise AttemptConflict(
            "That answer is out of date, so it was not saved over the newer one.",
            code="stale_revision",
            answer_revision=attempt.answer_revision,
        )
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


def save_answer(
    attempt_id: Any,
    student: User,
    question: Question,
    answer_data: dict[str, Any],
    *,
    client_session: str = "",
    expected_revision: int | None = None,
) -> StudentAnswer:
    with transaction.atomic():
        attempt = _ensure_active_locked_attempt(
            attempt_id, student, client_session=client_session, expected_revision=expected_revision
        )
        answer = _save_answer_for_locked_attempt(attempt, question, answer_data)
        _touch_attempt(attempt, client_session=client_session)
        return answer


def save_answers_batch(
    attempt_id: Any,
    student: User,
    updates: list[tuple[Question, dict[str, Any]]],
    *,
    client_session: str = "",
    expected_revision: int | None = None,
) -> list[StudentAnswer]:
    """All-or-nothing batch autosave; a partial failure rolls the whole batch back."""
    with transaction.atomic():
        attempt = _ensure_active_locked_attempt(
            attempt_id, student, client_session=client_session, expected_revision=expected_revision
        )
        answers = [_save_answer_for_locked_attempt(attempt, question, answer_data) for question, answer_data in updates]
        _touch_attempt(attempt, client_session=client_session)
        return answers


def _touch_attempt(attempt: ExamAttempt, *, client_session: str = "") -> ExamAttempt:
    """One accepted write = one revision. The counter is bumped in SQL, never from client input."""
    now = timezone.now()
    attempt.answer_revision = (attempt.answer_revision or 0) + 1
    fields = ["answer_revision", "last_activity_at", "updated_at"]
    if client_session and not attempt.client_session:
        attempt.client_session = client_session[:64]
        fields.append("client_session")
    attempt.last_activity_at = now
    attempt.save(update_fields=fields)
    return attempt


def set_question_flag(
    attempt_id: Any,
    student: User,
    question: Question,
    *,
    is_flagged: bool,
    client_session: str = "",
    expected_revision: int | None = None,
) -> StudentAnswer:
    with transaction.atomic():
        attempt = _ensure_active_locked_attempt(
            attempt_id, student, client_session=client_session, expected_revision=expected_revision
        )
        _validate_attempt_question(attempt, question)
        answer, _ = StudentAnswer.objects.get_or_create(
            attempt=attempt,
            question=question,
            defaults={"answer_data": {}, "is_flagged": is_flagged},
        )
        changed = answer.is_flagged != is_flagged
        if changed:
            answer.is_flagged = is_flagged
            answer.save(update_fields=("is_flagged", "updated_at"))
        # A flag is an edit too: it takes a revision so a queued answer cannot land after it unnoticed.
        if changed:
            _touch_attempt(attempt, client_session=client_session)
        else:
            attempt.last_activity_at = timezone.now()
            attempt.save(update_fields=("last_activity_at", "updated_at"))
        return answer


def submit_attempt(
    attempt_id: Any,
    student: User,
    *,
    client_session: str = "",
    trigger: str = "manual",
) -> tuple[ExamAttempt, "ExamResult"]:
    """Finalize once; repeated submit calls safely return the existing finalized result."""
    from apps.results.models import ExamResult

    with transaction.atomic():
        attempt = _locked_attempt(attempt_id)
        if attempt.student_id != student.id:
            raise ValidationError({"attempt": ["This exam session is not available."]})

        attempt = finalize_expired_attempt(attempt)
        if attempt.status == ExamAttempt.Status.IN_PROGRESS and not attempt.exam.settings.allow_unanswered:
            # The teacher asked for a complete answer sheet; the server enforces it, the UI only warns.
            missing = unanswered_question_ids(attempt)
            if missing:
                raise ValidationError({
                    "answers": [
                        f"{len(missing)} question(s) are still empty and this exam requires an answer to all of them."
                    ]
                })
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
        if trigger == "auto":
            record_attempt_event(attempt, AttemptEvent.Kind.AUTO_SUBMITTED, detail={"seconds_left": 0})
        if client_session:
            adopt_client_session(attempt, client_session, reason="submit")
        result = _grade_attempt(attempt, finalized_at=now)
        if result.pending_manual_grading_count:
            from apps.notifications.models import Notification
            from apps.notifications.services import notify_teacher

            notify_teacher(
                attempt,
                kind=Notification.Kind.GRADING_REQUIRED,
                title="پاسخ در انتظار تصحیح",
                body=(
                    f"{result.pending_manual_grading_count} پاسخ در «{attempt.exam.title}» "
                    "برای نمرهٔ دستی باقی مانده است."
                ),
            )
        return attempt, result


def refresh_attempt_if_expired(attempt_id: Any, student: User) -> ExamAttempt:
    """Used by read endpoints so stale sessions cannot remain IN_PROGRESS indefinitely."""
    with transaction.atomic():
        attempt = _locked_attempt(attempt_id)
        if attempt.student_id != student.id:
            raise ValidationError({"attempt": ["This exam session is not available."]})
        return finalize_expired_attempt(attempt)
