from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.attempts.models import ExamAttempt
from apps.users.models import StudentProfile, User

from .models import Exam, ExamSettings, Question, QuestionOption, QuestionTag


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


class TeacherExamSchedulingAndSettingsApiTests(TeacherExamApiTests):
    """Coverage for the teaching-workflow additions: pass mark, live counts, start/extend."""

    def test_passing_percentage_round_trips_and_is_validated(self) -> None:
        self.authenticate(self.teacher)
        created = self.create_exam_via_api(settings={"passing_percentage": "60.00", "max_attempts": 2})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["settings"]["passing_percentage"], "60.00")

        exam_id = created.data["id"]
        updated = self.client.patch(
            f"/api/v1/exams/{exam_id}/",
            {"settings": {"passing_percentage": "75.50"}},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["settings"]["passing_percentage"], "75.50")

        invalid = self.client.patch(
            f"/api/v1/exams/{exam_id}/",
            {"settings": {"passing_percentage": "140"}},
            format="json",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("passing_percentage", invalid.data["detail"]["settings"])

    def test_default_passing_percentage_disables_the_pass_verdict(self) -> None:
        self.authenticate(self.teacher)
        created = self.create_exam_via_api()
        self.assertEqual(created.data["settings"]["passing_percentage"], "0.00")

    def test_duplicate_carries_the_passing_percentage(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam()
        exam.settings.passing_percentage = Decimal("45.00")
        exam.settings.save()
        self.add_valid_multiple_choice(exam)
        exam.status = Exam.Status.ACTIVE
        exam.save()

        response = self.client.post(f"/api/v1/exams/{exam.id}/duplicate/", format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["settings"]["passing_percentage"], "45.00")

    def test_teacher_exam_payload_reports_owner_name_and_participation(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam()
        self.add_valid_multiple_choice(exam)

        listed = self.client.get("/api/v1/exams/")
        self.assertEqual(listed.status_code, 200)
        row = next(item for item in listed.data if item["id"] == str(exam.id))
        self.assertEqual(row["teacher_name"], self.teacher.get_full_name())
        self.assertEqual(row["question_count"], 1)
        self.assertEqual(row["attempt_count"], 0)
        self.assertEqual(row["participant_count"], 0)

        detail = self.client.get(f"/api/v1/exams/{exam.id}/")
        self.assertEqual(detail.data["teacher_name"], self.teacher.get_full_name())
        self.assertEqual(detail.data["question_count"], 1)
        self.assertEqual(detail.data["participant_count"], 0)

    def test_start_action_opens_a_scheduled_exam_early(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam(start_at=timezone.now() + timedelta(days=1))
        self.add_valid_multiple_choice(exam)
        exam.status = Exam.Status.SCHEDULED
        exam.start_at = timezone.now() + timedelta(days=1)
        exam.save()

        response = self.client.post(f"/api/v1/exams/{exam.id}/start/", format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], Exam.Status.ACTIVE)

        exam.refresh_from_db()
        self.assertEqual(exam.status, Exam.Status.ACTIVE)
        self.assertLessEqual(exam.start_at, timezone.now())

    def test_start_action_rejects_an_exam_without_questions(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam()
        response = self.client.post(f"/api/v1/exams/{exam.id}/start/", format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("questions", response.data["detail"])

    def test_extend_action_widens_time_only_for_active_exams(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam(duration_minutes=45)
        draft = self.client.post(f"/api/v1/exams/{exam.id}/extend/", {"extra_minutes": 15}, format="json")
        self.assertEqual(draft.status_code, 400)

        exam.status = Exam.Status.ACTIVE
        exam.end_at = timezone.now() + timedelta(minutes=60)
        exam.save()
        original_end = exam.end_at

        extended = self.client.post(f"/api/v1/exams/{exam.id}/extend/", {"extra_minutes": 15}, format="json")
        self.assertEqual(extended.status_code, 200)
        exam.refresh_from_db()
        self.assertEqual(exam.duration_minutes, 60)
        self.assertGreater(exam.end_at, original_end)

        invalid = self.client.post(f"/api/v1/exams/{exam.id}/extend/", {"extra_minutes": 0}, format="json")
        self.assertEqual(invalid.status_code, 400)


class QuestionOptionIdentityApiTests(TeacherExamApiTests):
    """Option primary keys are referenced by saved student answers, so edits must not churn them."""

    def test_option_ids_survive_a_renumbering_edit(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam()
        created = self.add_valid_multiple_choice(exam)
        original = {option["id"]: option["text"] for option in created.data["options"]}

        reordered = self.client.patch(
            f"/api/v1/questions/{created.data['id']}/",
            {
                "options": [
                    {"id": list(original)[1], "text": "Incorrect", "is_correct": False},
                    {"id": list(original)[0], "text": "Still correct", "is_correct": True},
                ]
            },
            format="json",
        )
        self.assertEqual(reordered.status_code, 200)
        self.assertEqual([option["text"] for option in reordered.data["options"]], ["Incorrect", "Still correct"])
        self.assertEqual({option["id"] for option in reordered.data["options"]}, set(original))
        self.assertTrue(reordered.data["options"][1]["is_correct"])

    def test_new_options_are_created_and_unanswered_ones_removed(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam()
        created = self.add_valid_multiple_choice(exam)
        keep = created.data["options"][0]["id"]

        updated = self.client.patch(
            f"/api/v1/questions/{created.data['id']}/",
            {
                "options": [
                    {"id": str(keep), "text": "Correct", "is_correct": True},
                    {"text": "Rejected", "is_correct": False},
                    {"text": "Also incorrect", "is_correct": False},
                ]
            },
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(len(updated.data["options"]), 3)
        self.assertEqual(updated.data["options"][0]["id"], str(keep))
        self.assertEqual(QuestionOption.objects.filter(question_id=created.data["id"]).count(), 3)

    def test_option_selected_by_a_student_answer_cannot_be_removed(self) -> None:
        from apps.attempts.models import ExamAttempt, StudentAnswer

        self.authenticate(self.teacher)
        exam = self.create_exam()
        exam.status = Exam.Status.ACTIVE
        exam.save()
        created = self.add_valid_multiple_choice(exam)
        question = Question.objects.get(pk=created.data["id"])
        correct, incorrect = question.options.order_by("order")

        attempt = ExamAttempt.objects.create(exam=exam, student=self.student, status=ExamAttempt.Status.SUBMITTED)
        answer = StudentAnswer.objects.create(attempt=attempt, question=question, answer_data={})
        answer.selected_options.add(incorrect)

        blocked = self.client.patch(
            f"/api/v1/questions/{question.id}/",
            {"options": [{"id": str(correct.id), "text": "Correct", "is_correct": True}]},
            format="json",
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("options", blocked.data["detail"])
        self.assertEqual(QuestionOption.objects.filter(question=question).count(), 2)

    def test_stale_option_id_is_rejected_with_a_recoverable_message(self) -> None:
        self.authenticate(self.teacher)
        exam = self.create_exam()
        created = self.add_valid_multiple_choice(exam)
        stale = self.client.patch(
            f"/api/v1/questions/{created.data['id']}/",
            {
                "options": [
                    {"id": "11111111-1111-1111-1111-111111111111", "text": "Correct", "is_correct": True},
                    {"text": "Incorrect", "is_correct": False},
                ]
            },
            format="json",
        )
        self.assertEqual(stale.status_code, 400)
        self.assertIn("options", stale.data["detail"])


class ExamLifecycleIntegrityTests(TestCase):
    """Ending, extending and expiring an exam must not move the goalposts under a student."""

    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.teacher = User.objects.create_user(email="lifecycle.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.student = User.objects.create_user(email="lifecycle.student@example.com", password=self.password)
        self.client = APIClient()

    def authenticate(self, user: User) -> None:
        self.client.force_authenticate(user=user)

    def make_exam(self, **overrides) -> Exam:
        defaults = {"title": "Lifecycle exam", "subject": "Biology", "duration_minutes": 30}
        defaults.update(overrides)
        exam = Exam.objects.create(teacher=self.teacher, **defaults)
        exam.settings.randomize_questions = False
        exam.settings.save()
        return exam

    def add_question(self, exam: Exam, *, marks: int = 2) -> Question:
        question = Question.objects.create(exam=exam, type=Question.Type.MULTIPLE_CHOICE, text="Pick one", order=1, marks=marks)
        QuestionOption.objects.create(question=question, text="Right", is_correct=True, order=1)
        QuestionOption.objects.create(question=question, text="Wrong", is_correct=False, order=2)
        return question

    def start_attempt(self, exam: Exam):
        self.authenticate(self.student)
        return self.client.post(f"/api/v1/student/exams/{exam.id}/start/")

    def test_duration_edit_does_not_recut_a_running_attempt(self) -> None:
        """A teacher shortening the exam for later groups must not steal minutes mid-answer."""
        exam = self.make_exam()
        self.add_question(exam)
        self.authenticate(self.teacher)
        self.assertEqual(self.client.post(f"/api/v1/exams/{exam.id}/publish/").status_code, 200)
        attempt = self.start_attempt(exam).data
        before = self.client.get(f"/api/v1/student/attempts/{attempt['id']}/", HTTP_AUTHORIZATION="x").data["remaining_seconds"] if False else None
        self.authenticate(self.student)
        before = self.client.get(f"/api/v1/student/attempts/{attempt['id']}/").data["remaining_seconds"]

        self.authenticate(self.teacher)
        self.assertEqual(self.client.patch(f"/api/v1/exams/{exam.id}/", {"duration_minutes": 5}, format="json").status_code, 200)

        self.authenticate(self.student)
        after = self.client.get(f"/api/v1/student/attempts/{attempt['id']}/").data["remaining_seconds"]
        self.assertGreater(after, before - 10, "the running session kept its window")
        self.assertGreater(attempt and ExamAttempt.objects.get(pk=attempt["id"]).expires_at - ExamAttempt.objects.get(pk=attempt["id"]).started_at, timedelta(minutes=29))

    def test_extending_time_widens_open_attempts_only(self) -> None:
        exam = self.make_exam()
        self.add_question(exam)
        self.authenticate(self.teacher)
        self.client.post(f"/api/v1/exams/{exam.id}/publish/")
        attempt_id = self.start_attempt(exam).data["id"]
        # Twenty-five of the thirty minutes are gone. The deadline is a snapshot, so the test moves it
        # the same way a running clock would.
        ExamAttempt.objects.filter(pk=attempt_id).update(
            started_at=timezone.now() - timedelta(minutes=25),
            expires_at=timezone.now() + timedelta(minutes=5),
        )
        self.authenticate(self.student)
        remaining = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["remaining_seconds"]
        self.assertLess(remaining, 6 * 60)

        self.authenticate(self.teacher)
        extended = self.client.post(f"/api/v1/exams/{exam.id}/extend/", {"extra_minutes": 20}, format="json")
        self.assertEqual(extended.status_code, 200)
        self.assertEqual(extended.data["duration_minutes"], 50)

        self.authenticate(self.student)
        widened = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["remaining_seconds"]
        self.assertGreater(widened, remaining + 19 * 60 - 5)

        # A second student who has not started yet gets the new duration; nobody's history moves.
        other = User.objects.create_user(email="late.student@example.com", password=self.password)
        self.authenticate(other)
        later = self.client.post(f"/api/v1/student/exams/{exam.id}/start/").data
        self.assertGreater(later["remaining_seconds"], 49 * 60)

    def test_completing_an_exam_finalizes_open_attempts_and_grades_saved_work(self) -> None:
        from apps.results.models import ExamResult

        exam = self.make_exam()
        question = self.add_question(exam)
        self.authenticate(self.teacher)
        self.client.post(f"/api/v1/exams/{exam.id}/publish/")
        attempt_id = self.start_attempt(exam).data["id"]
        self.authenticate(self.student)
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.get(order=1).id)]},
            format="json",
        )

        self.authenticate(self.teacher)
        self.assertEqual(self.client.post(f"/api/v1/exams/{exam.id}/complete/").status_code, 200)

        attempt = ExamAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.status, ExamAttempt.Status.EXPIRED)
        self.assertIsNotNone(attempt.submitted_at)
        result = ExamResult.objects.get(attempt=attempt)
        self.assertEqual(result.score, Decimal("2.00"))
        # Writing after the teacher closed the exam is refused rather than silently accepted.
        self.authenticate(self.student)
        refused = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.get(order=2).id)]},
            format="json",
        )
        self.assertEqual(refused.status_code, 409)

    def test_archiving_closes_open_attempts(self) -> None:
        exam = self.make_exam()
        self.add_question(exam)
        self.authenticate(self.teacher)
        self.client.post(f"/api/v1/exams/{exam.id}/publish/")
        attempt_id = self.start_attempt(exam).data["id"]
        self.authenticate(self.teacher)
        self.assertEqual(self.client.post(f"/api/v1/exams/{exam.id}/archive/").status_code, 200)
        self.assertEqual(ExamAttempt.objects.get(pk=attempt_id).status, ExamAttempt.Status.EXPIRED)

    def test_overdue_exam_is_closed_lazily_on_read(self) -> None:
        """No scheduler: the list read reconciles an exam whose window already closed."""
        exam = self.make_exam(status=Exam.Status.ACTIVE, start_at=timezone.now() - timedelta(hours=2), end_at=timezone.now() - timedelta(minutes=5))
        self.add_question(exam)
        self.authenticate(self.teacher)
        rows = self.client.get("/api/v1/exams/").data
        self.assertEqual(Exam.objects.get(pk=exam.id).status, Exam.Status.COMPLETED)
        self.assertEqual(next(row for row in rows if row["id"] == str(exam.id))["status"], "completed")

    def test_result_keeps_the_maximum_it_was_graded_against(self) -> None:
        exam = self.make_exam()
        exam.settings.result_visibility = ExamSettings.ResultVisibility.IMMEDIATE
        exam.settings.save()
        question = self.add_question(exam, marks=2)
        self.authenticate(self.teacher)
        self.client.post(f"/api/v1/exams/{exam.id}/publish/")
        attempt_id = self.start_attempt(exam).data["id"]
        self.authenticate(self.student)
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.get(order=1).id)]},
            format="json",
        )
        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")

        # The teacher re-weights the exam afterwards; the graded snapshot must not drift.
        self.authenticate(self.teacher)
        self.client.patch(f"/api/v1/questions/{question.id}/", {"marks": 10}, format="json")

        self.authenticate(self.student)
        result = self.client.get(f"/api/v1/student/results/{attempt_id}/").data
        self.assertEqual(result["maximum_score"], 2.0)
        self.assertEqual(result["percentage"], "100.00")

    def test_published_result_survives_later_manual_grading(self) -> None:
        from apps.attempts.models import ExamAttempt as Attempt
        from apps.results.models import ExamResult

        exam = self.make_exam()
        self.add_question(exam)
        exam.settings.result_visibility = ExamSettings.ResultVisibility.PENDING
        exam.settings.save()
        attempt = Attempt.objects.create(
            exam=exam, student=self.student, attempt_number=1,
            status=Attempt.Status.SUBMITTED, started_at=timezone.now(), submitted_at=timezone.now(),
        )
        result = ExamResult.objects.create(attempt=attempt, status=ExamResult.Status.PUBLISHED, score=Decimal("1.00"), maximum_score=Decimal("2.00"), published_at=timezone.now())

        from apps.attempts.services import _grade_attempt

        _grade_attempt(attempt, finalized_at=timezone.now())
        result.refresh_from_db()
        self.assertEqual(result.status, ExamResult.Status.PUBLISHED, "regrading must not un-publish a result a student has seen")
        self.assertIsNotNone(result.published_at)


