from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower

from apps.core.models import TimeStampedUUIDModel
from apps.users.models import User


class Exam(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SCHEDULED = "scheduled", "Scheduled"
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    subject = models.CharField(max_length=150, db_index=True)
    grade = models.CharField(max_length=100, blank=True)
    class_name = models.CharField(max_length=100, blank=True)
    instructions = models.TextField(blank=True)
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_exams")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    duration_minutes = models.PositiveIntegerField()
    total_marks = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    start_at = models.DateTimeField(null=True, blank=True, db_index=True)
    end_at = models.DateTimeField(null=True, blank=True)
    # Used only by archive/restore workflow; never client-writable through normal updates.
    status_before_archive = models.CharField(max_length=20, choices=Status.choices, null=True, blank=True, editable=False)

    class Meta:
        ordering = ("-updated_at",)
        indexes = [
            models.Index(fields=("teacher", "status")),
            models.Index(fields=("status", "start_at")),
            models.Index(fields=("subject", "grade")),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(duration_minutes__gte=1), name="exam_duration_positive"),
            models.CheckConstraint(
                condition=(
                    models.Q(end_at__isnull=True)
                    | models.Q(start_at__isnull=True)
                    | models.Q(end_at__gt=models.F("start_at"))
                ),
                name="exam_end_after_start",
            ),
        ]

    def __str__(self) -> str:
        return self.title

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if self.duration_minutes < 1:
            errors["duration_minutes"] = "Duration must be at least one minute."
        if self.end_at and not self.start_at:
            errors["start_at"] = "A start time is required when an end time is set."
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            errors["end_at"] = "End time must be after start time."
        if self.teacher_id and getattr(self.teacher, "role", None) not in {User.Role.TEACHER, User.Role.ADMIN}:
            errors["teacher"] = "Only teachers or administrators can own an exam."
        if errors:
            raise ValidationError(errors)


class ExamSettings(TimeStampedUUIDModel):
    class ResultVisibility(models.TextChoices):
        IMMEDIATE = "immediate", "Immediately after submission"
        PENDING = "pending", "After teacher review"
        HIDDEN = "hidden", "Manually published"

    class QuestionLayout(models.TextChoices):
        PAGED = "paged", "One question per page"
        SINGLE_PAGE = "single_page", "All questions on one page"

    exam = models.OneToOneField(Exam, on_delete=models.CASCADE, related_name="settings")
    allow_previous_questions = models.BooleanField(default=True)
    # Presentation only: paged shows one question at a time, single_page stacks the whole answer sheet.
    # It never changes grading, the snapshot, or which answers are accepted.
    question_layout = models.CharField(
        max_length=12, choices=QuestionLayout.choices, default=QuestionLayout.PAGED
    )
    randomize_questions = models.BooleanField(default=False)
    result_visibility = models.CharField(max_length=20, choices=ResultVisibility.choices, default=ResultVisibility.PENDING)
    show_correct_answers = models.BooleanField(default=False)
    max_attempts = models.PositiveSmallIntegerField(default=1)
    # Option order is randomized per attempt on top of question order; grading never sees these orders.
    randomize_options = models.BooleanField(default=False)
    # False makes "submit" refuse while a question of the attempt snapshot is still blank.
    allow_unanswered = models.BooleanField(default=True)
    # Pass mark as a percentage of the exam total; 0 disables the pass/fail verdict everywhere.
    passing_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        verbose_name_plural = "Exam settings"

    def answerable_question_count(self) -> int:  # pragma: no cover - convenience for admin tooling
        return self.exam.questions.count()

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if self.max_attempts < 1:
            errors["max_attempts"] = "At least one attempt must be allowed."
        if self.passing_percentage < 0 or self.passing_percentage > 100:
            errors["passing_percentage"] = "Passing percentage must be between 0 and 100."
        if errors:
            raise ValidationError(errors)

    def __str__(self) -> str:
        return f"Settings: {self.exam.title}"


