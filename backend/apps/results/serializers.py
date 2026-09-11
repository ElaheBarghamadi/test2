from __future__ import annotations

from decimal import Decimal

from rest_framework import serializers

from apps.attempts.models import AttemptEvent, ExamAttempt, StudentAnswer

from .models import ExamResult


class StudentResultSerializer(serializers.ModelSerializer):
    """Published result plus the exam context a student needs to read it (marks, pass verdict)."""

    is_final = serializers.SerializerMethodField()
    maximum_score = serializers.SerializerMethodField()
    attempt_number = serializers.SerializerMethodField()
    submitted_at = serializers.SerializerMethodField()
    passing_percentage = serializers.SerializerMethodField()
    passed = serializers.SerializerMethodField()

    class Meta:
        model = ExamResult
        # No question-level correctness, answer keys, or teacher configuration is exposed here.
        fields = (
            "id",
            "status",
            "score",
            "percentage",
            "maximum_score",
            "correct_count",
            "incorrect_count",
            "unanswered_count",
            "pending_manual_grading_count",
            "passing_percentage",
            "passed",
            "attempt_number",
            "submitted_at",
            "is_final",
            "feedback",
            "published_at",
        )
        read_only_fields = fields

    def get_is_final(self, result: ExamResult) -> bool:
        return result.pending_manual_grading_count == 0

    def get_maximum_score(self, result: ExamResult) -> float:
        """The marks this attempt was actually graded against.

        Falling back to the live exam total would let a later re-weighting contradict a score the
        student already saw; the snapshot is the record, and the fallback only covers rows graded
        before the column existed.
        """
        if result.maximum_score:
            return float(result.maximum_score)
        return float(result.attempt.exam.total_marks)

    def get_attempt_number(self, result: ExamResult) -> int:
        return result.attempt.attempt_number

    def get_submitted_at(self, result: ExamResult):  # type: ignore[no-untyped-def]
        return result.attempt.submitted_at

    def get_passing_percentage(self, result: ExamResult) -> float:
        return float(result.attempt.exam.settings.passing_percentage)

    def get_passed(self, result: ExamResult) -> bool | None:
        """None while the score is not final or the teacher left the pass mark unset (0)."""
        passing = float(result.attempt.exam.settings.passing_percentage)
        if result.percentage is None or passing <= 0:
            return None
        return float(result.percentage) >= passing


class TeacherResultSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="attempt.student.get_full_name", read_only=True)
    exam_title = serializers.CharField(source="attempt.exam.title", read_only=True)

    class Meta:
        model = ExamResult
        fields = (
            "id",
            "attempt",
            "student_name",
            "exam_title",
            "status",
            "score",
            "percentage",
            "correct_count",
            "incorrect_count",
            "unanswered_count",
            "pending_manual_grading_count",
            "manual_grading_count",
            "feedback",
            "computed_at",
            "published_at",
            "revised_at",
        )


