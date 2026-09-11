from __future__ import annotations

from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.exams.models import Exam, Question, QuestionOption
from apps.results.models import ExamResult
from apps.results.serializers import StudentResultSerializer
from apps.users.permissions import IsOwnStudentAttempt, IsStudent

from .models import ExamAttempt, StudentAnswer
from .serializers import (
    StudentAnswerInputSerializer,
    StudentAttemptAnswerSerializer,
    StudentAttemptDetailSerializer,
    StudentAvailableExamSerializer,
    StudentBatchAnswerSerializer,
)
from .services import (
    AttemptConflict,
    AudienceContext,
    attempt_question_ids,
    attempt_timing,
    claim_session,
    exam_availability,
    heartbeat,
    record_client_signal,
    refresh_attempt_if_expired,
    save_answer,
    save_answers_batch,
    set_question_flag,
    start_attempt,
    submit_attempt,
)


def _session_context(request) -> tuple[str, int | None]:  # type: ignore[no-untyped-def]
    """Read the two optional write guards. Absent headers simply mean "no guard", so old clients work.

    `X-Exam-Session` is a random id the browser tab keeps in sessionStorage; `X-Exam-Revision` is the
    attempt revision that payload was built from. Both travel as headers so the strict, field-validated
    answer payloads stay untouched.
    """
    client_session = (request.headers.get("X-Exam-Session") or "")[:64]
    raw_revision = request.headers.get("X-Exam-Revision")
    expected_revision = None
    if raw_revision is not None:
        try:
            expected_revision = max(0, int(raw_revision))
        except (TypeError, ValueError):
            expected_revision = None
    return client_session, expected_revision


def _conflict_response(exc: AttemptConflict) -> Response:
    """A rejected write is a conflict, not a validation failure: clients branch on `code`."""
    payload: dict[str, object] = {
        "detail": str(exc),
        "code": exc.code,
        "status_code": status.HTTP_409_CONFLICT,
    }
    payload.update(exc.extra)
    return Response(payload, status=status.HTTP_409_CONFLICT)


def _drf_validation_error(exc: DjangoValidationError) -> serializers.ValidationError:
    if hasattr(exc, "message_dict"):
        return serializers.ValidationError(exc.message_dict)
    return serializers.ValidationError(exc.messages)


def _ordered_questions(attempt: ExamAttempt) -> list[Question]:
    ordered_ids = attempt_question_ids(attempt)
    questions = Question.objects.filter(exam_id=attempt.exam_id, id__in=ordered_ids).prefetch_related(
        Prefetch("options", queryset=QuestionOption.objects.order_by("order"))
    )
    question_by_id = {str(question.id): question for question in questions}
    return [question_by_id[question_id] for question_id in ordered_ids if question_id in question_by_id]


def _attempt_detail_queryset():  # type: ignore[no-untyped-def]
    return (
        ExamAttempt.objects.select_related("exam", "exam__settings")
        .prefetch_related(
            Prefetch(
                "answers",
                queryset=StudentAnswer.objects.select_related("question").prefetch_related(
                    Prefetch("selected_options", queryset=QuestionOption.objects.order_by("order"))
                ),
            )
        )
    )


def _hydrate_attempt(attempt_id: UUID, student) -> ExamAttempt:  # type: ignore[no-untyped-def]
    attempt = get_object_or_404(_attempt_detail_queryset().filter(student=student), pk=attempt_id)
    attempt.student_questions = _ordered_questions(attempt)
    return attempt


def _answer_response(answer_id: UUID) -> Response:
    answer = (
        StudentAnswer.objects.prefetch_related(Prefetch("selected_options", queryset=QuestionOption.objects.order_by("order")))
        .get(pk=answer_id)
    )
    return Response(StudentAttemptAnswerSerializer(answer).data)


