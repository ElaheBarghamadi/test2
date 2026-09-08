from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.exams.models import Exam, ExamSettings, Question, QuestionOption

from .models import ExamAttempt, StudentAnswer


class StudentAvailableAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamAttempt
        fields = ("id", "status", "started_at", "submitted_at")
        read_only_fields = fields


class StudentAvailableExamSerializer(serializers.ModelSerializer):
    """Dashboard-safe exam shape: it intentionally excludes teacher and full settings data."""

    availability = serializers.CharField(source="student_availability", read_only=True)
    attempt = StudentAvailableAttemptSerializer(source="student_attempt", read_only=True, allow_null=True)

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
            "start_at",
            "end_at",
            "availability",
            "attempt",
        )
        read_only_fields = fields


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
        fields = ("allow_previous_questions", "randomize_questions")
        read_only_fields = fields


class StudentAttemptExamSerializer(serializers.ModelSerializer):
    navigation = StudentNavigationSettingsSerializer(source="settings", read_only=True)

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
            "navigation",
        )
        read_only_fields = fields


class StudentAttemptDetailSerializer(serializers.ModelSerializer):
    exam = StudentAttemptExamSerializer(read_only=True)
    answers = StudentAttemptAnswerSerializer(many=True, read_only=True)
    questions = serializers.SerializerMethodField()
    server_time = serializers.SerializerMethodField()
    expires_at = serializers.SerializerMethodField()
    remaining_seconds = serializers.SerializerMethodField()

    class Meta:
        model = ExamAttempt
        fields = (
            "id",
            "attempt_number",
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
        return StudentAttemptQuestionSerializer(questions, many=True).data

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
