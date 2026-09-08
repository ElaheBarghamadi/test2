from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attempts.models import ExamAttempt, StudentAnswer
from apps.attempts.services import _grade_attempt
from apps.exams.models import Exam, Question
from apps.organizations.models import SchoolMembership
from apps.users.models import User
from apps.users.permissions import IsTeacherOrAdministrator

from .models import ExamResult
from .serializers import (
    ManualGradeSerializer,
    TeacherAttemptAnswerSerializer,
    TeacherAttemptRowSerializer,
    TeacherResultFeedbackSerializer,
    TeacherResultSerializer,
)


class TeacherResultsAccessMixin:
    permission_classes = (IsTeacherOrAdministrator,)

    def exams(self):  # type: ignore[no-untyped-def]
        queryset = Exam.objects.select_related("settings", "teacher")
        if self.request.user.role != "admin":
            queryset = queryset.filter(teacher=self.request.user)
        return queryset

    def attempts(self):  # type: ignore[no-untyped-def]
        return (
            ExamAttempt.objects.filter(exam__in=self.exams())
            .select_related("exam", "exam__settings", "student", "student__student_profile", "result")
            .order_by("-last_activity_at", "-created_at")
        )

    def get_exam(self, exam_id):  # type: ignore[no-untyped-def]
        return get_object_or_404(self.exams(), pk=exam_id)

    def get_attempt(self, attempt_id):  # type: ignore[no-untyped-def]
        return get_object_or_404(self.attempts(), pk=attempt_id)


