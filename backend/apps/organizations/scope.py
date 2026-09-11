"""Who governs which school, and what that means as a queryset.

A school administrator («مدیر مدرسه») is an account scoped to one `School` through their own
`SchoolMembership`. Everything they reach is derived from that single row, which keeps the rule small enough
to audit:

* **their school** — the school of the administrator's own membership;
* **its people** — users whose membership points at that school;
* **its papers** — exams authored by a teacher of that school, because an exam belongs to a teacher and the
  teacher belongs to a school;
* **supervision, not authoring** — they move a paper through its lifecycle (schedule, publish, extend,
  complete, archive) and read participation and results, but they never see a student's answers and never
  write question content. A principal who edits a teacher's stems would make the answer key and the attempts
  that were already graded disagree, and a principal who reads answer sheets turns supervision into grading.

A platform administrator (`admin`) is unrestricted; a teacher is scoped to their own rows. `None` returned
from `managed_school` means "not a school administrator", and every helper below is a no-op for them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from apps.users.models import User

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .models import School


def is_platform_admin(user: Any) -> bool:
    return bool(getattr(user, "is_authenticated", False)) and user.role == User.Role.ADMIN


def is_school_admin(user: Any) -> bool:
    return bool(getattr(user, "is_authenticated", False)) and user.role == User.Role.SCHOOL_ADMIN


def school_of(user: Any) -> School | None:
    """The school a user belongs to, through their own membership."""
    membership = getattr(user, "school_membership", None)
    return getattr(membership, "school", None)


def managed_school(user: Any) -> School | None:
    """The school an administrator governs, or `None` when the caller governs everything or nothing."""
    return school_of(user) if is_school_admin(user) else None


def governs_nothing(user: Any) -> bool:
    """A school administrator whose account has no membership yet.

    Their authority *is* the membership, so without one there is no school to scope to — and the answer must
    be "nothing", not the unscoped fallback that a platform administrator gets. A role granted in the admin
    console before the school was chosen would otherwise read every exam and every account on the network.
    """
    return is_school_admin(user) and school_of(user) is None


def exam_school(exam: Any) -> School | None:
    """The school a paper belongs to: its teacher's school, not its own field."""
    return school_of(getattr(exam, "teacher", None))


def scope_users(user: Any, queryset: Any) -> Any:
    """Restrict a user queryset to the people of a school administrator's school."""
    if governs_nothing(user):
        return queryset.none()
    school = managed_school(user)
    return queryset if school is None else queryset.filter(school_membership__school=school)


def scope_exams(user: Any, queryset: Any) -> Any:
    """Restrict an exam queryset to the papers of a school administrator's school."""
    if governs_nothing(user):
        return queryset.none()
    school = managed_school(user)
    return queryset if school is None else queryset.filter(teacher__school_membership__school=school)


def can_supervise_exam(user: Any, exam: Any) -> bool:
    """May this account read the paper and move it through its lifecycle?"""
    if is_platform_admin(user):
        return True
    if exam.teacher_id == getattr(user, "id", None):
        # A teacher supervising their own paper is the ordinary case; the role does not have to be teacher.
        return True
    if governs_nothing(user):
        return False
    school = managed_school(user)
    return school is not None and exam_school(exam) is not None and exam_school(exam).pk == school.pk


def can_author_exam(user: Any, exam: Any) -> bool:
    """May this account write the paper's content — its fields, questions, options and grades?"""
    return is_platform_admin(user) or exam.teacher_id == getattr(user, "id", None)


def answers_are_private(user: Any, exam: Any) -> bool:
    """Whether a student's answer sheet must stay hidden from this account.

    The school administrator's scope ends at scores: they may publish results and see who is pending, and
    may not open a sheet. Everything else — the owner and the platform admin — may.
    """
    return not (can_author_exam(user, exam) or is_platform_admin(user))
