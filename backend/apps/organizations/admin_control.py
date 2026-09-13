"""The platform administrator's own surface: statistics, a reading of the database, and control actions.

Three principles run through this module, each because the alternative was worse.

*Numbers are computed where they are read.* A dashboard that paged through every attempt to count them would
work in development and fall over in a school. Every figure here is one aggregate, taken over the same scope
the read itself uses, so a school administrator gets their school's totals and never a slice of the network.

*Supervision is not control.* A school administrator may read all of it. The actions that change somebody
else's data — closing a paper, finalizing an attempt, revoking sessions, repairing rows — belong to the
platform administrator alone, because they override a teacher's or a student's work rather than watching it.

*No second source of truth.* `scope.py` decides which rows exist for the caller and the permission classes
decide which methods they may call. A route that guessed either would drift from the rest of the API the
first week it shipped.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import django
from django.conf import settings
from django.db import connection
from django.db.models import Avg, Case, Count, F, FloatField, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attempts.models import AttemptEvent, ExamAttempt, StudentAnswer
from apps.attempts.services import _grade_attempt, close_exam_attempts
from apps.exams.content_identity import question_content_hash
from apps.exams.models import Exam, Question
from apps.exams.services import archive_exam, publish_exam, restore_exam
from apps.notifications.models import Notification
from apps.results.models import ExamResult
from apps.users.models import User
from apps.users.permissions import IsAdministrator, IsAdministratorOrSchoolAdmin

from .models import School
from .scope import governs_nothing, managed_school, scope_exams, scope_users
from rest_framework.exceptions import PermissionDenied

ACTIVITY_DAYS = 14
FINALIZED = [ExamAttempt.Status.SUBMITTED, ExamAttempt.Status.EXPIRED]


def _require_membership(user) -> None:
    """A school administrator with no membership governs nothing, so they are told so rather than shown the network."""
    if governs_nothing(user):
        raise PermissionDenied("حساب مدیر مدرسه به هیچ مدرسه‌ای وصل نشده است؛ مدیر کل سامانه باید اول آن را وصل کند.")


def _percent(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 1) if whole else 0.0


def _series(queryset, field: str, days: int = ACTIVITY_DAYS) -> list[dict[str, object]]:
    """One row per day for the last `days`, empty days included as zero.

    A gap in a chart should read as a quiet day, not as missing data, and filling it here means the client
    never has to know which dates happen to exist in the table.
    """
    # Both ends of the window are *local* dates: `TruncDate` buckets in the current timezone, and a
    # `timezone.now().date()` is UTC — so mixing them dropped a day's rows whenever the site's evening fell on
    # the next UTC day. Same clock on both sides, or the chart quietly loses the newest data at midnight.
    today = timezone.localdate()
    since = today - timedelta(days=days - 1)
    counts = (
        queryset.filter(**{f"{field}__date__gte": since, f"{field}__date__lte": today})
        .annotate(day=TruncDate(field))
        .values("day")
        .annotate(count=Count("pk"))
    )
    by_day = {row["day"]: row["count"] for row in counts if row["day"] is not None}
    return [
        {"date": (since + timedelta(days=offset)).isoformat(), "count": by_day.get(since + timedelta(days=offset), 0)}
        for offset in range(days)
    ]


def database_size() -> int | None:
    """Bytes the database actually occupies, or None when the engine will not say."""
    name = settings.DATABASES["default"].get("NAME")
    if connection.vendor == "sqlite":
        path = Path(str(name))
        return path.stat().st_size if path.exists() else None
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_database_size(current_database())")
            row = cursor.fetchone()
        return int(row[0]) if row else None
    return None


class AdminStatsView(APIView):
    """Site-wide statistics, scoped to whoever is asking."""

    permission_classes = (IsAdministratorOrSchoolAdmin,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        _require_membership(request.user)
        school = managed_school(request.user)
        users = scope_users(request.user, User.objects.all())
        exams = scope_exams(request.user, Exam.objects.all())
        # Attempts and answers have no school of their own; they belong to a network through the paper they
        # were taken for, so the same exam set decides what a school administrator may count.
        attempts = ExamAttempt.objects.filter(exam__in=exams)
        answers = StudentAnswer.objects.filter(attempt__in=attempts)
        results = ExamResult.objects.filter(attempt__in=attempts)

        exam_status = dict(exams.order_by("status").values_list("status").annotate(count=Count("pk")))
        attempt_status = dict(attempts.order_by("status").values_list("status").annotate(count=Count("pk")))
        published = results.filter(status=ExamResult.Status.PUBLISHED).count()
        awaiting = results.filter(pending_manual_grading_count__gt=0).count()
        scored = results.exclude(percentage=None)
        # `passed` is not a column: the verdict is `percentage >= the exam's own pass mark`, which the result
        # serializer computes per row. Annotated here with the same rule rather than re-derived from a guess,
        # so a pass rate on the console and a check mark on the result page cannot disagree.
        verdicts = scored.annotate(
            is_pass=Case(
                When(
                    Q(percentage__gte=F("attempt__exam__settings__passing_percentage"))
                    & Q(attempt__exam__settings__passing_percentage__gt=0),
                    then=Value(1.0),
                ),
                default=Value(0.0),
                output_field=FloatField(),
            )
        )
        averages = verdicts.aggregate(average=Avg("percentage"), passed=Coalesce(Sum("is_pass"), Value(0.0)))
        now = timezone.now()
        return Response({
            "scope": {
                "kind": "school" if school else "platform",
                "school": {"id": str(school.pk), "name": school.name} if school else None,
            },
            "generated_at": now,
            "totals": {
                "users": users.count(),
                "users_by_role": {role: users.filter(role=role).count() for role in User.Role.values},
                "active_users": users.filter(is_active=True).count(),
                "inactive_users": users.filter(is_active=False).count(),
                "schools": 1 if school else School.objects.count(),
                "exams": exams.count(),
                "exams_by_status": exam_status,
                "questions": Question.objects.filter(exam__in=exams).count(),
                "bank_questions": Question.objects.filter(exam__isnull=True).count(),
                "attempts": attempts.count(),
                "attempts_by_status": attempt_status,
                "answers": answers.count(),
                "results_published": published,
                "results_awaiting_grading": awaiting,
                "notifications": Notification.objects.filter(recipient__in=users).count(),
                "unread_notifications": Notification.objects.filter(recipient__in=users, is_read=False).count(),
            },
            "grading": {
                "written_ungraded": answers.filter(question__type=Question.Type.WRITTEN, manual_score=None).count(),
                "teacher_marked": answers.filter(manual_score__isnull=False).count(),
                "exams_awaiting": awaiting,
                "share_of_results": _percent(awaiting, results.count()),
            },
            "scores": {
                "results_scored": scored.count(),
                "average_percentage": round(float(averages["average"] or 0), 1),
                "pass_rate": _percent(round(float(averages["passed"] or 0)), scored.count()),
                "marks_awarded": float(results.aggregate(total=Sum("score"))["total"] or Decimal("0")),
            },
            "activity": {
                "days": ACTIVITY_DAYS,
                "submissions": _series(attempts.filter(submitted_at__isnull=False), "submitted_at"),
                "starts": _series(attempts.filter(started_at__isnull=False), "started_at"),
                "exams_created": _series(exams, "created_at"),
                "signups": _series(users, "created_at"),
                "signals": _series(AttemptEvent.objects.filter(attempt__in=attempts), "created_at"),
                "live_now": {
                    "attempts_in_progress": attempt_status.get(ExamAttempt.Status.IN_PROGRESS, 0),
                    "students_writing": attempts.filter(status=ExamAttempt.Status.IN_PROGRESS).values("student").distinct().count(),
                    "exams_live": exam_status.get(Exam.Status.ACTIVE, 0),
                    "exams_overdue": exams.filter(status=Exam.Status.ACTIVE, end_at__lt=now).count(),
                },
            },
            "top": {
                "teachers": [
                    {
                        "id": str(row["pk"]),
                        "name": (row["first_name"] or "").strip() or row["email"],
                        "exams": row["exams"],
                        "attempts": row["attempts"],
                    }
                    for row in users.filter(role=User.Role.TEACHER)
                    .annotate(
                        exams=Count("created_exams", distinct=True),
                        attempts=Count("created_exams__attempts", distinct=True),
                    )
                    .values("pk", "first_name", "email", "exams", "attempts")
                    .order_by("-exams", "-attempts")[:5]
                ],
                "schools": []
                if school
                else [
                    {"id": str(row.pk), "name": row.name, "users": row.user_count, "exams": row.exam_count}
                    for row in School.objects.annotate(
                        user_count=Count("memberships", distinct=True),
                        exam_count=Count("memberships__user__created_exams", distinct=True),
                    )
                    .order_by("-exam_count", "-user_count")[:5]
                ],
            },
            "health": {
                "database": {"engine": connection.vendor, "size_bytes": database_size()},
                "debug": bool(settings.DEBUG),
                "django": django.get_version(),
                "signals_by_kind": {
                    row["kind"]: row["count"]
                    for row in AttemptEvent.objects.filter(attempt__in=attempts, created_at__gte=now - timedelta(days=ACTIVITY_DAYS))
                    .values("kind")
                    .annotate(count=Count("pk"))
                    .order_by("-count")
                },
            },
        })


class AdminDatabaseView(APIView):
    """Row counts and the inconsistencies an administrator should be told about.

    The `issues` block is the reason this view exists. Counts are trivia; "۱۲ پاسخ‌برگ نهایی‌شده نتیجه ندارد"
    is something a person has to fix, and it is far better found here than by a student who cannot see a score.
    """

    permission_classes = (IsAdministratorOrSchoolAdmin,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        _require_membership(request.user)
        school = managed_school(request.user)
        exams = scope_exams(request.user, Exam.objects.all())
        users = scope_users(request.user, User.objects.all())
        attempts = ExamAttempt.objects.filter(exam__in=exams)
        finalized_without_result = attempts.filter(status__in=FINALIZED).filter(result__isnull=True)
        scoped = {
            "users": users,
            "schools": School.objects.filter(pk=school.pk) if school else School.objects.all(),
            "exams": exams,
            "questions": Question.objects.filter(Q(exam__in=exams) | Q(exam__isnull=True)),
            "attempts": attempts,
            "answers": StudentAnswer.objects.filter(attempt__in=attempts),
            "results": ExamResult.objects.filter(attempt__in=attempts),
            "events": AttemptEvent.objects.filter(attempt__in=attempts),
            "notifications": Notification.objects.filter(recipient__in=users),
        }
        labels = {
            "users": "کاربران",
            "schools": "مدارس",
            "exams": "آزمون‌ها",
            "questions": "سؤال‌ها",
            "attempts": "پاسخ‌برگ‌ها",
            "answers": "پاسخ‌های ثبت‌شده",
            "results": "نتیجه‌ها",
            "events": "رویدادهای نشست",
            "notifications": "اعلان‌ها",
        }
        return Response({
            "scope": {"kind": "school" if school else "platform", "school": school.name if school else None},
            "tables": [{"key": key, "label": labels[key], "rows": queryset.count()} for key, queryset in scoped.items()],
            "issues": {
                "finalized_without_result": finalized_without_result.count(),
                "exams_past_their_end": exams.filter(status=Exam.Status.ACTIVE, end_at__lt=timezone.now()).count(),
                "choice_questions_without_options": Question.objects.filter(
                    exam__in=exams, type=Question.Type.MULTIPLE_CHOICE, options__isnull=True
                )
                .distinct()
                .count(),
                "bank_drafts": Question.objects.filter(exam__isnull=True, status=Question.Status.DRAFT).count(),
                "stale_open_attempts": attempts.filter(status=ExamAttempt.Status.IN_PROGRESS, expires_at__lt=timezone.now()).count(),
            },
            "repairable": finalized_without_result.count(),
            "size_bytes": database_size(),
            "engine": connection.vendor,
        })


class AdminDatabaseRepairView(APIView):
    """The idempotent half of the fix list: rebuild what is missing, change nothing that exists.

    Each repair recomputes a derived value from the rows it derives from, which is what makes it safe to run
    twice and safe to run while students are writing. Nothing here touches a mark, a snapshot or a
    publication — those are decisions, and a button called "repair" must not be able to make one.
    """

    permission_classes = (IsAdministrator,)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        repaired = {"results": 0, "totals": 0, "content_hashes": 0}
        missing = (
            ExamAttempt.objects.filter(status__in=FINALIZED)
            .filter(result__isnull=True)
            .order_by("pk")[:500]
        )
        for attempt in missing:
            _grade_attempt(attempt, finalized_at=attempt.submitted_at or timezone.now())
            repaired["results"] += 1

        for exam in Exam.objects.exclude(status=Exam.Status.ARCHIVED).order_by("pk")[:500]:
            total = sum((question.marks for question in exam.questions.filter(is_archived=False)), Decimal("0.00"))
            if exam.total_marks != total:
                exam.total_marks = total
                exam.save(update_fields=("total_marks", "updated_at"))
                repaired["totals"] += 1

        for question in Question.objects.filter(content_hash="").order_by("pk")[:1000]:
            question.content_hash = question_content_hash(question)
            question.save(update_fields=("content_hash", "updated_at"))
            repaired["content_hashes"] += 1

        return Response({"repaired": repaired, "at": timezone.now()})


class AdminExamActionView(APIView):
    """Platform-wide rescue of a paper: close it, publish it, archive or restore it.

    These call the same services the teacher's own buttons call, so an archived exam is not permanently
    frozen because its author left, and a paper whose students are still writing can be ended when the
    teacher cannot. School administrators are refused: they supervise exams, they do not edit them.
    """

    permission_classes = (IsAdministrator,)

    def post(self, request, exam_id, action) -> Response:  # type: ignore[no-untyped-def]
        exam = get_object_or_404(Exam, pk=exam_id)
        if action == "force-close":
            closed = close_exam_attempts(exam, reason="admin_force_close")
            exam.refresh_from_db()
            return Response({"closed_attempts": closed, "status": exam.status})
        services = {"archive": archive_exam, "restore": restore_exam, "publish": publish_exam}
        service = services.get(action)
        if service is None:
            raise serializers.ValidationError({"action": ["This action is not supported."]})
        try:
            service(exam.pk)
        except Exception as exc:  # a domain refusal is a 400 the console can show, not a 500
            raise serializers.ValidationError({"exam": [str(exc)[:300] or "این اقدام برای این آزمون ممکن نیست."]}) from exc
        exam.refresh_from_db()
        return Response({"status": exam.status, "updated_at": exam.updated_at})


class AdminAttemptActionView(APIView):
    """One student's sheet: finalize it, or release the device lock the teacher set."""

    permission_classes = (IsAdministrator,)

    def post(self, request, attempt_id, action) -> Response:  # type: ignore[no-untyped-def]
        attempt = get_object_or_404(ExamAttempt.objects.select_related("exam"), pk=attempt_id)
        if action == "finalize":
            if attempt.status != ExamAttempt.Status.IN_PROGRESS:
                raise serializers.ValidationError({"attempt": ["This attempt is already finalized."]})
            # The service works per exam, and one exam's open sheets are exactly the set that has to close
            # when an administrator decides the sitting is over; already-submitted sheets are untouched.
            close_exam_attempts(attempt.exam, reason="admin_force_close")
            attempt.refresh_from_db()
            return Response({"status": attempt.status, "finalized_at": attempt.submitted_at})
        if action == "unlock-device":
            # Clearing the fingerprint is how a legitimate device change is allowed after the fact: the next
            # claim re-seeds it from whoever is asking, and the earlier refusal stays in the teacher's log.
            attempt.device_signature = ""
            attempt.client_session = ""
            attempt.save(update_fields=("device_signature", "client_session", "updated_at"))
            AttemptEvent.objects.create(attempt=attempt, kind=AttemptEvent.Kind.SESSION_SWITCH, detail={"reason": "admin_unlocked"})
            return Response({"unlocked": True})
        raise serializers.ValidationError({"action": ["This action is not supported."]})


