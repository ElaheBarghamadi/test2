from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from datetime import timedelta
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, Max, Prefetch, Sum
from django.utils import timezone

from .content_identity import question_content_hash
from .models import Exam, ExamSettings, Question, QuestionOption
from apps.notifications.models import Notification
from apps.notifications.services import notify, notify_exam_audience


CHOICE_QUESTION_TYPES = {
    Question.Type.MULTIPLE_CHOICE,
    Question.Type.MULTIPLE_ANSWER,
    Question.Type.TRUE_FALSE,
}


def validate_question_configuration(question_type: str, configuration: Any) -> dict[str, list[str]]:
    """Validate the intentionally small, typed metadata surface for each question type."""
    if not isinstance(configuration, dict):
        return {"configuration": ["Configuration must be an object."]}

    allowed_fields: dict[str, set[str]] = {
        Question.Type.MULTIPLE_CHOICE: set(),
        Question.Type.MULTIPLE_ANSWER: set(),
        Question.Type.TRUE_FALSE: set(),
        Question.Type.SHORT_ANSWER: {"expected_answers", "case_sensitive", "max_length", "placeholder"},
        Question.Type.WRITTEN: {"max_length", "placeholder", "grading_note"},
    }
    errors: dict[str, list[str]] = {}
    unknown_fields = set(configuration) - allowed_fields[question_type]
    if unknown_fields:
        errors["configuration"] = [
            f"Unsupported configuration fields for this question type: {', '.join(sorted(unknown_fields))}."
        ]

    max_length = configuration.get("max_length")
    if max_length is not None and (not isinstance(max_length, int) or isinstance(max_length, bool) or max_length < 1):
        errors.setdefault("configuration", []).append("max_length must be a positive integer.")

    if "case_sensitive" in configuration and not isinstance(configuration["case_sensitive"], bool):
        errors.setdefault("configuration", []).append("case_sensitive must be a boolean.")

    expected_answers = configuration.get("expected_answers")
    if expected_answers is not None:
        if not isinstance(expected_answers, list) or not expected_answers or any(
            not isinstance(answer, str) or not answer.strip() for answer in expected_answers
        ):
            errors.setdefault("configuration", []).append(
                "expected_answers must be a non-empty list of non-empty strings."
            )

    for text_field in ("placeholder", "grading_note"):
        value = configuration.get(text_field)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            errors.setdefault("configuration", []).append(f"{text_field} must be a non-empty string when supplied.")
    return errors


def question_definition_errors(
    question_type: str,
    options: Iterable[Mapping[str, Any]] | None,
    configuration: Any,
    *,
    require_options: bool = True,
) -> dict[str, list[str]]:
    """Return client-safe question validation errors without persisting partial content."""
    errors = validate_question_configuration(question_type, configuration)
    option_list = list(options or [])
    correct_count = sum(bool(option.get("is_correct")) for option in option_list)

    if question_type == Question.Type.MULTIPLE_CHOICE:
        if require_options and len(option_list) < 2:
            errors.setdefault("options", []).append("A multiple-choice question needs at least two options.")
        if require_options and correct_count != 1:
            errors.setdefault("options", []).append("A multiple-choice question needs exactly one correct option.")
    elif question_type == Question.Type.MULTIPLE_ANSWER:
        if require_options and len(option_list) < 2:
            errors.setdefault("options", []).append("A multiple-answer question needs at least two options.")
        if require_options and correct_count < 1:
            errors.setdefault("options", []).append("A multiple-answer question needs at least one correct option.")
    elif question_type == Question.Type.TRUE_FALSE:
        if require_options and len(option_list) != 2:
            errors.setdefault("options", []).append("A true/false question needs exactly two options.")
        if require_options and correct_count != 1:
            errors.setdefault("options", []).append("A true/false question needs exactly one correct option.")
    elif question_type in {Question.Type.SHORT_ANSWER, Question.Type.WRITTEN} and option_list:
        errors.setdefault("options", []).append("Text questions cannot have answer options.")
    return errors


