from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.exams.models import Exam
from apps.users.models import StudentProfile, TeacherProfile, User
from apps.users.permissions import IsAdministrator

from .models import School, SchoolMembership
from .serializers import AdminExamSerializer, AdminSchoolSerializer, AdminUserCreateSerializer, AdminUserSerializer, AdminUserWriteSerializer


def schools_queryset():
    return School.objects.annotate(
        user_count=Count("memberships", distinct=True),
        exam_count=Count("memberships__user__created_exams", distinct=True),
    )


def users_queryset():
    return User.objects.select_related("school_membership__school", "student_profile", "teacher_profile").order_by("-created_at")


def apply_profile(user: User, data: dict) -> None:
    student_data = data.get("student_profile")
    teacher_data = data.get("teacher_profile")
    if student_data is not None:
        if user.role != User.Role.STUDENT:
            raise serializers.ValidationError({"student_profile": "Only student users may have a student profile."})
        allowed = {"grade", "class_name"}
        unsupported = set(student_data).difference(allowed)
        if unsupported:
            raise serializers.ValidationError({key: "Unsupported student profile field." for key in unsupported})
        profile, _ = StudentProfile.objects.get_or_create(user=user)
        for key in allowed.intersection(student_data):
            setattr(profile, key, str(student_data[key]).strip())
        profile.full_clean(); profile.save()
    if teacher_data is not None:
        if user.role != User.Role.TEACHER:
            raise serializers.ValidationError({"teacher_profile": "Only teacher users may have a teacher profile."})
        if set(teacher_data).difference({"department"}):
            raise serializers.ValidationError({"teacher_profile": "Unsupported teacher profile field."})
        profile, _ = TeacherProfile.objects.get_or_create(user=user)
        if "department" in teacher_data:
            profile.department = str(teacher_data["department"]).strip()
        profile.full_clean(); profile.save()


def apply_school(user: User, data: dict) -> None:
    if "school_id" not in data:
        return
    school = data.get("school")
    membership = SchoolMembership.objects.filter(user=user).first()
    if school is None:
        if membership:
            membership.delete()
        return
    if membership:
        membership.school = school; membership.save(update_fields=("school", "updated_at"))
    else:
        SchoolMembership.objects.create(user=user, school=school)


class AdminSchoolListCreateView(APIView):
    permission_classes = (IsAdministrator,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        return Response(AdminSchoolSerializer(schools_queryset(), many=True).data)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = AdminSchoolSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        school = serializer.save()
        return Response(AdminSchoolSerializer(schools_queryset().get(pk=school.pk)).data, status=status.HTTP_201_CREATED)


class AdminSchoolDetailView(APIView):
    permission_classes = (IsAdministrator,)

    def patch(self, request, school_id) -> Response:  # type: ignore[no-untyped-def]
        school = get_object_or_404(School, pk=school_id)
        serializer = AdminSchoolSerializer(school, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response(AdminSchoolSerializer(schools_queryset().get(pk=updated.pk)).data)


class AdminUserListCreateView(APIView):
    permission_classes = (IsAdministrator,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        queryset = users_queryset()
        if search := request.query_params.get("search", "").strip():
            queryset = queryset.filter(Q(email__icontains=search) | Q(first_name__icontains=search) | Q(last_name__icontains=search))
        if role := request.query_params.get("role"):
            if role not in User.Role.values:
                raise serializers.ValidationError({"role": "Unsupported role filter."})
            queryset = queryset.filter(role=role)
        if school_id := request.query_params.get("school_id"):
            queryset = queryset.filter(school_membership__school_id=school_id)
        return Response(AdminUserSerializer(queryset, many=True).data)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = AdminUserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            user = User.objects.create_user(
                email=data["email"], password=data["password"], first_name=data.get("first_name", ""),
                last_name=data.get("last_name", ""), role=data.get("role", User.Role.STUDENT), is_active=data.get("is_active", True),
            )
            apply_school(user, data)
            apply_profile(user, data)
        return Response(AdminUserSerializer(users_queryset().get(pk=user.pk)).data, status=status.HTTP_201_CREATED)


class AdminUserDetailView(APIView):
    permission_classes = (IsAdministrator,)

    def patch(self, request, user_id) -> Response:  # type: ignore[no-untyped-def]
        user = get_object_or_404(users_queryset(), pk=user_id)
        serializer = AdminUserWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if user.pk == request.user.pk and (data.get("role") not in {None, User.Role.ADMIN} or data.get("is_active") is False):
            raise serializers.ValidationError({"user": "Administrators cannot remove their own administrative access."})
        with transaction.atomic():
            for field in ("first_name", "last_name", "role", "is_active"):
                if field in data:
                    setattr(user, field, data[field])
            if "password" in data:
                user.set_password(data["password"])
            user.full_clean(); user.save()
            apply_school(user, data)
            apply_profile(user, data)
        return Response(AdminUserSerializer(users_queryset().get(pk=user.pk)).data)


class AdminOverviewView(APIView):
    permission_classes = (IsAdministrator,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        users = User.objects.all()
        exams = Exam.objects.all()
        return Response({
            "school_count": School.objects.filter(is_active=True).count(),
            "user_count": users.count(),
            "user_counts": {role: users.filter(role=role).count() for role in User.Role.values},
            "active_exam_count": exams.filter(status=Exam.Status.ACTIVE).count(),
            "exam_count": exams.count(),
            "unassigned_user_count": users.filter(school_membership__isnull=True).count(),
            "recent_users": AdminUserSerializer(users_queryset()[:6], many=True).data,
            "recent_exams": AdminExamSerializer(
                exams.select_related("teacher", "teacher__school_membership__school").annotate(question_count=Count("questions", distinct=True), participant_count=Count("attempts__student", distinct=True)).order_by("-updated_at")[:6],
                many=True,
            ).data,
        })


class AdminExamListView(APIView):
    permission_classes = (IsAdministrator,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        queryset = Exam.objects.select_related("teacher", "teacher__school_membership__school").annotate(
            question_count=Count("questions", distinct=True), participant_count=Count("attempts__student", distinct=True)
        ).order_by("-updated_at")
        if search := request.query_params.get("search", "").strip():
            queryset = queryset.filter(Q(title__icontains=search) | Q(subject__icontains=search) | Q(teacher__email__icontains=search))
        return Response(AdminExamSerializer(queryset, many=True).data)
