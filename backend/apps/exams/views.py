from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.models import User
from apps.organizations.scope import is_school_admin, scope_exams
from apps.users.permissions import CanSuperviseExam, IsExamOwnerOrAdministrator, IsTeacherOrAdministrator

from .models import Exam, Question, QuestionFolder, QuestionOption, QuestionTag
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


def _refuse_school_admin_authoring(user) -> None:
    """Authoring is the owner's job, and the console says so in the language the teacher reads.

    The rule is enforced here rather than hidden in the interface: a school administrator's reach is the
    paper's lifecycle — schedule, publication, results — and writing a teacher's stems would make the answer
    key disagree with attempts that were already graded against it.
    """
    if is_school_admin(user):
        raise PermissionDenied("مدیر مدرسه نمی‌تواند محتوای آزمون را تغییر دهد؛ این کار آموزگار مالک آزمون است.")


class TeacherExamAccessMixin:
    """Scoping and permissions for the teacher-facing exam routes.

    A school administrator reaches this family for **reading and lifecycle**: `CanSuperviseExam` admits them
    and `scope_exams` narrows every queryset to their own school, so a foreign exam id is a 404 before any
    object check. Writing is refused per entry point (see `_refuse_school_admin_authoring`) or, for the
    question family, by `QuestionAccessMixin` restating the stricter pair.
    """

    permission_classes = (CanSuperviseExam,)
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
        if self.request.user.role == User.Role.TEACHER:
            queryset = queryset.filter(teacher=self.request.user)
        else:
            # Platform admin sees the network; a school administrator sees their school's papers.
            queryset = scope_exams(self.request.user, queryset)
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
        _refuse_school_admin_authoring(request.user)
        serializer = ExamWriteSerializer(data=request.data, context={"teacher": request.user})
        serializer.is_valid(raise_exception=True)
        exam = serializer.save()
        return self.detail_response(exam, response_status=status.HTTP_201_CREATED)


