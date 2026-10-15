from __future__ import annotations

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.exams.models import Exam
from apps.organizations.models import SchoolMembership
from apps.users.models import StudentGroup, StudentGroupMember, StudentProfile, User
from apps.users.permissions import IsTeacherOrAdministrator


def _student_directory_queryset(user):  # type: ignore[no-untyped-def]
    students = User.objects.filter(role=User.Role.STUDENT, is_active=True).select_related("student_profile")
    if user.role == User.Role.ADMIN:
        return students.order_by("last_name", "first_name", "email")
    membership = SchoolMembership.objects.filter(user=user).only("school_id").first()
    if membership:
        students = students.filter(school_membership__school_id=membership.school_id)
    else:
        # A teacher without school membership has no global roster. They can group only students who have
        # participated in one of their exams or are already in one of their groups.
        students = students.filter(
            Q(exam_attempts__exam__teacher=user) | Q(group_memberships__group__teacher=user)
        ).distinct()
    return students.order_by("last_name", "first_name", "email")


class StudentDirectorySerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    grade = serializers.SerializerMethodField()
    class_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "full_name", "email", "grade", "class_name")
        read_only_fields = fields

    def get_grade(self, student: User) -> str:
        profile = getattr(student, "student_profile", None)
        return profile.grade if profile else ""

    def get_class_name(self, student: User) -> str:
        profile = getattr(student, "student_profile", None)
        return profile.class_name if profile else ""


class StudentDirectoryView(APIView):
    permission_classes = (IsTeacherOrAdministrator,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        query = request.query_params.get("q", "").strip()[:100]
        grade = request.query_params.get("grade", "").strip()[:100]
        class_name = request.query_params.get("class_name", "").strip()[:100]
        queryset = _student_directory_queryset(request.user)
        if query:
            queryset = queryset.filter(
                Q(first_name__icontains=query) | Q(last_name__icontains=query) | Q(email__icontains=query)
            )
        if grade:
            queryset = queryset.filter(student_profile__grade__iexact=grade)
        if class_name:
            queryset = queryset.filter(student_profile__class_name__iexact=class_name)
        return Response(StudentDirectorySerializer(queryset[:500], many=True).data)


class StudentGroupReadSerializer(serializers.ModelSerializer):
    student_ids = serializers.SerializerMethodField()
    student_count = serializers.SerializerMethodField()

    class Meta:
        model = StudentGroup
        fields = ("id", "name", "description", "student_ids", "student_count", "created_at", "updated_at")
        read_only_fields = fields

    def get_student_ids(self, group: StudentGroup) -> list[str]:
        return [str(student_id) for student_id in group.students.values_list("id", flat=True)]

    def get_student_count(self, group: StudentGroup) -> int:
        return group.students.count()


class StudentGroupInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, trim_whitespace=True)
    description = serializers.CharField(max_length=300, required=False, allow_blank=True, trim_whitespace=True)
    student_ids = serializers.ListField(child=serializers.UUIDField(), required=False, allow_empty=True)

    def to_internal_value(self, data):  # type: ignore[no-untyped-def]
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "این فیلد برای گروه پشتیبانی نمی‌شود." for field in unexpected})
        return super().to_internal_value(data)

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("نام گروه را وارد کنید.")
        return value

    def validate_student_ids(self, value: list) -> list:
        if len(value) != len(set(value)):
            raise serializers.ValidationError("یک دانش‌آموز را دوبار انتخاب نکنید.")
        user = self.context["request"].user
        allowed = _student_directory_queryset(user).filter(id__in=value)
        if set(allowed.values_list("id", flat=True)) != set(value):
            raise serializers.ValidationError("یک یا چند دانش‌آموز در فهرست مجاز شما نیستند.")
        return value

    def validate(self, attrs: dict) -> dict:
        user = self.context["request"].user
        name = attrs.get("name", getattr(self.instance, "name", ""))
        duplicates = StudentGroup.objects.filter(teacher=user, name__iexact=name)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError({"name": "گروهی با این نام از قبل دارید."})
        return attrs


class StudentGroupListCreateView(APIView):
    permission_classes = (IsTeacherOrAdministrator,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        groups = StudentGroup.objects.filter(teacher=request.user).prefetch_related("students").order_by("name")
        return Response(StudentGroupReadSerializer(groups, many=True).data)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = StudentGroupInputSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        students = _student_directory_queryset(request.user).filter(id__in=data.get("student_ids", []))
        try:
            with transaction.atomic():
                group = StudentGroup.objects.create(
                    teacher=request.user,
                    name=data["name"],
                    description=data.get("description", ""),
                )
                group.students.set(students)
        except IntegrityError as exc:
            raise serializers.ValidationError({"name": "گروهی با این نام از قبل دارید."}) from exc
        return Response(StudentGroupReadSerializer(group).data, status=status.HTTP_201_CREATED)


class StudentGroupDetailView(APIView):
    permission_classes = (IsTeacherOrAdministrator,)

    def get_group(self, request, group_id):  # type: ignore[no-untyped-def]
        return get_object_or_404(StudentGroup.objects.filter(teacher=request.user), pk=group_id)

    @staticmethod
    def _freeze_if_scheduled(group: StudentGroup) -> None:
        if group.targeted_exams.filter(status__in=(Exam.Status.SCHEDULED, Exam.Status.ACTIVE)).exists():
            raise PermissionDenied("این گروه به آزمون زمان‌بندی‌شده یا فعال متصل است؛ برای تغییر اعضا ابتدا آزمون را لغو یا کامل کنید.")

    def patch(self, request, group_id) -> Response:  # type: ignore[no-untyped-def]
        group = self.get_group(request, group_id)
        self._freeze_if_scheduled(group)
        serializer = StudentGroupInputSerializer(group, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            for field in ("name", "description"):
                if field in data:
                    setattr(group, field, data[field])
            group.full_clean()
            group.save()
            if "student_ids" in data:
                students = _student_directory_queryset(request.user).filter(id__in=data["student_ids"])
                group.students.set(students)
        return Response(StudentGroupReadSerializer(group).data)

    def delete(self, request, group_id) -> Response:  # type: ignore[no-untyped-def]
        group = self.get_group(request, group_id)
        self._freeze_if_scheduled(group)
        group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