class StudentAvailableExamView(APIView):
    permission_classes = (IsStudent,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        # Membership and profile are constants for this request; resolving them once keeps the loop
        # from issuing two extra queries per exam.
        audience = AudienceContext(request.user)
        candidate_exams = (
            Exam.objects.filter(status__in=(Exam.Status.SCHEDULED, Exam.Status.ACTIVE, Exam.Status.COMPLETED))
            .select_related("settings", "teacher")
            .annotate(question_count=Count("questions", distinct=True))
            .prefetch_related(
                Prefetch(
                    "attempts",
                    queryset=ExamAttempt.objects.filter(student=request.user)
                    .select_related("result")
                    .order_by("-attempt_number", "-created_at"),
                    to_attr="student_attempts",
                )
            )
            .order_by("start_at", "title")
        )
        visible_exams: list[Exam] = []
        for exam in candidate_exams:
            attempts = exam.student_attempts
            latest_attempt = attempts[0] if attempts else None
            if latest_attempt and latest_attempt.status == ExamAttempt.Status.IN_PROGRESS:
                latest_attempt = refresh_attempt_if_expired(latest_attempt.id, request.user)

            availability = exam_availability(exam, request.user, audience=audience)
            if availability is None or (availability == "completed" and latest_attempt is None):
                continue
            if latest_attempt and latest_attempt.status == ExamAttempt.Status.IN_PROGRESS:
                availability = "in_progress"
            elif latest_attempt and latest_attempt.status in {ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED}:
                availability = "completed"
            exam.student_availability = availability
            exam.student_attempt = latest_attempt
            if latest_attempt is not None:
                # Reuse the already loaded exam so timing and result summaries add no queries.
                latest_attempt.exam = exam
                if latest_attempt.status == ExamAttempt.Status.IN_PROGRESS:
                    latest_attempt.student_remaining_seconds = attempt_timing(latest_attempt)["remaining_seconds"]
            visible_exams.append(exam)
        return Response(StudentAvailableExamSerializer(visible_exams, many=True).data)


class StudentExamStartView(APIView):
    throttle_scope = "exam_write"

    permission_classes = (IsStudent,)

    def post(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        client_session, _ = _session_context(request)
        try:
            attempt, created = start_attempt(exam_id, request.user, client_session=client_session)
        except (DjangoValidationError, Exam.DoesNotExist) as exc:
            if isinstance(exc, Exam.DoesNotExist):
                raise serializers.ValidationError({"exam": ["This exam is not available to start."]}) from exc
            raise _drf_validation_error(exc) from exc
        hydrated_attempt = _hydrate_attempt(attempt.id, request.user)
        return Response(
            StudentAttemptDetailSerializer(hydrated_attempt, context={"timing": attempt_timing(hydrated_attempt)}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class StudentAttemptAccessMixin:
    permission_classes = (IsOwnStudentAttempt,)

    def get_attempt(self, attempt_id: UUID, *, refresh_expiry: bool = True) -> ExamAttempt:
        attempt = get_object_or_404(ExamAttempt.objects.filter(student=self.request.user), pk=attempt_id)
        self.check_object_permissions(self.request, attempt)
        if refresh_expiry:
            try:
                refresh_attempt_if_expired(attempt.id, self.request.user)
            except DjangoValidationError as exc:
                raise _drf_validation_error(exc) from exc
        return _hydrate_attempt(attempt.id, self.request.user)

    def get_attempt_question(self, attempt: ExamAttempt, question_id: UUID) -> Question:
        question = get_object_or_404(Question.objects.filter(exam_id=attempt.exam_id), pk=question_id)
        if str(question.id) not in attempt_question_ids(attempt):
            raise serializers.ValidationError({"question": ["This question is not part of the exam session."]})
        return question


class StudentAttemptDetailView(StudentAttemptAccessMixin, APIView):
    def get(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        return Response(StudentAttemptDetailSerializer(attempt, context={"timing": attempt_timing(attempt)}).data)


class StudentAttemptHeartbeatView(StudentAttemptAccessMixin, APIView):
    """Small, pollable liveness endpoint: the clock and the queue, without the whole attempt payload."""

    def post(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        client_session, _ = _session_context(request)
        get_object_or_404(ExamAttempt.objects.filter(student=request.user), pk=attempt_id)
        try:
            return Response(heartbeat(attempt_id, request.user, client_session=client_session))
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc


class StudentAttemptClaimView(StudentAttemptAccessMixin, APIView):
    """Deliberate takeover: continue this attempt in this tab, e.g. after the student switched devices."""

    def post(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        # Resolve ownership first: an attempt the caller cannot reach is a 404, whatever they sent.
        get_object_or_404(ExamAttempt.objects.filter(student=request.user), pk=attempt_id)
        client_session, _ = _session_context(request)
        if not client_session:
            raise serializers.ValidationError({"session": ["A session identifier is required."]})
        try:
            return Response(claim_session(attempt_id, request.user, client_session=client_session))
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc


class StudentAttemptSignalView(StudentAttemptAccessMixin, APIView):
    """Records a browser-observed signal (tab hidden, connection lost). Never a verdict, never a timestamp."""

    def post(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        kind = (request.data.get("kind") or "").strip()
        get_object_or_404(ExamAttempt.objects.filter(student=request.user), pk=attempt_id)
        try:
            record_client_signal(attempt_id, request.user, kind=kind)
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class StudentAttemptAnswerView(StudentAttemptAccessMixin, APIView):
    throttle_scope = "exam_write"

    def patch(self, request, attempt_id, question_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        question = self.get_attempt_question(attempt, question_id)
        serializer = StudentAnswerInputSerializer(data=request.data, context={"question": question})
        serializer.is_valid(raise_exception=True)
        client_session, expected_revision = _session_context(request)
        try:
            answer = save_answer(
                attempt.id,
                request.user,
                question,
                serializer.validated_data,
                client_session=client_session,
                expected_revision=expected_revision,
            )
        except AttemptConflict as exc:
            return _conflict_response(exc)
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        return _answer_response(answer.id)


class StudentAttemptBatchAnswerView(StudentAttemptAccessMixin, APIView):
    throttle_scope = "exam_write"

    def patch(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        serializer = StudentBatchAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        questions_by_id = {str(question.id): question for question in _ordered_questions(attempt)}
        item_errors: dict[str, object] = {}
        updates: list[tuple[Question, dict]] = []
        seen_question_ids: set[str] = set()
        uuid_field = serializers.UUIDField()
        for index, item in enumerate(serializer.validated_data["answers"]):
            question_id = item.get("question_id")
            try:
                parsed_question_id = uuid_field.run_validation(question_id)
            except serializers.ValidationError as exc:
                item_errors[str(index)] = {"question_id": exc.detail}
                continue
            question_key = str(parsed_question_id)
            if question_key in seen_question_ids:
                item_errors[str(index)] = {"question_id": ["Each question may appear only once in a batch."]}
                continue
            seen_question_ids.add(question_key)
            question = questions_by_id.get(question_key)
            if question is None:
                item_errors[str(index)] = {"question_id": ["This question is not part of the exam session."]}
                continue
            answer_payload = {key: value for key, value in item.items() if key != "question_id"}
            item_serializer = StudentAnswerInputSerializer(data=answer_payload, context={"question": question})
            if not item_serializer.is_valid():
                item_errors[str(index)] = item_serializer.errors
                continue
            updates.append((question, item_serializer.validated_data))
        if item_errors:
            raise serializers.ValidationError({"answers": item_errors})

        client_session, expected_revision = _session_context(request)
        try:
            answers = save_answers_batch(
                attempt.id, request.user, updates, client_session=client_session, expected_revision=expected_revision
            )
        except AttemptConflict as exc:
            return _conflict_response(exc)
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        answer_ids = [answer.id for answer in answers]
        persisted_answers = (
            StudentAnswer.objects.filter(id__in=answer_ids)
            .prefetch_related(Prefetch("selected_options", queryset=QuestionOption.objects.order_by("order")))
        )
        answer_by_id = {answer.id: answer for answer in persisted_answers}
        return Response(StudentAttemptAnswerSerializer([answer_by_id[answer_id] for answer_id in answer_ids], many=True).data)


class StudentAttemptFlagView(StudentAttemptAccessMixin, APIView):
    throttle_scope = "exam_write"

    def post(self, request, attempt_id, question_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        question = self.get_attempt_question(attempt, question_id)
        client_session, expected_revision = _session_context(request)
        try:
            answer = set_question_flag(
                attempt.id,
                request.user,
                question,
                is_flagged=True,
                client_session=client_session,
                expected_revision=expected_revision,
            )
        except AttemptConflict as exc:
            return _conflict_response(exc)
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        return _answer_response(answer.id)

    def delete(self, request, attempt_id, question_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        question = self.get_attempt_question(attempt, question_id)
        client_session, expected_revision = _session_context(request)
        try:
            answer = set_question_flag(
                attempt.id,
                request.user,
                question,
                is_flagged=False,
                client_session=client_session,
                expected_revision=expected_revision,
            )
        except AttemptConflict as exc:
            return _conflict_response(exc)
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc
        return _answer_response(answer.id)


class StudentAttemptSubmitView(StudentAttemptAccessMixin, APIView):
    def post(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        # Do not refresh expiry first: submit_attempt finalizes expired attempts atomically and idempotently.
        attempt = self.get_attempt(attempt_id, refresh_expiry=False)
        client_session, _ = _session_context(request)
        trigger = "auto" if str(request.data.get("trigger", "")) == "auto" else "manual"
        try:
            finalized_attempt, result = submit_attempt(
                attempt.id, request.user, client_session=client_session, trigger=trigger
            )
        except AttemptConflict as exc:
            return _conflict_response(exc)
        except DjangoValidationError as exc:
            raise _drf_validation_error(exc) from exc

        response_data: dict[str, object] = {
            "attempt": {
                "id": str(finalized_attempt.id),
                "status": finalized_attempt.status,
                "submitted_at": finalized_attempt.submitted_at,
            },
            "result_available": result.status == ExamResult.Status.PUBLISHED,
        }
        if result.status == ExamResult.Status.PUBLISHED:
            response_data["result"] = StudentResultSerializer(result).data
        return Response(response_data)


class StudentResultView(StudentAttemptAccessMixin, APIView):
    def get(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        if attempt.status not in {ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED}:
            raise serializers.ValidationError({"attempt": ["A result is available after the exam is finalized."]})
        result = get_object_or_404(
            ExamResult.objects.select_related("attempt__exam__settings", "attempt__student"), attempt=attempt
        )
        if result.status != ExamResult.Status.PUBLISHED:
            raise PermissionDenied("This result is not available.")
        return Response(StudentResultSerializer(result).data)
