from __future__ import annotations

from decimal import Decimal
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower

from apps.core.models import TimeStampedUUIDModel
from apps.core.private_storage import PrivateMediaStorage
from apps.users.models import User


_PRIVATE_MEDIA_STORAGE = PrivateMediaStorage()


def _question_media_path(instance, _filename: str) -> str:  # type: ignore[no-untyped-def]
    # Ignore the untrusted browser filename and never create a public/static URL for this object.
    return f"question-media/{instance.question_id}/{uuid.uuid4().hex}"


class Exam(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SCHEDULED = "scheduled", "Scheduled"
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    class AudienceMode(models.TextChoices):
        PROFILE = "profile", "Grade and class"
        SELECTED = "selected", "Selected groups and students"

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    subject = models.CharField(max_length=150, db_index=True)
    grade = models.CharField(max_length=100, blank=True)
    class_name = models.CharField(max_length=100, blank=True)
    # Existing exams remain on profile targeting after migration. New UI-created exams can require an
    # explicit roster; selected groups expand to their current members when a student starts the exam.
    audience_mode = models.CharField(max_length=12, choices=AudienceMode.choices, default=AudienceMode.PROFILE, db_index=True)
    student_groups = models.ManyToManyField("users.StudentGroup", blank=True, related_name="targeted_exams")
    students = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="eligible_exams")
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

    class ResultDetail(models.TextChoices):
        """How much of a published result the student is allowed to read.

        A ladder, not a switch: "the score" and "everything including the model answer" are the two ends most
        people reach for, but a teacher who wants students to review what they wrote without being able to
        compare answers against the key needs the rungs in between.
        """

        SCORE_ONLY = "score_only", "Score only"
        OWN_ANSWERS = "own_answers", "Score and their own answer sheet"
        OWN_ANSWERS_WITH_FEEDBACK = "own_answers_with_feedback", "Answer sheet and the teacher's notes"
        FULL_KEY = "full_key", "Answer sheet, notes, and the correct answers"

    class IntegrityPolicy(models.TextChoices):
        """Whether the exam watches the browser at all, and whether watching has any consequence.

        The teacher owns this switch, in three positions rather than two. `off` records no browser-monitoring
        signals and restricts nothing. `observe` records only browser observations and warns the student, so a
        human can judge them, and changes nothing about the exam. `enforce` additionally applies the rules
        below. An observation is never a verdict on its own.
        """

        OFF = "off", "Off"
        OBSERVE = "observe", "Record only"
        ENFORCE = "enforce", "Record and enforce"

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
    # Null means "not chosen": the answer is derived from `show_correct_answers`, so an exam created before
    # this existed behaves exactly as it did. Written as `full_key`, this is the same promise; the two middle
    # rungs are what a teacher picks when they want reflection without an answer key.
    result_detail = models.CharField(max_length=32, choices=ResultDetail.choices, null=True, blank=True)
    max_attempts = models.PositiveSmallIntegerField(default=1)
    # Option order is randomized per attempt on top of question order; grading never sees these orders.
    randomize_options = models.BooleanField(default=False)
    # False makes "submit" refuse while a question of the attempt snapshot is still blank.
    allow_unanswered = models.BooleanField(default=True)
    # Pass mark as a percentage of the exam total; 0 disables the pass/fail verdict everywhere.
    passing_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    # Anti-cheating, off by default: an exam that blocks the clipboard or locks a device is a decision about
    # real students on real machines, and it is the teacher's to make, not the platform's.
    integrity_policy = models.CharField(max_length=12, choices=IntegrityPolicy.choices, default=IntegrityPolicy.OFF)
    # Number of confirmed tab-exit warnings allowed before the *next* confirmed exit closes the attempt;
    # 0 disables automatic closure. The count is based on events whose duration was verified server-side.
    max_tab_switches = models.PositiveSmallIntegerField(default=0)
    # A return within this many seconds is not recorded as a tab-exit warning. 5 seconds avoids charging
    # short browser/OS transitions; 0 means every observed departure is immediately counted.
    tab_switch_grace_seconds = models.PositiveSmallIntegerField(default=5)
    block_copy_paste = models.BooleanField(default=False)
    require_fullscreen = models.BooleanField(default=False)
    # This is a browser User-Agent signature, not a hardware identifier: a refresh in the same browser keeps
    # working and a different browser family is refused. It cannot prove which physical device is in use.
    lock_to_one_device = models.BooleanField(default=False)
    # IP/User-Agent are personal connection metadata. Capture is opt-in and only active when monitoring is on.
    record_access_info = models.BooleanField(default=False)
    # Best-effort page shortcuts only; a normal website cannot block OS-level captures or extensions.
    block_screenshot_shortcuts = models.BooleanField(default=False)

    @property
    def result_detail_level(self) -> str:
        """The rung this exam publishes at, resolved once so no consumer re-derives it differently."""
        if self.result_detail:
            return self.result_detail
        return self.ResultDetail.FULL_KEY if self.show_correct_answers else self.ResultDetail.SCORE_ONLY

    @property
    def integrity_records(self) -> bool:
        """True when browser signals are stored at all."""
        return self.integrity_policy != self.IntegrityPolicy.OFF

    @property
    def integrity_enforced(self) -> bool:
        """True when the stored signals can also cost the student something."""
        return self.integrity_policy == self.IntegrityPolicy.ENFORCE

    def integrity_rules(self) -> dict:
        """The one reading of the settings, served to the runner so no client invents a policy.

        Each rule is already AND-ed with the master switch: the UI can bind a checkbox straight to it and a
        stale client cannot re-enable enforcement by sending a flag of its own.
        """
        enforced = self.integrity_enforced
        return {
            "policy": self.integrity_policy,
            "records": self.integrity_records,
            "enforced": enforced,
            "block_copy_paste": bool(enforced and self.block_copy_paste),
            "require_fullscreen": bool(enforced and self.require_fullscreen),
            "lock_to_one_device": bool(enforced and self.lock_to_one_device),
            "max_tab_switches": int(self.max_tab_switches) if enforced else 0,
            "tab_switch_grace_seconds": int(self.tab_switch_grace_seconds) if self.integrity_records else 0,
            "record_access_info": bool(self.integrity_records and self.record_access_info),
            "block_screenshot_shortcuts": bool(enforced and self.block_screenshot_shortcuts),
        }

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
        if self.max_tab_switches > 100:
            errors["max_tab_switches"] = "A warning limit above 100 does not describe an exam."
        if self.tab_switch_grace_seconds > 120:
            errors["tab_switch_grace_seconds"] = "The tab-switch grace period cannot exceed 120 seconds."
        # The sub-rules stay configurable while the policy is off, so a teacher who disables monitoring for
        # one week can turn it back on and find their settings where they left them. They are simply inert.
        if errors:
            raise ValidationError(errors)

    def __str__(self) -> str:
        return f"Settings: {self.exam.title}"


