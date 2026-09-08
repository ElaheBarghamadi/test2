from django.urls import path

from .views import TeacherQuestionDetailView

app_name = "questions"
urlpatterns = [path("<uuid:question_id>/", TeacherQuestionDetailView.as_view(), name="question-detail")]
