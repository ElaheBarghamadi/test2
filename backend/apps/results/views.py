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

from apps.attempts.grading import grade_answer, requires_manual_grading, selected_option_ids, AnswerMark
from apps.attempts.models import ExamAttempt, StudentAnswer
from apps.attempts.services import _grade_attempt, attempt_timing, integrity_summary
from apps.exams.models import Exam, Question
from apps.organizations.models import SchoolMembership
from apps.users.models import User
from apps.organizations.scope import scope_exams
from apps.users.permissions import IsTeacherOrAdministrator, IsTeacherOrSchoolStaff

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
    """Results supervision: the owner, the platform admin, or the administrator of the paper's school.

    The five views that expose or write a *student's answers* restate the stricter pair, because a school
    administrator's scope ends at scores: they see who is pending and publish results, and never open a sheet.
    """

    permission_classes = (IsTeacherOrSchoolStaff,)

    def exams(self):  # type: ignore[no-untyped-def]
        queryset = Exam.objects.select_related("settings", "teacher")
        if self.request.user.role == User.Role.TEACHER:
            queryset = queryset.filter(teacher=self.request.user)
        else:
            queryset = scope_exams(self.request.user, queryset)
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
    # answers: a school administrator does not reach this. The mixin admits them to
    # results supervision — scores, pending counts, publication — and this route is the answer sheet
    # itself.
    permission_classes = (IsTeacherOrAdministrator,)
    def get(self, request, attempt_id) -> Response:  # type: ignore[no-untyped-def]
        attempt = self.get_attempt(attempt_id)
        answers = (
            StudentAnswer.objects.filter(attempt=attempt)
            .select_related("question")
            # The sheet shows a mark per question, which means the answer key has to be at hand; without
            # this prefetch every row would re-query its options.
            .prefetch_related("selected_options", "question__options")
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
                # The rules the teacher had switched on for this exam, beside what the student did under them.
                # Both halves travel together on purpose: a count without its rule invites a verdict the
                # settings never authorised.
                "integrity": integrity_summary(attempt),
                "session_signals": TeacherAttemptEventSerializer(attempt.events.all()[:40], many=True).data,
            }
        )


class TeacherManualGradeView(TeacherResultsAccessMixin, APIView):
    # grades: a school administrator does not reach this. The mixin admits them to
    # results supervision — scores, pending counts, publication — and this route is the answer sheet
    # itself.
    permission_classes = (IsTeacherOrAdministrator,)
    def patch(self, request, attempt_id, question_id) -> Response:  # type: ignore[no-untyped-def]
        with transaction.atomic():
            attempt = self.get_attempt(attempt_id)
            if attempt.status not in {ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED}:
                raise serializers.ValidationError({"attempt": ["Only finalized attempts can be graded."]})
            question = get_object_or_404(Question.objects.filter(exam=attempt.exam), pk=question_id)
            # Any question may be marked by hand, keyed ones included: the key is a guess about the answer and
            # the teacher's number is the decision. A row is created for a question the student left blank so
            # a teacher can award marks there too, and `manual_score: null` hands the question back to the key.
            answer = StudentAnswer.objects.select_for_update().filter(attempt=attempt, question=question).first()
            if answer is None:
                answer = StudentAnswer.objects.create(attempt=attempt, question=question)
            serializer = ManualGradeSerializer(data=request.data, context={"answer": answer})
            serializer.is_valid(raise_exception=True)
            if "manual_score" in serializer.validated_data:
                answer.manual_score = serializer.validated_data["manual_score"]
            if "feedback" in serializer.validated_data:
                answer.feedback = serializer.validated_data["feedback"]
            answer.full_clean()
            answer.save()
            result = _grade_attempt(attempt, finalized_at=timezone.now())
            # The queue for this student may have just emptied: tell them the number they waited for exists.
            _notify_grading_completed(attempt, result)
            answer.refresh_from_db()
            return Response({"answer": TeacherAttemptAnswerSerializer(answer).data, "result": TeacherResultSerializer(result).data})