class QuestionFolder(TimeStampedUUIDModel):
    """A named shelf inside one teacher's question bank, optionally nested.

    Folders belong to the teacher rather than to a school or an exam: a bank is a personal working space, and
    sharing it would mean deciding who may move somebody else's material. Deleting a folder unfiles the
    questions inside it instead of taking them along.
    """

    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="question_folders")
    parent = models.ForeignKey("self", on_delete=models.CASCADE, related_name="children", null=True, blank=True)
    name = models.CharField(max_length=120)

    class Meta:
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(Lower("name"), "parent", models.F("teacher"), name="unique_folder_name_per_parent"),
        ]

    def __str__(self) -> str:
        return f"{self.parent.name} / {self.name}" if self.parent_id else self.name

    def clean(self) -> None:
        errors: dict[str, str] = {}
        if not self.name.strip():
            errors["name"] = "Folder name cannot be blank."
        if len(self.name.strip()) > 120:
            errors["name"] = "Folder name must be 120 characters or fewer."
        # A cycle would make the tree unrenderable and the parent walk endless, so nesting is checked here
        # rather than trusted to whatever UI built it.
        if self.parent_id is not None:
            seen = {self.pk}
            node = self.parent
            while node is not None:
                if node.pk in seen:
                    errors["parent"] = "A folder cannot be nested inside itself."
                    break
                seen.add(node.pk)
                node = node.parent
        if errors:
            raise ValidationError(errors)


