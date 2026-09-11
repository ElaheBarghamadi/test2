from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Avg, Count, F, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attempts.models import ExamAttempt, StudentAnswer
from apps.attempts.services import _grade_attempt, attempt_timing
from apps.exams.models import Exam, Question
from apps.organizations.models import SchoolMembership
from apps.users.models import User
from apps.users.permissions import IsTeacherOrAdministrator

from .models import ExamResult
from .serializers import (
    ManualGradeSerializer,
    TeacherAttemptEventSerializer,
    TeacherAttemptAnswerSerializer,
    TeacherAttemptRowSerializer,
    TeacherResultFeedbackSerializer,
    TeacherResultSerializer,
)


class TeacherResultsAccessMixin:
    permission_classes = (IsTeacherOrAdministrator,)

    def exams(self):  # type: ignore[no-untyped-def]
        queryset = Exam.objects.select_related("settings", "teacher")
        if self.request.user.role != User.Role.ADMIN:
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


def pass_statistics(results):  # type: ignore[no-untyped-def]
    """Count how many results can carry a verdict, and how many of them pass.

    A verdict only exists where the teacher set a pass mark, so the denominator is "results that can have
    a verdict" rather than "all attempts" — that distinction is what keeps the dashboard honest.
    """
    from django.db.models import Case, IntegerField, Sum, Value, When

    scored = results.exclude(percentage__isnull=True).filter(
        attempt__exam__settings__passing_percentage__gt=0
    )
    totals = scored.aggregate(
        verdicts=Count("id"),
        passed=Sum(
            Case(
                When(percentage__gte=F("attempt__exam__settings__passing_percentage"), then=Value(1)),
                default=Value(0),
                output_field=IntegerField(),
            )
        ),
    )
    verdicts = totals["verdicts"] or 0
    passed = totals["passed"] or 0
    return {"verdict_count": verdicts, "passed_count": passed, "pass_rate": round(passed * 100 / verdicts) if verdicts else None}


class TeacherResultsOverviewView(TeacherResultsAccessMixin, APIView):
    """Aggregate-only cards/activity for the teacher dashboard. No student answer content.

    Every number here is a database aggregate. The dashboard used to draw its participation bar from
    `20 + participant_count * 10`, which looked like a statistic and was not one.
    """

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        exams = self.exams()
        attempts = self.attempts()
        finalized = attempts.filter(status__in=(ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED))
        results = ExamResult.objects.filter(attempt__in=finalized)
        status_counts = dict(exams.values_list("status").annotate(count=Count("id")))
        attempt_total = attempts.count()
        finalized_total = finalized.count()
        averages = results.aggregate(
            average_percentage=Avg("percentage"),
            average_score=Avg("score"),
            graded=Count("id", filter=Q(percentage__isnull=False)),
            pending_results=Count("id", filter=Q(pending_manual_grading_count__gt=0)),
            pending_answers=Sum("pending_manual_grading_count"),
            manual_answers=Sum("manual_grading_count"),
        )
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
        completed_exams = (
            exams.filter(status=Exam.Status.COMPLETED)
            .annotate(
                attempt_count=Count("attempts", distinct=True),
                participant_count=Count("attempts__student", distinct=True),
            )
            .order_by("-updated_at")[:5]
        )
        return Response(
            {
                "exam_counts": {status: status_counts.get(status, 0) for status in Exam.Status.values},
                "participant_count": attempts.values("student_id").distinct().count(),
                "attempt_count": attempt_total,
                "finalized_attempt_count": finalized_total,
                # Share of started attempts that reached a final state.
                "completion_rate": round(finalized_total * 100 / attempt_total) if attempt_total else 0,
                "average_percentage": float(averages["average_percentage"]) if averages["average_percentage"] is not None else None,
                "average_score": float(averages["average_score"]) if averages["average_score"] is not None else None,
                "graded_result_count": averages["graded"],
                "pending_manual_grading_count": averages["pending_results"] or 0,
                "pending_manual_answer_count": averages["pending_answers"] or 0,
                "manual_answer_count": averages["manual_answers"] or 0,
                **pass_statistics(results),
                "recent_activity": recent,
                "recently_completed_exams": [
                    {
                        "id": str(exam.id),
                        "title": exam.title,
                        "subject": exam.subject,
                        "ended_at": exam.updated_at,
                        "attempt_count": exam.attempt_count,
                        "participant_count": exam.participant_count,
                    }
                    for exam in completed_exams
                ],
            }
        )


