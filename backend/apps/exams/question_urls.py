from django.urls import path

from .views import (
    QuestionArchiveView,
    QuestionBankCategoriesView,
    QuestionBankListView,
    QuestionBankTagsView,
    QuestionFolderDetailView,
    QuestionFolderListView,
    TeacherQuestionDetailView,
)

app_name = "questions"
urlpatterns = [
    # The reusable bank: every question this teacher owns, searchable and filterable. POST authors a question
    # straight onto the shelf, with no exam behind it.
    path("", QuestionBankListView.as_view(), name="question-bank"),
    path("tags/", QuestionBankTagsView.as_view(), name="question-bank-tags"),
    path("categories/", QuestionBankCategoriesView.as_view(), name="question-bank-categories"),
    # Folders are the bank's own furniture: a flat list the client assembles into a tree via `parent`.
    path("folders/", QuestionFolderListView.as_view(), name="question-folder-list"),
    path("folders/<uuid:folder_id>/", QuestionFolderDetailView.as_view(), name="question-folder-detail"),
    path("<uuid:question_id>/", TeacherQuestionDetailView.as_view(), name="question-detail"),
    path("<uuid:question_id>/archive/", QuestionArchiveView.as_view(), name="question-archive"),
]
