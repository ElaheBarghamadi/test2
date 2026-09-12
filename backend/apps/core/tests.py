from django.test import Client, TestCase


class HealthCheckTests(TestCase):
    def test_health_endpoint_returns_safe_liveness_payload(self) -> None:
        response = Client().get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "examora-backend"})


class ConditionalApiGetTests(TestCase):
    """The validator contract behind the frontend's `must-revalidate`: cheap rechecks, no cross-user hints."""

    password = "A-strong-test-password-927"

    def token_for(self, email: str) -> str:
        from apps.users.models import User

        User.objects.create_user(email=email, password=self.password, role=User.Role.TEACHER)
        client = Client()
        response = client.post(
            "/api/v1/auth/login/", {"email": email, "password": self.password}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 200, response.content[:200])
        return response.json()["access"]

    def get_exams(self, token: str, **extra):
        return Client().get("/api/v1/exams/", HTTP_AUTHORIZATION=f"Bearer {token}", **extra)

    def test_a_read_carries_a_validator_and_revalidation_answers_without_a_body(self) -> None:
        token = self.token_for("etag.teacher@example.com")
        first = self.get_exams(token)
        self.assertEqual(first.status_code, 200)
        etag = first.headers["ETag"]
        self.assertTrue(etag.startswith('W/"'), "the validator is weak: it vouches for equivalence, not bytes")
        self.assertEqual(first.headers["Cache-Control"], "private, max-age=0, must-revalidate")
        self.assertIn("Authorization", first.headers["Vary"])

        again = self.get_exams(token, HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(again.status_code, 304)
        self.assertEqual(again.content, b"", "a 304 that ships a body would be the worst of both")
        self.assertEqual(again.headers["ETag"], etag)

    def test_a_write_moves_the_validator(self) -> None:
        token = self.token_for("write.teacher@example.com")
        before = self.get_exams(token).headers["ETag"]
        created = Client().post(
            "/api/v1/exams/",
            {"title": "Cached paper", "subject": "Biology", "duration_minutes": 30},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(created.status_code, 201, created.content[:300])
        after = self.get_exams(token)
        self.assertEqual(after.status_code, 200, "the list changed, so a 304 would be a lie")
        self.assertNotEqual(after.headers["ETag"], before)

    def test_one_teachers_validator_says_nothing_about_anotherones(self) -> None:
        """Both lists are empty and byte-identical; the salts must still differ.

        Without a per-user salt, an attacker who could get a browser to send `If-None-Match` of their own
        choosing could test one fact at a time about somebody else's payload — "is this exactly what the empty
        list hashes to" is a question worth 1 bit per try, and an exam platform should not be selling bits.
        """
        first = self.get_exams(self.token_for("quiet.one@example.com"))
        second = self.get_exams(self.token_for("quiet.two@example.com"))
        self.assertEqual(first.content, second.content)
        self.assertNotEqual(first.headers["ETag"], second.headers["ETag"])

    def test_a_failure_is_not_made_cacheable(self) -> None:
        token = self.token_for("missing.teacher@example.com")
        response = self.get_exams(token, HTTP_ACCEPT="application/json")
        import uuid

        missing = Client().get(
            f"/api/v1/exams/{uuid.uuid4()}/", HTTP_AUTHORIZATION=f"Bearer {token}", content_type="application/json"
        )
        self.assertEqual(missing.status_code, 404)
        self.assertNotIn("ETag", missing.headers)
        self.assertEqual(response.status_code, 200)
