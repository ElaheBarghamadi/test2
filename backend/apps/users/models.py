from __future__ import annotations

from typing import Any

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models

from apps.core.models import TimeStampedUUIDModel


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def create_user(self, email: str, password: str | None = None, **extra_fields: Any) -> "User":
        if not email:
            raise ValueError("Users must have an email address.")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str | None = None, **extra_fields: Any) -> "User":
        extra_fields.setdefault("role", User.Role.ADMIN)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self.create_user(email, password, **extra_fields)


class User(TimeStampedUUIDModel, AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        STUDENT = "student", "Student"
        TEACHER = "teacher", "Teacher"
        ADMIN = "admin", "Administrator"
        # Scoped to one school through `SchoolMembership`: supervision of its people, papers and results,
        # never authoring a teacher's paper and never a student's answer sheet. See `apps/organizations/scope.py`.
        SCHOOL_ADMIN = "school_admin", "School administrator"

    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STUDENT, db_index=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    last_login = models.DateTimeField(blank=True, null=True)

    objects = UserManager()

    EMAIL_FIELD = "email"
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        ordering = ("email",)
        indexes = [models.Index(fields=("role", "is_active"))]

    def __str__(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        return " ".join(part for part in [self.first_name, self.last_name] if part).strip() or self.email

    def get_short_name(self) -> str:
        return self.first_name or self.email


class StudentProfile(TimeStampedUUIDModel):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="student_profile")
    student_identifier = models.CharField(max_length=64, unique=True, null=True, blank=True)
    grade = models.CharField(max_length=100, blank=True)
    class_name = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ("student_identifier", "user__last_name")

    def __str__(self) -> str:
        return f"Student profile: {self.user.get_full_name()}"


class TeacherProfile(TimeStampedUUIDModel):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="teacher_profile")
    teacher_identifier = models.CharField(max_length=64, unique=True, null=True, blank=True)
    department = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ("teacher_identifier", "user__last_name")

    def __str__(self) -> str:
        return f"Teacher profile: {self.user.get_full_name()}"