def validate_exam_for_publication(exam: Exam) -> None:
    """One reusable publish gate for API actions and future admin actions."""
    errors: dict[str, list[str]] = {}
    if not exam.title.strip():
        errors.setdefault("title", []).append("An exam title is required.")
    if exam.end_at and not exam.start_at:
        errors.setdefault("start_at", []).append("A start time is required when an end time is set.")
    if exam.start_at and exam.end_at and exam.end_at <= exam.start_at:
        errors.setdefault("end_at", []).append("End time must be after start time.")
    if not exam.questions.exists():
        errors.setdefault("questions", []).append("An exam needs at least one question.")

    for question in exam.questions.prefetch_related("options").order_by("order"):
        option_data = [
            {"text": option.text, "is_correct": option.is_correct, "order": option.order}
            for option in question.options.all()
        ]
        question_errors = question_definition_errors(question.type, option_data, question.configuration)
        if question_errors:
            errors[f"question:{question.id}"] = [
                message for messages in question_errors.values() for message in messages
            ]
    if errors:
        raise ValidationError(errors)


def refresh_question_hashes(exam: Exam) -> int:
    """(Re)compute the content fingerprint of every question in an exam.

    Bulk copies write rows without going through the question serializer, so their fingerprints have to be
    set here. Two rows that turn out to share one fingerprint leave the *later* one unhashed rather than
    being merged or deleted: a duplicate a student has already answered is history, and history is not this
    function's to rewrite.
    """
    claimed: set[str] = set()
    updated = 0
    for question in exam.questions.prefetch_related("options").order_by("order"):
        identity = question_content_hash(question)
        if identity in claimed:
            if question.content_hash:
                question.content_hash = ""
                question.save(update_fields=("content_hash", "updated_at"))
            continue
        claimed.add(identity)
        if question.content_hash != identity:
            question.content_hash = identity
            question.save(update_fields=("content_hash", "updated_at"))
            updated += 1
    return updated


def refresh_total_marks(exam: Exam) -> None:
    """Persist a query-friendly marks total whenever teacher content changes."""
    total = exam.questions.aggregate(total=Sum("marks"))["total"] or 0
    exam.total_marks = total
    exam.save(update_fields=("total_marks", "updated_at"))


def _locked_exam(exam_id) -> Exam:
    return Exam.objects.select_for_update().select_related("settings", "teacher").get(pk=exam_id)


def publish_exam(exam_id) -> Exam:
    """Move a valid draft/scheduled exam into its schedule-appropriate visible state."""
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status not in {Exam.Status.DRAFT, Exam.Status.SCHEDULED}:
            raise ValidationError({"status": ["Only draft or scheduled exams can be published."]})
        validate_exam_for_publication(exam)

        now = timezone.now()
        if exam.end_at and exam.end_at <= now:
            raise ValidationError({"schedule": ["An exam whose end time has passed cannot be published."]})
        if exam.start_at and exam.start_at > now:
            target_status = Exam.Status.SCHEDULED
        else:
            target_status = Exam.Status.ACTIVE

        if exam.status == Exam.Status.SCHEDULED and target_status == Exam.Status.SCHEDULED:
            raise ValidationError({"status": ["This exam is already scheduled and cannot be activated before its start time."]})

        refresh_total_marks(exam)
        exam.status = target_status
        exam.status_before_archive = None
        exam.save(update_fields=("status", "status_before_archive", "updated_at"))
        notify_exam_audience(
            exam,
            kind=Notification.Kind.EXAM_PUBLISHED,
            title="آزمون تازه منتشر شد",
            body=f"«{exam.title}» برای شما منتشر شد.",
        )
        return exam


def archive_exam(exam_id) -> Exam:
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status == Exam.Status.ARCHIVED:
            raise ValidationError({"status": ["This exam is already archived."]})
        exam.status_before_archive = exam.status
        exam.status = Exam.Status.ARCHIVED
        exam.save(update_fields=("status", "status_before_archive", "updated_at"))
        # Archiving takes the exam away from the class, so no attempt may stay open behind it.
        from apps.attempts.services import close_exam_attempts

        close_exam_attempts(exam, reason="archived")
        return exam