class TeacherGradingQueueView(TeacherResultsAccessMixin, APIView):
    """Finalized attempts with answers still waiting for the teacher's pen, with progress.

    The counts come from the grading snapshot (`manual_grading_count` / `pending_manual_grading_count`),
    so the marking screen can show "17 / 24 graded" and jump straight to the next ungraded answer
    without opening each attempt first.
    """

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        results = ExamResult.objects.filter(
            attempt__in=self.attempts(),
            attempt__status__in=(ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED),
            pending_manual_grading_count__gt=0,
        ).select_related("attempt", "attempt__exam", "attempt__student")
        if exam_id := request.query_params.get("exam_id"):
            results = results.filter(attempt__exam_id=exam_id)
        if student_id := request.query_params.get("student_id"):
            results = results.filter(attempt__student_id=student_id)

        rows = []
        for result in results[:200]:
            attempt = result.attempt
            total = result.manual_grading_count or result.pending_manual_grading_count
            open_count = result.pending_manual_grading_count
            rows.append(
                {
                    "result_id": str(result.id),
                    "attempt_id": str(attempt.id),
                    "attempt_number": attempt.attempt_number,
                    "student_id": str(attempt.student_id),
                    "student_name": attempt.student.get_full_name(),
                    "exam_id": str(attempt.exam_id),
                    "exam_title": attempt.exam.title,
                    "submitted_at": attempt.submitted_at,
                    "graded_count": max(total - open_count, 0),
                    "manual_count": total,
                    "open_count": open_count,
                    "progress": round(max(total - open_count, 0) * 100 / total) if total else 0,
                    "result_status": result.status,
                }
            )
        # Least-finished first: the fastest way to clear a queue is to finish what is already open.
        rows.sort(key=lambda row: (row["progress"], row["exam_title"]))
        return Response({"total": len(rows), "queue": rows})



class TeacherExamResultsView(TeacherResultsAccessMixin, APIView):
    def get(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        attempts = self.attempts().filter(exam=exam)
        # The results table filters client-side today; the filter is offered server-side so a large
        # cohort does not have to be downloaded to find the rows that need grading.
        if status_filter := request.query_params.get("submission_status"):
            allowed = {
                "in_progress": (ExamAttempt.Status.IN_PROGRESS,),
                "submitted": (ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED),
            }
            if status_filter in allowed:
                attempts = attempts.filter(status__in=allowed[status_filter])
            elif status_filter == "needs_grading":
                attempts = attempts.filter(result__pending_manual_grading_count__gt=0)
            else:
                raise serializers.ValidationError({"submission_status": "Unsupported submission filter."})
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
                "attempt_number": attempt.attempt_number,
                "started_at": attempt.started_at,
                "submitted_at": attempt.submitted_at,
                "server_time": timezone.now(),
                # Expiry stays recomputed for in-progress rows so a teacher watching a live exam sees the
                # same deadline the student does; finalized rows report the recorded submission time.
                "remaining_seconds": (
                    attempt_timing(attempt)["remaining_seconds"] if attempt.status == ExamAttempt.Status.IN_PROGRESS else None
                ),
                "answers": TeacherAttemptAnswerSerializer(answers, many=True).data,
                "result": TeacherResultSerializer(result).data if result else None,
                # Observation, not verdict: the marking screen shows these so a teacher can see what the
                # platform noticed, and nothing here changes a student's score.
                "session_switch_count": attempt.session_switch_count,
                "session_signals": TeacherAttemptEventSerializer(attempt.events.all()[:40], many=True).data,
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
            before = getattr(attempt, "result", None)
            was_open = before.pending_manual_grading_count if before else 0
            result = _grade_attempt(attempt, finalized_at=timezone.now())
            if was_open and result.pending_manual_grading_count == 0:
                # The queue for this student just emptied: tell them the number they were waiting for exists.
                from apps.notifications.models import Notification
                from apps.notifications.services import notify

                notify(
                    [attempt.student],
                    kind=Notification.Kind.GRADING_COMPLETED,
                    title="تصحیح دستی کامل شد",
                    body=f"نمرهٔ «{attempt.exam.title}» نهایی شد.",
                    link=f"/student/results/{attempt.pk}",
                    exam=attempt.exam,
                    attempt=attempt,
                )
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
        published = list(eligible.select_related("attempt"))
        published_count = eligible.update(status=ExamResult.Status.PUBLISHED, published_at=now, updated_at=now)
        pending_count = ExamResult.objects.filter(
            attempt__exam=exam, pending_manual_grading_count__gt=0
        ).count()
        from apps.notifications.models import Notification
        from apps.notifications.services import notify

        notify(
            [result.attempt.student for result in published],
            kind=Notification.Kind.RESULT_PUBLISHED,
            title="نتیجهٔ آزمون منتشر شد",
            body=f"نتیجهٔ «{exam.title}» در دسترس شماست.",
            link="/student/dashboard",
            exam=exam,
        )
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
        if request.user.role == User.Role.ADMIN:
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
