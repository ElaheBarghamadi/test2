from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.organizations.models import School, SchoolMembership

from .models import StudentProfile, TeacherProfile, User
from .passwords import password_errors


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
    # A pupil picks their grade and class while signing up. They used to be sent in a second request after
    # the account existed, which meant a dropped connection left a real account with an empty profile and a
    # form that could only be resubmitted into an "email already registered" error.
    grade = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=100)
    class_name = serializers.CharField(required=False, allow_blank=True, write_only=True, max_length=100)

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "password", "role", "school_code", "grade", "class_name")
        # The generated `UniqueValidator` compares the address byte for byte and answers in DRF's own
        # half-Persian wording ("user با این email از قبل موجود است."). `validate_email` below does the same
        # job case-insensitively with a sentence a pupil can act on, and `create` catches the database's own
        # refusal as well, so the check is not the only thing standing between us and a duplicate.
        extra_kwargs = {"email": {"validators": []}}

    def validate_email(self, value: str) -> str:
        # Whole address, lower-case, as stored: the duplicate check and the row it guards must agree.
        email = User.objects.normalize_email(value).strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(
                "این ایمیل قبلاً ثبت شده است. اگر حساب دارید وارد شوید یا از «گذرواژه را فراموش کرده‌اید» استفاده کنید."
            )
        return email

    def validate_school_code(self, value: str):  # type: ignore[no-untyped-def]
        code = value.strip().upper()
        if not code:
            return None
        school = School.objects.filter(join_code=code, is_active=True).first()
        if school is None:
            raise serializers.ValidationError("کد مدرسهٔ واردشده معتبر یا فعال نیست؛ آن را از مدیر مدرسه بگیرید.")
        return school

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "این فیلد در فرم ثبت‌نام پشتیبانی نمی‌شود." for field in unexpected})
        candidate = User(
            email=attrs.get("email", ""),
            first_name=attrs.get("first_name", ""),
            last_name=attrs.get("last_name", ""),
        )
        errors = password_errors(attrs["password"], candidate)
        if errors:
            raise serializers.ValidationError({"password": errors})
        # Grade and class only describe a pupil; sending them with any other role is not an error worth
        # failing a sign-up over, so they are simply dropped.
        if attrs.get("role") != User.Role.STUDENT:
            attrs.pop("grade", None)
            attrs.pop("class_name", None)
        return attrs

    def create(self, validated_data: dict) -> User:
        grade = validated_data.pop("grade", "")
        class_name = validated_data.pop("class_name", "")
        school = validated_data.pop("school_code", None)
        try:
            # One transaction: the account, its school membership and its pupil profile appear together or
            # not at all. A half-registered user is the state this replaces.
            with transaction.atomic():
                user = User.objects.create_user(**validated_data)
                if school is not None:
                    SchoolMembership.objects.create(user=user, school=school)
                if grade or class_name:
                    profile, _ = StudentProfile.objects.get_or_create(user=user)
                    if grade:
                        profile.grade = grade
                    if class_name:
                        profile.class_name = class_name
                    profile.full_clean(exclude=("student_identifier",))
                    profile.save(update_fields=("grade", "class_name", "updated_at"))
        except IntegrityError as exc:
            # Two sign-ups for the same address arriving at once both pass `validate_email`; the unique
            # index is what actually decides. Reporting it as a field error keeps the answer a 400 the form
            # can show, instead of a 500 for a user who did nothing wrong.
            raise serializers.ValidationError(
                {"email": "این ایمیل قبلاً ثبت شده است. اگر حساب دارید وارد شوید یا از «گذرواژه را فراموش کرده‌اید» استفاده کنید."}
            ) from exc
        return user


class StudentProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentProfile
        fields = ("grade", "class_name")

    def to_internal_value(self, data: dict) -> dict:
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "این فیلد در پروفایل دانش‌آموز پشتیبانی نمی‌شود." for field in unexpected})
        return super().to_internal_value(data)


class TeacherProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeacherProfile
        fields = ("department",)

    def to_internal_value(self, data: dict) -> dict:
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "این فیلد در پروفایل آموزگار پشتیبانی نمی‌شود." for field in unexpected})
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
            errors = {field: "این مقدار از مسیر پروفایل قابل تغییر نیست." for field in blocked}
            errors.update({field: "این فیلد در پروفایل پشتیبانی نمی‌شود." for field in unexpected})
            raise serializers.ValidationError(errors)

        user = self.instance
        if "student_profile" in attrs and user.role != User.Role.STUDENT:
            raise serializers.ValidationError({"student_profile": "پروفایل دانش‌آموزی فقط برای حساب دانش‌آموز است."})
        if "teacher_profile" in attrs and user.role != User.Role.TEACHER:
            raise serializers.ValidationError({"teacher_profile": "پروفایل آموزگاری فقط برای حساب آموزگار است."})
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
    new_password = serializers.CharField(
        write_only=True, min_length=8, error_messages={"min_length": "گذرواژه باید دست‌کم ۸ کاراکتر داشته باشد."}
    )

    def validate(self, attrs: dict) -> dict:
        try:
            user_id = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist) as exc:
            raise serializers.ValidationError({"token": "پیوند بازیابی گذرواژه نامعتبر یا منقضی شده است."}) from exc
        from django.contrib.auth.tokens import default_token_generator

        if not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError({"token": "پیوند بازیابی گذرواژه نامعتبر یا منقضی شده است."})
        errors = password_errors(attrs["new_password"], user)
        if errors:
            raise serializers.ValidationError({"new_password": errors})
        attrs["user"] = user
        return attrs

    def save(self) -> User:
        user = self.validated_data["user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=("password", "updated_at"))
        return user


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(
        write_only=True, min_length=8, error_messages={"min_length": "گذرواژه باید دست‌کم ۸ کاراکتر داشته باشد."}
    )

    def validate_old_password(self, value: str) -> str:
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("گذرواژهٔ فعلی درست نیست.")
        return value

    def validate(self, attrs: dict) -> dict:
        errors = password_errors(attrs["new_password"], self.context["request"].user)
        if errors:
            raise serializers.ValidationError({"new_password": errors})
        return attrs

    def save(self) -> User:
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=("password", "updated_at"))
        return user


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds a safe account shape to the standard JWT token response."""

    # One sentence for every way the credentials can fail — unknown address, wrong password, deactivated
    # account. Saying which one it was would tell a stranger which addresses have accounts here, and the
    # stock message ("No active account…") was English in an otherwise Persian form.
    default_error_messages = {"no_active_account": "ایمیل یا گذرواژه درست نیست."}

    @classmethod
    def get_token(cls, user: User):
        token = super().get_token(user)
        token["role"] = user.role
        return token

    def validate(self, attrs: dict) -> dict:
        data = super().validate(attrs)
        data["user"] = CurrentUserSerializer(self.user).data
        return data
