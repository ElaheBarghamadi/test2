from __future__ import annotations

from decimal import Decimal
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedUUIDModel
from apps.core.private_storage import PrivateMediaStorage
from apps.exams.models import Exam, Question, QuestionOption
from apps.users.models import User


_PRIVATE_MEDIA_STORAGE = PrivateMediaStorage()


def _answer_media_path(instance, _filename: str) -> str:  # type: ignore[no-untyped-def]
    return f"answer-media/{instance.answer.attempt_id}/{instance.answer.question_id}/{uuid.uuid4().hex}"


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
    # {question_id: [option ids]} in the order this attempt should display them. Snapshot, not derived,
    # so option randomization survives a refresh, a reconnect, and a teacher re-ordering the question.
    option_order = models.JSONField(default=dict, blank=True)
    # The deadline is snapshotted per attempt. Deriving it from the live exam row would let a routine
    # duration edit re-cut the time of every student who is writing right now.
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Optimistic-concurrency counter: rejects a retried/queued write that would overwrite a newer answer.
    answer_revision = models.PositiveIntegerField(default=0)
    # Highest question index (into this attempt's own snapshot order) an answer was ever written to.
    # The "no going back" rule is measured against it: with `allow_previous_questions` off, a question
    # below the frontier has been passed and its answer is final. Index-based, never `Question.order`,
    # because a randomized attempt does not run in `order` sequence.
    answer_frontier = models.PositiveSmallIntegerField(default=0)
    # Tab/device ownership of the session. Enforced server-side so a second tab cannot clobber answers.
    client_session = models.CharField(max_length=64, blank=True)
    # Short hash of the starting User-Agent, stored only for an enabled enforced browser lock. It allows the
    # same browser after refresh; a different User-Agent may be refused, but this cannot identify hardware and
    # different physical devices may share or spoof the same value.
    device_signature = models.CharField(max_length=64, blank=True)
    # Readable connection metadata is collected only when the teacher explicitly enabled it for this exam.
    # These are a start-time snapshot, not a claim to identify a person or physical device.
    client_ip_address = models.GenericIPAddressField(null=True, blank=True)
    client_user_agent = models.CharField(max_length=512, blank=True)
    # Visibility departures are provisional until the configured grace period has elapsed. They are not
    # AttemptEvent rows until the server confirms a long departure, so quick returns create no warning.
    visibility_hidden_at = models.DateTimeField(null=True, blank=True)
    visibility_violation_recorded = models.BooleanField(default=False)
    session_switch_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=("exam", "student", "attempt_number"), name="unique_exam_student_attempt_number"),
            models.CheckConstraint(condition=models.Q(attempt_number__gte=1), name="attempt_number_positive"),
        ]
        indexes = [
            models.Index(fields=("student", "status")),
            models.Index(fields=("exam", "status")),
            models.Index(fields=("exam", "student")),
            models.Index(fields=("status", "expires_at")),
        ]

    def __str__(self) -> str:
        return f"{self.student} · {self.exam} · #{self.attempt_number}"

    @property
    def is_finalized(self) -> bool:
        return self.status in {self.Status.SUBMITTED, self.Status.EXPIRED}

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


class StudentAnswerAttachment(TimeStampedUUIDModel):
    """Private image/audio response, linked to the answer rather than embedded in JSON or base64."""

    class Kind(models.TextChoices):
        IMAGE = "image", "Image"
        AUDIO = "audio", "Audio"

    answer = models.ForeignKey(StudentAnswer, on_delete=models.CASCADE, related_name="attachments")
    kind = models.CharField(max_length=8, choices=Kind.choices, db_index=True)
    file = models.FileField(upload_to=_answer_media_path, storage=_PRIVATE_MEDIA_STORAGE, max_length=255)
    original_name = models.CharField(max_length=180)
    content_type = models.CharField(max_length=80)
    size_bytes = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        ordering = ("created_at",)
        indexes = [models.Index(fields=("answer", "kind", "created_at"))]
        constraints = [models.CheckConstraint(condition=models.Q(size_bytes__gt=0), name="answer_media_size_positive")]

    def __str__(self) -> str:
        return f"{self.kind} · {self.answer_id}"


class AttemptEvent(TimeStampedUUIDModel):
    """Server-recorded session and activity signals for one attempt.

    These are *observations*, not verdicts: a teacher reads them next to the answers, and nothing here
    automatically penalises a student. Timestamps always come from the server, never from the browser.
    """

    class Kind(models.TextChoices):
        SESSION_SWITCH = "session_switch", "Another browser session took over"
        TAB_HIDDEN = "tab_hidden", "Exam tab hidden"
        TAB_VISIBLE = "tab_visible", "Exam tab visible again"
        DISCONNECTED = "disconnected", "Connection lost"
        RECONNECTED = "reconnected", "Connection restored"
        AUTO_SUBMITTED = "auto_submitted", "Submitted when the timer expired"
        EXAM_CLOSED = "exam_closed", "Finalized because the teacher ended the exam"
        STALE_WRITE_REJECTED = "stale_write_rejected", "Out-of-date save request rejected"
        QUESTION_LOCKED = "question_locked", "Edit refused by the no-return rule"
        # Browser-observed integrity signals. Recorded only when the teacher switched monitoring on.
        COPY = "copy", "Copied text out of the exam"
        CUT = "cut", "Cut text inside the exam"
        PASTE = "paste", "Pasted text into an answer"
        FULLSCREEN_ENTER = "fullscreen_enter", "Fullscreen started"
        FULLSCREEN_EXIT = "fullscreen_exit", "Fullscreen left"
        SCREENSHOT_SHORTCUT = "screenshot_shortcut", "A common print/screenshot shortcut reached the exam page"
        SESSION_LOCK_REFUSED = "session_lock_refused", "Another device was refused the attempt"
        TAB_LIMIT_REACHED = "tab_limit_reached", "Tab-switch limit reached"

    attempt = models.ForeignKey(ExamAttempt, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=32, choices=Kind.choices, db_index=True)
    detail = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("attempt", "kind")), models.Index(fields=("attempt", "created_at"))]

    def __str__(self) -> str:
        return f"{self.attempt} · {self.kind}"
