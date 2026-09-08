from __future__ import annotations

from django.test import TestCase
from rest_framework.test import APIClient

from apps.exams.models import Exam, Question, QuestionOption
from apps.users.models import User

from .models import School, SchoolMembership


class OrganizationAdministrationApiTests(TestCase):
    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.admin = User.objects.create_user(email="admin@example.com", password=self.password, role=User.Role.ADMIN)
        self.teacher = User.objects.create_user(email="teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.student = User.objects.create_user(email="student@example.com", password=self.password)
        self.client = APIClient()

    def authenticate(self, user: User) -> None:
        self.client.force_authenticate(user)

    def test_admin_only_school_crud_and_safe_counts(self) -> None:
        self.assertEqual(self.client.get("/api/v1/admin/schools/").status_code, 401)
        self.authenticate(self.teacher)
        self.assertEqual(self.client.get("/api/v1/admin/schools/").status_code, 403)

        self.authenticate(self.admin)
        created = self.client.post("/api/v1/admin/schools/", {"name": "North Academy", "city": "Amsterdam"}, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["name"], "North Academy")
        self.assertTrue(created.data["join_code"])
        self.assertEqual(created.data["user_count"], 0)
        self.assertEqual(created.data["exam_count"], 0)

        school_id = created.data["id"]
        updated = self.client.patch(f"/api/v1/admin/schools/{school_id}/", {"is_active": False}, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertFalse(updated.data["is_active"])
        # Join codes are server generated and must never be client-writable.
        self.assertEqual(self.client.patch(f"/api/v1/admin/schools/{school_id}/", {"join_code": "OVERRIDE"}, format="json").status_code, 400)

    def test_admin_can_provision_edit_and_protect_user_accounts(self) -> None:
        school = School.objects.create(name="East Academy", city="Haarlem")
        self.authenticate(self.admin)
        created = self.client.post(
            "/api/v1/admin/users/",
            {
                "email": "new.teacher@example.com", "password": self.password, "first_name": "New", "last_name": "Teacher",
                "role": User.Role.TEACHER, "school_id": str(school.id), "teacher_profile": {"department": "Science"},
            }, format="json",
        )
        self.assertEqual(created.status_code, 201)
        user = User.objects.get(email="new.teacher@example.com")
        self.assertEqual(user.role, User.Role.TEACHER)
        self.assertEqual(user.school_membership.school, school)
        self.assertEqual(user.teacher_profile.department, "Science")
        self.assertNotIn("password", created.data)

        changed = self.client.patch(
            f"/api/v1/admin/users/{user.id}/",
            {"role": User.Role.STUDENT, "student_profile": {"grade": "12", "class_name": "12-A"}, "school_id": None, "password": "Another-strong-password-912"},
            format="json",
        )
        self.assertEqual(changed.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.STUDENT)
        self.assertFalse(SchoolMembership.objects.filter(user=user).exists())
        self.assertEqual(user.student_profile.grade, "12")
        self.assertTrue(user.check_password("Another-strong-password-912"))

        self_protected = self.client.patch(f"/api/v1/admin/users/{self.admin.id}/", {"role": User.Role.STUDENT}, format="json")
        self.assertEqual(self_protected.status_code, 400)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, User.Role.ADMIN)

    def test_admin_dashboard_and_exam_list_include_real_school_context(self) -> None:
        school = School.objects.create(name="Central Academy", city="Amsterdam")
        SchoolMembership.objects.create(user=self.teacher, school=school)
        exam = Exam.objects.create(title="Physics", subject="Physics", teacher=self.teacher, duration_minutes=30, status=Exam.Status.ACTIVE)
        question = Question.objects.create(exam=exam, type=Question.Type.MULTIPLE_CHOICE, text="Question", order=1, marks=2)
        QuestionOption.objects.create(question=question, text="Correct", order=1, is_correct=True)
        QuestionOption.objects.create(question=question, text="Wrong", order=2, is_correct=False)
        self.authenticate(self.admin)

        overview = self.client.get("/api/v1/admin/overview/")
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.data["school_count"], 1)
        self.assertEqual(overview.data["exam_count"], 1)
        self.assertEqual(overview.data["recent_exams"][0]["school"]["name"], school.name)
        self.assertEqual(overview.data["recent_exams"][0]["question_count"], 1)

        exams = self.client.get("/api/v1/admin/exams/")
        self.assertEqual(exams.status_code, 200)
        self.assertEqual(exams.data[0]["teacher_email"], self.teacher.email)
        self.assertEqual(exams.data[0]["school"]["id"], str(school.id))

    def test_public_registration_can_join_only_an_active_school_and_returns_safe_summary(self) -> None:
        school = School.objects.create(name="Join Academy", city="Leiden")
        registered = self.client.post(
            "/api/v1/auth/register/",
            {"email": "joined@example.com", "password": self.password, "first_name": "Joined", "school_code": school.join_code.lower()},
            format="json",
        )
        self.assertEqual(registered.status_code, 201)
        self.assertEqual(registered.data["school"], {"id": str(school.id), "name": school.name, "city": school.city})
        self.assertNotIn("join_code", registered.data)
        self.assertEqual(User.objects.get(email="joined@example.com").school_membership.school, school)

        school.is_active = False; school.save()
        rejected = self.client.post(
            "/api/v1/auth/register/", {"email": "blocked@example.com", "password": self.password, "school_code": school.join_code}, format="json"
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertFalse(User.objects.filter(email="blocked@example.com").exists())


class SchoolIsolationApiTests(TestCase):
    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.school_a = School.objects.create(name="School A", city="Amsterdam")
        self.school_b = School.objects.create(name="School B", city="Amsterdam")
        self.teacher = User.objects.create_user(email="teacher.a@example.com", password=self.password, role=User.Role.TEACHER)
        self.student_a = User.objects.create_user(email="student.a@example.com", password=self.password)
        self.student_b = User.objects.create_user(email="student.b@example.com", password=self.password)
        self.student_zero = User.objects.create_user(email="student.zero@example.com", password=self.password)
        self.unassigned = User.objects.create_user(email="unassigned@example.com", password=self.password)
        SchoolMembership.objects.create(user=self.teacher, school=self.school_a)
        SchoolMembership.objects.create(user=self.student_a, school=self.school_a)
        SchoolMembership.objects.create(user=self.student_zero, school=self.school_a)
        SchoolMembership.objects.create(user=self.student_b, school=self.school_b)
        self.exam = Exam.objects.create(title="School A Exam", subject="Math", teacher=self.teacher, duration_minutes=20, status=Exam.Status.ACTIVE)
        question = Question.objects.create(exam=self.exam, type=Question.Type.MULTIPLE_CHOICE, text="One", order=1, marks=1)
        QuestionOption.objects.create(question=question, text="Yes", order=1, is_correct=True)
        QuestionOption.objects.create(question=question, text="No", order=2, is_correct=False)
        self.client = APIClient()

    def test_school_teacher_exam_is_only_visible_and_startable_by_same_school_students(self) -> None:
        self.client.force_authenticate(self.student_a)
        visible = self.client.get("/api/v1/student/exams/")
        self.assertEqual(visible.status_code, 200)
        self.assertEqual([item["id"] for item in visible.data], [str(self.exam.id)])
        self.assertEqual(self.client.post(f"/api/v1/student/exams/{self.exam.id}/start/").status_code, 201)

        self.client.force_authenticate(self.teacher)
        roster = self.client.get("/api/v1/results/teacher/students/")
        self.assertEqual(roster.status_code, 200)
        roster_by_email = {row["email"]: row for row in roster.data}
        self.assertEqual(set(roster_by_email), {self.student_a.email, self.student_zero.email})
        self.assertEqual(roster_by_email[self.student_zero.email]["attempt_count"], 0)

        for student in (self.student_b, self.unassigned):
            self.client.force_authenticate(student)
            self.assertEqual(self.client.get("/api/v1/student/exams/").data, [])
            self.assertEqual(self.client.post(f"/api/v1/student/exams/{self.exam.id}/start/").status_code, 400)
