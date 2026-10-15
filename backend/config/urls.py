from django.conf import settings
from django.contrib import admin
from django.shortcuts import redirect
from django.urls import include, path

from apps.core.views import health_check


def legacy_teacher_exam_create(request):  # type: ignore[no-untyped-def]
    """Send the old singular teacher URL to the current Next.js page instead of a Django 404."""
    return redirect(f"{settings.FRONTEND_URL.rstrip('/')}/teacher/exams/create")


urlpatterns = [
    path("teacher/exam/create/", legacy_teacher_exam_create, name="legacy-teacher-exam-create-slash"),
    path("teacher/exam/create", legacy_teacher_exam_create, name="legacy-teacher-exam-create"),
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health"),
    path("api/v1/auth/", include("apps.users.urls")),
    path("api/v1/users/", include("apps.users.urls_users")),
    path("api/v1/admin/", include("apps.organizations.urls")),
    path("api/v1/exams/", include("apps.exams.urls")),
    path("api/v1/questions/", include("apps.exams.question_urls")),
    path("api/v1/student/", include("apps.attempts.student_urls")),
    path("api/v1/attempts/", include("apps.attempts.urls")),
    path("api/v1/results/", include("apps.results.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
]
