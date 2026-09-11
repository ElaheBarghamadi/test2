from django.urls import path

from .views import QuestionArchiveView, QuestionBankListView, QuestionBankTagsView, TeacherQuestionDetailView

app_name = "questions"
urlpatterns = [
    # The reusable bank: every question this teacher owns, searchable and filterable.
    path("", QuestionBankListView.as_view(), name="question-bank"),
    path("tags/", QuestionBankTagsView.as_view(), name="question-bank-tags"),
    path("<uuid:question_id>/", TeacherQuestionDetailView.as_view(), name="question-detail"),
    path("<uuid:question_id>/archive/", QuestionArchiveView.as_view(), name="question-archive"),
]