class TeacherResultsOverviewView(TeacherResultsAccessMixin, APIView):
    """Aggregate-only cards/activity for the teacher dashboard. No student answer content."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        exams = self.exams()
        attempts = self.attempts()
        status_counts = dict(exams.values_list("status").annotate(count=Count("id")))
        recent = [
            {
                "id": str(attempt.id),
                "title": attempt.exam.title,
                "student_name": attempt.student.get_full_name(),
                "status": attempt.status,
                "at": attempt.last_activity_at,
            }
            for attempt in attempts[:8]
        ]
        return Response(
            {
                "exam_counts": {status: status_counts.get(status, 0) for status in Exam.Status.values},
                "participant_count": attempts.values("student_id").distinct().count(),
                "attempt_count": attempts.count(),
                "pending_manual_grading_count": ExamResult.objects.filter(
                    attempt__in=attempts, pending_manual_grading_count__gt=0
                ).count(),
                "recent_activity": recent,
            }
        )


class TeacherExamResultsView(TeacherResultsAccessMixin, APIView):
    def get(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        attempts = self.attempts().filter(exam=exam)
        return Response(TeacherAttemptRowSerializer(attempts, many=True).data)


class TeacherAttemptDetailView(TeacherResultsAccessMixin, APIView):
    def get(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        answers = (
            StudentAnswer.objects.filter(attempt=attempt)
            .select_related("question")
            .prefetch_related("selected_options")
            .order_by("question__order")
        )
        result = getattr(attempt, "result", None)
        return Response(
            {
                "id": str(attempt.id),
                "exam": {"id": str(attempt.exam_id), "title": attempt.exam.title, "total_marks": attempt.exam.total_marks},
                "student": {
                    "id": str(attempt.student_id),
                    "full_name": attempt.student.get_full_name(),
                    "email": attempt.student.email,
                    "grade": getattr(getattr(attempt.student, "student_profile", None), "grade", ""),
                    "class_name": getattr(getattr(attempt.student, "student_profile", None), "class_name", ""),
                },
                "status": attempt.status,
                "started_at": attempt.started_at,
                "submitted_at": attempt.submitted_at,
                "answers": TeacherAttemptAnswerSerializer(answers, many=True).data,
                "result": TeacherResultSerializer(result).data if result else None,
            }
        )


class TeacherManualGradeView(TeacherResultsAccessMixin, APIView):
    def patch(self, request, attempt_id, question_id) -> Response:  # type: ignore[no-untyped-def]
        with transaction.atomic():
            attempt = self.get_attempt(attempt_id)
            if attempt.status not in {ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED}:
                raise serializers.ValidationError({"attempt": ["Only finalized attempts can be graded."]})
            question = get_object_or_404(Question.objects.filter(exam=attempt.exam), pk=question_id)
            requires_manual_grading = question.type == Question.Type.WRITTEN or (
                question.type == Question.Type.SHORT_ANSWER and not question.configuration.get("expected_answers", [])
            )
            if not requires_manual_grading:
                raise serializers.ValidationError({"question": ["This answer is automatically graded and cannot be manually overridden."]})
            answer = StudentAnswer.objects.select_for_update().filter(attempt=attempt, question=question).first()
            if answer is None:
                raise serializers.ValidationError({"answer": ["The student did not submit an answer for this question."]})
            serializer = ManualGradeSerializer(data=request.data, context={"answer": answer})
            serializer.is_valid(raise_exception=True)
            answer.manual_score = serializer.validated_data["manual_score"]
            if "feedback" in serializer.validated_data:
                answer.feedback = serializer.validated_data["feedback"]
            answer.full_clean()
            answer.save(update_fields=("manual_score", "feedback", "updated_at"))
            result = _grade_attempt(attempt, finalized_at=timezone.now())
            answer.refresh_from_db()
            return Response({"answer": TeacherAttemptAnswerSerializer(answer).data, "result": TeacherResultSerializer(result).data})


class TeacherResultFeedbackView(TeacherResultsAccessMixin, APIView):
    def patch(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        result = get_object_or_404(ExamResult, attempt=attempt)
        serializer = TeacherResultFeedbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result.feedback = serializer.validated_data["feedback"]
        result.save(update_fields=("feedback", "updated_at"))
        return Response(TeacherResultSerializer(result).data)


class TeacherPublishResultsView(TeacherResultsAccessMixin, APIView):
    """Publish every fully graded pending/hidden result for one owned exam in one action."""

    def post(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        now = timezone.now()
        eligible = ExamResult.objects.filter(
            attempt__exam=exam,
            attempt__status__in=(ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED),
            status__in=(ExamResult.Status.PENDING, ExamResult.Status.HIDDEN),
            pending_manual_grading_count=0,
        )
        published_count = eligible.update(status=ExamResult.Status.PUBLISHED, published_at=now, updated_at=now)
        pending_count = ExamResult.objects.filter(
            attempt__exam=exam, pending_manual_grading_count__gt=0
        ).count()
        return Response({"published_count": published_count, "pending_manual_grading_count": pending_count})


class TeacherStudentsOverviewView(TeacherResultsAccessMixin, APIView):
    """Students are derived from actual participation; no invented roster/membership relation."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        attempts = list(self.attempts())
        per_student: dict[str, list[ExamAttempt]] = defaultdict(list)
        for attempt in attempts:
            per_student[str(attempt.student_id)].append(attempt)

        # A school-assigned teacher gets a real roster, including students who have not yet
        # started an exam. Legacy teachers without a school only see their actual participants.
        membership = SchoolMembership.objects.filter(user=request.user).select_related("school").first()
        if request.user.role == "admin":
            roster = User.objects.filter(role=User.Role.STUDENT).select_related("student_profile")
        elif membership:
            roster = User.objects.filter(
                role=User.Role.STUDENT, school_membership__school=membership.school
            ).select_related("student_profile")
        else:
            roster = [student_attempts[0].student for student_attempts in per_student.values()]

        rows = []
        for student in roster:
            student_attempts = per_student.get(str(student.id), [])
            latest = student_attempts[0] if student_attempts else None
            completed = [a for a in student_attempts if a.status in {ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED}]
            in_progress = [a for a in student_attempts if a.status == ExamAttempt.Status.IN_PROGRESS]
            needs_grading = sum(1 for a in completed if getattr(a, "result", None) and a.result.pending_manual_grading_count)
            profile = getattr(student, "student_profile", None)
            rows.append({
                "id": str(student.id), "full_name": student.get_full_name(), "email": student.email,
                "grade": getattr(profile, "grade", ""), "class_name": getattr(profile, "class_name", ""),
                "attempt_count": len(student_attempts), "completed_attempt_count": len(completed),
                "in_progress_attempt_count": len(in_progress), "needs_grading_count": needs_grading,
                "last_activity_at": latest.last_activity_at if latest else None,
                "last_exam_title": latest.exam.title if latest else "",
            })
        return Response(rows)
