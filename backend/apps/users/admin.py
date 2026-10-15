from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.utils.translation import gettext_lazy as _

from .models import StudentGroup, StudentGroupMember, StudentProfile, TeacherProfile, User


@admin.register(User)
class ExamoraUserAdmin(UserAdmin):
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "role", "is_active", "is_staff", "created_at")
    list_filter = ("role", "is_active", "is_staff", "is_superuser")
    search_fields = ("email", "first_name", "last_name")
    readonly_fields = ("id", "created_at", "updated_at", "last_login")
    fieldsets = (
        (None, {"fields": ("email", "password")} ),
        (_("Personal info"), {"fields": ("first_name", "last_name", "role")} ),
        (_("Permissions"), {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")} ),
        (_("Important dates"), {"fields": ("last_login", "created_at", "updated_at")} ),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "first_name", "last_name", "role", "password1", "password2", "is_active", "is_staff")} ),
    )


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ("student_identifier", "user", "grade", "class_name", "updated_at")
    list_filter = ("grade", "class_name")
    search_fields = ("student_identifier", "user__email", "user__first_name", "user__last_name")
    autocomplete_fields = ("user",)
    readonly_fields = ("id", "created_at", "updated_at")


class StudentGroupMemberInline(admin.TabularInline):
    model = StudentGroupMember
    extra = 0
    autocomplete_fields = ("student",)


@admin.register(StudentGroup)
class StudentGroupAdmin(admin.ModelAdmin):
    list_display = ("name", "teacher", "student_count", "updated_at")
    search_fields = ("name", "teacher__email", "students__email", "students__first_name", "students__last_name")
    autocomplete_fields = ("teacher",)
    readonly_fields = ("id", "created_at", "updated_at")
    inlines = (StudentGroupMemberInline,)

    @admin.display(description="Students")
    def student_count(self, obj):  # type: ignore[no-untyped-def]
        return obj.students.count()


@admin.register(TeacherProfile)
class TeacherProfileAdmin(admin.ModelAdmin):
    list_display = ("teacher_identifier", "user", "department", "updated_at")
    list_filter = ("department",)
    search_fields = ("teacher_identifier", "user__email", "user__first_name", "user__last_name")
    autocomplete_fields = ("user",)
    readonly_fields = ("id", "created_at", "updated_at")
