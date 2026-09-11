from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedUUIDModel


class Notification(TimeStampedUUIDModel):
    """An in-app message for one account.

    Deliberately a tiny, self-contained surface: no email, no push, no scheduler. A notification is a
    pointer to something the student or teacher can already see in their own space, which is why the
    body is a short summary and `link` is an in-app route. Deleting the underlying exam does not leave
    a dangling row that breaks the list, so the foreign keys are nullable and SET_NULL.
    """

    class Kind(models.TextChoices):
        EXAM_PUBLISHED = "exam_published", "Exam published"
        EXAM_STARTED = "exam_started", "Exam started"
        EXAM_ENDED = "exam_ended", "Exam ended"
        ATTEMPTION_SUBMITTED = "attempt_submitted", "Attempt submitted"
        GRADING_REQUIRED = "grading_required", "Answers waiting for grading"
        GRADING_COMPLETED = "grading_completed", "Manual grading completed"
        RESULT_PUBLISHED = "result_published", "Result published"

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=32, choices=Kind.choices, db_index=True)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True)
    link = models.CharField(max_length=300, blank=True)
    exam = models.ForeignKey("exams.Exam", on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications")
    attempt = models.ForeignKey(
        "attempts.ExamAttempt", on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications"
    )
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    # NULL columns never collide in a SQL unique constraint, so "one notification per event per person"
    # is expressed as a key instead: `exam_published:<exam id>` or `result_published:<attempt id>`.
    # Empty means "this event may legitimately repeat".
    dedupe_key = models.CharField(max_length=140, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("recipient", "is_read", "-created_at")),
            models.Index(fields=("recipient", "kind")),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("recipient", "dedupe_key"),
                condition=~models.Q(dedupe_key=""),
                name="unique_deduped_notification_per_recipient",
            ),
        ]

    def mark_read(self) -> None:
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=("is_read", "read_at", "updated_at"))

    def __str__(self) -> str:
        return f"{self.recipient_id} · {self.kind}"
