from django.urls import path

from .views import (
    StudentAttemptAnswerView,
    StudentAttemptBatchAnswerView,
    StudentAttemptDetailView,
    StudentAttemptFlagView,
    StudentAttemptSubmitView,
    StudentAvailableExamView,
    StudentExamStartView,
    StudentResultView,
)

app_name = "student"
urlpatterns = [
    path("exams/", StudentAvailableExamView.as_view(), name="available-exams"),
    path("exams/<uuid:exam_id>/start/", StudentExamStartView.as_view(), name="exam-start"),
    path("attempts/<uuid:attempt_id>/", StudentAttemptDetailView.as_view(), name="attempt-detail"),
    path("attempts/<uuid:attempt_id>/answers/", StudentAttemptBatchAnswerView.as_view(), name="attempt-answer-batch"),
    path("attempts/<uuid:attempt_id>/answers/<uuid:question_id>/", StudentAttemptAnswerView.as_view(), name="attempt-answer"),
    path("attempts/<uuid:attempt_id>/flagged-questions/<uuid:question_id>/", StudentAttemptFlagView.as_view(), name="attempt-question-flag"),
    path("attempts/<uuid:attempt_id>/submit/", StudentAttemptSubmitView.as_view(), name="attempt-submit"),
    path("results/<uuid:attempt_id>/", StudentResultView.as_view(), name="attempt-result"),
]