def restore_exam(exam_id) -> Exam:
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status != Exam.Status.ARCHIVED:
            raise ValidationError({"status": ["Only archived exams can be restored."]})

        target_status = exam.status_before_archive or Exam.Status.DRAFT
        now = timezone.now()
        if target_status in {Exam.Status.SCHEDULED, Exam.Status.ACTIVE}:
            if exam.end_at and exam.end_at <= now:
                target_status = Exam.Status.COMPLETED
            elif exam.start_at and exam.start_at <= now:
                target_status = Exam.Status.ACTIVE
            elif exam.start_at:
                target_status = Exam.Status.SCHEDULED
            else:
                target_status = Exam.Status.ACTIVE

        exam.status = target_status
        exam.status_before_archive = None
        exam.save(update_fields=("status", "status_before_archive", "updated_at"))
        return exam


def complete_exam(exam_id) -> Exam:
    """End an exam now: the writing window closes and every open attempt is graded as it stands."""
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status != Exam.Status.ACTIVE:
            raise ValidationError({"status": ["Only active exams can be completed."]})
        exam.status = Exam.Status.COMPLETED
        exam.save(update_fields=("status", "updated_at"))
        from apps.attempts.services import close_exam_attempts

        closed = close_exam_attempts(exam, reason="completed")
        notify(
            [exam.teacher],
            kind=Notification.Kind.EXAM_ENDED,
            title="آزمون پایان یافت",
            body=f"«{exam.title}» بسته شد؛ {closed} تلاش باز نهایی گردید.",
            link=f"/teacher/results?exam={exam.pk}",
            exam=exam,
            # Ending can legitimately happen again after a restore, so this one is allowed to repeat.
            dedupe="",
        )
        return exam


def start_exam_now(exam_id) -> Exam:
    """Bring forward a scheduled exam: validate it once, then open it immediately.

    Teachers use this when a class is sitting in the room and the scheduled start time no longer
    reflects reality. The publish gate is reused so an exam can never be opened with broken content.
    """
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status not in {Exam.Status.DRAFT, Exam.Status.SCHEDULED}:
            raise ValidationError({"status": ["Only draft or scheduled exams can be started now."]})
        validate_exam_for_publication(exam)

        now = timezone.now()
        if exam.end_at and exam.end_at <= now:
            raise ValidationError({"schedule": ["An exam whose end time has passed cannot be started."]})
        if exam.start_at and exam.start_at > now:
            exam.start_at = now
        refresh_total_marks(exam)
        exam.status = Exam.Status.ACTIVE
        exam.status_before_archive = None
        exam.save(update_fields=("status", "status_before_archive", "start_at", "total_marks", "updated_at"))
        notify_exam_audience(
            exam,
            kind=Notification.Kind.EXAM_STARTED,
            title="آزمون آغاز شد",
            body=f"«{exam.title}» اکنون باز است و زمانش شمارش شروع می‌شود.",
            link=f"/student/exam/{exam.pk}",
        )
        return exam


def extend_exam_time(exam_id, extra_minutes: int) -> Exam:
    """Grant extra minutes to an active exam without touching already submitted attempts.

    Attempt expiry is derived from `duration_minutes`, so raising it widens the window for every
    attempt that is still in progress; the end-of-access window moves by the same amount.
    """
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status != Exam.Status.ACTIVE:
            raise ValidationError({"status": ["Only active exams can be extended."]})
        if extra_minutes < 1:
            raise ValidationError({"extra_minutes": ["Extension must be at least one minute."]})
        exam.duration_minutes = exam.duration_minutes + extra_minutes
        if exam.end_at:
            exam.end_at = max(exam.end_at, timezone.now()) + timedelta(minutes=extra_minutes)
        exam.save(update_fields=("duration_minutes", "end_at", "updated_at"))
        # Attempt deadlines are snapshots, so an extension has to be applied on purpose: students who
        # are mid-answer get exactly the same extra minutes, and nobody else's history moves.
        from apps.attempts.services import shift_open_attempt_deadlines

        shift_open_attempt_deadlines(exam, extra_minutes)
        return exam


