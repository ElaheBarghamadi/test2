from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from datetime import timedelta
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, Max, Prefetch, Sum
from django.utils import timezone

from .models import Exam, ExamSettings, Question, QuestionOption


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
        return exam


def archive_exam(exam_id) -> Exam:
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status == Exam.Status.ARCHIVED:
            raise ValidationError({"status": ["This exam is already archived."]})
        exam.status_before_archive = exam.status
        exam.status = Exam.Status.ARCHIVED
        exam.save(update_fields=("status", "status_before_archive", "updated_at"))
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
    with transaction.atomic():
        exam = _locked_exam(exam_id)
        if exam.status != Exam.Status.ACTIVE:
            raise ValidationError({"status": ["Only active exams can be completed."]})
        exam.status = Exam.Status.COMPLETED
        exam.save(update_fields=("status", "updated_at"))
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
        return duplicate


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
