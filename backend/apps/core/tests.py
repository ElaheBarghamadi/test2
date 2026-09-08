from django.test import Client, TestCase


class HealthCheckTests(TestCase):
    def test_health_endpoint_returns_safe_liveness_payload(self) -> None:
        response = Client().get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "examora-backend"})
