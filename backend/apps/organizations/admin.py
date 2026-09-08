from django.contrib import admin

from .models import School, SchoolMembership


@admin.register(School)
class SchoolAdmin(admin.ModelAdmin):
    list_display = ("name", "city", "join_code", "is_active", "created_at")
    list_filter = ("is_active", "city")
    search_fields = ("name", "city", "join_code")
    readonly_fields = ("join_code", "created_at", "updated_at")


@admin.register(SchoolMembership)
class SchoolMembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "school", "created_at")
    search_fields = ("user__email", "user__first_name", "user__last_name", "school__name")
    list_select_related = ("user", "school")
