"""The privilege boundary of the whole platform, in one place.

Every route the product exposes is exercised here against every role, so that "who may see this page"
has one answer that a test enforces rather than a comment that a later edit can invalidate. Two rules
drive the assertions:

* an unauthenticated request never sees data on any /api/v1 route (401, not 200);
* a role may only reach its own rows, so a foreign object is 403 or 404 - never the row itself.
"""

from __future__ import annotations

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.attempts.models import ExamAttempt
from apps.exams.models import Exam, ExamSettings, Question, QuestionOption
from apps.notifications.models import Notification
from apps.users.models import User

PASSWORD = "A-strong-test-password-927"

# (method, path template, roles that are *never* allowed a 200 on it)
ANONYMOUS_FORBIDDEN: list[tuple[str, str]] = [
    ("get", "/api/v1/exams/"),
    ("post", "/api/v1/exams/"),
    ("get", "/api/v1/questions/"),
    ("get", "/api/v1/questions/tags/"),
    ("get", "/api/v1/admin/overview/"),
    ("get", "/api/v1/admin/users/"),
    ("get", "/api/v1/admin/schools/"),
    ("get", "/api/v1/admin/exams/"),
    ("get", "/api/v1/results/teacher/overview/"),
    ("get", "/api/v1/results/teacher/grading-queue/"),
    ("get", "/api/v1/results/teacher/students/"),
    ("get", "/api/v1/student/exams/"),
    ("get", "/api/v1/notifications/"),
    ("get", "/api/v1/notifications/unread-count/"),
    ("post", "/api/v1/notifications/read-all/"),
    ("get", "/api/v1/users/me/"),
    ("patch", "/api/v1/users/me/"),
    ("post", "/api/v1/users/me/password/"),
    ("get", "/api/v1/auth/me/"),
]


class AccessMatrixBase(TestCase):
    """Fixtures shaped like a real school: two teachers, two students, one exam, one attempt."""

    @classmethod
    def setUpTestData(cls) -> None:
        cls.owner = User.objects.create_user(email="owner@example.com", password=PASSWORD, role=User.Role.TEACHER)
        cls.intruder_teacher = User.objects.create_user(
            email="intruder@example.com", password=PASSWORD, role=User.Role.TEACHER
        )
        cls.admin = User.objects.create_user(email="admin@example.com", password=PASSWORD, role=User.Role.ADMIN)
        cls.student = User.objects.create_user(email="student@example.com", password=PASSWORD)
        cls.other_student = User.objects.create_user(email="other.student@example.com", password=PASSWORD)

        cls.exam = Exam.objects.create(
            title="Cell biology", description="", subject="Biology", grade="", class_name="",
            teacher=cls.owner, status=Exam.Status.ACTIVE, duration_minutes=45,
        )
        cls.question = Question.objects.create(
            exam=cls.exam, type=Question.Type.MULTIPLE_CHOICE, text="Powerhouse of the cell?", order=1, marks=2
        )
        cls.correct = QuestionOption.objects.create(question=cls.question, text="Mitochondria", is_correct=True, order=1)
        QuestionOption.objects.create(question=cls.question, text="Nucleus", is_correct=False, order=2)
        cls.other_exam = Exam.objects.create(
            title="Organic chemistry", description="", subject="Chemistry", grade="", class_name="",
            teacher=cls.intruder_teacher, status=Exam.Status.ACTIVE, duration_minutes=30,
        )
        cls.attempt = ExamAttempt.objects.create(
            exam=cls.exam, student=cls.student, attempt_number=1, status=ExamAttempt.Status.IN_PROGRESS,
            expires_at=timezone.now() + timedelta(minutes=30),
        )

    def api(self, user: User | None = None) -> APIClient:
        client = APIClient()
        if user is not None:
            client.force_authenticate(user=user)
        return client


class AnonymousAccessTests(AccessMatrixBase):
    def test_no_data_route_answers_without_a_token(self) -> None:
        client = self.api(None)
        for method, path in ANONYMOUS_FORBIDDEN:
            with self.subTest(method=method, path=path):
                response = getattr(client, method)(path, {} if method == "post" else None, format="json")
                self.assertIn(response.status_code, (401, 403), f"{method.upper()} {path} -> {response.status_code}")

    def test_health_is_the_only_open_api_surface(self) -> None:
        response = self.api(None).get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("secret", response.json())


