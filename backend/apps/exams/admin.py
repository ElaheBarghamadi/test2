from django.contrib import admin

from .models import Exam, ExamSettings, Question, QuestionOption


class ExamSettingsInline(admin.StackedInline):
    model = ExamSettings
    extra = 0
    max_num = 1


class QuestionOptionInline(admin.TabularInline):
    model = QuestionOption
    extra = 2
    fields = ("order", "text", "is_correct")


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ("title", "subject", "grade", "class_name", "teacher", "status", "duration_minutes", "total_marks", "start_at", "updated_at")
    list_filter = ("status", "subject", "grade")
    search_fields = ("title", "description", "teacher__email", "teacher__first_name", "teacher__last_name")
    autocomplete_fields = ("teacher",)
    readonly_fields = ("id", "created_at", "updated_at", "total_marks")
    list_select_related = ("teacher",)
    inlines = (ExamSettingsInline,)
    fieldsets = (
        (None, {"fields": ("title", "description", "instructions", "teacher", "status")} ),
        ("Audience", {"fields": ("subject", "grade", "class_name")} ),
        ("Timing and marks", {"fields": ("duration_minutes", "total_marks", "start_at", "end_at")} ),
        ("Audit", {"fields": ("id", "created_at", "updated_at")} ),
    )


@admin.register(ExamSettings)
class ExamSettingsAdmin(admin.ModelAdmin):
    list_display = ("exam", "allow_previous_questions", "randomize_questions", "result_visibility", "show_correct_answers", "max_attempts", "updated_at")
    list_filter = ("result_visibility", "randomize_questions", "show_correct_answers")
    search_fields = ("exam__title", "exam__teacher__email")
    autocomplete_fields = ("exam",)
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("exam", "exam__teacher")


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("short_text", "exam", "type", "order", "marks", "updated_at")
    list_filter = ("type", "exam__status")
    search_fields = ("text", "exam__title")
    autocomplete_fields = ("exam",)
    readonly_fields = ("id", "created_at", "updated_at")
    list_select_related = ("exam",)
    inlines = (QuestionOptionInline,)

    @admin.display(description="Question")
    def short_text(self, obj: Question) -> str:
        return obj.text[:80]


@admin.register(QuestionOption)
class QuestionOptionAdmin(admin.ModelAdmin):
    list_display = ("short_text", "question", "order", "is_correct")
    list_filter = ("is_correct", "question__type")
    search_fields = ("text", "question__text", "question__exam__title")
    autocomplete_fields = ("question",)

    @admin.display(description="Option")
    def short_text(self, obj: QuestionOption) -> str:
        return obj.text[:80]