class AdminLiveAttemptsView(APIView):
    """The sheets that are open right now, for the one question an administrator can actually answer: who is
    writing at this moment, on what paper, and how long they have left.

    Everything is derived from server time — the remaining seconds are the attempt's own deadline, never a
    client clock — and rows are read-only here apart from the two actions on the attempt route, because an
    administrator watching a sitting is supervising it, not marking it.
    """

    permission_classes = (IsAdministratorOrSchoolAdmin,)

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        from apps.attempts.services import attempt_timing

        _require_membership(request.user)
        status_filter = (request.query_params.get("status") or ExamAttempt.Status.IN_PROGRESS).strip()
        allowed = {choice for choice, _label in ExamAttempt.Status.choices}
        if status_filter not in allowed:
            raise serializers.ValidationError({"status": ["This attempt status is not known."]})
        attempts = scope_exams(request.user, Exam.objects.all())
        queryset = (
            ExamAttempt.objects.filter(exam__in=attempts, status=status_filter)
            .select_related("exam", "student", "result")
            .order_by("-last_activity_at")[:200]
        )
        if search := (request.query_params.get("search") or "").strip():
            queryset = queryset.filter(
                Q(student__first_name__icontains=search)
                | Q(student__last_name__icontains=search)
                | Q(student__email__icontains=search)
                | Q(exam__title__icontains=search)
            )
        rows = []
        for attempt in queryset:
            timing = attempt_timing(attempt)
            result = getattr(attempt, "result", None)
            rows.append({
                "id": str(attempt.id),
                "exam": {"id": str(attempt.exam_id), "title": attempt.exam.title},
                "student": {
                    "id": str(attempt.student_id),
                    "name": attempt.student.get_full_name() or attempt.student.email,
                    "email": attempt.student.email,
                },
                "attempt_number": attempt.attempt_number,
                "status": attempt.status,
                "started_at": attempt.started_at,
                "last_activity_at": attempt.last_activity_at,
                "remaining_seconds": timing["remaining_seconds"],
                "device_locked": bool(attempt.device_signature),
                "session_switches": attempt.session_switch_count,
                "tab_switches": attempt.events.filter(kind=AttemptEvent.Kind.TAB_HIDDEN).count(),
                "score": float(result.score) if result and result.score is not None else None,
            })
        return Response({"attempts": rows, "count": len(rows), "as_of": timezone.now()})


class AdminUserSessionsView(APIView):
    """Cut a person's signed-in sessions off, at the refresh-token level.

    Existing access tokens live until they expire — that is how they are built — and the response says so,
    because "sessions revoked" that quietly leaves an hour of access open is the kind of claim an administrator
    would act on. A school administrator may do it inside their own school: ending a session supervises a
    person's access, it does not change their data.
    """

    permission_classes = (IsAdministratorOrSchoolAdmin,)

    def post(self, request, user_id) -> Response:  # type: ignore[no-untyped-def]
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

        _require_membership(request.user)
        user = get_object_or_404(scope_users(request.user, User.objects.all()), pk=user_id)
        outstanding = OutstandingToken.objects.filter(user=user)
        already = BlacklistedToken.objects.filter(token__in=outstanding).values_list("token_id", flat=True)
        created = 0
        for token in outstanding.exclude(token__in=list(already)):
            BlacklistedToken.objects.create(token=token)
            created += 1
        return Response({"revoked": created, "email": user.email})