class Question(TimeStampedUUIDModel):
    class Type(models.TextChoices):
        MULTIPLE_CHOICE = "multiple_choice", "Multiple choice"
        MULTIPLE_ANSWER = "multiple_answer", "Multiple answer"
        TRUE_FALSE = "true_false", "True / False"
        SHORT_ANSWER = "short_answer", "Short answer"
        WRITTEN = "written", "Written answer"

    class Difficulty(models.TextChoices):
        EASY = "easy", "Easy"
        MEDIUM = "medium", "Medium"
        HARD = "hard", "Hard"

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="questions")
    type = models.CharField(max_length=30, choices=Type.choices, db_index=True)
    text = models.TextField()
    instructions = models.TextField(blank=True)
    order = models.PositiveIntegerField()
    marks = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal("1.00"))
    # Holds type-specific non-secret configuration: e.g. max_length or grading note.
    configuration = models.JSONField(default=dict, blank=True)
    explanation = models.TextField(blank=True)
    # Bank metadata. These never change how a question grades; they only make it findable and reusable.
    difficulty = models.CharField(max_length=10, choices=Difficulty.choices, default=Difficulty.MEDIUM, db_index=True)
    tags = models.ManyToManyField("QuestionTag", related_name="questions", blank=True)
    # Set when this question was copied out of the bank, so the source can report where it is used.
    copied_from = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="copies")
    # Hidden from the bank picker; existing exams keep showing and grading it as before.
    is_archived = models.BooleanField(default=False)

    class Meta:
        ordering = ("order",)
        constraints = [
            models.UniqueConstraint(fields=("exam", "order"), name="unique_question_order_per_exam"),
            models.CheckConstraint(condition=models.Q(order__gte=1), name="question_order_positive"),
            models.CheckConstraint(condition=models.Q(marks__gte=Decimal("0")), name="question_marks_non_negative"),
        ]
        indexes = [
            models.Index(fields=("exam", "order")),
            models.Index(fields=("exam", "type")),
            models.Index(fields=("type", "difficulty")),
            models.Index(fields=("is_archived", "difficulty")),
        ]

    def __str__(self) -> str:
        return f"{self.exam.title} · Q{self.order}"

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if self.order < 1:
            errors["order"] = "Question order must start at 1."
        if self.marks < 0:
            errors["marks"] = "Marks cannot be negative."
        max_length = self.configuration.get("max_length")
        if max_length is not None and (not isinstance(max_length, int) or max_length < 1):
            errors["configuration"] = "max_length must be a positive integer."
        if errors:
            raise ValidationError(errors)

    def option_validation_errors(self) -> list[str]:
        """Validate persisted options; call this when preparing an exam for publication."""
        options = self.options.all()
        count = options.count()
        correct_count = options.filter(is_correct=True).count()
        if self.type == self.Type.MULTIPLE_CHOICE:
            if count < 2:
                return ["A multiple-choice question needs at least two options."]
            if correct_count != 1:
                return ["A multiple-choice question needs exactly one correct option."]
        if self.type == self.Type.MULTIPLE_ANSWER:
            if count < 2:
                return ["A multiple-answer question needs at least two options."]
            if correct_count < 1:
                return ["A multiple-answer question needs at least one correct option."]
        if self.type == self.Type.TRUE_FALSE:
            if count != 2:
                return ["A true/false question needs exactly two options."]
            if correct_count != 1:
                return ["A true/false question needs exactly one correct option."]
        if self.type in {self.Type.SHORT_ANSWER, self.Type.WRITTEN} and count:
            return ["Text questions cannot have answer options."]
        return []


class QuestionOption(TimeStampedUUIDModel):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="options")
    text = models.CharField(max_length=1000)
    is_correct = models.BooleanField(default=False)
    order = models.PositiveIntegerField()

    class Meta:
        ordering = ("order",)
        constraints = [
            models.UniqueConstraint(fields=("question", "order"), name="unique_option_order_per_question"),
            models.CheckConstraint(condition=models.Q(order__gte=1), name="option_order_positive"),
        ]
        indexes = [models.Index(fields=("question", "order"))]

    def __str__(self) -> str:
        return f"{self.question} · option {self.order}"

    def clean(self) -> None:
        if self.question.type not in {Question.Type.MULTIPLE_CHOICE, Question.Type.MULTIPLE_ANSWER, Question.Type.TRUE_FALSE}:
            raise ValidationError({"question": "Only choice and true/false questions may have options."})
        if self.order < 1:
            raise ValidationError({"order": "Option order must start at 1."})


class QuestionTag(TimeStampedUUIDModel):
    """A teacher-scoped label used to make the question bank searchable."""

    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="question_tags")
    name = models.CharField(max_length=60)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(Lower("name"), models.F("teacher"), name="unique_tag_name_per_teacher"),
        ]

    def __str__(self) -> str:
        return self.name

    def clean(self) -> None:
        if not self.name.strip():
            raise ValidationError({"name": "Tag name cannot be blank."})
        if len(self.name.strip()) > 60:
            raise ValidationError({"name": "Tag name must be 60 characters or fewer."})
