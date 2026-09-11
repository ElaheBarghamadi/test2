from django.urls import path

from .views import (
    StudentAttemptAnswerView,
    StudentAttemptBatchAnswerView,
    StudentAttemptClaimView,
    StudentAttemptDetailView,
    StudentAttemptFlagView,
    StudentAttemptHeartbeatView,
    StudentAttemptSignalView,
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
    path("attempts/<uuid:attempt_id>/heartbeat/", StudentAttemptHeartbeatView.as_view(), name="attempt-heartbeat"),
    path("attempts/<uuid:attempt_id>/claim-session/", StudentAttemptClaimView.as_view(), name="attempt-claim-session"),
    path("attempts/<uuid:attempt_id>/signals/", StudentAttemptSignalView.as_view(), name="attempt-signal"),
    path("results/<uuid:attempt_id>/", StudentResultView.as_view(), name="attempt-result"),
]
