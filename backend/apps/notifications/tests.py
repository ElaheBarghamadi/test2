from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.attempts.models import ExamAttempt
from apps.attempts.services import submit_attempt
from apps.exams.models import Exam, Question, QuestionOption
from apps.organizations.models import School, SchoolMembership
from apps.results.models import ExamResult
from apps.users.models import StudentProfile, User

from .models import Notification
from .services import exam_audience, notify


class NotificationAudienceTests(TestCase):
    """Who is told about an exam must be the same rule as who can see it."""

    def setUp(self) -> None:
        self.password = "A-strong-test-password-927"
        self.teacher = User.objects.create_user(email="nt@example.com", password=self.password, role=User.Role.TEACHER)
        self.school = School.objects.create(name="School of Notifications")
        self.in_school = User.objects.create_user(email="in.school@example.com", password=self.password)
        self.outside = User.objects.create_user(email="out.school@example.com", password=self.password)
        SchoolMembership.objects.create(user=self.teacher, school=self.school)
        SchoolMembership.objects.create(user=self.in_school, school=self.school)
        for student in (self.in_school, self.outside):
            StudentProfile.objects.update_or_create(user=student, defaults={"grade": "12", "class_name": "A"})

    def exam(self, **overrides) -> Exam:
        defaults = {"title": "Notification exam", "subject": "Biology", "grade": "12", "class_name": "A", "duration_minutes": 30}
        defaults.update(overrides)
        return Exam.objects.create(teacher=self.teacher, **defaults)

    def test_audience_follows_school_and_grade_class(self) -> None:
        exam = self.exam()
        ids = {student.pk for student in exam_audience(exam)}
        self.assertIn(self.in_school.pk, ids, "same school, matching grade/class")
        self.assertNotIn(self.outside.pk, ids, "a student outside the teacher's school is never told")

        # Dropping the grade/class pair widens the audience inside the school, but never past it.
        wide = self.exam(title="Whole school", grade="", class_name="")
        self.assertEqual({student.pk for student in exam_audience(wide)}, {self.in_school.pk})

        narrowed = self.exam(title="Other class", grade="12", class_name="Z")
        self.assertEqual(list(exam_audience(narrowed)), [])

    def test_notify_is_idempotent_per_event(self) -> None:
        exam = self.exam()
        students = list(exam_audience(exam))
        first = notify(students, kind=Notification.Kind.EXAM_PUBLISHED, title="t", exam=exam, body="b")
        again = notify(students, kind=Notification.Kind.EXAM_PUBLISHED, title="t", exam=exam, body="b")
        self.assertEqual(first, 1)
        self.assertEqual(again, 0, "a replayed transition must not double-notify")

    def test_publish_notifies_the_audience_once(self) -> None:
        exam = self.exam()
        question = Question.objects.create(exam=exam, type=Question.Type.MULTIPLE_CHOICE, text="Q", order=1, marks=1)
        QuestionOption.objects.create(question=question, text="a", is_correct=True, order=1)
        QuestionOption.objects.create(question=question, text="b", is_correct=False, order=2)

        client = APIClient()
        client.force_authenticate(self.teacher)
        self.assertEqual(client.post(f"/api/v1/exams/{exam.id}/publish/").status_code, 200)
        rows = Notification.objects.filter(kind=Notification.Kind.EXAM_PUBLISHED)
        self.assertEqual([row.recipient_id for row in rows], [self.in_school.pk])
        self.assertIn("Notification exam", rows[0].body)


