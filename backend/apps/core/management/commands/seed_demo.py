"""Create a small, believable school so the interface can be tried without inventing data by hand.

Development only. The command refuses to run with `DEBUG=False`, because a known password on a real
deployment is not a convenience — it is an open door.

Everything is idempotent: running it twice updates the same rows instead of failing on the unique
constraints, so it is safe to reach for after a `migrate` on a fresh clone.

    python manage.py seed_demo
"""
from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.organizations.models import School, SchoolMembership
from apps.users.models import StudentGroup, User

SCHOOL_NAME = "دبیرستان نمونهٔ بررسی"
PASSWORD = "Examora1234!"

FIRST_NAMES = ["سارا", "امیرعلی", "نگار", "محمدحسین", "ریحانه", "ابوالفضل", "مریم", "یاسین", "زهرا", "آرش", "هانیه", "سینا"]
LAST_NAMES = ["احمدی", "رضایی", "کریمی", "موسوی", "صادقی", "جعفری", "حسینی", "نوری", "قاسمی", "رحیمی", "طاهری", "مرادی"]
CLASSES = [("پایه دوازدهم", "تجربی ۱"), ("پایه دوازدهم", "تجربی ۲")]


class Command(BaseCommand):
    help = "Create a demo school with one teacher, one administrator and a class of students."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument("--students", type=int, default=len(FIRST_NAMES), help="How many students to create.")

    @transaction.atomic
    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        if not settings.DEBUG:
            raise CommandError("seed_demo only runs with DJANGO_DEBUG=true; it creates accounts with known passwords.")

        count = max(1, min(int(options["students"]), len(FIRST_NAMES)))
        school, _ = School.objects.get_or_create(name=SCHOOL_NAME, defaults={"city": "تهران"})

        admin = self._account("admin@examora.test", "مدیر", "سامانه", User.Role.ADMIN, is_staff=True)
        teacher = self._account("teacher@examora.test", "الهام", "برقشهر", User.Role.TEACHER)
        for user in (admin, teacher):
            SchoolMembership.objects.get_or_create(user=user, defaults={"school": school})

        students: list[User] = []
        for index in range(count):
            first, last = FIRST_NAMES[index], LAST_NAMES[index]
            grade, class_name = CLASSES[index % len(CLASSES)]
            student = self._account(f"student{index + 1}@examora.test", first, last, User.Role.STUDENT)
            SchoolMembership.objects.get_or_create(user=student, defaults={"school": school})
            profile = getattr(student, "student_profile", None)
            if profile is not None and (profile.grade != grade or profile.class_name != class_name):
                profile.grade = grade
                profile.class_name = class_name
                profile.save(update_fields=("grade", "class_name", "updated_at"))
            students.append(student)

        # Two overlapping-by-class groups, so the audience step has something to show and the union count is
        # visibly smaller than the sum of the two.
        half = max(1, len(students) // 2)
        groups = [
            ("تجربی ۲ — گروه الف", "دانش‌آموزانی که آزمون تکمیلی می‌دهند.", students[:half]),
            ("کلاس جبرانی", "برای کسانی که جلسهٔ قبل غایب بودند.", students[half - 1 : half + 2]),
        ]
        for name, description, members in groups:
            # A manual get-or-create: `get_or_create` would pass the `name__iexact` lookup to the constructor,
            # and the uniqueness rule here is case-insensitive per teacher, not an exact string match.
            group = StudentGroup.objects.filter(teacher=teacher, name__iexact=name).first()
            if group is None:
                group = StudentGroup.objects.create(teacher=teacher, name=name, description=description)
            group.students.set(members)

        self.stdout.write(self.style.SUCCESS(f"مدرسهٔ «{school.name}» آماده است."))
        self.stdout.write("")
        self.stdout.write(f"  مدیر:    admin@examora.test    / {PASSWORD}")
        self.stdout.write(f"  آموزگار: teacher@examora.test  / {PASSWORD}")
        self.stdout.write(f"  دانش‌آموز: student1@examora.test … student{count}@examora.test / {PASSWORD}")
        self.stdout.write("")
        self.stdout.write(f"  {len(groups)} گروه با {sum(len(members) for _, _, members in groups)} عضویت ساخته شد.")

    @staticmethod
    def _account(email: str, first_name: str, last_name: str, role: str, *, is_staff: bool = False) -> User:
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email, password=PASSWORD, first_name=first_name, last_name=last_name, role=role, is_staff=is_staff
            )
        else:
            # Re-running the command must not lock anybody out of a demo they are in the middle of.
            user.set_password(PASSWORD)
            user.first_name = first_name
            user.last_name = last_name
            user.role = role
            user.is_staff = is_staff
            user.is_active = True
            user.save()
        return user
