from django.contrib import admin
from django.urls import include, path

from apps.core.views import health_check

urlpatterns = [
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
