from django.urls import path

from .views import (
    ExamActionView,
    ExamQuestionImportView,
    ExamQuestionListCreateView,
    ExamQuestionReorderView,
    TeacherExamDetailView,
    TeacherExamListCreateView,
)

app_name = "exams"
urlpatterns = [
    path("", TeacherExamListCreateView.as_view(), name="exam-list-create"),
    path("<uuid:exam_id>/", TeacherExamDetailView.as_view(), name="exam-detail"),
    path("<uuid:exam_id>/publish/", ExamActionView.as_view(action="publish"), name="exam-publish"),
    path("<uuid:exam_id>/start/", ExamActionView.as_view(action="start"), name="exam-start"),
    path("<uuid:exam_id>/extend/", ExamActionView.as_view(action="extend"), name="exam-extend"),
    path("<uuid:exam_id>/archive/", ExamActionView.as_view(action="archive"), name="exam-archive"),
    path("<uuid:exam_id>/restore/", ExamActionView.as_view(action="restore"), name="exam-restore"),
    path("<uuid:exam_id>/complete/", ExamActionView.as_view(action="complete"), name="exam-complete"),
    path("<uuid:exam_id>/duplicate/", ExamActionView.as_view(action="duplicate"), name="exam-duplicate"),
    path("<uuid:exam_id>/questions/", ExamQuestionListCreateView.as_view(), name="exam-question-list-create"),
    path("<uuid:exam_id>/questions/reorder/", ExamQuestionReorderView.as_view(), name="exam-question-reorder"),
    path("<uuid:exam_id>/questions/import/", ExamQuestionImportView.as_view(), name="exam-question-import"),
]
