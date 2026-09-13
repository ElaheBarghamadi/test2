from __future__ import annotations

from django.db import connection
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.attempts.models import ExamAttempt, StudentAnswer
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


class SchoolAdministratorApiTests(TestCase):
    """«مدیر مدرسه»: one school, its people, its papers and their results — and no further.

    The role is deliberately *not* a smaller platform administrator. Everything below checks one of three
    things: the reach is the whole school (not one teacher's rows), the reach stops at the school's border
    (a foreign object is a 404, and a query string cannot widen it), and the two things a principal must
    never do — author a teacher's paper, read a student's answers — are refused at the API rather than only
    hidden in the interface.
    """

    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.platform_admin = User.objects.create_user(email="root@example.com", password=self.password, role=User.Role.ADMIN)
        self.principal = User.objects.create_user(email="principal@example.com", password=self.password, role=User.Role.SCHOOL_ADMIN)
        self.orphan_principal = User.objects.create_user(email="orphan@example.com", password=self.password, role=User.Role.SCHOOL_ADMIN)
        self.teacher = User.objects.create_user(email="school.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.rival_teacher = User.objects.create_user(email="rival.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.student = User.objects.create_user(email="school.student@example.com", password=self.password)
        self.client = APIClient()

        self.school = School.objects.create(name="North Academy", city="Tehran")
        self.other_school = School.objects.create(name="South Academy", city="Shiraz")
        for user, school in ((self.principal, self.school), (self.teacher, self.school), (self.student, self.school), (self.rival_teacher, self.other_school)):
            SchoolMembership.objects.create(user=user, school=school)

        self.exam = self.make_exam(self.teacher, "Physics midterm")
        self.foreign_exam = self.make_exam(self.rival_teacher, "Chemistry midterm")

    def make_exam(self, owner: User, title: str) -> Exam:
        exam = Exam.objects.create(teacher=owner, title=title, subject="Physics", duration_minutes=45, status=Exam.Status.DRAFT)
        question = Question.objects.create(exam=exam, type=Question.Type.MULTIPLE_CHOICE, text="Force unit?", order=1, marks=2)
        QuestionOption.objects.create(question=question, text="Newton", is_correct=True, order=1)
        QuestionOption.objects.create(question=question, text="Joule", is_correct=False, order=2)
        return exam

    def authenticate(self, user: User) -> None:
        self.client.force_authenticate(user)

    def test_overview_is_the_school_not_the_network(self) -> None:
        self.authenticate(self.principal)
        data = self.client.get("/api/v1/admin/overview/").data
        self.assertEqual(data["scope"]["kind"], "school")
        self.assertEqual(data["scope"]["school"]["name"], "North Academy")
        self.assertEqual(data["user_count"], 3, "principal, teacher and student of this school")
        self.assertEqual(data["exam_count"], 1)
        self.assertEqual(data["school_count"], 1)

        self.authenticate(self.platform_admin)
        platform = self.client.get("/api/v1/admin/overview/").data
        self.assertEqual(platform["scope"]["kind"], "platform")
        self.assertIsNone(platform["scope"]["school"])
        self.assertGreater(platform["exam_count"], 1)

    def test_roster_is_the_school_and_a_query_string_cannot_widen_it(self) -> None:
        self.authenticate(self.principal)
        rows = self.client.get("/api/v1/admin/users/").data
        self.assertEqual({row["email"] for row in rows}, {"principal@example.com", "school.teacher@example.com", "school.student@example.com"})

        refused = self.client.get(f"/api/v1/admin/users/?school_id={self.other_school.pk}")
        self.assertEqual(refused.status_code, 403)

    def test_schools_are_read_only_and_limited_to_their_own(self) -> None:
        self.authenticate(self.principal)
        rows = self.client.get("/api/v1/admin/schools/").data
        self.assertEqual([row["name"] for row in rows], ["North Academy"])
        self.assertEqual(self.client.post("/api/v1/admin/schools/", {"name": "Third Academy"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/v1/admin/schools/{self.school.pk}/", {"city": "Qom"}, format="json").status_code, 403)

    def test_people_can_be_created_only_inside_the_school_and_never_as_administrators(self) -> None:
        self.authenticate(self.principal)
        created = self.client.post(
            "/api/v1/admin/users/",
            {
                "email": "new.teacher@example.com", "password": self.password, "first_name": "N", "last_name": "K",
                "role": User.Role.TEACHER, "school_id": str(self.other_school.pk), "teacher_profile": {"department": "Math"},
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["school"]["name"], "North Academy", "the new account lands in the principal's own school")

        for role in (User.Role.ADMIN, User.Role.SCHOOL_ADMIN):
            refused = self.client.post(
                "/api/v1/admin/users/",
                {"email": f"{role}@example.com", "password": self.password, "role": role},
                format="json",
            )
            self.assertEqual(refused.status_code, 403, f"a principal cannot hand out the {role} role")

    def test_a_stale_school_id_cannot_break_creating_inside_their_own_school(self) -> None:
        """The payload's claim about the school is dropped, not validated, for a principal."""
        self.authenticate(self.principal)
        created = self.client.post(
            "/api/v1/admin/users/",
            {
                "email": "fresh.teacher@example.com", "password": self.password, "first_name": "F", "last_name": "T",
                "role": User.Role.TEACHER, "school_id": "11111111-1111-1111-1111-111111111111",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, "an id the principal cannot use is ignored, not rejected")
        self.assertEqual(created.data["school"]["name"], "North Academy")

    def test_people_of_another_school_are_not_even_visible(self) -> None:
        self.authenticate(self.principal)
        self.assertEqual(self.client.patch(f"/api/v1/admin/users/{self.rival_teacher.pk}/", {"is_active": False}, format="json").status_code, 404)

        # Moving one of their own people out of the school is the platform's decision.
        refused = self.client.patch(f"/api/v1/admin/users/{self.teacher.pk}/", {"school_id": str(self.other_school.pk)}, format="json")
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(self.client.patch(f"/api/v1/admin/users/{self.teacher.pk}/", {"role": User.Role.ADMIN}, format="json").status_code, 403)
        self.teacher.refresh_from_db()
        self.assertEqual(self.teacher.school_membership.school_id, self.school.pk)

    def test_papers_of_the_school_are_supervised_not_written(self) -> None:
        self.authenticate(self.principal)
        exams = self.client.get("/api/v1/exams/").data
        self.assertEqual([exam["title"] for exam in exams], ["Physics midterm"])
        self.assertEqual(self.client.get(f"/api/v1/exams/{self.exam.pk}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/exams/{self.foreign_exam.pk}/").status_code, 404, "a foreign paper is not there at all")

        self.assertEqual(self.client.post(f"/api/v1/exams/{self.exam.pk}/publish/", {}).status_code, 200)
        self.exam.refresh_from_db()
        # A paper whose window is unset publishes straight into `active`; either way it left `draft`, which
        # is the point - the principal moved it, not the owner.
        self.assertIn(self.exam.status, {Exam.Status.SCHEDULED, Exam.Status.ACTIVE})
        self.assertEqual(self.client.post(f"/api/v1/exams/{self.exam.pk}/extend/", {"extra_minutes": 15}, format="json").status_code, 200)

        # Reading a supervised paper is fine; writing its content is not.
        self.assertEqual(self.client.patch(f"/api/v1/exams/{self.exam.pk}/", {"title": "Renamed"}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/v1/exams/", {"title": "X", "subject": "Y", "duration_minutes": 30}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/v1/exams/{self.exam.pk}/duplicate/", {}).status_code, 403)
        self.assertEqual(self.client.post(f"/api/v1/exams/{self.exam.pk}/questions/", {"type": "written", "text": "x", "marks": 1}, format="json").status_code, 403)

    def test_results_are_visible_and_publishable_but_sheets_are_not(self) -> None:
        self.authenticate(self.principal)
        self.assertEqual(self.client.get("/api/v1/results/teacher/overview/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/results/teacher/exams/{self.exam.pk}/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/results/teacher/students/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/v1/results/teacher/exams/{self.exam.pk}/publish/", {}).status_code, 200)

        self.assertEqual(self.client.get(f"/api/v1/results/teacher/exams/{self.exam.pk}/grading/").status_code, 403, "the marking desk is an answer sheet")
        self.assertEqual(self.client.get(f"/api/v1/results/teacher/exams/{self.foreign_exam.pk}/").status_code, 404)

    def test_a_principal_without_a_school_governs_nothing(self) -> None:
        """The role's authority *is* its membership; with none, the fallback must be "nothing"."""
        self.authenticate(self.orphan_principal)
        for path in ("/api/v1/admin/overview/", "/api/v1/admin/users/", "/api/v1/admin/schools/", "/api/v1/admin/exams/"):
            self.assertEqual(self.client.get(path).status_code, 403, path)
        self.assertEqual(self.client.get("/api/v1/exams/").data, [])
        self.assertEqual(self.client.get(f"/api/v1/exams/{self.exam.pk}/").status_code, 404)

    def test_exam_monitoring_list_is_scoped(self) -> None:
        self.authenticate(self.principal)
        rows = self.client.get("/api/v1/admin/exams/").data
        self.assertEqual([row["title"] for row in rows], ["Physics midterm"])
        self.authenticate(self.platform_admin)
        self.assertEqual(len(self.client.get("/api/v1/admin/exams/").data), 2)

    def test_a_principal_cannot_unlock_themself(self) -> None:
        self.authenticate(self.principal)
        refused = self.client.patch(f"/api/v1/admin/users/{self.principal.pk}/", {"role": User.Role.ADMIN}, format="json")
        self.assertEqual(refused.status_code, 403)
        self.principal.refresh_from_db()
        self.assertEqual(self.principal.role, User.Role.SCHOOL_ADMIN)


class AdminConsoleApiTests(TestCase):
    """The platform console: what it may count, and what it may change.

    The interesting assertions are the two edges of the same design: the statistics must be complete enough to
    run a network from (a figure the console guesses is a figure nobody can act on), and every action must
    stay with the platform administrator, because each one overrides a teacher's or a student's work.
    """

    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.admin = User.objects.create_user(email="root@example.com", password=self.password, role=User.Role.ADMIN)
        self.teacher_a = User.objects.create_user(email="teacher.a@example.com", password=self.password, role=User.Role.TEACHER)
        self.teacher_b = User.objects.create_user(email="teacher.b@example.com", password=self.password, role=User.Role.TEACHER)
        self.student = User.objects.create_user(email="student@example.com", password=self.password)
        self.school_a = School.objects.create(name="Alpha", city="Tehran")
        self.school_b = School.objects.create(name="Beta", city="Karaj")
        for user, school in ((self.teacher_a, self.school_a), (self.teacher_b, self.school_b), (self.student, self.school_a)):
            SchoolMembership.objects.create(user=user, school=school)
        self.school_admin = User.objects.create_user(
            email="school.admin@example.com", password=self.password, role=User.Role.SCHOOL_ADMIN
        )
        SchoolMembership.objects.create(user=self.school_admin, school=self.school_a)
        self.client = APIClient()

    def authenticate(self, user: User) -> None:
        self.client.force_authenticate(user)

    def make_exam(self, teacher: User, **overrides) -> Exam:
        defaults = {"title": "Paper", "subject": "Physics", "duration_minutes": 30, "status": Exam.Status.ACTIVE}
        defaults.update(overrides)
        return Exam.objects.create(teacher=teacher, **defaults)

    def add_question(self, exam: Exam, *, marks: int = 2, text: str = "Which unit is power?") -> Question:
        question = Question.objects.create(
            exam=exam, type=Question.Type.MULTIPLE_CHOICE, text=text, order=exam.questions.count() + 1, marks=marks
        )
        QuestionOption.objects.create(question=question, text="Watt", is_correct=True, order=1)
        QuestionOption.objects.create(question=question, text="Joule", is_correct=False, order=2)
        return question

    def test_the_console_counts_the_network_for_the_platform_admin(self) -> None:
        from apps.attempts.models import ExamAttempt
        from apps.organizations.admin_control import ACTIVITY_DAYS

        exam_a = self.make_exam(self.teacher_a)
        self.make_exam(self.teacher_b, status=Exam.Status.DRAFT)
        self.add_question(exam_a)
        attempt = ExamAttempt.objects.create(
            exam=exam_a,
            student=self.student,
            status=ExamAttempt.Status.SUBMITTED,
            attempt_number=1,
            # A submitted row with no submission time is a data error, and the chart counts submissions by
            # their timestamp, so the fixture has to say when it happened.
            submitted_at=timezone.now(),
        )
        ExamAttempt.objects.create(exam=exam_a, student=self.student, status=ExamAttempt.Status.IN_PROGRESS, attempt_number=2)

        self.authenticate(self.admin)
        stats = self.client.get("/api/v1/admin/stats/").data
        check = self.assertEqual
        check(stats["scope"]["kind"], "platform")
        check(stats["totals"]["users"], User.objects.count())
        check(stats["totals"]["exams"], 2)
        check(stats["totals"]["attempts"], 2)
        check(stats["totals"]["exams_by_status"], {"active": 1, "draft": 1})
        check(stats["activity"]["days"], ACTIVITY_DAYS)
        check(len(stats["activity"]["submissions"]), ACTIVITY_DAYS, "a chart needs every day, quiet ones included")
        # One submission in the window, on exactly one day of the series. Which day is the server's
        # timezone business; that the series is zero-filled for the rest is what this pins.
        check(sum(row["count"] for row in stats["activity"]["submissions"]), 1)
        check(sorted((row["count"] for row in stats["activity"]["submissions"]), reverse=True)[:2], [1, 0])
        check(stats["activity"]["live_now"]["attempts_in_progress"], 1)
        self.assertTrue(stats["top"]["teachers"][0]["exams"] >= 1, "the busiest teacher leads the list")
        check(stats["health"]["database"]["engine"], connection.vendor)

    def test_a_school_admin_sees_their_school_and_not_the_network(self) -> None:
        self.make_exam(self.teacher_a)
        self.make_exam(self.teacher_b)
        self.make_exam(self.teacher_b, title="Another Beta paper")

        self.authenticate(self.school_admin)
        scoped = self.client.get("/api/v1/admin/stats/").data
        self.assertEqual(scoped["scope"]["kind"], "school")
        self.assertEqual(scoped["scope"]["school"]["name"], "Alpha")
        self.assertEqual(scoped["totals"]["exams"], 1, "one paper of Alpha, not three of the network")
        self.assertEqual(scoped["totals"]["schools"], 1)
        self.assertEqual(scoped["top"]["schools"], [], "a school administrator is not shown the rivals")

        self.authenticate(self.admin)
        self.assertEqual(self.client.get("/api/v1/admin/stats/").data["totals"]["exams"], 3)

    def test_the_console_is_closed_to_everybody_else(self) -> None:
        for path in ("/api/v1/admin/stats/", "/api/v1/admin/database/"):
            self.assertEqual(self.client.get(path).status_code, 401, f"{path} needs a session at all")
        for user in (self.teacher_a, self.student):
            self.authenticate(user)
            for path in ("/api/v1/admin/stats/", "/api/v1/admin/database/"):
                self.assertEqual(self.client.get(path).status_code, 403, f"{user.role} may not read {path}")

    def test_an_unattached_school_administrator_is_refused_rather_than_shown_everything(self) -> None:
        orphan = User.objects.create_user(email="orphan.admin@example.com", password=self.password, role=User.Role.SCHOOL_ADMIN)
        self.authenticate(orphan)
        refused = self.client.get("/api/v1/admin/stats/")
        self.assertEqual(refused.status_code, 403)
        self.assertIn("مدرسه", str(refused.data))

    def test_the_database_panel_names_an_inconsistency_and_repair_fixes_it(self) -> None:
        from apps.attempts.models import ExamAttempt
        from apps.results.models import ExamResult

        exam = self.make_exam(self.teacher_a)
        question = self.add_question(exam)
        # A sheet that finished without ever being graded: exactly the row a student would complain about.
        attempt = ExamAttempt.objects.create(
            exam=exam, student=self.student, status=ExamAttempt.Status.SUBMITTED, attempt_number=1
        )
        answer = StudentAnswer.objects.create(attempt=attempt, question=question, answer_data={})
        answer.selected_options.set([question.options.get(is_correct=True)])

        self.authenticate(self.school_admin)
        panel = self.client.get("/api/v1/admin/database/").data
        self.assertEqual(panel["issues"]["finalized_without_result"], 1)
        self.assertEqual(panel["repairable"], 1)
        self.assertEqual({row["key"]: row["rows"] for row in panel["tables"]}["answers"], 1)
        # Reading is supervision; repairing rewrites derived rows, and that is not what this role was given.
        self.assertEqual(self.client.post("/api/v1/admin/database/repair/").status_code, 403)

        self.authenticate(self.admin)
        repaired = self.client.post("/api/v1/admin/database/repair/", format="json")
        self.assertEqual(repaired.status_code, 200)
        self.assertEqual(repaired.data["repaired"]["results"], 1)
        result = ExamResult.objects.get(attempt=attempt)
        self.assertEqual(float(result.score), 2.0, "the repair grades it, it does not invent a mark")
        self.assertEqual(self.client.get("/api/v1/admin/database/").data["issues"]["finalized_without_result"], 0)
        # Running it again changes nothing: these repairs are recomputations, not mutations.
        again = self.client.post("/api/v1/admin/database/repair/", format="json")
        self.assertEqual(again.data["repaired"]["results"], 0)

    def test_the_platform_can_end_a_stuck_sitting_and_reopen_an_archived_paper(self) -> None:
        from apps.attempts.models import ExamAttempt

        exam = self.make_exam(self.teacher_a)
        self.add_question(exam)
        live = ExamAttempt.objects.create(exam=exam, student=self.student, status=ExamAttempt.Status.IN_PROGRESS, attempt_number=1)

        self.authenticate(self.teacher_a)
        self.assertEqual(self.client.post(f"/api/v1/admin/exams/{exam.id}/actions/force-close/").status_code, 403)

        self.authenticate(self.admin)
        closed = self.client.post(f"/api/v1/admin/exams/{exam.id}/actions/force-close/", format="json")
        self.assertEqual(closed.status_code, 200, closed.data)
        live.refresh_from_db()
        self.assertEqual(live.status, ExamAttempt.Status.EXPIRED)
        self.assertEqual(closed.data["closed_attempts"], 1)

        self.assertEqual(self.client.post(f"/api/v1/admin/exams/{exam.id}/actions/archive/", format="json").status_code, 200)
        exam.refresh_from_db()
        self.assertEqual(exam.status, Exam.Status.ARCHIVED)
        self.assertEqual(self.client.post(f"/api/v1/admin/exams/{exam.id}/actions/restore/", format="json").status_code, 200)
        exam.refresh_from_db()
        self.assertNotEqual(exam.status, Exam.Status.ARCHIVED)
        self.assertEqual(self.client.post(f"/api/v1/admin/exams/{exam.id}/actions/launch/", format="json").status_code, 400)

    def test_the_platform_can_open_a_device_lock_the_teacher_set(self) -> None:
        from apps.attempts.models import ExamAttempt

        exam = self.make_exam(self.teacher_a)
        self.add_question(exam)
        exam.settings.integrity_policy = "enforce"
        exam.settings.lock_to_one_device = True
        exam.settings.save()
        attempt = ExamAttempt.objects.create(
            exam=exam,
            student=self.student,
            status=ExamAttempt.Status.IN_PROGRESS,
            attempt_number=1,
            client_session="tab-desktop",
            device_signature="a-fingerprint-that-is-not-the-phone",
        )

        self.authenticate(self.student)
        refused = self.client.post(
            f"/api/v1/student/attempts/{attempt.id}/claim-session/", HTTP_X_EXAM_SESSION="tab-phone", HTTP_USER_AGENT="Phone Safari"
        )
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.data["code"], "device_locked")

        self.authenticate(self.admin)
        self.assertEqual(self.client.post(f"/api/v1/admin/attempts/{attempt.id}/actions/unlock-device/", format="json").status_code, 200)

        self.authenticate(self.student)
        allowed = self.client.post(
            f"/api/v1/student/attempts/{attempt.id}/claim-session/", HTTP_X_EXAM_SESSION="tab-phone", HTTP_USER_AGENT="Phone Safari"
        )
        self.assertEqual(allowed.status_code, 200, allowed.data)

    def test_revoking_sessions_ends_the_refresh_token_not_the_exam(self) -> None:
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

        login = self.client.post(
            "/api/v1/auth/login/", {"email": self.teacher_a.email, "password": self.password}, format="json"
        )
        self.assertEqual(login.status_code, 200)
        refresh = login.data["refresh"]
        self.assertEqual(OutstandingToken.objects.filter(user=self.teacher_a).count(), 1)

        self.authenticate(self.school_admin)
        revoked = self.client.post(f"/api/v1/admin/users/{self.teacher_a.id}/revoke-sessions/", format="json")
        self.assertEqual(revoked.status_code, 200)
        self.assertEqual(revoked.data["revoked"], 1)
        # A refresh that was cut off cannot mint another access token: the session is over, not hidden.
        refused = self.client.post("/api/v1/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(refused.status_code, 401)

    def test_a_school_admin_cannot_revoke_a_session_outside_their_school(self) -> None:
        self.authenticate(self.school_admin)
        self.assertEqual(self.client.post(f"/api/v1/admin/users/{self.teacher_b.id}/revoke-sessions/", format="json").status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/admin/users/{self.admin.id}/revoke-sessions/", format="json").status_code, 404)


class AdminLiveAttemptsApiTests(AdminConsoleApiTests):
    """Who is writing right now — the invigilation read, scoped like every other number in the console."""

    def test_the_console_lists_open_sheets_and_only_the_console(self) -> None:
        from datetime import timedelta

        from django.utils import timezone as tz

        exam = self.make_exam(self.teacher_a)
        self.add_question(exam)
        open_attempt = ExamAttempt.objects.create(
            exam=exam,
            student=self.student,
            status=ExamAttempt.Status.IN_PROGRESS,
            attempt_number=1,
            started_at=tz.now() - timedelta(minutes=5),
            expires_at=tz.now() + timedelta(minutes=25),
            device_signature="some-browser",
        )
        ExamAttempt.objects.create(
            exam=exam,
            student=self.student,
            status=ExamAttempt.Status.SUBMITTED,
            attempt_number=2,
            submitted_at=tz.now(),
        )

        self.authenticate(self.admin)
        live = self.client.get("/api/v1/admin/attempts/")
        self.assertEqual(live.status_code, 200)
        self.assertEqual(live.data["count"], 1, "only the sheet that is open right now")
        row = live.data["attempts"][0]
        self.assertEqual(row["id"], str(open_attempt.id))
        self.assertTrue(row["device_locked"], "an administrator has to see that a device lock is in place")
        self.assertTrue(1200 <= row["remaining_seconds"] <= 1500, row["remaining_seconds"])
        self.assertEqual(self.client.get("/api/v1/admin/attempts/?status=submitted").data["count"], 1)
        self.assertEqual(self.client.get("/api/v1/admin/attempts/?status=whenever").status_code, 400)

        self.authenticate(self.teacher_a)
        self.assertEqual(self.client.get("/api/v1/admin/attempts/").status_code, 403, "a teacher has their own live board")