FINALIZED_STATUSES = (ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED)


def _notify_grading_completed(attempt: ExamAttempt, result: ExamResult) -> None:
    """Tell the student their number is final, once, when the last open answer of the sheet closes."""
    if result.pending_manual_grading_count:
        return
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


class TeacherExamGradingBoardView(TeacherResultsAccessMixin, APIView):
    # board: a school administrator does not reach this. The mixin admits them to
    # results supervision — scores, pending counts, publication — and this route is the answer sheet
    # itself.
    permission_classes = (IsTeacherOrAdministrator,)
    """One exam's marking board: every question with how much of the cohort still needs a pen.

    The counts are computed from the same verdict function that grading uses, so a question the teacher
    marks complete here cannot still be sitting in another student's queue.
    """

    def get(self, request, exam_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        return Response(_grading_board(exam, _finalized_attempts(self.attempts(), exam)))


def _finalized_attempts(queryset, exam):  # type: ignore[no-untyped-def]
    return (
        queryset.filter(exam=exam, status__in=FINALIZED_STATUSES)
        .select_related("student", "student__student_profile", "result")
        .order_by("student__first_name", "student__last_name", "attempt_number")
    )


def _grading_board(exam: Exam, attempts) -> dict:  # type: ignore[type-arg]
    from apps.exams.models import Question

    questions = list(Question.objects.filter(exam=exam).prefetch_related("options").order_by("order"))
    attempts = list(attempts)
    answers = (
        StudentAnswer.objects.filter(attempt__in=attempts, question__in=questions)
        .select_related("attempt", "question")
        .prefetch_related("selected_options", "question__options")
    )
    marks: dict[tuple[str, str], AnswerMark] = {}
    for answer in answers:
        marks[(str(answer.attempt_id), str(answer.question_id))] = grade_answer(answer.question, answer)

    rows = []
    total_pending = 0
    total_manual = 0
    for question in questions:
        requires_manual = requires_manual_grading(question)
        answered = 0
        correct = incorrect = graded = pending = 0
        awarded_total = Decimal("0.00")
        for attempt in attempts:
            mark = marks.get((str(attempt.id), str(question.id)))
            if mark is None:
                continue
            answered += 1
            awarded_total += mark.awarded
            if mark.verdict == "unanswered":
                answered -= 1  # a blank is not an answer; it stays out of every count below
                continue
            if requires_manual:
                if mark.verdict == "pending":
                    pending += 1
                else:
                    graded += 1
            elif mark.verdict == "correct":
                correct += 1
            else:
                incorrect += 1
        total_pending += pending
        total_manual += graded + pending
        rows.append(
            {
                "id": str(question.id),
                "order": question.order,
                "text": question.text,
                "type": question.type,
                "marks": str(question.marks),
                "requires_manual_grading": requires_manual,
                "attempt_count": len(attempts),
                "answered_count": answered,
                "blank_count": len(attempts) - answered,
                "correct_count": correct,
                "incorrect_count": incorrect,
                "graded_count": graded,
                "pending_count": pending,
                "average_score": float((awarded_total / answered).quantize(Decimal("0.01"))) if answered else None,
                # "Complete" for a keyed question means there is nothing to do; for a manual one it means
                # every answered sheet has a number on it.
                "is_complete": pending == 0,
            }
        )
    return {
        "exam": {"id": str(exam.id), "title": exam.title, "total_marks": str(exam.total_marks)},
        "attempt_count": len(attempts),
        "questions": rows,
        "progress": {
            "total": total_manual,
            "graded": total_manual - total_pending,
            "percent": round((total_manual - total_pending) * 100 / total_manual) if total_manual else 100,
        },
    }


class TeacherExamQuestionGradingView(TeacherResultsAccessMixin, APIView):
    # cohort grading: a school administrator does not reach this. The mixin admits them to
    # results supervision — scores, pending counts, publication — and this route is the answer sheet
    # itself.
    permission_classes = (IsTeacherOrAdministrator,)
    """One question across the whole cohort — the other way through the same marks.

    Sheet-by-sheet marking is right for finishing one student; this is right for one rubric applied to
    thirty people, which is how a written answer actually gets marked consistently. `POST` saves the whole
    screen at once: every row is validated before anything is written, then each touched attempt is
    re-graded in the same transaction, so a typo in row nine cannot leave rows one to eight half-applied.
    """

    def _question(self, exam: Exam, question_id):  # type: ignore[no-untyped-def]
        return get_object_or_404(Question.objects.filter(exam=exam).prefetch_related("options"), pk=question_id)

    def get(self, request, exam_id, question_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        question = self._question(exam, question_id)
        attempts = _finalized_attempts(self.attempts(), exam)
        board = _grading_board(exam, attempts)
        return Response(
            {
                "exam": board["exam"],
                "question": _question_detail(question),
                "progress": {
                    "index": next(
                        (index + 1 for index, row in enumerate(board["questions"]) if row["id"] == str(question.id)), 1
                    ),
                    "total": len(board["questions"]),
                    "questions": board["questions"],
                },
                "stats": next((row for row in board["questions"] if row["id"] == str(question.id)), {}),
                "rows": _question_rows(exam, question, attempts),
            }
        )

    def post(self, request, exam_id, question_id) -> Response:  # type: ignore[no-untyped-def]
        exam = self.get_exam(exam_id)
        question = self._question(exam, question_id)
        # Keyed questions are writable here too, one decision per row: `{mark}` to override, `{mark: null}`
        # to hand the row back to the key, and `{feedback}` to leave a note without touching the number.
        grades = request.data.get("grades") if isinstance(request.data, dict) else None
        if not isinstance(grades, list) or not grades:
            raise serializers.ValidationError({"grades": ["Send at least one row."]})
        if len(grades) > 500:
            raise serializers.ValidationError({"grades": ["Too many rows in one request."]})

        attempts = {str(attempt.id): attempt for attempt in _finalized_attempts(self.attempts(), exam)}
        answers = {
            str(answer.attempt_id): answer
            for answer in StudentAnswer.objects.filter(
                attempt__in=list(attempts.values()), question=question
            ).select_related("attempt", "question").prefetch_related("selected_options", "question__options")
        }
        entry = ManualGradeSerializer

        # Validate the whole screen first: the teacher sees every bad row at once instead of saving,
        # hitting an error, fixing one row, saving again.
        errors: list[dict[str, object]] = []
        prepared: list[tuple[StudentAnswer, Decimal, str | None]] = []
        for index, item in enumerate(grades):
            if not isinstance(item, dict):
                errors.append({"index": index, "error": "Each row must be an object."})
                continue
            attempt = attempts.get(str(item.get("attempt_id", "")))
            if attempt is None:
                errors.append({"index": index, "error": "This attempt is not part of the exam."})
                continue
            # A missing row is not a refusal: a question the student left blank can still be awarded marks.
            answer = answers.get(str(attempt.id))
            payload: dict[str, object] = {}
            if "mark" in item:
                payload["manual_score"] = item.get("mark")
            if item.get("feedback") is not None:
                payload["feedback"] = item.get("feedback")
            if not payload:
                errors.append({"index": index, "error": "Send a mark, a note, or `mark: null` to undo an override."})
                continue
            serializer = entry(data=payload, context={"answer": answer, "question": question})
            if not serializer.is_valid():
                errors.append({"index": index, "attempt_id": str(attempt.id), "error": serializer.errors})
                continue
            prepared.append((attempt, answer, serializer.validated_data))
        if errors:
            raise serializers.ValidationError({"rows": errors})

        results = []
        with transaction.atomic():
            touched: dict[str, ExamAttempt] = {}
            for attempt_owner, answer, data in prepared:
                if answer is None:
                    # A blank can be graded too, so the row is created here rather than refused.
                    answer = StudentAnswer.objects.create(attempt=attempt_owner, question=question)
                if "manual_score" in data:
                    answer.manual_score = data["manual_score"]
                if "feedback" in data:
                    answer.feedback = data["feedback"]
                answer.full_clean()
                answer.save()
                touched[str(answer.attempt_id)] = attempt_owner
            for attempt in touched.values():
                result = _grade_attempt(attempt, finalized_at=timezone.now())
                _notify_grading_completed(attempt, result)
                results.append({"attempt_id": str(attempt.id), "result": TeacherResultSerializer(result).data})

        board = _grading_board(exam, _finalized_attempts(self.attempts(), exam))
        return Response(
            {
                "saved": len(prepared),
                "results": results,
                "stats": next((row for row in board["questions"] if row["id"] == str(question.id)), {}),
                "questions": board["questions"],
                "progress": board["progress"],
                "rows": _question_rows(exam, question, _finalized_attempts(self.attempts(), exam)),
            }
        )


def _question_detail(question: Question) -> dict:  # type: ignore[type-arg]
    configuration = question.configuration or {}
    return {
        "id": str(question.id),
        "order": question.order,
        "text": question.text,
        "type": question.type,
        "marks": str(question.marks),
        "instructions": question.instructions,
        "requires_manual_grading": requires_manual_grading(question),
        # The key is shown while marking so the teacher grades against the same standard the machine would
        # have used. It stays inside teacher endpoints only: no student payload carries it.
        "correct_option_ids": [str(option.id) for option in question.options.all() if option.is_correct],
        "expected_answers": configuration.get("expected_answers", []),
        "explanation": question.explanation,
        "difficulty": question.difficulty,
        "grading_notes": configuration.get("grading_notes", ""),
    }


def _question_rows(exam: Exam, question: Question, attempts) -> list[dict]:  # type: ignore[type-arg]
    answers = {
        str(answer.attempt_id): answer
        for answer in StudentAnswer.objects.filter(attempt__in=attempts, question=question)
        .select_related("attempt", "question")
        .prefetch_related("selected_options", "question__options")
    }
    rows = []
    for attempt in attempts:
        answer = answers.get(str(attempt.id))
        selected = selected_option_ids(answer)
        mark = grade_answer(question, answer)
        profile = getattr(attempt.student, "student_profile", None)
        rows.append(
            {
                "attempt_id": str(attempt.id),
                "attempt_number": attempt.attempt_number,
                "student_id": str(attempt.student_id),
                "student_name": attempt.student.get_full_name(),
                "grade": getattr(profile, "grade", "") or "",
                "class_name": getattr(profile, "class_name", "") or "",
                "submitted_at": attempt.submitted_at,
                "answer_id": str(answer.id) if answer else None,
                "selected_option_ids": selected,
                "selected_option_texts": (
                    [option.text for option in answer.selected_options.all()] if answer is not None else []
                ),
                "text": (answer.answer_data or {}).get("text") if answer is not None else None,
                "is_flagged": bool(answer.is_flagged) if answer is not None else False,
                "awarded_score": f"{mark.awarded:.2f}",
                "verdict": mark.verdict,
                "manual_score": None if answer is None or answer.manual_score is None else str(answer.manual_score),
                "feedback": answer.feedback if answer is not None else "",
                "editable": True,
                # What the key alone would have awarded, and whether the teacher's number replaced it. The
                # desk shows both so an override reads as a decision with a reason, not as a lost grade.
                "auto_score": f"{grade_answer(question, answer, ignore_manual=True).awarded:.2f}",
                "is_overridden": answer is not None and answer.manual_score is not None and not mark.requires_manual,
            }
        )
    return rows


class TeacherResultFeedbackView(TeacherResultsAccessMixin, APIView):
    # feedback: a school administrator does not reach this. The mixin admits them to
    # results supervision — scores, pending counts, publication — and this route is the answer sheet
    # itself.
    permission_classes = (IsTeacherOrAdministrator,)
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