def duplicate_exam(exam_id, owner) -> Exam:
    """Create a complete draft copy in one transaction without mutating the source exam."""
    with transaction.atomic():
        source = (
            Exam.objects.select_for_update()
            .select_related("settings")
            .prefetch_related(
                Prefetch(
                    "questions",
                    queryset=Question.objects.order_by("order").prefetch_related(
                        Prefetch("options", queryset=QuestionOption.objects.order_by("order"))
                    ),
                )
            )
            .get(pk=exam_id)
        )
        duplicate = Exam.objects.create(
            title=f"{source.title} (Copy)",
            description=source.description,
            subject=source.subject,
            grade=source.grade,
            class_name=source.class_name,
            instructions=source.instructions,
            teacher=owner,
            status=Exam.Status.DRAFT,
            duration_minutes=source.duration_minutes,
            total_marks=source.total_marks,
            start_at=source.start_at,
            end_at=source.end_at,
        )

        source_settings = source.settings
        duplicate_settings, _ = ExamSettings.objects.get_or_create(exam=duplicate)
        for field in (
            "allow_previous_questions",
            "randomize_questions",
            "result_visibility",
            "show_correct_answers",
            "result_detail",
            "max_attempts",
            "passing_percentage",
        ):
            setattr(duplicate_settings, field, getattr(source_settings, field))
        duplicate_settings.full_clean()
        duplicate_settings.save()

        for source_question in source.questions.all():
            duplicate_question = Question.objects.create(
                exam=duplicate,
                type=source_question.type,
                text=source_question.text,
                instructions=source_question.instructions,
                order=source_question.order,
                marks=source_question.marks,
                configuration=deepcopy(source_question.configuration),
                explanation=source_question.explanation,
            )
            QuestionOption.objects.bulk_create([
                QuestionOption(
                    question=duplicate_question,
                    text=source_option.text,
                    is_correct=source_option.is_correct,
                    order=source_option.order,
                )
                for source_option in source_question.options.all()
            ])
        refresh_total_marks(duplicate)
        refresh_question_hashes(duplicate)
        return duplicate


def close_overdue_exams(*, owner=None) -> int:
    """Move active exams whose window has closed into `completed`.

    There is no scheduler in this stack and 180 students do not justify one. Reading the exam list is
    the natural moment to reconcile the state, and the transition is idempotent, so the teacher panel
    and the student availability rule stop disagreeing about an exam that has already finished.
    """
    now = timezone.now()
    overdue = Exam.objects.filter(status=Exam.Status.ACTIVE, end_at__isnull=False, end_at__lte=now)
    if owner is not None and getattr(owner, "role", None) == "teacher":
        overdue = overdue.filter(teacher=owner)
    closed = 0
    for exam_id in list(overdue.values_list("id", flat=True)):
        with transaction.atomic():
            exam = Exam.objects.select_for_update().get(pk=exam_id)
            if exam.status != Exam.Status.ACTIVE or not exam.end_at or exam.end_at > timezone.now():
                continue
            exam.status = Exam.Status.COMPLETED
            exam.save(update_fields=("status", "updated_at"))
            from apps.attempts.services import close_exam_attempts

            close_exam_attempts(exam, reason="window_closed")
            closed += 1
    return closed