class QuestionBankApiTests(TestCase):
    """The bank is a search-and-copy surface; it must never move a question out from under an exam."""

    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.teacher = User.objects.create_user(email="bank.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.other_teacher = User.objects.create_user(email="rival.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)

    def make_exam(self, owner: User | None = None, **overrides) -> Exam:
        defaults = {"title": "Source exam", "subject": "Physics", "duration_minutes": 45, "status": Exam.Status.DRAFT}
        defaults.update(overrides)
        return Exam.objects.create(teacher=owner or self.teacher, **defaults)

    def add_question(self, exam: Exam, text: str, *, order: int = 1, difficulty: str = Question.Difficulty.MEDIUM, tags: list[str] | None = None) -> Question:
        question = Question.objects.create(exam=exam, type=Question.Type.MULTIPLE_CHOICE, text=text, order=order, marks=2, difficulty=difficulty)
        QuestionOption.objects.create(question=question, text="Right", is_correct=True, order=1)
        QuestionOption.objects.create(question=question, text="Wrong", is_correct=False, order=2)
        if tags:
            for name in tags:
                tag, _ = QuestionTag.objects.get_or_create(teacher=exam.teacher, name=name)
                question.tags.add(tag)
        return question

    def test_bank_search_filters_by_text_type_difficulty_and_tag(self) -> None:
        exam = self.make_exam()
        self.add_question(exam, "About forces", difficulty=Question.Difficulty.HARD, tags=["mechanics"])
        self.add_question(exam, "About waves", order=2, tags=["optics"])

        rows = self.client.get("/api/v1/questions/").data
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["difficulty"] for row in rows}, {"hard", "medium"})
        self.assertTrue(all(isinstance(row["id"], str) for row in rows), "ids stay strings on the wire")
        self.assertEqual(len(self.client.get("/api/v1/questions/?search=forces").data), 1)
        self.assertEqual(len(self.client.get("/api/v1/questions/?difficulty=hard").data), 1)
        self.assertEqual(len(self.client.get("/api/v1/questions/?type=written").data), 0)
        self.assertEqual(len(self.client.get("/api/v1/questions/?tag=Optics").data), 1)
        self.assertEqual(len(self.client.get("/api/v1/questions/?subject=chemistry").data), 0)

        tags = self.client.get("/api/v1/questions/tags/").data
        self.assertEqual({tag["name"] for tag in tags}, {"mechanics", "optics"})
        self.assertTrue(all(tag["count"] == 1 for tag in tags))

    def test_bank_list_is_scoped_to_the_teacher_and_admin_sees_everything(self) -> None:
        mine = self.make_exam()
        self.add_question(mine, "Mine")
        theirs = self.make_exam(owner=self.other_teacher)
        self.add_question(theirs, "Theirs")

        self.assertEqual({row["text"] for row in self.client.get("/api/v1/questions/").data}, {"Mine"})
        admin = User.objects.create_user(email="bank.admin@example.com", password=self.password, role=User.Role.ADMIN)
        self.client.force_authenticate(user=admin)
        self.assertEqual({row["text"] for row in self.client.get("/api/v1/questions/").data}, {"Mine", "Theirs"})

    def test_invalid_bank_filters_are_rejected_not_ignored(self) -> None:
        response = self.client.get("/api/v1/questions/?difficulty=impossible")
        self.assertEqual(response.status_code, 400)
        self.assertIn("difficulty", response.data["detail"])

    def test_import_copies_questions_and_never_moves_the_source(self) -> None:
        source_exam = self.make_exam()
        source = self.add_question(source_exam, "Newton's second law", tags=["mechanics"])
        target = self.make_exam(title="Target exam")

        response = self.client.post(f"/api/v1/exams/{target.id}/questions/import/", {"question_ids": [str(source.id)]}, format="json")
        self.assertEqual(response.status_code, 201)
        imported = response.data[0]
        self.assertNotEqual(imported["id"], str(source.id))
        self.assertEqual(imported["text"], "Newton's second law")
        self.assertEqual(len(imported["options"]), 2)
        self.assertEqual({option["text"] for option in imported["options"]}, {"Right", "Wrong"})
        self.assertEqual([tag["name"] for tag in imported["tags"]], ["mechanics"])
        self.assertEqual(str(imported["copied_from"]), str(source.id))
        self.assertEqual(imported["order"], 1)

        # The source exam keeps exactly what it had; the copy is what the new exam now grades.
        self.assertEqual(list(source_exam.questions.values_list("id", flat=True)), [source.id])
        self.assertEqual(Question.objects.filter(copied_from=source).count(), 1)
        target.refresh_from_db()
        self.assertEqual(target.total_marks, Decimal("2.00"))

    def test_import_appends_in_the_selected_order_and_reports_usage(self) -> None:
        exam = self.make_exam()
        first = self.add_question(exam, "First", order=1)
        second = self.add_question(exam, "Second", order=2)
        target = self.make_exam(title="Target")

        response = self.client.post(f"/api/v1/exams/{target.id}/questions/import/", {"question_ids": [str(second.id), str(first.id)]}, format="json")
        self.assertEqual([row["text"] for row in response.data], ["Second", "First"])
        self.assertEqual([row["order"] for row in response.data], [1, 2])

        bank = self.client.get("/api/v1/questions/").data
        counts = {row["text"]: row["usage_count"] for row in bank if str(row["exam"]) == str(exam.id)}
        self.assertEqual(counts, {"First": 1, "Second": 1}, bank)

    def test_import_rejects_foreign_and_missing_questions(self) -> None:
        theirs = self.make_exam(owner=self.other_teacher)
        foreign = self.add_question(theirs, "Not yours")
        response = self.client.post(f"/api/v1/exams/{self.make_exam(title='T').id}/questions/import/", {"question_ids": [str(foreign.id)]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("question_ids", response.data["detail"])

        target = self.make_exam(title="T2")
        missing = self.client.post(f"/api/v1/exams/{target.id}/questions/import/", {"question_ids": ["11111111-1111-1111-1111-111111111111"]}, format="json")
        self.assertEqual(missing.status_code, 400)

    def test_archiving_a_question_hides_it_from_the_bank_without_touching_the_exam(self) -> None:
        exam = self.make_exam(status=Exam.Status.ACTIVE)
        question = self.add_question(exam, "Retire me")

        archived = self.client.post(f"/api/v1/questions/{question.id}/archive/", {"action": "archive"}, format="json")
        self.assertEqual(archived.status_code, 200)
        self.assertTrue(archived.data["is_archived"])
        self.assertEqual(len(self.client.get("/api/v1/questions/").data), 0)
        self.assertEqual(len(self.client.get("/api/v1/questions/?archived=true").data), 1)
        # The live exam still lists it: archiving is a bank concern, not a content change.
        self.assertEqual([row["id"] for row in self.client.get(f"/api/v1/exams/{exam.id}/questions/").data], [str(question.id)])
        self.assertEqual(self.client.post(f"/api/v1/questions/{question.id}/archive/", {"action": "delete"}, format="json").status_code, 400)

    def test_difficulty_and_tags_round_trip_through_the_write_serializer(self) -> None:
        exam = self.make_exam()
        response = self.client.post(
            f"/api/v1/exams/{exam.id}/questions/",
            {"type": Question.Type.MULTIPLE_CHOICE, "text": "Tagged", "marks": 1, "difficulty": "hard", "tags": ["Mechanics", "mechanics", "  "], "options": [{"text": "a", "is_correct": True}, {"text": "b", "is_correct": False}]},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["difficulty"], "hard")
        self.assertEqual([tag["name"] for tag in response.data["tags"]], ["Mechanics"], "tags are deduplicated case-insensitively and blanks dropped")
        self.assertEqual(len(self.client.get("/api/v1/questions/?tag=mechanics").data), 1)

        cleared = self.client.patch(f"/api/v1/questions/{response.data['id']}/", {"tags": []}, format="json")
        self.assertEqual(cleared.data["tags"], [])


class ExamListCounterAccuracyTests(TeacherExamApiTests):
    """The list rows must agree with the detail rows no matter how many attempts exist."""

    def test_question_and_attempt_counts_do_not_multiply_each_other(self) -> None:
        from apps.attempts.models import ExamAttempt

        exam = self.create_exam()
        for order in (1, 2, 3):
            question = Question.objects.create(exam=exam, type="multiple_choice", text=f"Q{order}", order=order, marks=1)
            QuestionOption.objects.create(question=question, text="yes", is_correct=True, order=1)
            QuestionOption.objects.create(question=question, text="no", is_correct=False, order=2)
        students = [
            User.objects.create_user(email=f"counter.{index}@example.com", password=self.password) for index in range(4)
        ]
        for index, student in enumerate(students):
            ExamAttempt.objects.create(exam=exam, student=student, attempt_number=1, status=ExamAttempt.Status.IN_PROGRESS)

        self.authenticate(self.teacher)
        row = next(item for item in self.client.get("/api/v1/exams/").data if item["id"] == str(exam.id))
        detail = self.client.get(f"/api/v1/exams/{exam.id}/").data
        self.assertEqual(row["question_count"], 3)
        self.assertEqual(row["attempt_count"], 4)
        self.assertEqual(row["participant_count"], 4)
        self.assertEqual(row["question_count"], detail["question_count"])
        self.assertEqual(row["attempt_count"], detail["attempt_count"])
