from __future__ import annotations

from django.db.models import Count
from rest_framework import serializers

from apps.exams.models import Exam
from apps.users.models import StudentProfile, TeacherProfile, User

from .models import School, SchoolMembership


class SchoolSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = School
        fields = ("id", "name", "city", "is_active")
        read_only_fields = fields


class AdminSchoolSerializer(serializers.ModelSerializer):
    user_count = serializers.IntegerField(read_only=True)
    exam_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = School
        fields = ("id", "name", "city", "join_code", "is_active", "user_count", "exam_count", "created_at", "updated_at")
        read_only_fields = ("id", "join_code", "user_count", "exam_count", "created_at", "updated_at")

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("School name cannot be blank.")
        return value

    def validate(self, attrs: dict) -> dict:
        unsupported = set(self.initial_data).difference({"name", "city", "is_active"})
        if unsupported:
            raise serializers.ValidationError({field: "This is not a supported school field." for field in unsupported})
        return attrs


class AdminUserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    school = serializers.SerializerMethodField()
    profile = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "full_name", "role", "is_active", "school", "profile", "last_login", "created_at")
        read_only_fields = fields

    def get_school(self, user: User):  # type: ignore[no-untyped-def]
        membership = getattr(user, "school_membership", None)
        return SchoolSummarySerializer(membership.school).data if membership else None

    def get_profile(self, user: User) -> dict:
        if user.role == User.Role.STUDENT:
            profile = getattr(user, "student_profile", None)
            return {"grade": profile.grade if profile else "", "class_name": profile.class_name if profile else ""}
        if user.role == User.Role.TEACHER:
            profile = getattr(user, "teacher_profile", None)
            return {"department": profile.department if profile else ""}
        return {}


class AdminUserWriteSerializer(serializers.Serializer):
    first_name = serializers.CharField(required=False, max_length=150, allow_blank=True)
    last_name = serializers.CharField(required=False, max_length=150, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    role = serializers.ChoiceField(choices=User.Role.choices, required=False)
    is_active = serializers.BooleanField(required=False)
    school_id = serializers.UUIDField(required=False, allow_null=True)
    student_profile = serializers.DictField(required=False)
    teacher_profile = serializers.DictField(required=False)

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported user field." for field in unexpected})
        if "school_id" in attrs and attrs["school_id"] is not None:
            attrs["school"] = School.objects.filter(pk=attrs["school_id"], is_active=True).first()
            if attrs["school"] is None:
                raise serializers.ValidationError({"school_id": "An active school is required."})
        return attrs


class AdminUserCreateSerializer(AdminUserWriteSerializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_email(self, value: str) -> str:
        value = User.objects.normalize_email(value)
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value


class AdminExamSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.get_full_name", read_only=True)
    teacher_email = serializers.EmailField(source="teacher.email", read_only=True)
    school = serializers.SerializerMethodField()
    question_count = serializers.IntegerField(read_only=True)
    participant_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Exam
        fields = (
            "id", "title", "subject", "grade", "class_name", "status", "duration_minutes", "total_marks", "start_at", "end_at",
            "teacher_name", "teacher_email", "school", "question_count", "participant_count", "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_school(self, exam: Exam):  # type: ignore[no-untyped-def]
        membership = getattr(exam.teacher, "school_membership", None)
        return SchoolSummarySerializer(membership.school).data if membership else None
