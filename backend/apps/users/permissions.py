from rest_framework.permissions import BasePermission

from .models import User


class HasRole(BasePermission):
    allowed_roles: tuple[str, ...] = ()

    def has_permission(self, request, view) -> bool:  # type: ignore[no-untyped-def]
        return bool(request.user and request.user.is_authenticated and request.user.role in self.allowed_roles)


class IsStudent(HasRole):
    allowed_roles = (User.Role.STUDENT,)


class IsTeacher(HasRole):
    allowed_roles = (User.Role.TEACHER,)


class IsOwnStudentAttempt(IsStudent):
    """Object permission for student-facing attempt and result resources."""

    def has_object_permission(self, request, view, obj) -> bool:  # type: ignore[no-untyped-def]
        return bool(super().has_permission(request, view) and obj.student_id == request.user.id)


class IsAdministrator(HasRole):
    allowed_roles = (User.Role.ADMIN,)


class IsAdministratorOrSchoolAdmin(HasRole):
    """The admin console, with its data narrowed to one school for the school administrator."""

    allowed_roles = (User.Role.ADMIN, User.Role.SCHOOL_ADMIN)


class IsTeacherOrSchoolStaff(HasRole):
    """Anyone who may look at exam supervision for a paper they own, administer or supervise."""

    allowed_roles = (User.Role.TEACHER, User.Role.ADMIN, User.Role.SCHOOL_ADMIN)


class IsTeacherOrAdministrator(HasRole):
    allowed_roles = (User.Role.TEACHER, User.Role.ADMIN)


class IsExamOwnerOrAdministrator(IsTeacherOrAdministrator):
    """Object permission for future exam detail/update views."""

    def has_object_permission(self, request, view, obj) -> bool:  # type: ignore[no-untyped-def]
        return bool(request.user.role == User.Role.ADMIN or obj.teacher_id == request.user.id)


class CanSuperviseExam(IsTeacherOrSchoolStaff):
    """Read and lifecycle movement of a paper: the owner, the platform admin, or its school's administrator.

    The school administrator is admitted here and refused everywhere that writes content, so the two
    permissions are not two spellings of one rule. Object checks are a second net: every route resolves the
    paper through a queryset that `apps/organizations/scope.py` already narrowed, so a foreign id 404s
    before this method is reached.
    """

    def has_permission(self, request, view) -> bool:  # type: ignore[no-untyped-def]
        if not super().has_permission(request, view):
            return False
        from apps.organizations.scope import is_school_admin

        # A school administrator never authors: creation is refused at the door, not by guessing intent.
        return not (is_school_admin(request.user) and getattr(view, "authoring_only", False))

    def has_object_permission(self, request, view, obj) -> bool:  # type: ignore[no-untyped-def]
        from apps.organizations.scope import can_supervise_exam

        return can_supervise_exam(request.user, obj)


class CanAuthorExam(IsTeacherOrAdministrator):
    """Content writes: fields, questions, options, grading. A school administrator is not in this set."""

    def has_object_permission(self, request, view, obj) -> bool:  # type: ignore[no-untyped-def]
        from apps.organizations.scope import can_author_exam

        return can_author_exam(request.user, obj)