class TeacherExamDetailView(TeacherExamAccessMixin, APIView):
    def get(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        return Response(TeacherExamSerializer(self.get_exam(exam_id, include_questions=True)).data)

    def patch(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        _refuse_school_admin_authoring(request.user)
        exam = self.get_exam(exam_id)
        serializer = ExamWriteSerializer(exam, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_exam = serializer.save()
        return self.detail_response(updated_exam)


class ExamActionView(TeacherExamAccessMixin, APIView):
    action = None

    def post(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        # Duplicating a paper builds new rows, so it is authoring even though it reads like an action.
        if self.action == "duplicate":
            _refuse_school_admin_authoring(request.user)
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
    """Question content: the owner or the platform admin only.

    Inherits the scoping and the response helpers, but not `CanSuperviseExam` — a school administrator
    supervising a paper must not be able to add, edit, import, reorder or archive its questions.
    """

    permission_classes = (IsTeacherOrAdministrator, IsExamOwnerOrAdministrator)

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
            # Exam content is reachable through its paper's teacher; a bank row has no paper, so it is
            # reachable through the teacher who wrote it. Nothing else sees either.
            queryset = queryset.filter(Q(exam__teacher=self.request.user) | Q(owner=self.request.user))
        return queryset

    def get_question(self, question_id) -> Question:  # type: ignore[no-untyped-def]
        question = get_object_or_404(self.get_question_queryset(), pk=question_id)
        if question.exam_id is not None:
            self.check_object_permissions(self.request, question.exam)
        elif self.request.user.role != User.Role.ADMIN and question.owner_id != self.request.user.id:
            # The queryset above already narrowed this row to its owner; this is the second net, kept because
            # a bank row has no exam object for the permission class to be handed.
            raise PermissionDenied("This question is not yours.")
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
    # Bank organisation: a folder id, the literal "unfiled", a category name, and the draft/ready flag.
    folder = serializers.CharField(required=False, allow_blank=True, max_length=36)
    category = serializers.CharField(required=False, allow_blank=True, max_length=80)
    status = serializers.ChoiceField(required=False, choices=Question.Status.choices)
    # "bank" = questions that belong to no exam, "exam" = only content that is in a paper, "any" = both.
    placement = serializers.ChoiceField(required=False, default="any", choices=("any", "bank", "exam"))
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
        if folder := data.get("folder", ""):
            queryset = queryset.filter(folder__isnull=True) if folder == "unfiled" else queryset.filter(folder_id=folder)
        if data.get("category", "").strip():
            queryset = queryset.filter(category__iexact=data["category"].strip())
        if data.get("status"):
            queryset = queryset.filter(status=data["status"])
        if data.get("placement") == "bank":
            queryset = queryset.filter(exam__isnull=True)
        elif data.get("placement") == "exam":
            queryset = queryset.filter(exam__isnull=False)
        queryset = queryset.filter(is_archived=bool(data.get("archived")))
        order = data["ordering"]
        if order == "answered_count" or order == "-answered_count":
            queryset = queryset.order_by(order, "-created_at")
        else:
            queryset = queryset.order_by(order, "exam__title", "order")
        return Response(TeacherQuestionSerializer(queryset[:200], many=True).data)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        """Author a question straight into the bank, with no exam behind it.

        This is the "save it and keep working on it" path: a draft row is invisible to every exam, so a
        teacher can write half a question, close the tab, and finish it later without a paper carrying it.
        """
        serializer = QuestionWriteSerializer(
            data=request.data, context={"exam": None, "owner": request.user, "request": request}
        )
        serializer.is_valid(raise_exception=True)
        question = serializer.save()
        payload = dict(TeacherQuestionSerializer(self.get_question(question.pk)).data)
        if getattr(serializer, "deduplicated", None) is not None:
            payload["deduplicated"] = True
            return Response(payload, status=status.HTTP_200_OK)
        return Response(payload, status=status.HTTP_201_CREATED)


class QuestionBankTagsView(QuestionAccessMixin, APIView):
    """The teacher's tag list, with counts, for the bank's filter chips."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        teacher = None if request.user.role == User.Role.ADMIN else request.user
        tags = QuestionTag.objects.filter(teacher=teacher) if teacher is not None else QuestionTag.objects.all()
        return Response([{"id": str(tag.id), "name": tag.name, "count": tag.questions.count()} for tag in tags.order_by("name")])


class QuestionFolderSerializer(serializers.ModelSerializer):
    """One shelf of the bank. `question_count` is the number of live (unarchived) questions filed in it."""

    question_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = QuestionFolder
        fields = ("id", "name", "parent", "question_count", "created_at", "updated_at")
        read_only_fields = ("id", "question_count", "created_at", "updated_at")

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Folder name cannot be blank.")
        return value[:120]

    def validate_parent(self, value):  # type: ignore[no-untyped-def]
        if value is None:
            return None
        user = self.context["request"].user
        if user.role != User.Role.ADMIN and value.teacher_id != user.id:
            raise serializers.ValidationError("This folder is not yours.")
        return value

    def validate(self, attrs: dict) -> dict:
        unexpected = set(self.initial_data).difference(self.fields)
        if unexpected:
            raise serializers.ValidationError({field: "This is not a supported folder field." for field in unexpected})
        # The unique index treats "no parent" as distinct from itself, so two top-level folders could share a
        # name if this were left to the database. The check is here instead, case-insensitively, and it skips
        # the row being renamed.
        teacher = getattr(self.context["request"].user, "pk", None)
        name = (attrs.get("name") or "").lower()
        parent = attrs.get("parent", self.instance.parent if self.instance is not None else None)
        if name:
            clash = QuestionFolder.objects.filter(teacher_id=teacher, name__iexact=name, parent=parent)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({"name": "You already have a folder with this name here."})
        return attrs


class QuestionFolderAccessMixin(QuestionAccessMixin):
    """Folders are the teacher's own furniture; the platform admin can see all of them."""

    def get_folder_queryset(self):  # type: ignore[no-untyped-def]
        queryset = QuestionFolder.objects.select_related("parent").annotate(
            question_count=Count("questions", filter=Q(questions__is_archived=False), distinct=True)
        )
        if self.request.user.role != User.Role.ADMIN:
            queryset = queryset.filter(teacher=self.request.user)
        return queryset


class QuestionFolderListView(QuestionFolderAccessMixin, APIView):
    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        folders = self.get_folder_queryset().order_by("name")
        return Response(QuestionFolderSerializer(folders, many=True).data)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = QuestionFolderSerializer(
            data=request.data, context={"request": request, "teacher": request.user},
        )
        serializer.is_valid(raise_exception=True)
        # `teacher` is not in the serializer's fields: the folder always belongs to whoever is authenticated,
        # so a request cannot file a folder in somebody else's bank by naming their id.
        folder = serializer.save(teacher=request.user)
        # Re-read through the scoped queryset: `question_count` is an annotation, and a plain instance
        # would answer without it.
        return Response(
            QuestionFolderSerializer(self.get_folder_queryset().get(pk=folder.pk)).data,
            status=status.HTTP_201_CREATED,
        )


class QuestionFolderDetailView(QuestionFolderAccessMixin, APIView):
    def get_object(self, folder_id) -> QuestionFolder:  # type: ignore[no-untyped-def]
        return get_object_or_404(self.get_folder_queryset(), pk=folder_id)

    def patch(self, request, folder_id) -> Response:  # type: ignore[no-untyped-def]
        folder = self.get_object(folder_id)
        serializer = QuestionFolderSerializer(folder, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(QuestionFolderSerializer(self.get_folder_queryset().get(pk=folder.pk)).data)

    def delete(self, request, folder_id) -> Response:  # type: ignore[no-untyped-def]
        folder = self.get_object(folder_id)
        if folder.children.exists():
            raise serializers.ValidationError(
                {"folder": ["Move or delete the folders inside it first."]}
            )
        # `on_delete=SET_NULL` on Question.folder means the questions are unfiled, never deleted: a folder is
        # a way of organising the bank, not a container that owns what is in it.
        folder.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class QuestionBankCategoriesView(QuestionAccessMixin, APIView):
    """The teacher's own category labels, with counts, for the bank's filter chips."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        rows = (
            self.get_question_queryset()
            .exclude(category="")
            .values("category")
            .annotate(count=Count("id"))
            .order_by("category")
        )
        return Response([{"category": row["category"], "count": row["count"]} for row in rows])


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
            # A bank row has no exam to re-sequence or re-total, and `exam_id` being null here is the normal
            # case for a question its author deleted before ever using it.
            if question.exam_id is not None:
                exam = Exam.objects.select_for_update().get(pk=question.exam_id)
            question.delete()
            if question.exam_id is not None:
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