def copy_questions_into_exam(exam: Exam, question_ids: list, teacher) -> tuple[list, int]:  # type: ignore[no-untyped-def]
    """Insert copies of bank questions at the end of an exam, in the selected order.

    Returns the new question ids and how many selections were dropped as duplicates of what the exam
    already holds.

    Copying rather than linking is deliberate. A question that is *shared* between two exams would
    change the answer sheet of a live exam the moment someone edits it for the other one, and it would
    silently re-grade attempts that were already submitted. The link (`copied_from`) only exists so the
    bank can report where a question ended up.
    """
    from django.db import transaction as db_transaction

    from .models import QuestionTag

    with db_transaction.atomic():
        locked = Exam.objects.select_for_update().get(pk=exam.pk)
        if locked.status in {Exam.Status.ARCHIVED}:
            raise ValidationError({"exam": ["An archived exam cannot be changed."]})
        sources = list(
            Question.objects.select_related("exam")
            .prefetch_related(Prefetch("options", queryset=QuestionOption.objects.order_by("order")), "tags")
            .filter(pk__in=question_ids)
        )
        by_id = {str(question.pk): question for question in sources}
        missing = [str(question_id) for question_id in question_ids if str(question_id) not in by_id]
        if missing:
            raise ValidationError({"question_ids": ["One or more questions no longer exist. Reload the bank and try again."]})
        # A bank row has no parent exam, so its owner is the field that answers "whose is this".
        def source_owner_id(question: Question) -> object:
            return question.owner_id if question.exam_id is None else question.exam.teacher_id

        foreign = [
            question
            for question in sources
            if source_owner_id(question) != getattr(teacher, "pk", None) and getattr(teacher, "role", None) != "admin"
        ]
        unfinished = [question for question in sources if question.status == Question.Status.DRAFT]
        if unfinished:
            # A draft is a question its author has not finished: it stays on the shelf until they say so, and
            # inserting it into a paper is the one thing the flag exists to prevent.
            raise ValidationError(
                {"question_ids": ["Draft questions cannot be added to an exam. Open it in the bank and mark it ready."]}
            )
        if foreign and getattr(teacher, "role", None) != "admin":
            raise ValidationError({"question_ids": ["You can only reuse questions from your own exams."]})

        next_order = (locked.questions.aggregate(max_order=Max("order"))["max_order"] or 0)
        # Inserting a question the exam already holds would give the student the same statement twice for
        # double the marks, so the destination's own fingerprints (recomputed for any legacy row that never
        # got one) decide what is skipped.
        present = {(question.content_hash or question_content_hash(question)) for question in locked.questions.prefetch_related("options")}
        seen: set[str] = set()
        skipped = 0
        created: list[Question] = []
        for question_id in question_ids:
            source = by_id[str(question_id)]
            identity = question_content_hash(source)
            if identity in present or identity in seen:
                skipped += 1
                continue
            seen.add(identity)
            next_order += 1
            copy = Question.objects.create(
                exam=locked,
                content_hash=identity,
                type=source.type,
                text=source.text,
                instructions=source.instructions,
                order=next_order,
                marks=source.marks,
                configuration=deepcopy(source.configuration),
                explanation=source.explanation,
                difficulty=source.difficulty,
                copied_from=source,
            )
            QuestionOption.objects.bulk_create(
                [
                    QuestionOption(question=copy, text=option.text, is_correct=option.is_correct, order=index)
                    for index, option in enumerate(source.options.all(), start=1)
                ]
            )
            for tag in source.tags.all():
                target_tag, _ = QuestionTag.objects.get_or_create(
                    teacher_id=locked.teacher_id, name=tag.name, defaults={"name": tag.name}
                )
                copy.tags.add(target_tag)
            created.append(copy)
        refresh_total_marks(locked)
        return [str(question.pk) for question in created], skipped


def reorder_questions(exam_id, question_ids: list) -> None:
    """Safely reorder every question in an exam; the complete ordered set is required."""
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        current_ids = list(exam.questions.order_by("order").values_list("id", flat=True))
        if len(question_ids) != len(set(question_ids)):
            raise ValidationError({"question_ids": ["Question IDs must not contain duplicates."]})
        if set(question_ids) != set(current_ids):
            raise ValidationError({"question_ids": ["Question IDs must be the complete set of this exam's questions."]})

        if not current_ids:
            return
        max_order = exam.questions.aggregate(max_order=Max("order"))["max_order"] or 0
        exam.questions.update(order=F("order") + max_order + len(current_ids) + 1)
        for order, question_id in enumerate(question_ids, start=1):
            Question.objects.filter(pk=question_id, exam=exam).update(order=order)


def resequence_questions(exam_id) -> None:
    """Close order gaps after a question removal without transient unique-constraint collisions."""
    exam = _locked_exam(exam_id)
    question_ids = list(exam.questions.order_by("order").values_list("id", flat=True))
    if not question_ids:
        return
    max_order = exam.questions.aggregate(max_order=Max("order"))["max_order"] or 0
    exam.questions.update(order=F("order") + max_order + len(question_ids) + 1)
    for order, question_id in enumerate(question_ids, start=1):
        Question.objects.filter(pk=question_id, exam=exam).update(order=order)
