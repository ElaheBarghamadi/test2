"""Notification fan-out. Every helper is called from inside the transition it describes.

Keeping the write next to the state change (rather than a post-save signal) is what makes it
transactional: a publish that rolls back leaves no ghost notification behind, and a re-run of the same
transition does not double-notify, because each event carries a dedupe key.
"""

from __future__ import annotations

from typing import Iterable

from django.db import models as dj_models

from apps.exams.models import Exam
from apps.users.models import User

from .models import Notification

MAX_TITLE = 200
MAX_BODY = 500


def exam_audience(exam: Exam):  # type: ignore[no-untyped-def]
    """Active students this exam is addressed to — the same rule the student dashboard applies.

    School isolation is authoritative when the teacher belongs to a school; the grade/class pair narrows
    it further, and an empty pair means the whole school. Expressed as one queryset so publishing to a
    year group is a single insert rather than a loop over 180 accounts.
    """
    from apps.organizations.models import SchoolMembership

    students = User.objects.filter(role=User.Role.STUDENT, is_active=True)
    teacher_school_id = SchoolMembership.objects.filter(user=exam.teacher).values_list("school_id", flat=True).first()
    if teacher_school_id:
        students = students.filter(school_membership__school_id=teacher_school_id)
    if exam.grade:
        students = students.filter(student_profile__grade=exam.grade)
    if exam.class_name:
        students = students.filter(student_profile__class_name=exam.class_name)
    return students.exclude(pk=exam.teacher_id).distinct()


def notify(
    recipients: Iterable,
    *,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    exam: Exam | None = None,
    attempt=None,  # type: ignore[no-untyped-def]
    dedupe: str = "",
) -> int:
    """Insert notifications for one event, skipping anyone who already has it. Returns the new count."""
    key = dedupe or (
        f"{kind}:{attempt.pk}" if attempt is not None else (f"{kind}:{exam.pk}" if exam is not None else "")
    )
    recipient_ids = list(dict.fromkeys(getattr(recipient, "pk", recipient) for recipient in recipients))
    if not recipient_ids:
        return 0
    if key:
        # `bulk_create(ignore_conflicts=True)` cannot report which rows it skipped, so the people who
        # already have this event are filtered out first — one extra query, an honest count.
        already = {str(pk) for pk in Notification.objects.filter(dedupe_key=key, recipient_id__in=recipient_ids).values_list("recipient_id", flat=True)}
        recipient_ids = [recipient_id for recipient_id in recipient_ids if str(recipient_id) not in already]
    if not recipient_ids:
        return 0
    Notification.objects.bulk_create(
        [
            Notification(
                recipient_id=recipient_id,
                kind=kind,
                title=title[:MAX_TITLE],
                body=body[:MAX_BODY],
                link=link[:300],
                exam_id=exam.pk if exam is not None else None,
                attempt_id=attempt.pk if attempt is not None else None,
                dedupe_key=key[:140],
            )
            for recipient_id in recipient_ids
        ],
        # Still there for the race between the filter and the insert: a concurrent duplicate is skipped
        # rather than raising, on both PostgreSQL and SQLite.
        ignore_conflicts=bool(key),
    )
    return len(recipient_ids)


def notify_exam_audience(exam: Exam, *, kind: str, title: str, body: str = "", link: str = "/student/dashboard") -> int:
    return notify(exam_audience(exam), kind=kind, title=title, body=body or exam.title, link=link, exam=exam)


def notify_teacher(attempt, *, kind: str, title: str, body: str = "") -> int:  # type: ignore[no-untyped-def]
    return notify(
        [attempt.exam.teacher],
        kind=kind,
        title=title,
        body=body,
        link=f"/teacher/results?exam={attempt.exam_id}",
        exam=attempt.exam,
        attempt=attempt,
    )


def unread_count(user) -> int:  # type: ignore[no-untyped-def]
    return Notification.objects.filter(recipient=user, is_read=False).count()
