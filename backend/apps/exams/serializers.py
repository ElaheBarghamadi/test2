from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import F, Max
from rest_framework import serializers

from .models import Exam, ExamSettings, Question, QuestionOption
from .services import question_definition_errors, refresh_total_marks


class StudentQuestionOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ("id", "text", "order")


class StudentQuestionSerializer(serializers.ModelSerializer):
    options = StudentQuestionOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        # Student-facing routes are intentionally deferred and must continue to omit answer keys.
        fields = ("id", "type", "text", "instructions", "order", "marks", "options")


class TeacherQuestionOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ("id", "text", "is_correct", "order")
        read_only_fields = ("id", "order")


class TeacherQuestionSerializer(serializers.ModelSerializer):
    options = TeacherQuestionOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = (
            "id",
            "exam",
            "type",
            "text",
            "instructions",
            "order",
            "marks",
            "configuration",
            "explanation",
            "options",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "exam", "order", "created_at", "updated_at")


class QuestionOptionWriteSerializer(serializers.Serializer):
    """Option input. `id` is optional and only used to keep an existing option's identity stable.

    Reusing the primary key matters because saved student answers reference option IDs: a teacher
    who edits one option's wording must not silently invalidate an in-flight attempt.
    """

    id = serializers.UUIDField(required=False, allow_null=True)
    text = serializers.CharField(max_length=1000, trim_whitespace=True)
    is_correct = serializers.BooleanField()

    def to_internal_value(self, data: dict) -> dict:
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported option field." for field in unexpected})
        return super().to_internal_value(data)

    def validate_text(self, value: str) -> str:
        if not value:
            raise serializers.ValidationError("Option text cannot be blank.")
        return value


class ExamSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamSettings
        fields = (
            "allow_previous_questions",
            "randomize_questions",
            "result_visibility",
            "show_correct_answers",
            "max_attempts",
            "passing_percentage",
        )

    def validate_max_attempts(self, value: int) -> int:
        if value < 1:
            raise serializers.ValidationError("At least one attempt must be allowed.")
        return value

    def validate_passing_percentage(self, value) -> Decimal:
        percentage = Decimal(str(value)).quantize(Decimal("0.01"))
        if percentage < 0 or percentage > 100:
            raise serializers.ValidationError("Passing percentage must be between 0 and 100.")
        return percentage

    def to_internal_value(self, data: dict) -> dict:
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported exam setting." for field in unexpected})
        return super().to_internal_value(data)


