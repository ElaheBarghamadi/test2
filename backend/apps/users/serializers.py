from __future__ import annotations

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.organizations.models import School, SchoolMembership

from .models import StudentProfile, TeacherProfile, User


class StudentProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentProfile
        fields = ("student_identifier", "grade", "class_name")
        read_only_fields = ("student_identifier",)


class TeacherProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeacherProfile
        fields = ("teacher_identifier", "department")
        read_only_fields = ("teacher_identifier",)


class CurrentUserSerializer(serializers.ModelSerializer):
    """Safe account response shared by register, login, and current-user endpoints."""

    full_name = serializers.CharField(source="get_full_name", read_only=True)
    profile = serializers.SerializerMethodField()
    school = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "full_name", "role", "profile", "school", "created_at")
        read_only_fields = fields

    def get_profile(self, user: User) -> dict | None:
        if user.role == User.Role.STUDENT:
            profile, _ = StudentProfile.objects.get_or_create(user=user)
            return {"type": User.Role.STUDENT, **StudentProfileSerializer(profile).data}
        if user.role == User.Role.TEACHER:
            profile, _ = TeacherProfile.objects.get_or_create(user=user)
            return {"type": User.Role.TEACHER, **TeacherProfileSerializer(profile).data}
        return None

    def get_school(self, user: User) -> dict | None:
        membership = getattr(user, "school_membership", None)
        if not membership:
            return None
        return {"id": str(membership.school_id), "name": membership.school.name, "city": membership.school.city}


class RegisterSerializer(serializers.ModelSerializer):
    """Public registration permits student/teacher roles but never administrative authority."""

    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    role = serializers.ChoiceField(
        choices=(User.Role.STUDENT, User.Role.TEACHER), required=False, default=User.Role.STUDENT, write_only=True
    )
    school_code = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=16)

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "password", "role", "school_code")

    def validate_email(self, value: str) -> str:
        email = User.objects.normalize_email(value)
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return email

    def validate_school_code(self, value: str):  # type: ignore[no-untyped-def]
        code = value.strip().upper()
        if not code:
            return None
        school = School.objects.filter(join_code=code, is_active=True).first()
        if school is None:
            raise serializers.ValidationError("A valid active school code is required.")
        return school

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported registration field." for field in unexpected})
        candidate = User(
            email=attrs.get("email", ""),
            first_name=attrs.get("first_name", ""),
            last_name=attrs.get("last_name", ""),
        )
        try:
            validate_password(attrs["password"], candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def create(self, validated_data: dict) -> User:
        school = validated_data.pop("school_code", None)
        user = User.objects.create_user(**validated_data)
        if school is not None:
            SchoolMembership.objects.create(user=user, school=school)
        return user


class StudentProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentProfile
        fields = ("grade", "class_name")

    def to_internal_value(self, data: dict) -> dict:
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported student profile field." for field in unexpected})
        return super().to_internal_value(data)


class TeacherProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeacherProfile
        fields = ("department",)

    def to_internal_value(self, data: dict) -> dict:
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported teacher profile field." for field in unexpected})
        return super().to_internal_value(data)


class CurrentUserUpdateSerializer(serializers.ModelSerializer):
    """Allows only structured, role-appropriate profile edits by the authenticated user."""

    student_profile = StudentProfileUpdateSerializer(required=False)
    teacher_profile = TeacherProfileUpdateSerializer(required=False)
    protected_fields = {"email", "role", "is_staff", "is_superuser", "is_active", "password"}

    class Meta:
        model = User
        fields = ("first_name", "last_name", "student_profile", "teacher_profile")

    def validate(self, attrs: dict) -> dict:
        incoming_fields = set(self.initial_data)
        blocked = self.protected_fields.intersection(incoming_fields)
        unexpected = incoming_fields.difference(self.fields).difference(blocked)
        if blocked or unexpected:
            errors = {field: "This field cannot be changed through the profile API." for field in blocked}
            errors.update({field: "This is not a supported profile field." for field in unexpected})
            raise serializers.ValidationError(errors)

        user = self.instance
        if "student_profile" in attrs and user.role != User.Role.STUDENT:
            raise serializers.ValidationError({"student_profile": "Only student users have a student profile."})
        if "teacher_profile" in attrs and user.role != User.Role.TEACHER:
            raise serializers.ValidationError({"teacher_profile": "Only teacher users have a teacher profile."})
        return attrs

    def update(self, instance: User, validated_data: dict) -> User:
        student_data = validated_data.pop("student_profile", None)
        teacher_data = validated_data.pop("teacher_profile", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save(update_fields=(*validated_data.keys(), "updated_at") if validated_data else None)

        if student_data is not None:
            profile, _ = StudentProfile.objects.get_or_create(user=instance)
            for field, value in student_data.items():
                setattr(profile, field, value)
            profile.full_clean()
            profile.save()
        if teacher_data is not None:
            profile, _ = TeacherProfile.objects.get_or_create(user=instance)
            for field, value in teacher_data.items():
                setattr(profile, field, value)
            profile.full_clean()
            profile.save()
        return instance


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs: dict) -> dict:
        try:
            user_id = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist) as exc:
            raise serializers.ValidationError({"token": "The password reset link is invalid or expired."}) from exc
        from django.contrib.auth.tokens import default_token_generator

        if not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError({"token": "The password reset link is invalid or expired."})
        try:
            validate_password(attrs["new_password"], user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)}) from exc
        attrs["user"] = user
        return attrs

    def save(self) -> User:
        user = self.validated_data["user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=("password", "updated_at"))
        return user


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_old_password(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("The current password is incorrect.")
        return value

    def validate(self, attrs: dict) -> dict:
        try:
            validate_password(attrs["new_password"], self.context["request"].user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)}) from exc
        return attrs

    def save(self) -> User:
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=("password", "updated_at"))
        return user


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds a safe account shape to the standard JWT token response."""

    @classmethod
    def get_token(cls, user: User):
        token = super().get_token(user)
        token["role"] = user.role
        return token

    def validate(self, attrs: dict) -> dict:
        data = super().validate(attrs)
        data["user"] = CurrentUserSerializer(self.user).data
        return data
