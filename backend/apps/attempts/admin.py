from django.contrib import admin

from .models import ExamAttempt, StudentAnswer


class StudentAnswerInline(admin.TabularInline):
    model = StudentAnswer
    extra = 0
    readonly_fields = ("id", "created_at", "updated_at")
    fields = ("question", "is_flagged", "manual_score", "feedback", "answer_data")
    autocomplete_fields = ("question",)


@admin.register(ExamAttempt)
class ExamAttemptAdmin(admin.ModelAdmin):
    list_display = ("exam", "student", "attempt_number", "status", "started_at", "submitted_at", "last_activity_at")
    list_filter = ("status", "exam__subject")
    search_fields = ("student__email", "student__first_name", "student__last_name", "exam__title")
    autocomplete_fields = ("exam", "student")
    readonly_fields = ("id", "created_at", "updated_at", "last_activity_at")
    list_select_related = ("exam", "student")
    inlines = (StudentAnswerInline,)


@admin.register(StudentAnswer)
class StudentAnswerAdmin(admin.ModelAdmin):
    list_display = ("attempt", "question", "is_flagged", "manual_score", "updated_at")
    list_filter = ("is_flagged", "question__type", "attempt__status")
    search_fields = ("attempt__student__email", "question__text", "attempt__exam__title")
    autocomplete_fields = ("attempt", "question", "selected_options")
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("attempt", "question")
