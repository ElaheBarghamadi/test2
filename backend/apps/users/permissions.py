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


class IsTeacherOrAdministrator(HasRole):
    allowed_roles = (User.Role.TEACHER, User.Role.ADMIN)


class IsExamOwnerOrAdministrator(IsTeacherOrAdministrator):
    """Object permission for future exam detail/update views."""

    def has_object_permission(self, request, view, obj) -> bool:  # type: ignore[no-untyped-def]
        return bool(request.user.role == User.Role.ADMIN or obj.teacher_id == request.user.id)
