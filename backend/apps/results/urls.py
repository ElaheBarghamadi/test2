from django.urls import path

from .views import (
    TeacherExamAutoMarksView,
    TeacherExamExportView,
    TeacherAttemptDetailView,
    TeacherGradingQueueView,
    TeacherExamGradingBoardView,
    TeacherExamQuestionGradingView,
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
    path("teacher/grading-queue/", TeacherGradingQueueView.as_view(), name="teacher-grading-queue"),
    path("teacher/students/", TeacherStudentsOverviewView.as_view(), name="teacher-students"),
    path("teacher/exams/<uuid:exam_id>/", TeacherExamResultsView.as_view(), name="teacher-exam-results"),
    path("teacher/exams/<uuid:exam_id>/publish/", TeacherPublishResultsView.as_view(), name="teacher-publish-results"),
    path("teacher/exams/<uuid:exam_id>/grading/", TeacherExamGradingBoardView.as_view(), name="teacher-grading-board"),
    # The desk's bulk actions: a spreadsheet of the paper, and "fill in what the exam already knows".
    path("teacher/exams/<uuid:exam_id>/export/", TeacherExamExportView.as_view(), name="teacher-exam-export"),
    path("teacher/exams/<uuid:exam_id>/auto-marks/", TeacherExamAutoMarksView.as_view(), name="teacher-exam-auto-marks"),
    path(
        "teacher/exams/<uuid:exam_id>/grading/<uuid:question_id>/",
        TeacherExamQuestionGradingView.as_view(),
        name="teacher-grading-question",
    ),
    path("teacher/attempts/<uuid:attempt_id>/", TeacherAttemptDetailView.as_view(), name="teacher-attempt-detail"),
    path("teacher/attempts/<uuid:attempt_id>/answers/<uuid:question_id>/grade/", TeacherManualGradeView.as_view(), name="teacher-manual-grade"),
    path("teacher/attempts/<uuid:attempt_id>/feedback/", TeacherResultFeedbackView.as_view(), name="teacher-result-feedback"),
]