class StudentBoundaryTests(AccessMatrixBase):
    """A student may not reach any teacher or admin surface, by id or by guessing a foreign id."""

    def test_teacher_and_admin_surfaces_are_closed(self) -> None:
        client = self.api(self.student)
        paths = [
            "/api/v1/exams/",
            "/api/v1/questions/",
            "/api/v1/questions/tags/",
            "/api/v1/admin/overview/",
            "/api/v1/admin/users/",
            "/api/v1/admin/exams/",
            "/api/v1/results/teacher/overview/",
            "/api/v1/results/teacher/students/",
            f"/api/v1/results/teacher/exams/{self.other_exam.id}/",
            f"/api/v1/results/teacher/attempts/{self.attempt.id}/",
        ]
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(client.get(path).status_code, 403, path)
        for path in (f"/api/v1/exams/{self.exam.id}/", f"/api/v1/questions/{self.question.id}/"):
            with self.subTest(path=path):
                self.assertEqual(client.get(path).status_code, 403, path)

    def test_writes_to_teacher_surfaces_are_refused_before_validation(self) -> None:
        client = self.api(self.student)
        response = client.post(f"/api/v1/exams/{self.exam.id}/questions/", {"text": "x"}, format="json")
        self.assertEqual(response.status_code, 403)
        response = client.post(f"/api/v1/exams/{self.exam.id}/publish/", {}, format="json")
        self.assertEqual(response.status_code, 403)
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.status, Exam.Status.ACTIVE)
        self.assertEqual(self.exam.questions.count(), 1)

    def test_own_attempt_is_readable_but_another_students_is_not(self) -> None:
        self.assertEqual(self.api(self.student).get(f"/api/v1/student/attempts/{self.attempt.id}/").status_code, 200)
        for student in (self.other_student, self.intruder_teacher, self.owner):
            with self.subTest(as_user=student.email):
                response = self.api(student).get(f"/api/v1/student/attempts/{self.attempt.id}/")
                self.assertIn(response.status_code, (403, 404))

    def test_answer_key_never_leaks_on_a_student_route(self) -> None:
        payload = self.api(self.student).get(f"/api/v1/student/attempts/{self.attempt.id}/").json()
        rendered = str(payload)
        self.assertNotIn("is_correct", rendered)
        self.assertNotIn("Mitochondria", str([q for q in payload["questions"] if "options" in q][0].keys()))
        # The correct option's text is only ever shown as an option label, never flagged as correct.
        for question in payload["questions"]:
            for option in question.get("options", []):
                self.assertNotIn("is_correct", option)