class Question(TimeStampedUUIDModel):
    class Status(models.TextChoices):
        """Whether a bank question is finished enough to be put in front of students.

        Only the bank asks this: a question that belongs to an exam is exam content whatever this says, and
        the publish gate already judges it by its own rules.
        """

        DRAFT = "draft", "Draft"
        READY = "ready", "Ready"

    class Type(models.TextChoices):
        MULTIPLE_CHOICE = "multiple_choice", "Multiple choice"
        MULTIPLE_ANSWER = "multiple_answer", "Multiple answer"
        MATCHING = "matching", "Matching"
        TRUE_FALSE = "true_false", "True / False"
        SHORT_ANSWER = "short_answer", "Short answer"
        WRITTEN = "written", "Written answer"

    class Difficulty(models.TextChoices):
        EASY = "easy", "Easy"
        MEDIUM = "medium", "Medium"
        HARD = "hard", "Hard"

    # Null means "in the bank, not in an exam yet". Nothing that reads exam content (`exam.questions`, the
    # attempt snapshot, the publish gate) can see such a row, so an unfinished question cannot leak into a
    # paper; ownership of those rows comes from `owner` instead of through the exam's teacher.
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="questions", null=True, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bank_questions", null=True, blank=True
    )
    folder = models.ForeignKey(
        QuestionFolder, on_delete=models.SET_NULL, related_name="questions", null=True, blank=True
    )
    # A free-text label, not a fixed list: a biology teacher's categories are nobody else's vocabulary.
    category = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.READY)
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
    # Fingerprint of the question's content (see `content_identity`). Two rows in one exam with the same
    # fingerprint are the same question typed twice, which the write path refuses to store.
    content_hash = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ("order",)
        constraints = [
            models.UniqueConstraint(fields=("exam", "order"), name="unique_question_order_per_exam"),
            models.CheckConstraint(condition=models.Q(order__gte=1), name="question_order_positive"),
            models.CheckConstraint(condition=models.Q(marks__gte=Decimal("0")), name="question_marks_non_negative"),
            models.UniqueConstraint(
                fields=("exam", "content_hash"),
                condition=~models.Q(content_hash=""),
                name="unique_question_content_per_exam",
                violation_error_message="This exam already holds an identical question.",
            ),
            # The per-exam constraint above cannot cover bank rows, because `exam` is null and Postgres lets
            # any number of nulls through a unique index. So the bank gets its own: the same question typed
            # twice into one teacher's shelf is one row, in exactly the spirit of the exam-level rule.
            models.UniqueConstraint(
                fields=("owner", "content_hash"),
                condition=models.Q(exam__isnull=True) & ~models.Q(content_hash="") & ~models.Q(owner__isnull=True),
                name="unique_bank_content_per_teacher",
                violation_error_message="Your bank already holds an identical question.",
            ),
        ]
        indexes = [
            models.Index(fields=("exam", "order")),
            models.Index(fields=("exam", "content_hash")),
            models.Index(fields=("exam", "type")),
            models.Index(fields=("type", "difficulty")),
            models.Index(fields=("is_archived", "difficulty")),
            # The bank's own two filters, applied on nearly every list request.
            models.Index(fields=("owner", "folder")),
            models.Index(fields=("owner", "category")),
        ]

    def __str__(self) -> str:
        # A bank row has no parent exam to name, and `__str__` runs in admin lists and error messages, so it
        # has to answer without touching a null relation.
        return f"{self.exam.title} · Q{self.order}" if self.exam_id is not None else f"bank · {self.text[:40]}"

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
        if self.type == self.Type.MATCHING:
            from .services import question_definition_errors

            option_data = list(self.options.order_by("order").values("text", "is_correct", "order"))
            errors = question_definition_errors(self.type, option_data, self.configuration)
            return [message for messages in errors.values() for message in messages]
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
        if self.question.type not in {Question.Type.MULTIPLE_CHOICE, Question.Type.MULTIPLE_ANSWER, Question.Type.TRUE_FALSE, Question.Type.MATCHING}:
            raise ValidationError({"question": "Only choice and true/false questions may have options."})
        if self.order < 1:
            raise ValidationError({"order": "Option order must start at 1."})


class QuestionMedia(TimeStampedUUIDModel):
    """Private teacher-uploaded prompt media; the API serves it only after an ownership/attempt check."""

    class Kind(models.TextChoices):
        IMAGE = "image", "Image"
        AUDIO = "audio", "Audio"

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="media")
    kind = models.CharField(max_length=8, choices=Kind.choices, db_index=True)
    file = models.FileField(upload_to=_question_media_path, storage=_PRIVATE_MEDIA_STORAGE, max_length=255)
    original_name = models.CharField(max_length=180)
    content_type = models.CharField(max_length=80)
    size_bytes = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    alt_text = models.CharField(max_length=180, blank=True)
    order = models.PositiveSmallIntegerField(default=1)

    class Meta:
        ordering = ("order", "created_at")
        indexes = [models.Index(fields=("question", "kind", "order"))]
        constraints = [models.CheckConstraint(condition=models.Q(size_bytes__gt=0), name="question_media_size_positive")]

    def __str__(self) -> str:
        return f"{self.kind} · {self.question_id}"


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