from __future__ import annotations

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models

from apps.attempts.models import ExamAttempt
from apps.core.models import TimeStampedUUIDModel


class ExamResult(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        PUBLISHED = "published", "Published"
        HIDDEN = "hidden", "Hidden"

    attempt = models.OneToOneField(ExamAttempt, on_delete=models.CASCADE, related_name="result")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    score = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    percentage = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    correct_count = models.PositiveIntegerField(default=0)
    incorrect_count = models.PositiveIntegerField(default=0)
    unanswered_count = models.PositiveIntegerField(default=0)
    pending_manual_grading_count = models.PositiveIntegerField(default=0)
    # Total answers that needed manual grading when this snapshot was taken, so the marking screen can
    # say "17 / 24 graded" instead of only "4 left".
    manual_grading_count = models.PositiveIntegerField(default=0)
    feedback = models.TextField(blank=True)
    # Denominator frozen at grading time. Without it, a later marks edit would leave the stored
    # percentage and the reported maximum contradicting each other.
    maximum_score = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    computed_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    # Set whenever a result that students may already have seen is recomputed.
    revised_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-updated_at",)
        indexes = [models.Index(fields=("status", "published_at"))]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(score__isnull=True) | models.Q(score__lte=models.F("maximum_score")),
                name="score_within_maximum",
            ),
        ]

    def __str__(self) -> str:
        return f"Result: {self.attempt}"

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if self.score is not None and self.score < Decimal("0"):
            errors["score"] = "Score cannot be negative."
        if self.percentage is not None and not Decimal("0") <= self.percentage <= Decimal("100"):
            errors["percentage"] = "Percentage must be between 0 and 100."
        if errors:
            raise ValidationError(errors)

    # Results are stored as a scoring snapshot rather than calculated per read.
    # This keeps historical reports stable after a question or grading rubric changes.
