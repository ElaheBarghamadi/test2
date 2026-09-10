from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.models import User
from apps.users.permissions import IsExamOwnerOrAdministrator, IsTeacherOrAdministrator

from .models import Exam, Question, QuestionOption
from .serializers import (
    ExamWriteSerializer,
    QuestionReorderSerializer,
    QuestionWriteSerializer,
    TeacherExamListSerializer,
    TeacherExamSerializer,
    TeacherQuestionSerializer,
)
from .services import (
    archive_exam,
    complete_exam,
    duplicate_exam,
    extend_exam_time,
    publish_exam,
    refresh_total_marks,
    reorder_questions,
    resequence_questions,
    restore_exam,
    start_exam_now,
)


class ExamListQuerySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Exam.Status.choices, required=False)
    search = serializers.CharField(required=False, max_length=100)
    ordering = serializers.ChoiceField(
        choices=("title", "-title", "status", "-status", "start_at", "-start_at", "created_at", "-created_at", "updated_at", "-updated_at"),
        required=False,
        default="-updated_at",
    )


class ExamExtendSerializer(serializers.Serializer):
    """Body for the time-extension action; every other exam action is parameterless."""

    extra_minutes = serializers.IntegerField(min_value=1, max_value=180)

    def to_internal_value(self, data: dict) -> dict:
        unexpected = set(data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported extension field." for field in unexpected})
        return super().to_internal_value(data)


def _drf_validation_error(exc: DjangoValidationError) -> serializers.ValidationError:
    if hasattr(exc, "message_dict"):
        return serializers.ValidationError(exc.message_dict)
    return serializers.ValidationError(exc.messages)


class TeacherExamAccessMixin:
    permission_classes = (IsTeacherOrAdministrator, IsExamOwnerOrAdministrator)

    def get_exam_queryset(self, *, include_questions: bool = False):  # type: ignore[no-untyped-def]
        queryset = Exam.objects.select_related("teacher", "settings").annotate(
            # Distinct counts keep the question and attempt joins from multiplying each other.
            question_count=Count("questions", distinct=True),
            attempt_count=Count("attempts", distinct=True),
            participant_count=Count("attempts__student", distinct=True),
        )
        if include_questions:
            queryset = queryset.prefetch_related(
                Prefetch(
                    "questions",
                    queryset=Question.objects.order_by("order").prefetch_related(
                        Prefetch("options", queryset=QuestionOption.objects.order_by("order"))
                    ),
                )
            )
        if self.request.user.role != User.Role.ADMIN:
            queryset = queryset.filter(teacher=self.request.user)
        return queryset

    def get_exam(self, exam_id, *, include_questions: bool = False) -> Exam:  # type: ignore[no-untyped-def]
        exam = get_object_or_404(self.get_exam_queryset(include_questions=include_questions), pk=exam_id)
        self.check_object_permissions(self.request, exam)
        return exam

    def detail_response(self, exam: Exam, response_status: int = status.HTTP_200_OK) -> Response:
        hydrated = self.get_exam(exam.pk, include_questions=True)
        return Response(TeacherExamSerializer(hydrated).data, status=response_status)


class TeacherExamListCreateView(TeacherExamAccessMixin, APIView):
    """Teacher/admin owned exam listing and creation; no client-provided owner or status."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        params = ExamListQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data

        queryset = self.get_exam_queryset().annotate(question_count=Count("questions"))
        if exam_status := data.get("status"):
            queryset = queryset.filter(status=exam_status)
        if search := data.get("search"):
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(description__icontains=search) | Q(subject__icontains=search)
            )
        queryset = queryset.order_by(data["ordering"])
        return Response(TeacherExamListSerializer(queryset, many=True).data)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = ExamWriteSerializer(data=request.data, context={"teacher": request.user})
        serializer.is_valid(raise_exception=True)
        exam = serializer.save()
        return self.detail_response(exam, response_status=status.HTTP_201_CREATED)


class TeacherExamDetailView(TeacherExamAccessMixin, APIView):
    def get(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        return Response(TeacherExamSerializer(self.get_exam(exam_id, include_questions=True)).data)

    def patch(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        serializer = ExamWriteSerializer(exam, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_exam = serializer.save()
        return self.detail_response(updated_exam)


class ExamActionView(TeacherExamAccessMixin, APIView):
    action = None

    def post(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        # Resolve through owner-scoped queryset before any state-changing service call.
        exam = self.get_exam(exam_id)
        try:
            if self.action == "publish":
                result = publish_exam(exam.pk)
            elif self.action == "start":
                result = start_exam_now(exam.pk)
            elif self.action == "extend":
                minutes = ExamExtendSerializer(data=request.data)
                minutes.is_valid(raise_exception=True)
                result = extend_exam_time(exam.pk, minutes.validated_data["extra_minutes"])
            elif self.action == "archive":
                result = archive_exam(exam.pk)
            elif self.action == "restore":
                result = restore_exam(exam.pk)
            elif self.action == "complete":
                result = complete_exam(exam.pk)
            elif self.action == "duplicate":
                result = duplicate_exam(exam.pk, request.user)
            else:  # pragma: no cover - protects future route configuration mistakes
                raise RuntimeError("Unknown exam action")
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        response_status = status.HTTP_201_CREATED if self.action == "duplicate" else status.HTTP_200_OK
        return self.detail_response(result, response_status=response_status)



class QuestionAccessMixin(TeacherExamAccessMixin):
    def get_question_queryset(self):  # type: ignore[no-untyped-def]
        queryset = Question.objects.select_related("exam", "exam__teacher").prefetch_related(
            Prefetch("options", queryset=QuestionOption.objects.order_by("order"))
        )
        if self.request.user.role != User.Role.ADMIN:
            queryset = queryset.filter(exam__teacher=self.request.user)
        return queryset

    def get_question(self, question_id) -> Question:  # type: ignore[no-untyped-def]
        question = get_object_or_404(self.get_question_queryset(), pk=question_id)
        self.check_object_permissions(self.request, question.exam)
        return question


class ExamQuestionListCreateView(QuestionAccessMixin, APIView):
    def get(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        questions = self.get_question_queryset().filter(exam=exam).order_by("order")
        return Response(TeacherQuestionSerializer(questions, many=True).data)

    def post(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        serializer = QuestionWriteSerializer(data=request.data, context={"exam": exam})
        serializer.is_valid(raise_exception=True)
        question = serializer.save()
        question = self.get_question(question.pk)
        return Response(TeacherQuestionSerializer(question).data, status=status.HTTP_201_CREATED)


class TeacherQuestionDetailView(QuestionAccessMixin, APIView):
    def get(self, request, question_id) -> Response:  # type: ignore[no-untyped-def]
        return Response(TeacherQuestionSerializer(self.get_question(question_id)).data)

    def patch(self, request, question_id) -> Response:  # type: ignore[no-untyped-def]
        question = self.get_question(question_id)
        serializer = QuestionWriteSerializer(question, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_question = serializer.save()
        return Response(TeacherQuestionSerializer(self.get_question(updated_question.pk)).data)

    def delete(self, request, question_id) -> Response:  # type: ignore[no-untyped-def]
        question = self.get_question(question_id)
        with transaction.atomic():
            exam = Exam.objects.select_for_update().get(pk=question.exam_id)
            question.delete()
            resequence_questions(exam.pk)
            refresh_total_marks(exam)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ExamQuestionReorderView(QuestionAccessMixin, APIView):
    def post(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        serializer = QuestionReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reorder_questions(exam.pk, serializer.validated_data["question_ids"])
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        questions = self.get_question_queryset().filter(exam=exam).order_by("order")
        return Response(TeacherQuestionSerializer(questions, many=True).data)
