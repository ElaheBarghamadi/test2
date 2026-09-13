from django.urls import path

from . import admin_control as admin_views
from .views import AdminExamListView, AdminOverviewView, AdminSchoolDetailView, AdminSchoolListCreateView, AdminUserDetailView, AdminUserListCreateView

app_name = "organizations"
urlpatterns = [
    path("overview/", AdminOverviewView.as_view(), name="admin-overview"),
    path("schools/", AdminSchoolListCreateView.as_view(), name="admin-school-list-create"),
    path("schools/<uuid:school_id>/", AdminSchoolDetailView.as_view(), name="admin-school-detail"),
    path("users/", AdminUserListCreateView.as_view(), name="admin-user-list-create"),
    path("users/<uuid:user_id>/", AdminUserDetailView.as_view(), name="admin-user-detail"),
    path("exams/", AdminExamListView.as_view(), name="admin-exams"),
    # The console's own surface: figures, a reading of the database, and the actions that only the platform
    # administrator may take on somebody else's data.
    path("stats/", admin_views.AdminStatsView.as_view(), name="admin-stats"),
    path("database/", admin_views.AdminDatabaseView.as_view(), name="admin-database"),
    path("database/repair/", admin_views.AdminDatabaseRepairView.as_view(), name="admin-database-repair"),
    path("exams/<uuid:exam_id>/actions/<str:action>/", admin_views.AdminExamActionView.as_view(), name="admin-exam-action"),
    path("attempts/", admin_views.AdminLiveAttemptsView.as_view(), name="admin-live-attempts"),
    path("attempts/<uuid:attempt_id>/actions/<str:action>/", admin_views.AdminAttemptActionView.as_view(), name="admin-attempt-action"),
    path("users/<uuid:user_id>/revoke-sessions/", admin_views.AdminUserSessionsView.as_view(), name="admin-user-revoke-sessions"),
]
