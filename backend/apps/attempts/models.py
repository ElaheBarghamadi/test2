from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedUUIDModel
from apps.exams.models import Exam, Question, QuestionOption
from apps.users.models import User


class ExamAttempt(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "Not started"
        IN_PROGRESS = "in_progress", "In progress"
        SUBMITTED = "submitted", "Submitted"
        EXPIRED = "expired", "Expired"

    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name="attempts")
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="exam_attempts")
    attempt_number = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NOT_STARTED, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    last_activity_at = models.DateTimeField(default=timezone.now, db_index=True)
    # Backend-generated question UUID order; keeps randomized order stable across sessions.
    question_order = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [models.UniqueConstraint(fields=("exam", "student", "attempt_number"), name="unique_exam_student_attempt_number")]
        indexes = [
            models.Index(fields=("student", "status")),
            models.Index(fields=("exam", "status")),
            models.Index(fields=("exam", "student")),
        ]

    def __str__(self) -> str:
        return f"{self.student} · {self.exam} · #{self.attempt_number}"

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if self.student_id and getattr(self.student, "role", None) != User.Role.STUDENT:
            errors["student"] = "Only student users may create exam attempts."
        if self.attempt_number < 1:
            errors["attempt_number"] = "Attempt number must start at 1."
        if self.submitted_at and self.started_at and self.submitted_at < self.started_at:
            errors["submitted_at"] = "Submission cannot precede the attempt start."
        if errors:
            raise ValidationError(errors)


class StudentAnswer(TimeStampedUUIDModel):
    attempt = models.ForeignKey(ExamAttempt, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(Question, on_delete=models.PROTECT, related_name="student_answers")
    # JSON supports true/false and text payloads while selected_options preserves relational integrity for choices.
    answer_data = models.JSONField(default=dict, blank=True)
    selected_options = models.ManyToManyField(QuestionOption, blank=True, related_name="selected_by_answers")
    is_flagged = models.BooleanField(default=False)
    manual_score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    feedback = models.TextField(blank=True)

    class Meta:
        ordering = ("question__order",)
        constraints = [models.UniqueConstraint(fields=("attempt", "question"), name="unique_answer_per_attempt_question")]
        indexes = [models.Index(fields=("attempt", "question")), models.Index(fields=("question",))]

    def __str__(self) -> str:
        return f"{self.attempt} · {self.question}"

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if self.attempt_id and self.question_id and self.question.exam_id != self.attempt.exam_id:
            errors["question"] = "Answer question must belong to the attempt exam."
        if self.manual_score is not None and self.manual_score < Decimal("0"):
            errors["manual_score"] = "Manual score cannot be negative."
        if self.pk:
            incorrect_options = self.selected_options.exclude(question=self.question)
            if incorrect_options.exists():
                errors["selected_options"] = "Selected options must belong to this answer's question."
        if errors:
            raise ValidationError(errors)
