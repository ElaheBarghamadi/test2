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

from .models import Exam, Question, QuestionOption, QuestionTag
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
    close_overdue_exams,
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
    # Authoring is bulk-friendly by design (options, reorder, import), so the same write budget that
    # guards the exam engine guards it: 240/min is far above real editing, and it caps a runaway loop.
    throttle_scope = "exam_write"

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
        # No scheduler runs here, so the list read is where an exam whose window closed is moved out of
        # "active". The query behind it is a single indexed filter and the transition is idempotent.
        close_overdue_exams(owner=request.user)
        params = ExamListQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data

        # No re-annotation here on purpose: `question_count` already exists from the shared queryset,
        # and re-declaring it without `distinct=True` multiplies questions by attempts through the join.
        # No re-annotation here on purpose: `question_count` already exists from the shared queryset,
        # and re-declaring it without `distinct=True` multiplies questions by attempts through the join.
        queryset = self.get_exam_queryset()
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
        queryset = (
            Question.objects.select_related("exam", "exam__teacher")
            .prefetch_related(
                Prefetch("options", queryset=QuestionOption.objects.order_by("order")),
                "tags",
            )
            # Bank bookkeeping: how many attempts answered this question, and how many copies the
            # teacher has made of it elsewhere. Both are annotations so a list stays one query.
            .annotate(
                answered_count=Count("student_answers", distinct=True),
                usage_count=Count("copies", distinct=True),
            )
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
        reused = getattr(serializer, "deduplicated", None)
        question = self.get_question(question.pk)
        payload = dict(TeacherQuestionSerializer(question).data)
        if reused is not None:
            # The exam already held this exact question, so no second copy was made. 200 rather than 201
            # says so in the status itself, and the flag lets the builder explain it to the teacher.
            payload["deduplicated"] = True
            return Response(payload, status=status.HTTP_200_OK)
        return Response(payload, status=status.HTTP_201_CREATED)


class QuestionBankFilterSerializer(serializers.Serializer):
    """Query-string filters for the reusable question bank."""

    search = serializers.CharField(required=False, allow_blank=True, max_length=200)
    type = serializers.ChoiceField(required=False, choices=Question.Type.choices)
    difficulty = serializers.ChoiceField(required=False, choices=Question.Difficulty.choices)
    tag = serializers.CharField(required=False, allow_blank=True, max_length=60)
    subject = serializers.CharField(required=False, allow_blank=True, max_length=150)
    exam = serializers.UUIDField(required=False)
    archived = serializers.BooleanField(required=False, default=False)
    ordering = serializers.ChoiceField(
        required=False,
        default="-updated_at",
        choices=(
            "updated_at", "-updated_at", "difficulty", "-difficulty",
            "marks", "-marks", "answered_count", "-answered_count", "type", "-type",
        ),
    )


class QuestionBankListView(QuestionAccessMixin, APIView):
    """Every question this teacher owns, searchable, so the next exam can reuse the last one."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        params = QuestionBankFilterSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        queryset = self.get_question_queryset().select_related("exam__settings")
        if search := data.get("search", "").strip():
            queryset = queryset.filter(Q(text__icontains=search) | Q(instructions__icontains=search) | Q(exam__subject__icontains=search))
        if data.get("type"):
            queryset = queryset.filter(type=data["type"])
        if data.get("difficulty"):
            queryset = queryset.filter(difficulty=data["difficulty"])
        if data.get("subject", "").strip():
            queryset = queryset.filter(exam__subject__iexact=data["subject"].strip())
        if data.get("tag", "").strip():
            queryset = queryset.filter(tags__name__iexact=data["tag"].strip())
        if data.get("exam"):
            queryset = queryset.filter(exam_id=data["exam"])
        queryset = queryset.filter(is_archived=bool(data.get("archived")))
        order = data["ordering"]
        if order == "answered_count" or order == "-answered_count":
            queryset = queryset.order_by(order, "-created_at")
        else:
            queryset = queryset.order_by(order, "exam__title", "order")
        return Response(TeacherQuestionSerializer(queryset[:200], many=True).data)


class QuestionBankTagsView(QuestionAccessMixin, APIView):
    """The teacher's tag list, with counts, for the bank's filter chips."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        teacher = None if request.user.role == User.Role.ADMIN else request.user
        tags = QuestionTag.objects.filter(teacher=teacher) if teacher is not None else QuestionTag.objects.all()
        return Response([{"id": str(tag.id), "name": tag.name, "count": tag.questions.count()} for tag in tags.order_by("name")])


class QuestionImportSerializer(serializers.Serializer):
    """Bulk "insert these bank questions into that exam"."""

    question_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False, max_length=100)

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported import field." for field in unexpected})
        if len(attrs["question_ids"]) != len(set(attrs["question_ids"])):
            raise serializers.ValidationError({"question_ids": "Question IDs must not repeat."})
        return attrs


class ExamQuestionImportView(QuestionAccessMixin, APIView):
    """Copy bank questions into an exam. Copies, never moves: grading history stays untouched."""

    def post(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        params = QuestionImportSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        from .services import copy_questions_into_exam

        try:
            created_ids, skipped = copy_questions_into_exam(exam, params.validated_data["question_ids"], request.user)
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        questions = self.get_question_queryset().filter(pk__in=created_ids).order_by("order")
        if skipped:
            # Selections that duplicate what the exam already holds are dropped, not inserted twice, and the
            # response says how many so the teacher is not left counting.
            return Response(
                {
                    "questions": TeacherQuestionSerializer(questions, many=True).data,
                    "created_count": len(created_ids),
                    "skipped_duplicates": skipped,
                },
                status=status.HTTP_200_OK if created_ids else status.HTTP_201_CREATED,
            )
        return Response(TeacherQuestionSerializer(questions, many=True).data, status=status.HTTP_201_CREATED)


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
        if question.student_answers.exists():
            # StudentAnswer.question is PROTECT, and that protection is the point: deleting this row
            # would delete the answer history it belongs to. Before this check the ORM raised
            # ProtectedError and the API answered with a 500 debug page.
            return Response(
                {
                    "detail": {
                        "question": (
                            "This question has student answers, so it cannot be deleted. Archive it to hide it "
                            "from the bank, or duplicate the exam if you need a clean copy."
                        )
                    },
                    "code": "question_has_answers",
                    "answered_count": question.student_answers.count(),
                    "status_code": status.HTTP_409_CONFLICT,
                },
                status=status.HTTP_409_CONFLICT,
            )
        with transaction.atomic():
            exam = Exam.objects.select_for_update().get(pk=question.exam_id)
            question.delete()
            resequence_questions(exam.pk)
            refresh_total_marks(exam)
        return Response(status=status.HTTP_204_NO_CONTENT)


class QuestionArchiveView(QuestionAccessMixin, APIView):
    """Hide a question from the bank picker, or bring it back. Exam content is untouched either way."""

    def post(self, request, question_id) -> Response:  # type: ignore[no-untyped-def]
        action = (request.data.get("action") or "archive").strip().lower()
        if action not in {"archive", "restore"}:
            raise serializers.ValidationError({"action": "Use `archive` or `restore`."})
        question = self.get_question(question_id)
        question.is_archived = action == "archive"
        question.save(update_fields=("is_archived", "updated_at"))
        return Response(TeacherQuestionSerializer(self.get_question(question.pk)).data)


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
