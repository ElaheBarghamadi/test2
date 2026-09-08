import re

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from .models import StudentProfile, TeacherProfile, User


class AuthenticationApiTests(TestCase):
    password = "A-strong-test-password-927"

    def test_custom_user_model_and_student_profile_are_provisioned(self) -> None:
        user = get_user_model().objects.create_user(
            email="student@example.com",
            password=self.password,
            first_name="Sara",
        )
        self.assertIsInstance(user, User)
        self.assertEqual(user.role, User.Role.STUDENT)
        self.assertTrue(StudentProfile.objects.filter(user=user).exists())

    def test_register_login_refresh_logout_and_current_user(self) -> None:
        client = APIClient()
        register = client.post(
            "/api/v1/auth/register/",
            {
                "email": "new.student@example.com",
                "first_name": "New",
                "last_name": "Student",
                "password": self.password,
            },
            format="json",
        )
        self.assertEqual(register.status_code, 201)
        self.assertNotIn("password", register.data)
        self.assertEqual(register.data["role"], User.Role.STUDENT)
        self.assertEqual(register.data["profile"]["type"], User.Role.STUDENT)

        login = client.post(
            "/api/v1/auth/login/",
            {"email": "new.student@example.com", "password": self.password},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        self.assertIn("access", login.data)
        self.assertIn("refresh", login.data)
        self.assertEqual(login.data["user"]["email"], "new.student@example.com")

        current = client.get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        self.assertEqual(current.status_code, 200)
        self.assertEqual(current.data["email"], "new.student@example.com")
        self.assertNotIn("is_staff", current.data)

        refreshed = client.post("/api/v1/auth/token/refresh/", {"refresh": login.data["refresh"]}, format="json")
        self.assertEqual(refreshed.status_code, 200)
        self.assertIn("access", refreshed.data)

        logout = client.post(
            "/api/v1/auth/logout/",
            {"refresh": refreshed.data["refresh"]},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access']}",
        )
        self.assertEqual(logout.status_code, 204)
        rejected_refresh = client.post(
            "/api/v1/auth/token/refresh/", {"refresh": refreshed.data["refresh"]}, format="json"
        )
        self.assertEqual(rejected_refresh.status_code, 401)

    def test_registration_creates_teacher_profile_but_rejects_admin_role(self) -> None:
        client = APIClient()
        teacher_registration = client.post(
            "/api/v1/auth/register/",
            {"email": "teacher.registered@example.com", "password": self.password, "role": User.Role.TEACHER},
            format="json",
        )
        self.assertEqual(teacher_registration.status_code, 201)
        user = User.objects.get(email="teacher.registered@example.com")
        self.assertEqual(user.role, User.Role.TEACHER)
        self.assertTrue(TeacherProfile.objects.filter(user=user).exists())

        admin_registration = client.post(
            "/api/v1/auth/register/",
            {"email": "not.admin@example.com", "password": self.password, "role": User.Role.ADMIN},
            format="json",
        )
        self.assertEqual(admin_registration.status_code, 400)
        self.assertFalse(User.objects.filter(email="not.admin@example.com").exists())

    def test_authenticated_user_can_edit_only_own_structured_profile(self) -> None:
        user = User.objects.create_user(email="profile.student@example.com", password=self.password)
        client = APIClient()
        client.force_authenticate(user)

        update = client.patch(
            "/api/v1/users/me/",
            {"first_name": "Nika", "student_profile": {"grade": "12", "class_name": "12-A"}},
            format="json",
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.data["first_name"], "Nika")
        self.assertEqual(update.data["profile"]["grade"], "12")

        protected = client.patch("/api/v1/users/me/", {"role": User.Role.ADMIN}, format="json")
        self.assertEqual(protected.status_code, 400)
        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.STUDENT)

    def test_password_reset_delivery_confirmation_and_authenticated_change(self) -> None:
        user = User.objects.create_user(email="recover@example.com", password=self.password)
        client = APIClient()

        requested = client.post("/api/v1/auth/password-reset/", {"email": user.email}, format="json")
        self.assertEqual(requested.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        match = re.search(r"uid=([^&]+)&token=([^\s]+)", mail.outbox[0].body)
        self.assertIsNotNone(match)
        uid, token = match.groups()  # type: ignore[union-attr]
        confirmed = client.post(
            "/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "A-fresh-password-812"}, format="json"
        )
        self.assertEqual(confirmed.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("A-fresh-password-812"))
        # The one-time token cannot be replayed after the password changes.
        self.assertEqual(client.post("/api/v1/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": self.password}, format="json").status_code, 400)

        unknown = client.post("/api/v1/auth/password-reset/", {"email": "unknown@example.com"}, format="json")
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        client.force_authenticate(user)
        changed = client.post("/api/v1/users/me/password/", {"old_password": "A-fresh-password-812", "new_password": self.password}, format="json")
        self.assertEqual(changed.status_code, 204)
        user.refresh_from_db()
        self.assertTrue(user.check_password(self.password))
        self.assertEqual(client.post("/api/v1/users/me/password/", {"old_password": "wrong", "new_password": "Another-strong-password-912"}, format="json").status_code, 400)
