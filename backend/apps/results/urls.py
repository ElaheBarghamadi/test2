from django.urls import path

from .views import (
    TeacherAttemptDetailView,
    TeacherExamResultsView,
    TeacherManualGradeView,
    TeacherPublishResultsView,
    TeacherResultFeedbackView,
    TeacherResultsOverviewView,
    TeacherStudentsOverviewView,
)

app_name = "results"
urlpatterns = [
    path("teacher/overview/", TeacherResultsOverviewView.as_view(), name="teacher-overview"),
    path("teacher/students/", TeacherStudentsOverviewView.as_view(), name="teacher-students"),
    path("teacher/exams/<uuid:exam_id>/", TeacherExamResultsView.as_view(), name="teacher-exam-results"),
    path("teacher/exams/<uuid:exam_id>/publish/", TeacherPublishResultsView.as_view(), name="teacher-publish-results"),
    path("teacher/attempts/<uuid:attempt_id>/", TeacherAttemptDetailView.as_view(), name="teacher-attempt-detail"),
    path("teacher/attempts/<uuid:attempt_id>/answers/<uuid:question_id>/grade/", TeacherManualGradeView.as_view(), name="teacher-manual-grade"),
    path("teacher/attempts/<uuid:attempt_id>/feedback/", TeacherResultFeedbackView.as_view(), name="teacher-result-feedback"),
]
