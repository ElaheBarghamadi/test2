from django.urls import path

from .views import AdminExamListView, AdminOverviewView, AdminSchoolDetailView, AdminSchoolListCreateView, AdminUserDetailView, AdminUserListCreateView

app_name = "organizations"
urlpatterns = [
    path("overview/", AdminOverviewView.as_view(), name="admin-overview"),
    path("schools/", AdminSchoolListCreateView.as_view(), name="admin-school-list-create"),
    path("schools/<uuid:school_id>/", AdminSchoolDetailView.as_view(), name="admin-school-detail"),
    path("users/", AdminUserListCreateView.as_view(), name="admin-user-list-create"),
    path("users/<uuid:user_id>/", AdminUserDetailView.as_view(), name="admin-user-detail"),
    path("exams/", AdminExamListView.as_view(), name="admin-exams"),
]
