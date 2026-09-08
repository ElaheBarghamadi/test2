from django.contrib import admin

from .models import ExamResult


@admin.register(ExamResult)
class ExamResultAdmin(admin.ModelAdmin):
    list_display = ("attempt", "status", "score", "percentage", "correct_count", "incorrect_count", "unanswered_count", "pending_manual_grading_count", "published_at")
    list_filter = ("status", "attempt__exam__subject")
    search_fields = ("attempt__student__email", "attempt__exam__title")
    autocomplete_fields = ("attempt",)
    readonly_fields = ("id", "created_at", "updated_at", "computed_at", "published_at")
    list_select_related = ("attempt", "attempt__exam", "attempt__student")
