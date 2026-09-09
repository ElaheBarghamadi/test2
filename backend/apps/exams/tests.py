from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.users.models import User

from .models import Exam, ExamSettings, Question, QuestionOption


class TeacherExamApiTests(TestCase):
    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.teacher = User.objects.create_user(
            email="teacher@example.com", password=self.password, role=User.Role.TEACHER
        )
        self.other_teacher = User.objects.create_user(
            email="other.teacher@example.com", password=self.password, role=User.Role.TEACHER
        )
        self.student = User.objects.create_user(email="student@example.com", password=self.password)
        self.client = APIClient()

    def authenticate(self, user: User) -> None:
        self.client.force_authenticate(user=user)

    def create_exam(self, **overrides) -> Exam:
        defaults = {
            "title": "Biology assessment",
            "description": "Cell biology review.",
            "subject": "Biology",
            "grade": "12",
            "class_name": "12-A",
            "duration_minutes": 45,
        }
        defaults.update(overrides)
        return Exam.objects.create(teacher=self.teacher, **defaults)

    def create_exam_via_api(self, **overrides):
        payload = {
            "title": "Chemistry assessment",
            "description": "A controlled API-created exam.",
            "subject": "Chemistry",
            "grade": "11",
            "class_name": "11-B",
            "duration_minutes": 50,
            "settings": {"randomize_questions": True, "max_attempts": 2},
        }
        payload.update(overrides)
        return self.client.post("/api/v1/exams/", payload, format="json")

    def add_valid_multiple_choice(self, exam: Exam, text: str = "Which is correct?"):
        return self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {
                "type": Question.Type.MULTIPLE_CHOICE,
                "text": text,
                "marks": "2.00",
                "options": [
                    {"text": "Correct", "is_correct": True},
                    {"text": "Incorrect", "is_correct": False},
                ],
            },
            format="json",
        )

    def test_student_cannot_create_exams_or_access_teacher_answer_keys(self) -> None:
        exam = self.create_exam()
        Question.objects.create(
            exam=exam,
            type=Question.Type.MULTIPLE_CHOICE,
            text="Teacher-only content",
            order=1,
            marks=1,
        )
        self.authenticate(self.student)
        response = self.create_exam_via_api()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Exam.objects.count(), 1)
        questions = self.client.get(f"/api/v1/exams/{exam.id}/questions/")
        self.assertEqual(questions.status_code, 403)

    def test_teacher_can_create_list_and_update_own_exam_without_client_owner(self) -> None:
        self.authenticate(self.teacher)
        response = self.create_exam_via_api()
        self.assertEqual(response.status_code, 201)
        exam = Exam.objects.get(pk=response.data["id"])
        self.assertEqual(exam.teacher, self.teacher)
        self.assertEqual(exam.status, Exam.Status.DRAFT)
        self.assertEqual(exam.settings.max_attempts, 2)
        self.assertTrue(exam.settings.randomize_questions)

        listing = self.client.get("/api/v1/exams/?status=draft&ordering=title")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data[0]["question_count"], 0)

        updated = self.client.patch(
            f"/api/v1/exams/{exam.id}/",
            {"title": "Updated chemistry assessment", "settings": {"show_correct_answers": True}},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        exam.refresh_from_db()
        self.assertEqual(exam.title, "Updated chemistry assessment")
        self.assertTrue(exam.settings.show_correct_answers)

        blocked_status = self.client.patch(f"/api/v1/exams/{exam.id}/", {"status": Exam.Status.ACTIVE}, format="json")
        self.assertEqual(blocked_status.status_code, 400)
        exam.refresh_from_db()
        self.assertEqual(exam.status, Exam.Status.DRAFT)

    def test_exam_settings_accept_the_frontend_pending_visibility_value(self) -> None:
        self.authenticate(self.teacher)
        response = self.create_exam_via_api(
            settings={
                "allow_previous_questions": True,
                "randomize_questions": False,
                "result_visibility": ExamSettings.ResultVisibility.PENDING,
                "show_correct_answers": False,
                "max_attempts": 1,
            }
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["settings"]["result_visibility"], ExamSettings.ResultVisibility.PENDING)

        invalid_legacy_value = self.client.patch(
            f"/api/v1/exams/{response.data['id']}/",
            {"settings": {"result_visibility": "manual"}},
            format="json",
        )
        self.assertEqual(invalid_legacy_value.status_code, 400)

    def test_teacher_cannot_view_or_edit_another_teachers_exam(self) -> None:
        exam = self.create_exam()
        self.authenticate(self.other_teacher)
        detail = self.client.get(f"/api/v1/exams/{exam.id}/")
        self.assertEqual(detail.status_code, 404)
        update = self.client.patch(f"/api/v1/exams/{exam.id}/", {"title": "Unauthorized"}, format="json")
        self.assertEqual(update.status_code, 404)
        exam.refresh_from_db()
        self.assertEqual(exam.title, "Biology assessment")

    def test_archive_restore_and_publish_workflow(self) -> None:
        exam = self.create_exam()
        self.authenticate(self.teacher)

        invalid_publish = self.client.post(f"/api/v1/exams/{exam.id}/publish/")
        self.assertEqual(invalid_publish.status_code, 400)
        self.assertIn("questions", invalid_publish.data["detail"])

        question = self.add_valid_multiple_choice(exam)
        self.assertEqual(question.status_code, 201)
        published = self.client.post(f"/api/v1/exams/{exam.id}/publish/")
        self.assertEqual(published.status_code, 200)
        self.assertEqual(published.data["status"], Exam.Status.ACTIVE)
        self.assertEqual(published.data["total_marks"], "2.00")

        completed = self.client.post(f"/api/v1/exams/{exam.id}/complete/")
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.data["status"], Exam.Status.COMPLETED)

        archived = self.client.post(f"/api/v1/exams/{exam.id}/archive/")
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.data["status"], Exam.Status.ARCHIVED)
        restored = self.client.post(f"/api/v1/exams/{exam.id}/restore/")
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.data["status"], Exam.Status.COMPLETED)

    def test_administrator_can_access_teacher_owned_exam(self) -> None:
        exam = self.create_exam()
        administrator = User.objects.create_user(
            email="admin@example.com", password=self.password, role=User.Role.ADMIN
        )
        self.authenticate(administrator)
        response = self.client.get(f"/api/v1/exams/{exam.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], str(exam.id))

    def test_publish_future_schedule_moves_draft_to_scheduled(self) -> None:
        now = timezone.now()
        exam = self.create_exam(start_at=now + timedelta(hours=1), end_at=now + timedelta(hours=2))
        self.authenticate(self.teacher)
        self.assertEqual(self.add_valid_multiple_choice(exam).status_code, 201)
        response = self.client.post(f"/api/v1/exams/{exam.id}/publish/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], Exam.Status.SCHEDULED)

    def test_duplicate_copies_settings_questions_options_and_assigns_new_draft_owner(self) -> None:
        exam = self.create_exam()
        settings = exam.settings
        settings.randomize_questions = True
        settings.max_attempts = 3
        settings.save()
        Question.objects.create(
            exam=exam,
            type=Question.Type.MULTIPLE_CHOICE,
            text="Original question",
            order=1,
            marks=3,
        )
        question = exam.questions.get()
        QuestionOption.objects.create(question=question, text="Yes", is_correct=True, order=1)
        QuestionOption.objects.create(question=question, text="No", is_correct=False, order=2)

        self.authenticate(self.teacher)
        response = self.client.post(f"/api/v1/exams/{exam.id}/duplicate/")
        self.assertEqual(response.status_code, 201)
        copied = Exam.objects.get(pk=response.data["id"])
        self.assertNotEqual(copied.id, exam.id)
        self.assertEqual(copied.teacher, self.teacher)
        self.assertEqual(copied.status, Exam.Status.DRAFT)
        self.assertEqual(copied.settings.max_attempts, 3)
        copied_question = copied.questions.get()
        self.assertEqual(copied_question.text, "Original question")
        self.assertEqual(copied_question.options.count(), 2)
        self.assertTrue(copied_question.options.get(order=1).is_correct)

    def test_question_validation_and_reordering(self) -> None:
        exam = self.create_exam()
        self.authenticate(self.teacher)

        invalid_multiple_choice = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {
                "type": Question.Type.MULTIPLE_CHOICE,
                "text": "Broken question",
                "options": [{"text": "Only choice", "is_correct": True}],
            },
            format="json",
        )
        self.assertEqual(invalid_multiple_choice.status_code, 400)

        invalid_multiple_answer = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {
                "type": Question.Type.MULTIPLE_ANSWER,
                "text": "Another broken question",
                "options": [
                    {"text": "First", "is_correct": False},
                    {"text": "Second", "is_correct": False},
                ],
            },
            format="json",
        )
        self.assertEqual(invalid_multiple_answer.status_code, 400)

        invalid_true_false = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {
                "type": Question.Type.TRUE_FALSE,
                "text": "Broken true or false",
                "options": [
                    {"text": "True", "is_correct": True},
                    {"text": "False", "is_correct": True},
                ],
            },
            format="json",
        )
        self.assertEqual(invalid_true_false.status_code, 400)

        first = self.add_valid_multiple_choice(exam, text="First valid")
        second = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {
                "type": Question.Type.TRUE_FALSE,
                "text": "True or false?",
                "marks": "1.00",
                "options": [
                    {"text": "True", "is_correct": True},
                    {"text": "False", "is_correct": False},
                ],
            },
            format="json",
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertTrue(first.data["options"][0]["is_correct"])

        reordered = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/reorder/",
            {"question_ids": [second.data["id"], first.data["id"]]},
            format="json",
        )
        self.assertEqual(reordered.status_code, 200)
        self.assertEqual([item["id"] for item in reordered.data], [second.data["id"], first.data["id"]])
        self.assertEqual([item["order"] for item in reordered.data], [1, 2])

        bad_reorder = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/reorder/", {"question_ids": [first.data["id"]]}, format="json"
        )
        self.assertEqual(bad_reorder.status_code, 400)

    def test_short_answer_and_written_questions_use_typed_metadata(self) -> None:
        exam = self.create_exam()
        self.authenticate(self.teacher)
        short_answer = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {
                "type": Question.Type.SHORT_ANSWER,
                "text": "Name the organelle.",
                "marks": "1.50",
                "configuration": {"expected_answers": ["mitochondrion", "mitochondria"], "case_sensitive": False, "max_length": 80},
            },
            format="json",
        )
        self.assertEqual(short_answer.status_code, 201)
        self.assertEqual(short_answer.data["configuration"]["expected_answers"][0], "mitochondrion")

        written = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {
                "type": Question.Type.WRITTEN,
                "text": "Explain cellular respiration.",
                "instructions": "Use at least two sentences.",
                "marks": "5.00",
                "configuration": {"max_length": 1200, "grading_note": "Assess conceptual accuracy."},
            },
            format="json",
        )
        self.assertEqual(written.status_code, 201)
        self.assertEqual(written.data["type"], Question.Type.WRITTEN)

    def test_question_detail_requires_owner_and_supports_patch_and_delete(self) -> None:
        exam = self.create_exam()
        self.authenticate(self.teacher)
        created = self.add_valid_multiple_choice(exam)
        question_id = created.data["id"]
        updated = self.client.patch(f"/api/v1/questions/{question_id}/", {"marks": "4.00"}, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["marks"], "4.00")

        self.authenticate(self.other_teacher)
        forbidden = self.client.get(f"/api/v1/questions/{question_id}/")
        self.assertEqual(forbidden.status_code, 404)

        self.authenticate(self.teacher)
        deleted = self.client.delete(f"/api/v1/questions/{question_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(Question.objects.filter(pk=question_id).exists())
        exam.refresh_from_db()
        self.assertEqual(exam.total_marks, 0)

    def test_exam_settings_are_provisioned_for_each_exam(self) -> None:
        exam = self.create_exam()
        self.assertTrue(ExamSettings.objects.filter(exam=exam).exists())