class TeacherExamListSerializer(serializers.ModelSerializer):
    settings = ExamSettingsSerializer(read_only=True)
    question_count = serializers.IntegerField(read_only=True)
    attempt_count = serializers.IntegerField(read_only=True)
    participant_count = serializers.IntegerField(read_only=True)
    teacher_name = serializers.CharField(source="teacher.get_full_name", read_only=True)

    class Meta:
        model = Exam
        fields = (
            "id",
            "title",
            "subject",
            "grade",
            "class_name",
            "teacher",
            "teacher_name",
            "status",
            "duration_minutes",
            "total_marks",
            "start_at",
            "end_at",
            "settings",
            "question_count",
            "attempt_count",
            "participant_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class TeacherExamSerializer(serializers.ModelSerializer):
    settings = ExamSettingsSerializer(read_only=True)
    questions = TeacherQuestionSerializer(many=True, read_only=True)
    question_count = serializers.IntegerField(read_only=True)
    attempt_count = serializers.IntegerField(read_only=True)
    participant_count = serializers.IntegerField(read_only=True)
    teacher_name = serializers.CharField(source="teacher.get_full_name", read_only=True)

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
            "teacher",
            "status",
            "duration_minutes",
            "total_marks",
            "start_at",
            "end_at",
            "settings",
            "questions",
            "question_count",
            "attempt_count",
            "participant_count",
            "teacher_name",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class ExamWriteSerializer(serializers.ModelSerializer):
    """Teacher input shape. Ownership and state stay under server control."""

    settings = ExamSettingsSerializer(required=False)
    protected_fields = {"teacher", "status", "total_marks", "status_before_archive"}

    class Meta:
        model = Exam
        fields = (
            "title",
            "description",
            "subject",
            "grade",
            "class_name",
            "instructions",
            "duration_minutes",
            "start_at",
            "end_at",
            "settings",
        )

    def validate_title(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Title cannot be blank.")
        return value

    def validate_subject(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Subject cannot be blank.")
        return value

    def validate(self, attrs: dict) -> dict:
        incoming_fields = set(self.initial_data)
        blocked = self.protected_fields.intersection(incoming_fields)
        unexpected = incoming_fields.difference(self.fields).difference(blocked)
        if blocked or unexpected:
            errors = {field: "This field is controlled by exam actions." for field in blocked}
            errors.update({field: "This is not a supported exam field." for field in unexpected})
            raise serializers.ValidationError(errors)

        instance = self.instance
        duration = attrs.get("duration_minutes", instance.duration_minutes if instance else None)
        start_at = attrs.get("start_at", instance.start_at if instance else None)
        end_at = attrs.get("end_at", instance.end_at if instance else None)
        errors: dict[str, str] = {}
        if duration is not None and duration < 1:
            errors["duration_minutes"] = "Duration must be at least one minute."
        if end_at and not start_at:
            errors["start_at"] = "A start time is required when an end time is set."
        if start_at and end_at and end_at <= start_at:
            errors["end_at"] = "End time must be after start time."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    @staticmethod
    def _update_settings(exam: Exam, settings_data: dict) -> None:
        settings, _ = ExamSettings.objects.get_or_create(exam=exam)
        for field, value in settings_data.items():
            setattr(settings, field, value)
        settings.full_clean()
        settings.save()

    def create(self, validated_data: dict) -> Exam:
        settings_data = validated_data.pop("settings", None)
        teacher = self.context["teacher"]
        with transaction.atomic():
            exam = Exam(teacher=teacher, **validated_data)
            exam.full_clean()
            exam.save()
            if settings_data is not None:
                self._update_settings(exam, settings_data)
            return exam

    def update(self, instance: Exam, validated_data: dict) -> Exam:
        settings_data = validated_data.pop("settings", None)
        with transaction.atomic():
            for field, value in validated_data.items():
                setattr(instance, field, value)
            instance.full_clean()
            instance.save()
            if settings_data is not None:
                self._update_settings(instance, settings_data)
            return instance


class QuestionWriteSerializer(serializers.ModelSerializer):
    """Write-only nested option input; teacher responses use TeacherQuestionSerializer."""

    options = QuestionOptionWriteSerializer(many=True, required=False)
    protected_fields = {"exam", "order", "id"}

    class Meta:
        model = Question
        fields = ("type", "text", "instructions", "marks", "configuration", "explanation", "options")

    def validate_text(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Question text cannot be blank.")
        return value

    def validate_marks(self, value):
        if value < 0:
            raise serializers.ValidationError("Marks cannot be negative.")
        return value

    def validate(self, attrs: dict) -> dict:
        incoming_fields = set(self.initial_data)
        blocked = self.protected_fields.intersection(incoming_fields)
        unexpected = incoming_fields.difference(self.fields).difference(blocked)
        if blocked or unexpected:
            errors = {field: "Use the dedicated ordering or parent resource action." for field in blocked}
            errors.update({field: "This is not a supported question field." for field in unexpected})
            raise serializers.ValidationError(errors)

        instance = self.instance
        question_type = attrs.get("type", instance.type if instance else None)
        configuration = attrs.get("configuration", instance.configuration if instance else {})
        options_supplied = "options" in attrs
        if options_supplied:
            effective_options = attrs["options"]
        elif instance:
            effective_options = list(instance.options.order_by("order").values("text", "is_correct", "order"))
        else:
            effective_options = []
        errors = question_definition_errors(question_type, effective_options, configuration)
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    @staticmethod
    def _sync_options(question: Question, options_data: list[dict]) -> None:
        """Apply option edits in place so existing IDs survive, and protect answered options.

        A naive delete-and-recreate would move every option primary key, which silently drops the
        `StudentAnswer.selected_options` links of attempts that are already in progress. Matching on
        the supplied `id` keeps wording/grading edits non-destructive, while removal is refused once
        students have selected that option.
        """
        existing = {str(option.id): option for option in question.options.all()}
        supplied_ids = [str(option["id"]) for option in options_data if option.get("id")]
        if len(supplied_ids) != len(set(supplied_ids)):
            raise serializers.ValidationError({"options": "Option IDs must not repeat in one request."})
        if any(option_id not in existing for option_id in supplied_ids):
            raise serializers.ValidationError(
                {"options": "One or more option IDs no longer exist on this question. Reload it and try again."}
            )

        # Option order is unique per question, so shift everything away before renumbering.
        QuestionOption.objects.filter(question=question).update(order=F("order") + len(existing) + len(options_data) + 1)

        claimed: set[str] = set()
        for index, option in enumerate(options_data, start=1):
            option_id = str(option["id"]) if option.get("id") else None
            if option_id is not None:
                instance = existing[option_id]
                instance.text = option["text"]
                instance.is_correct = option["is_correct"]
                instance.order = index
                instance.full_clean()
                instance.save(update_fields=("text", "is_correct", "order", "updated_at"))
                claimed.add(option_id)
                continue
            QuestionOption(question=question, text=option["text"], is_correct=option["is_correct"], order=index).save()

        removed = [option for option_id, option in existing.items() if option_id not in claimed]
        blocked = [str(option.order) for option in removed if option.selected_by_answers.exists()]
        if blocked:
            raise serializers.ValidationError({
                "options": (
                    "Options " + ", ".join(sorted(blocked, key=int)) + " are already part of a student answer and cannot be "
                    "removed. Keep them in the list or duplicate the exam for a fresh structure."
                )
            })
        for option in removed:
            option.delete()

    def create(self, validated_data: dict) -> Question:
        options_data = validated_data.pop("options", [])
        parent_exam = self.context["exam"]
        with transaction.atomic():
            # Serialising creates for one exam prevents two writers taking the same next order.
            exam = Exam.objects.select_for_update().get(pk=parent_exam.pk)
            next_order = (exam.questions.aggregate(max_order=Max("order"))["max_order"] or 0) + 1
            question = Question(exam=exam, order=next_order, **validated_data)
            question.full_clean()
            question.save()
            self._sync_options(question, options_data)
            refresh_total_marks(exam)
            return question

    def update(self, instance: Question, validated_data: dict) -> Question:
        options_data = validated_data.pop("options", None)
        with transaction.atomic():
            question = Question.objects.select_for_update().select_related("exam").get(pk=instance.pk)
            for field, value in validated_data.items():
                setattr(question, field, value)
            question.full_clean()
            question.save()
            if options_data is not None:
                self._sync_options(question, options_data)
            refresh_total_marks(question.exam)
            return question


class QuestionReorderSerializer(serializers.Serializer):
    question_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported reorder field." for field in unexpected})
        return attrs

    def validate_question_ids(self, value: list) -> list:
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Question IDs must not contain duplicates.")
        return value
