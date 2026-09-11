from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.exams.models import Exam, ExamSettings, Question, QuestionOption

from .models import ExamAttempt, StudentAnswer
from .services import apply_option_order


class StudentAvailableAttemptSerializer(serializers.ModelSerializer):
    """Attempt summary for the student dashboard.

    `remaining_seconds` keeps a resumable attempt honest across reloads, and the result summary is
    emitted only once the teacher has published it so an ungraded attempt cannot leak anything.
    """

    remaining_seconds = serializers.SerializerMethodField()
    result = serializers.SerializerMethodField()

    class Meta:
        model = ExamAttempt
        fields = ("id", "status", "started_at", "submitted_at", "attempt_number", "remaining_seconds", "result")
        read_only_fields = fields

    def get_remaining_seconds(self, attempt: ExamAttempt) -> int | None:
        value = getattr(attempt, "student_remaining_seconds", None)
        return int(value) if value is not None else None

    def get_result(self, attempt: ExamAttempt) -> dict | None:
        from apps.results.models import ExamResult

        result = getattr(attempt, "result", None)
        if result is None or result.status != ExamResult.Status.PUBLISHED:
            return None
        settings = attempt.exam.settings
        percentage = float(result.percentage) if result.percentage is not None else None
        passing = float(settings.passing_percentage)
        return {
            "score": float(result.score) if result.score is not None else None,
            "percentage": percentage,
            "maximum_score": float(attempt.exam.total_marks),
            "passing_percentage": passing,
            "passed": None if percentage is None or passing <= 0 else percentage >= passing,
            "is_final": result.pending_manual_grading_count == 0,
        }


class StudentAvailableExamSerializer(serializers.ModelSerializer):
    """Dashboard-safe exam shape: it intentionally excludes teacher and answer-key data."""

    availability = serializers.CharField(source="student_availability", read_only=True)
    attempt = StudentAvailableAttemptSerializer(source="student_attempt", read_only=True, allow_null=True)
    max_attempts = serializers.SerializerMethodField()
    attempts_used = serializers.SerializerMethodField()
    passing_percentage = serializers.SerializerMethodField()
    result_visibility = serializers.SerializerMethodField()
    allow_unanswered = serializers.SerializerMethodField()
    allow_previous_questions = serializers.SerializerMethodField()
    question_layout = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()
    question_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Exam
        fields = (
            "id",
            "title",
            "description",
            "subject",
            "grade",
            "class_name",
            "duration_minutes",
            "total_marks",
            "start_at",
            "end_at",
            "availability",
            "question_count",
            "max_attempts",
            "attempts_used",
            "passing_percentage",
            "result_visibility",
            "allow_unanswered",
            "allow_previous_questions",
            "question_layout",
            "teacher_name",
            "attempt",
        )
        read_only_fields = fields

    def get_max_attempts(self, exam: Exam) -> int:
        return exam.settings.max_attempts

    def get_attempts_used(self, exam: Exam) -> int:
        return len(getattr(exam, "student_attempts", []) or [])

    def get_passing_percentage(self, exam: Exam) -> float:
        return float(exam.settings.passing_percentage)

    def get_result_visibility(self, exam: Exam) -> str:
        # The policy itself is public; whether a score is released is a separate question.
        return exam.settings.result_visibility

    def get_teacher_name(self, exam: Exam) -> str:
        # A student may see who set their exam, exactly as on a paper exam paper. The in-attempt payload
        # stays free of teacher fields; this is the dashboard, outside the answer window.
        return exam.teacher.get_full_name()

    def get_allow_unanswered(self, exam: Exam) -> bool:
        # The student has to know before starting that a blank answer will block submission.
        return exam.settings.allow_unanswered

    def get_allow_previous_questions(self, exam: Exam) -> bool:
        # The start screen states the navigation rule before an attempt exists, so it has to come from the
        # server: hardcoding it told students they could go back on exams where the teacher had said no.
        return exam.settings.allow_previous_questions

    def get_question_layout(self, exam: Exam) -> str:
        # Layout is presentation, and the dashboard needs it before the attempt exists so the runner
        # does not re-flow the whole answer sheet a second after the student presses start.
        return exam.settings.question_layout


class StudentAttemptOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ("id", "text", "order")
        read_only_fields = fields


class StudentAttemptQuestionSerializer(serializers.ModelSerializer):
    options = StudentAttemptOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        # Deliberately excludes configuration, explanation, and QuestionOption.is_correct.
        fields = ("id", "type", "text", "instructions", "order", "marks", "options")
        read_only_fields = fields


class StudentAttemptAnswerSerializer(serializers.ModelSerializer):
    question_id = serializers.UUIDField(read_only=True)
    selected_option_ids = serializers.SerializerMethodField()
    text = serializers.SerializerMethodField()
    answered = serializers.SerializerMethodField()

    class Meta:
        model = StudentAnswer
        fields = ("id", "question_id", "selected_option_ids", "text", "answered", "is_flagged", "updated_at")
        read_only_fields = fields

    def get_selected_option_ids(self, answer: StudentAnswer) -> list[str]:
        return [str(option.id) for option in answer.selected_options.all()]

    def get_text(self, answer: StudentAnswer) -> str | None:
        value = answer.answer_data.get("text") if isinstance(answer.answer_data, dict) else None
        return value if isinstance(value, str) and value else None

    def get_answered(self, answer: StudentAnswer) -> bool:
        return bool(self.get_selected_option_ids(answer) or self.get_text(answer))


class StudentNavigationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamSettings
        # Result visibility, max attempts, and correct-answer visibility are management-only settings.
        # `allow_unanswered` is different: the student has to know before pressing submit that the
        # teacher requires a complete answer sheet, and knowing it leaks nothing.
        fields = ("allow_previous_questions", "randomize_questions", "allow_unanswered", "question_layout")
        read_only_fields = fields


class StudentAttemptExamSerializer(serializers.ModelSerializer):
    navigation = StudentNavigationSettingsSerializer(source="settings", read_only=True)
    total_marks = serializers.SerializerMethodField()
    question_count = serializers.SerializerMethodField()
    passing_percentage = serializers.SerializerMethodField()
    result_visibility = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = (
            "id",
            "title",
            "description",
            "subject",
            "grade",
            "class_name",
            "instructions",
            "duration_minutes",
            "start_at",
            "end_at",
            "total_marks",
            "question_count",
            "passing_percentage",
            "result_visibility",
            "navigation",
        )
        read_only_fields = fields

    def get_total_marks(self, exam: Exam) -> float:
        return float(exam.total_marks)

    def get_question_count(self, exam: Exam) -> int:
        return exam.questions.count()

    def get_passing_percentage(self, exam: Exam) -> float:
        return float(exam.settings.passing_percentage)

    def get_result_visibility(self, exam: Exam) -> str:
        return exam.settings.result_visibility