class NotificationApiTests(TestCase):
    def setUp(self) -> None:
        self.password = "A-strong-test-password-927"
        self.student = User.objects.create_user(email="bell.student@example.com", password=self.password)
        self.other = User.objects.create_user(email="bell.other@example.com", password=self.password)
        self.client = APIClient()

    def test_list_count_and_read_flow_are_recipient_scoped(self) -> None:
        mine = Notification.objects.create(recipient=self.student, kind=Notification.Kind.RESULT_PUBLISHED, title="yours")
        theirs = Notification.objects.create(recipient=self.other, kind=Notification.Kind.RESULT_PUBLISHED, title="theirs")

        self.client.force_authenticate(self.student)
        listing = self.client.get("/api/v1/notifications/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data["unread_count"], 1)
        self.assertEqual([row["id"] for row in listing.data["results"]], [str(mine.id)])

        self.assertEqual(self.client.get("/api/v1/notifications/unread-count/").data, {"unread_count": 1})
        # Another account's row is not readable, markable, or even distinguishable.
        self.assertEqual(self.client.post(f"/api/v1/notifications/{theirs.id}/read/").status_code, 404)
        self.assertEqual(Notification.objects.get(pk=theirs.pk).is_read, False)

        self.assertEqual(self.client.post(f"/api/v1/notifications/{mine.id}/read/").status_code, 200)
        mine.refresh_from_db()
        self.assertTrue(mine.is_read)
        self.assertIsNotNone(mine.read_at)
        self.assertEqual(self.client.get("/api/v1/notifications/?unread_only=true").data["results"], [])

    def test_read_all_and_filters(self) -> None:
        for index in range(3):
            Notification.objects.create(recipient=self.student, kind=Notification.Kind.EXAM_ENDED, title=f"n{index}")
        Notification.objects.create(recipient=self.other, kind=Notification.Kind.EXAM_ENDED, title="not mine")
        self.client.force_authenticate(self.student)

        limited = self.client.get("/api/v1/notifications/?limit=2")
        self.assertEqual(len(limited.data["results"]), 2)
        self.assertEqual(limited.data["unread_count"], 3)
        self.assertEqual(self.client.get("/api/v1/notifications/?limit=0").status_code, 400)

        cleared = self.client.post("/api/v1/notifications/read-all/")
        self.assertEqual(cleared.data["updated"], 3)
        self.assertEqual(cleared.data["unread_count"], 0)
        self.assertEqual(Notification.objects.filter(recipient=self.other, is_read=False).count(), 1)

    def test_endpoints_require_a_session(self) -> None:
        self.assertEqual(self.client.get("/api/v1/notifications/").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/notifications/read-all/").status_code, 401)


class ResultNotificationFlowTests(TestCase):
    """Publication and the end of manual grading reach the student without extra polling."""

    def setUp(self) -> None:
        self.password = "A-strong-test-password-927"
        self.teacher = User.objects.create_user(email="flow.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.student = User.objects.create_user(email="flow.student@example.com", password=self.password)
        StudentProfile.objects.update_or_create(user=self.student, defaults={"grade": "", "class_name": ""})
        self.exam = Exam.objects.create(
            title="Flow exam", subject="Biology", grade="", class_name="", duration_minutes=30,
            teacher=self.teacher, status=Exam.Status.ACTIVE,
            total_marks=Decimal("2.00"),
        )
        self.exam.settings.result_visibility = "pending"
        self.exam.settings.save()
        self.written = Question.objects.create(exam=self.exam, type=Question.Type.WRITTEN, text="Explain", order=1, marks=2)

    def attempt(self) -> ExamAttempt:
        from apps.attempts.services import start_attempt

        attempt, _ = start_attempt(self.exam.pk, self.student)
        return attempt

    def test_grading_needed_then_completion_notifies_the_student(self) -> None:
        attempt = self.attempt()
        from apps.attempts.services import save_answer

        save_answer(attempt.pk, self.student, self.written, {"text": "Because of osmosis."})
        _, result = submit_attempt(attempt.pk, self.student)
        self.assertEqual(result.pending_manual_grading_count, 1)

        grading = Notification.objects.filter(kind=Notification.Kind.GRADING_REQUIRED)
        self.assertEqual([row.recipient_id for row in grading], [self.teacher.pk])

        client = APIClient()
        client.force_authenticate(self.teacher)
        graded = client.patch(
            f"/api/v1/results/teacher/attempts/{attempt.pk}/answers/{self.written.pk}/grade/",
            {"manual_score": "2.00", "feedback": "Good"},
            format="json",
        )
        self.assertEqual(graded.status_code, 200)
        completed = Notification.objects.filter(kind=Notification.Kind.GRADING_COMPLETED)
        self.assertEqual([row.recipient_id for row in completed], [self.student.pk])
        self.assertIn(f"/student/results/{attempt.pk}", completed[0].link)

        # A second edit to the same answer does not tell the student twice.
        client.patch(
            f"/api/v1/results/teacher/attempts/{attempt.pk}/answers/{self.written.pk}/grade/",
            {"manual_score": "1.50"},
            format="json",
        )
        self.assertEqual(Notification.objects.filter(kind=Notification.Kind.GRADING_COMPLETED).count(), 1)

    def test_publishing_results_notifies_students_and_not_the_teacher(self) -> None:
        attempt = self.attempt()
        from apps.attempts.services import save_answer, submit_attempt as submit

        save_answer(attempt.pk, self.student, self.written, {"text": "Answer."})
        submit(attempt.pk, self.student)
        ExamResult.objects.filter(attempt=attempt).update(pending_manual_grading_count=0, manual_grading_count=0)

        client = APIClient()
        client.force_authenticate(self.teacher)
        published = client.post(f"/api/v1/results/teacher/exams/{self.exam.pk}/publish/")
        self.assertEqual(published.data["published_count"], 1)
        rows = Notification.objects.filter(kind=Notification.Kind.RESULT_PUBLISHED)
        self.assertEqual({row.recipient_id for row in rows}, {self.student.pk})
        self.assertEqual(rows[0].exam_id, self.exam.pk)