class TeacherAttemptRowSerializer(serializers.ModelSerializer):
    """A teacher-owned, aggregate-only row for the class results table."""

    student_id = serializers.UUIDField(read_only=True)
    student_name = serializers.CharField(source="student.get_full_name", read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)
    grade = serializers.CharField(source="student.student_profile.grade", read_only=True, default="")
    class_name = serializers.CharField(source="student.student_profile.class_name", read_only=True, default="")
    score = serializers.SerializerMethodField()
    percentage = serializers.SerializerMethodField()
    maximum_score = serializers.SerializerMethodField()
    submission_status = serializers.SerializerMethodField()
    completion_minutes = serializers.SerializerMethodField()
    pending_manual_grading_count = serializers.SerializerMethodField()
    manual_grading_count = serializers.SerializerMethodField()
    attempt_number = serializers.IntegerField(read_only=True)
    result_status = serializers.SerializerMethodField()

    class Meta:
        model = ExamAttempt
        fields = (
            "id",
            "student_id",
            "student_name",
            "student_email",
            "grade",
            "class_name",
            "status",
            "submission_status",
            "started_at",
            "submitted_at",
            "last_activity_at",
            "completion_minutes",
            "score",
            "percentage",
            "maximum_score",
            "pending_manual_grading_count",
            "manual_grading_count",
            "attempt_number",
            "result_status",
        )
        read_only_fields = fields

    @staticmethod
    def _result(attempt: ExamAttempt) -> ExamResult | None:
        return getattr(attempt, "result", None)

    def get_score(self, attempt: ExamAttempt):  # type: ignore[no-untyped-def]
        result = self._result(attempt)
        return result.score if result else None

    def get_percentage(self, attempt: ExamAttempt):  # type: ignore[no-untyped-def]
        result = self._result(attempt)
        return result.percentage if result else None

    def get_pending_manual_grading_count(self, attempt: ExamAttempt) -> int:
        result = self._result(attempt)
        return result.pending_manual_grading_count if result else 0

    def get_manual_grading_count(self, attempt: ExamAttempt) -> int:
        result = self._result(attempt)
        if result is None:
            return 0
        # Rows graded before the total was snapshotted fall back to "whatever is still open".
        return result.manual_grading_count or result.pending_manual_grading_count

    def get_maximum_score(self, attempt: ExamAttempt) -> float:
        """The exam total as the result saw it, so a row's score and maximum cannot disagree."""
        result = self._result(attempt)
        if result is not None and result.maximum_score:
            return float(result.maximum_score)
        return float(attempt.exam.total_marks)

    def get_result_status(self, attempt: ExamAttempt) -> str | None:
        result = self._result(attempt)
        return result.status if result else None

    def get_submission_status(self, attempt: ExamAttempt) -> str:
        if attempt.status == ExamAttempt.Status.IN_PROGRESS:
            return "in_progress"
        result = self._result(attempt)
        if result and result.pending_manual_grading_count:
            return "needs_grading"
        return "submitted"

    def get_completion_minutes(self, attempt: ExamAttempt):  # type: ignore[no-untyped-def]
        if not attempt.started_at or not attempt.submitted_at:
            return None
        seconds = max(0, (attempt.submitted_at - attempt.started_at).total_seconds())
        return int(Decimal(seconds / 60).quantize(Decimal("1")))


class TeacherAttemptEventSerializer(serializers.ModelSerializer):
    """One recorded session/activity signal. Timestamps are the server's, never the browser's."""

    class Meta:
        model = AttemptEvent
        fields = ("id", "kind", "detail", "created_at")
        read_only_fields = fields


class TeacherAttemptAnswerSerializer(serializers.ModelSerializer):
    question_id = serializers.UUIDField(read_only=True)
    question_text = serializers.CharField(source="question.text", read_only=True)
    question_type = serializers.CharField(source="question.type", read_only=True)
    question_order = serializers.IntegerField(source="question.order", read_only=True)
    maximum_score = serializers.DecimalField(source="question.marks", max_digits=7, decimal_places=2, read_only=True)
    selected_option_ids = serializers.SerializerMethodField()
    selected_option_texts = serializers.SerializerMethodField()
    text = serializers.SerializerMethodField()
    manual_grading_required = serializers.SerializerMethodField()

    class Meta:
        model = StudentAnswer
        fields = (
            "id",
            "question_id",
            "question_text",
            "question_type",
            "question_order",
            "maximum_score",
            "selected_option_ids",
            "selected_option_texts",
            "text",
            "manual_grading_required",
            "is_flagged",
            "manual_score",
            "feedback",
            "updated_at",
        )
        read_only_fields = fields

    def get_selected_option_ids(self, answer: StudentAnswer) -> list[str]:
        return [str(option.id) for option in answer.selected_options.all()]

    def get_selected_option_texts(self, answer: StudentAnswer) -> list[str]:
        return [option.text for option in answer.selected_options.all()]

    def get_text(self, answer: StudentAnswer) -> str | None:
        value = answer.answer_data.get("text") if isinstance(answer.answer_data, dict) else None
        return value if isinstance(value, str) and value else None

    def get_manual_grading_required(self, answer: StudentAnswer) -> bool:
        if answer.question.type == "written":
            return True
        if answer.question.type == "short_answer":
            return not bool(answer.question.configuration.get("expected_answers", []))
        return False


class ManualGradeSerializer(serializers.Serializer):
    manual_score = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=Decimal("0.00"))
    feedback = serializers.CharField(required=False, allow_blank=True, max_length=5000)

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported grading field." for field in unexpected})
        answer: StudentAnswer = self.context["answer"]
        if attrs["manual_score"] > answer.question.marks:
            raise serializers.ValidationError({"manual_score": "Manual score cannot exceed the question marks."})
        return attrs


class TeacherResultFeedbackSerializer(serializers.Serializer):
    feedback = serializers.CharField(allow_blank=True, max_length=5000)

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported result field." for field in unexpected})
        return attrs