class StudentAttemptDetailSerializer(serializers.ModelSerializer):
    exam = StudentAttemptExamSerializer(read_only=True)
    answers = StudentAttemptAnswerSerializer(many=True, read_only=True)
    questions = serializers.SerializerMethodField()
    server_time = serializers.SerializerMethodField()
    expires_at = serializers.SerializerMethodField()
    remaining_seconds = serializers.SerializerMethodField()
    attempt_limit = serializers.SerializerMethodField()
    answer_revision = serializers.IntegerField(read_only=True)
    # Which answers are final. Meaningless unless the exam is paged and forbids returning, but always
    # reported so the runner does not have to guess the rule from two other fields.
    answer_frontier = serializers.IntegerField(read_only=True)

    class Meta:
        model = ExamAttempt
        fields = (
            "id",
            "attempt_number",
            "attempt_limit",
            "answer_revision",
            "answer_frontier",
            "status",
            "started_at",
            "submitted_at",
            "last_activity_at",
            "server_time",
            "expires_at",
            "remaining_seconds",
            "exam",
            "questions",
            "answers",
        )
        read_only_fields = fields

    def get_questions(self, attempt: ExamAttempt) -> list[dict]:
        questions = getattr(attempt, "student_questions", None)
        if questions is None:
            questions = attempt.exam.questions.prefetch_related("options").order_by("order")
        payload = StudentAttemptQuestionSerializer(questions, many=True).data
        # Display order is a per-attempt snapshot; correctness is never positional.
        return apply_option_order(attempt, payload)

    def _timing_value(self, attempt: ExamAttempt, field: str) -> Any:
        timing = self.context.get("timing")
        if timing is None:
            return None
        return timing[field]

    def get_server_time(self, attempt: ExamAttempt):  # type: ignore[no-untyped-def]
        return self._timing_value(attempt, "server_time")

    def get_expires_at(self, attempt: ExamAttempt):  # type: ignore[no-untyped-def]
        return self._timing_value(attempt, "expires_at")

    def get_remaining_seconds(self, attempt: ExamAttempt):  # type: ignore[no-untyped-def]
        return self._timing_value(attempt, "remaining_seconds")

    def get_attempt_limit(self, attempt: ExamAttempt) -> int:
        return attempt.exam.settings.max_attempts



class StudentAnswerInputSerializer(serializers.Serializer):
    """Canonical, type-aware input. Clients never write the model's raw answer_data JSON."""

    selected_option_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    text = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    def validate(self, attrs: dict) -> dict:
        incoming_fields = set(self.initial_data)
        unexpected = incoming_fields.difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported answer field." for field in unexpected})

        question: Question = self.context["question"]
        choice_types = {
            Question.Type.MULTIPLE_CHOICE,
            Question.Type.MULTIPLE_ANSWER,
            Question.Type.TRUE_FALSE,
        }
        if question.type in choice_types:
            if "text" in attrs or "selected_option_ids" not in attrs:
                raise serializers.ValidationError({"selected_option_ids": "Select options for this question type."})
            option_ids = attrs["selected_option_ids"]
            if len(option_ids) != len(set(option_ids)):
                raise serializers.ValidationError({"selected_option_ids": "Selected options must not contain duplicates."})
            if question.type in {Question.Type.MULTIPLE_CHOICE, Question.Type.TRUE_FALSE} and len(option_ids) not in {0, 1}:
                raise serializers.ValidationError({"selected_option_ids": "Select exactly one option, or send an empty list to clear."})
            # An empty list intentionally clears a previously autosaved answer.
            if question.type == Question.Type.MULTIPLE_ANSWER and len(option_ids) == 0:
                return attrs
            if question.type == Question.Type.MULTIPLE_ANSWER and len(option_ids) < 1:
                raise serializers.ValidationError({"selected_option_ids": "Select one or more options, or send an empty list to clear."})
            existing_option_ids = set(
                QuestionOption.objects.filter(question=question, id__in=option_ids).values_list("id", flat=True)
            )
            if existing_option_ids != set(option_ids):
                raise serializers.ValidationError({"selected_option_ids": "Every option must belong to this question."})
            return attrs

        if "selected_option_ids" in attrs or "text" not in attrs:
            raise serializers.ValidationError({"text": "Provide text for this question type."})
        text = attrs["text"]
        max_length = question.configuration.get("max_length") if isinstance(question.configuration, dict) else None
        if max_length is not None and len(text) > max_length:
            raise serializers.ValidationError({"text": f"Answer must be at most {max_length} characters."})
        return attrs


class StudentBatchAnswerSerializer(serializers.Serializer):
    answers = serializers.ListField(child=serializers.DictField(), allow_empty=False)

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported batch answer field." for field in unexpected})
        return attrs
