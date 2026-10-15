from django.urls import path

from .views import PasswordChangeView, UserProfileView
from .group_views import StudentDirectoryView, StudentGroupDetailView, StudentGroupListCreateView

app_name = "users"
urlpatterns = [
    path("me/", UserProfileView.as_view(), name="me"),
    path("me/password/", PasswordChangeView.as_view(), name="password-change"),
    path("students/", StudentDirectoryView.as_view(), name="student-directory"),
    path("groups/", StudentGroupListCreateView.as_view(), name="student-group-list-create"),
    path("groups/<uuid:group_id>/", StudentGroupDetailView.as_view(), name="student-group-detail"),
]