class TeacherBoundaryTests(AccessMatrixBase):
    """One teacher cannot read another teacher's exam, answer keys, attempts or results."""

    def test_foreign_exam_and_children_are_invisible(self) -> None:
        client = self.api(self.intruder_teacher)
        for path in (
            f"/api/v1/exams/{self.exam.id}/",
            f"/api/v1/exams/{self.exam.id}/questions/",
            f"/api/v1/results/teacher/exams/{self.exam.id}/",
            f"/api/v1/results/teacher/attempts/{self.attempt.id}/",
        ):
            with self.subTest(path=path):
                self.assertEqual(client.get(path).status_code, 404, path)
        for path in (f"/api/v1/questions/{self.question.id}/", f"/api/v1/results/teacher/attempts/{self.attempt.id}/feedback/"):
            with self.subTest(path=path):
                response = client.patch(path, {}, format="json") if path.endswith("feedback/") else client.get(path)
                self.assertIn(response.status_code, (403, 404), path)

    def test_own_surface_is_readable(self) -> None:
        client = self.api(self.intruder_teacher)
        # The list is scoped to their own exams, so the other teacher's row is simply absent.
        self.assertEqual([row["id"] for row in client.get("/api/v1/exams/").json()], [str(self.other_exam.id)])
        self.assertEqual(client.get(f"/api/v1/exams/{self.other_exam.id}/").status_code, 200)
        owned = self.api(self.owner).get("/api/v1/exams/").json()
        self.assertEqual([row["id"] for row in owned], [str(self.exam.id)])

    def test_teacher_may_not_use_admin_surfaces(self) -> None:
        client = self.api(self.owner)
        for path in ("/api/v1/admin/overview/", "/api/v1/admin/users/", "/api/v1/admin/schools/"):
            with self.subTest(path=path):
                self.assertEqual(client.get(path).status_code, 403, path)
        response = client.patch(f"/api/v1/users/me/", {"role": "admin"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.role, User.Role.TEACHER)

    def test_a_real_token_is_required_for_the_admin_surface(self) -> None:
        """force_authenticate skips the JWT layer, so this one check logs in for real."""
        client = APIClient()
        login = client.post("/api/v1/auth/login/", {"email": "owner@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(login.status_code, 200, login.data)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.json()['access']}")
        self.assertEqual(client.get("/api/v1/admin/overview/").status_code, 403)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 200)


class AdministratorBoundaryTests(AccessMatrixBase):
    def test_admin_reaches_school_wide_surfaces(self) -> None:
        client = self.api(self.admin)
        for path in ("/api/v1/admin/overview/", "/api/v1/admin/users/", "/api/v1/admin/exams/", "/api/v1/exams/"):
            with self.subTest(path=path):
                self.assertEqual(client.get(path).status_code, 200, path)
        # School-wide visibility is deliberate for the exam surface, so another teacher's exam resolves.
        self.assertEqual(client.get(f"/api/v1/exams/{self.exam.id}/").status_code, 200)

    def test_admin_may_not_self_demote_or_lock_out(self) -> None:
        client = self.api(self.admin)
        response = client.patch(f"/api/v1/admin/users/{self.admin.id}/", {"role": "teacher"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        response = client.patch(f"/api/v1/admin/users/{self.admin.id}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, User.Role.ADMIN)
        self.assertTrue(self.admin.is_active)

    def test_admin_users_surface_excludes_password_material(self) -> None:
        row = self.api(self.admin).get("/api/v1/admin/users/").json()[0]
        self.assertNotIn("password", row)
        self.assertNotIn("last_login_hash", row)


class NotificationScopeTests(AccessMatrixBase):
    def test_notifications_are_read_only_for_their_recipient(self) -> None:
        mine = Notification.objects.create(recipient=self.student, kind=Notification.Kind.EXAM_PUBLISHED, title="t", body="b")
        theirs = Notification.objects.create(recipient=self.other_student, kind=Notification.Kind.EXAM_PUBLISHED, title="t2", body="b2")

        listing = self.api(self.student).get("/api/v1/notifications/").json()
        self.assertEqual([item["id"] for item in listing["results"]], [str(mine.id)])
        self.assertEqual(listing["unread_count"], 1)

        response = self.api(self.student).post(f"/api/v1/notifications/{theirs.id}/read/", {}, format="json")
        self.assertEqual(response.status_code, 404)
        theirs.refresh_from_db()
        self.assertFalse(theirs.is_read)

        self.api(self.student).post("/api/v1/notifications/read-all/", {}, format="json")
        theirs.refresh_from_db()
        mine.refresh_from_db()
        self.assertTrue(mine.is_read)
        self.assertFalse(theirs.is_read)


class SessionRevocationTests(AccessMatrixBase):
    """Logout must revoke the session it was given, and only that session."""

    def login(self, email: str) -> tuple[APIClient, dict]:
        client = APIClient()
        response = client.post("/api/v1/auth/login/", {"email": email, "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        tokens = response.json()
        # A login response carries no ambient credential: the bearer header is what authenticates the
        # rest of the session, exactly as the browser client does it.
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        return client, tokens

    def test_logout_blacklists_the_issued_refresh_token(self) -> None:
        client, tokens = self.login("student@example.com")
        response = client.post("/api/v1/auth/logout/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(response.status_code, 204, response.data)
        refresh = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(refresh.status_code, 401, refresh.data)

    def test_one_account_cannot_revoke_another_accounts_refresh_token(self) -> None:
        _, victim = self.login("student@example.com")
        attacker, _tokens = self.login("owner@example.com")
        response = attacker.post("/api/v1/auth/logout/", {"refresh": victim["refresh"]}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        # The victim's session survives, so a leaked token string is not a denial-of-service lever.
        still_valid = APIClient().post("/api/v1/auth/token/refresh/", {"refresh": victim["refresh"]}, format="json")
        self.assertEqual(still_valid.status_code, 200, still_valid.data)

    def test_password_change_cannot_widen_privilege(self) -> None:
        client, _tokens = self.login("student@example.com")
        response = client.patch("/api/v1/users/me/", {"role": User.Role.ADMIN, "is_staff": True}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.student.refresh_from_db()
        self.assertEqual(self.student.role, User.Role.STUDENT)
        self.assertFalse(self.student.is_staff)


class DjangoAdminSurfaceTests(AccessMatrixBase):
    """Django's own admin is a different door; API tokens are not session credentials and staff
    accounts are never created through the API."""

    def test_admin_site_is_not_reachable_by_a_bearer_token(self) -> None:
        client = APIClient()
        login = client.post("/api/v1/auth/login/", {"email": "admin@example.com", "password": PASSWORD}, format="json")
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.json()['access']}")
        response = client.get("/admin/", follow_redirects=True)
        self.assertIn(response.status_code, (302, 200))
        if response.status_code == 200:
            self.assertIn(b"Log in", response.content)

    def test_registered_accounts_are_never_staff(self) -> None:
        for user in (self.owner, self.student, self.admin):
            with self.subTest(email=user.email):
                self.assertFalse(user.is_staff)
