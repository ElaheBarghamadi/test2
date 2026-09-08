from __future__ import annotations

import secrets

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import TimeStampedUUIDModel


def school_join_code() -> str:
    return secrets.token_urlsafe(6).upper().replace("-", "").replace("_", "")[:8]


class School(TimeStampedUUIDModel):
    """A tenant boundary for school administration and teacher/student rosters."""

    name = models.CharField(max_length=200, unique=True)
    city = models.CharField(max_length=120, blank=True)
    join_code = models.CharField(max_length=16, unique=True, default=school_join_code, editable=False, db_index=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name

    def clean(self) -> None:
        if not self.name.strip():
            raise ValidationError({"name": "School name cannot be blank."})


class SchoolMembership(TimeStampedUUIDModel):
    """Each account belongs to at most one school in the current single-tenant user model."""

    school = models.ForeignKey(School, on_delete=models.PROTECT, related_name="memberships")
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="school_membership")

    class Meta:
        ordering = ("school__name", "user__last_name", "user__first_name")
        indexes = [models.Index(fields=("school", "user"))]

    def __str__(self) -> str:
        return f"{self.user} @ {self.school}"
