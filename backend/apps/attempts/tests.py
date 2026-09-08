from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.exams.models import Exam, ExamSettings, Question, QuestionOption
from apps.results.models import ExamResult
from apps.users.models import User

from .models import ExamAttempt, StudentAnswer


class StudentExamApiTests(TestCase):
    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.teacher = User.objects.create_user(
            email="teacher@example.com", password=self.password, role=User.Role.TEACHER
        )
        self.student = User.objects.create_user(email="student@example.com", password=self.password)
        self.other_student = User.objects.create_user(email="other.student@example.com", password=self.password)
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def make_exam(
        self,
        *,
        status: str = Exam.Status.ACTIVE,
        result_visibility: str = ExamSettings.ResultVisibility.IMMEDIATE,
        randomize: bool = False,
        max_attempts: int = 1,
        start_at=None,
        end_at=None,
        grade: str = "",
        class_name: str = "",
    ) -> Exam:
        exam = Exam.objects.create(
            title="Cell biology assessment",
            description="Student API test exam.",
            subject="Biology",
            grade=grade,
            class_name=class_name,
            teacher=self.teacher,
            status=status,
            duration_minutes=45,
            start_at=start_at,
            end_at=end_at,
        )
        exam.settings.randomize_questions = randomize
        exam.settings.max_attempts = max_attempts
        exam.settings.result_visibility = result_visibility
        exam.settings.save()
        return exam

    @staticmethod
    def add_choice_question(exam: Exam, question_type: str, *, marks: int = 1, correct_indexes: set[int] = {0}) -> Question:
        question = Question.objects.create(
            exam=exam,
            type=question_type,
            text=f"{question_type} question",
            order=exam.questions.count() + 1,
            marks=marks,
        )
        option_texts = ("True", "False") if question_type == Question.Type.TRUE_FALSE else ("First", "Second", "Third")
        for index, text in enumerate(option_texts):
            QuestionOption.objects.create(
                question=question,
                text=text,
                order=index + 1,
                is_correct=index in correct_indexes,
            )
        return question

    @staticmethod
    def add_short_question(exam: Exam, *, expected_answers: list[str] | None = None, marks: int = 1) -> Question:
        return Question.objects.create(
            exam=exam,
            type=Question.Type.SHORT_ANSWER,
            text="Name the organelle.",
            order=exam.questions.count() + 1,
            marks=marks,
            configuration={"expected_answers": expected_answers or ["mitochondrion"], "case_sensitive": False, "max_length": 80},
        )

    @staticmethod
    def add_written_question(exam: Exam, *, marks: int = 5) -> Question:
        return Question.objects.create(
            exam=exam,
            type=Question.Type.WRITTEN,
            text="Explain photosynthesis.",
            order=exam.questions.count() + 1,
            marks=marks,
            configuration={"max_length": 500, "grading_note": "Assess concepts."},
        )

    def start(self, exam: Exam):
        return self.client.post(f"/api/v1/student/exams/{exam.id}/start/")

    @staticmethod
    def response_keys(value: Any) -> set[str]:
        if isinstance(value, dict):
            return set(value).union(*(StudentExamApiTests.response_keys(item) for item in value.values()))
        if isinstance(value, list):
            return set().union(*(StudentExamApiTests.response_keys(item) for item in value)) if value else set()
        return set()

    def test_available_exam_dashboard_excludes_drafts_archives_and_unmatched_audiences(self) -> None:
        available = self.make_exam()
        self.add_choice_question(available, Question.Type.MULTIPLE_CHOICE)
        self.make_exam(status=Exam.Status.DRAFT)
        self.make_exam(status=Exam.Status.ARCHIVED)
        self.make_exam(grade="12")
        future = self.make_exam(
            status=Exam.Status.SCHEDULED,
            start_at=timezone.now() + timedelta(hours=1),
            end_at=timezone.now() + timedelta(hours=2),
        )
        self.add_choice_question(future, Question.Type.MULTIPLE_CHOICE)

        response = self.client.get("/api/v1/student/exams/")
        self.assertEqual(response.status_code, 200)
        by_id = {item["id"]: item for item in response.data}
        self.assertEqual(by_id[str(available.id)]["availability"], "available")
        self.assertEqual(by_id[str(future.id)]["availability"], "upcoming")
        self.assertEqual(len(response.data), 2)
        self.assertNotIn("settings", by_id[str(available.id)])
        self.assertNotIn("teacher", by_id[str(available.id)])

    def test_student_cannot_start_unavailable_archived_or_exhausted_exam(self) -> None:
        archived = self.make_exam(status=Exam.Status.ARCHIVED)
        self.add_choice_question(archived, Question.Type.MULTIPLE_CHOICE)
        self.assertEqual(self.start(archived).status_code, 400)

        exam = self.make_exam(max_attempts=1)
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        started = self.start(exam)
        attempt_id = started.data["id"]
        option = question.options.get(is_correct=True)
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(option.id)]},
            format="json",
        )
        self.assertEqual(self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/").status_code, 200)
        exhausted = self.start(exam)
        self.assertEqual(exhausted.status_code, 400)
        self.assertEqual(ExamAttempt.objects.filter(exam=exam, student=self.student).count(), 1)

    def test_start_is_idempotent_and_persists_a_stable_backend_question_order(self) -> None:
        exam = self.make_exam(randomize=True)
        first_question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        second_question = self.add_choice_question(exam, Question.Type.TRUE_FALSE)

        first_start = self.start(exam)
        second_start = self.start(exam)
        self.assertEqual(first_start.status_code, 201)
        self.assertEqual(second_start.status_code, 200)
        self.assertEqual(first_start.data["id"], second_start.data["id"])
        self.assertEqual(ExamAttempt.objects.filter(exam=exam, student=self.student).count(), 1)
        self.assertEqual(
            [question["id"] for question in first_start.data["questions"]],
            [question["id"] for question in second_start.data["questions"]],
        )
        attempt = ExamAttempt.objects.get(pk=first_start.data["id"])
        self.assertEqual(set(attempt.question_order), {str(first_question.id), str(second_question.id)})

    def test_attempt_detail_is_safe_and_other_students_or_teachers_cannot_access_it(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        self.add_short_question(exam)
        self.add_written_question(exam)
        started = self.start(exam)
        attempt_id = started.data["id"]

        detail = self.client.get(f"/api/v1/student/attempts/{attempt_id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertIn("remaining_seconds", detail.data)
        self.assertIn("server_time", detail.data)
        blocked_keys = {
            "is_correct",
            "configuration",
            "expected_answers",
            "explanation",
            "teacher",
            "show_correct_answers",
            "result_visibility",
            "max_attempts",
        }
        self.assertTrue(blocked_keys.isdisjoint(self.response_keys(detail.data)))

        self.client.force_authenticate(self.other_student)
        self.assertEqual(self.client.get(f"/api/v1/student/attempts/{attempt_id}/").status_code, 404)
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.client.get(f"/api/v1/student/attempts/{attempt_id}/").status_code, 403)

    def test_autosave_updates_one_answer_and_rejects_bad_or_foreign_options(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        other_question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        other_exam = self.make_exam()
        foreign_question = self.add_choice_question(other_exam, Question.Type.MULTIPLE_CHOICE)
        started = self.start(exam)
        attempt_id = started.data["id"]

        correct_option = question.options.get(is_correct=True)
        first = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(correct_option.id)]},
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        second_option = question.options.exclude(pk=correct_option.id).first()
        second = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(second_option.id)]},
            format="json",
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(StudentAnswer.objects.filter(attempt_id=attempt_id, question=question).count(), 1)
        self.assertEqual(second.data["selected_option_ids"], [str(second_option.id)])

        bad_option = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(other_question.options.first().id)]},
            format="json",
        )
        self.assertEqual(bad_option.status_code, 400)
        wrong_question = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{foreign_question.id}/",
            {"selected_option_ids": [str(foreign_question.options.first().id)]},
            format="json",
        )
        self.assertEqual(wrong_question.status_code, 404)

    def test_batch_autosave_is_atomic_and_flagging_is_attempt_scoped(self) -> None:
        exam = self.make_exam()
        first_question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        second_question = self.add_choice_question(exam, Question.Type.MULTIPLE_ANSWER, correct_indexes={0, 1})
        started = self.start(exam)
        attempt_id = started.data["id"]

        invalid_batch = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/",
            {
                "answers": [
                    {"question_id": str(first_question.id), "selected_option_ids": [str(first_question.options.first().id)]},
                    {"question_id": str(second_question.id), "selected_option_ids": ["00000000-0000-0000-0000-000000000000"]},
                ]
            },
            format="json",
        )
        self.assertEqual(invalid_batch.status_code, 400)
        self.assertEqual(StudentAnswer.objects.filter(attempt_id=attempt_id).count(), 0)

        batch = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/",
            {
                "answers": [
                    {"question_id": str(first_question.id), "selected_option_ids": [str(first_question.options.first().id)]},
                    {
                        "question_id": str(second_question.id),
                        "selected_option_ids": [str(second_question.options.get(order=1).id), str(second_question.options.get(order=2).id)],
                    },
                ]
            },
            format="json",
        )
        self.assertEqual(batch.status_code, 200)
        self.assertEqual(len(batch.data), 2)

        flagged = self.client.post(f"/api/v1/student/attempts/{attempt_id}/flagged-questions/{first_question.id}/")
        self.assertEqual(flagged.status_code, 200)
        self.assertTrue(flagged.data["is_flagged"])
        unflagged = self.client.delete(f"/api/v1/student/attempts/{attempt_id}/flagged-questions/{first_question.id}/")
        self.assertEqual(unflagged.status_code, 200)
        self.assertFalse(unflagged.data["is_flagged"])

    def test_expired_attempt_is_finalized_and_cannot_be_modified(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt = ExamAttempt.objects.create(
            exam=exam,
            student=self.student,
            attempt_number=1,
            status=ExamAttempt.Status.IN_PROGRESS,
            started_at=timezone.now() - timedelta(minutes=46),
            question_order=[str(question.id)],
        )
        response = self.client.patch(
            f"/api/v1/student/attempts/{attempt.id}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.first().id)]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, ExamAttempt.Status.EXPIRED)
        self.assertIsNotNone(attempt.submitted_at)
        self.assertTrue(ExamResult.objects.filter(attempt=attempt).exists())

    def test_submission_is_idempotent_and_grades_choice_true_false_and_short_answers(self) -> None:
        exam = self.make_exam()
        multiple_choice = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=2)
        multiple_answer = self.add_choice_question(exam, Question.Type.MULTIPLE_ANSWER, marks=3, correct_indexes={0, 1})
        true_false = self.add_choice_question(exam, Question.Type.TRUE_FALSE, marks=1, correct_indexes={1})
        short_answer = self.add_short_question(exam, expected_answers=["mitochondrion"], marks=1)
        started = self.start(exam)
        attempt_id = started.data["id"]

        answer_payloads = [
            (multiple_choice, {"selected_option_ids": [str(multiple_choice.options.get(order=1).id)]}),
            (multiple_answer, {"selected_option_ids": [str(multiple_answer.options.get(order=1).id), str(multiple_answer.options.get(order=2).id)]}),
            (true_false, {"selected_option_ids": [str(true_false.options.get(order=2).id)]}),
            (short_answer, {"text": "Mitochondrion"}),
        ]
        for question, payload in answer_payloads:
            response = self.client.patch(
                f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/", payload, format="json"
            )
            self.assertEqual(response.status_code, 200)

        submitted = self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.data["attempt"]["status"], ExamAttempt.Status.SUBMITTED)
        self.assertTrue(submitted.data["result_available"])
        self.assertEqual(submitted.data["result"]["score"], "7.00")
        self.assertEqual(submitted.data["result"]["percentage"], "100.00")
        self.assertEqual(submitted.data["result"]["correct_count"], 4)
        self.assertTrue(submitted.data["result"]["is_final"])
        forbidden_student_keys = {"is_correct", "configuration", "expected_answers", "explanation", "correct_option_ids"}
        self.assertTrue(forbidden_student_keys.isdisjoint(self.response_keys(submitted.data)))
        result_response = self.client.get(f"/api/v1/student/results/{attempt_id}/")
        self.assertEqual(result_response.status_code, 200)
        self.assertTrue(forbidden_student_keys.isdisjoint(self.response_keys(result_response.data)))

        repeated_submit = self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertEqual(repeated_submit.status_code, 200)
        self.assertEqual(repeated_submit.data["result"]["id"], submitted.data["result"]["id"])
        self.assertEqual(ExamResult.objects.filter(attempt_id=attempt_id).count(), 1)
        no_edit = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{multiple_choice.id}/",
            {"selected_option_ids": [str(multiple_choice.options.get(order=2).id)]},
            format="json",
        )
        self.assertEqual(no_edit.status_code, 400)

    def test_incorrect_multiple_choice_receives_zero_and_is_counted_incorrect(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=2, correct_indexes={0})
        started = self.start(exam)
        self.client.patch(
            f"/api/v1/student/attempts/{started.data['id']}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.get(order=2).id)]},
            format="json",
        )
        submitted = self.client.post(f"/api/v1/student/attempts/{started.data['id']}/submit/")
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.data["result"]["score"], "0.00")
        self.assertEqual(submitted.data["result"]["correct_count"], 0)
        self.assertEqual(submitted.data["result"]["incorrect_count"], 1)

    def test_multiple_answer_requires_exact_match_and_written_answers_remain_manual(self) -> None:
        exam = self.make_exam()
        multiple_answer = self.add_choice_question(exam, Question.Type.MULTIPLE_ANSWER, marks=3, correct_indexes={0, 1})
        written = self.add_written_question(exam, marks=5)
        started = self.start(exam)
        attempt_id = started.data["id"]
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{multiple_answer.id}/",
            {"selected_option_ids": [str(multiple_answer.options.get(order=1).id)]},
            format="json",
        )
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{written.id}/",
            {"text": "A thoughtful written answer."},
            format="json",
        )
        submitted = self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        result = submitted.data["result"]
        self.assertEqual(result["score"], "0.00")
        self.assertIsNone(result["percentage"])
        self.assertEqual(result["incorrect_count"], 1)
        self.assertEqual(result["pending_manual_grading_count"], 1)
        self.assertFalse(result["is_final"])

    def test_hidden_result_is_not_returned_or_retrievable(self) -> None:
        exam = self.make_exam(result_visibility=ExamSettings.ResultVisibility.HIDDEN)
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        started = self.start(exam)
        attempt_id = started.data["id"]
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.get(order=1).id)]},
            format="json",
        )
        submitted = self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertFalse(submitted.data["result_available"])
        self.assertNotIn("result", submitted.data)
        self.assertEqual(self.client.get(f"/api/v1/student/results/{attempt_id}/").status_code, 403)

    def test_student_cannot_submit_another_students_attempt(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        started = self.start(exam)
        self.client.force_authenticate(self.other_student)
        self.assertEqual(self.client.post(f"/api/v1/student/attempts/{started.data['id']}/submit/").status_code, 404)


class TeacherResultsApiTests(TestCase):
    """Teacher reporting/grading routes must remain ownership-scoped and never alter student safety."""

    password = "A-strong-test-password-927"

    def setUp(self) -> None:
        self.teacher = User.objects.create_user(email="results.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.other_teacher = User.objects.create_user(email="other.results.teacher@example.com", password=self.password, role=User.Role.TEACHER)
        self.student = User.objects.create_user(email="results.student@example.com", password=self.password)
        self.student_client = APIClient()
        self.student_client.force_authenticate(self.student)
        self.teacher_client = APIClient()
        self.teacher_client.force_authenticate(self.teacher)
        self.other_teacher_client = APIClient()
        self.other_teacher_client.force_authenticate(self.other_teacher)

        self.exam = Exam.objects.create(
            title="Written assessment",
            description="Manual grading test.",
            subject="Biology",
            teacher=self.teacher,
            status=Exam.Status.ACTIVE,
            duration_minutes=45,
        )
        self.exam.settings.result_visibility = ExamSettings.ResultVisibility.PENDING
        self.exam.settings.save()
        self.written = Question.objects.create(
            exam=self.exam,
            type=Question.Type.WRITTEN,
            text="Explain the process.",
            order=1,
            marks=5,
            configuration={"max_length": 500},
        )

    def finalized_attempt(self) -> ExamAttempt:
        started = self.student_client.post(f"/api/v1/student/exams/{self.exam.id}/start/")
        self.assertEqual(started.status_code, 201)
        attempt_id = started.data["id"]
        saved = self.student_client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{self.written.id}/",
            {"text": "A thoughtful answer."},
            format="json",
        )
        self.assertEqual(saved.status_code, 200)
        submitted = self.student_client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertEqual(submitted.status_code, 200)
        return ExamAttempt.objects.get(pk=attempt_id)

    def test_teacher_can_list_grade_and_publish_own_manual_result(self) -> None:
        attempt = self.finalized_attempt()
        rows = self.teacher_client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/")
        self.assertEqual(rows.status_code, 200)
        self.assertEqual(rows.data[0]["submission_status"], "needs_grading")
        self.assertEqual(rows.data[0]["pending_manual_grading_count"], 1)
        self.assertEqual(rows.data[0]["student_email"], self.student.email)

        detail = self.teacher_client.get(f"/api/v1/results/teacher/attempts/{attempt.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["answers"][0]["text"], "A thoughtful answer.")
        self.assertEqual(detail.data["answers"][0]["maximum_score"], "5.00")

        graded = self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt.id}/answers/{self.written.id}/grade/",
            {"manual_score": "4.00", "feedback": "استدلال خوب است."},
            format="json",
        )
        self.assertEqual(graded.status_code, 200)
        self.assertEqual(graded.data["answer"]["manual_score"], "4.00")
        self.assertEqual(graded.data["result"]["pending_manual_grading_count"], 0)
        self.assertEqual(graded.data["result"]["score"], "4.00")
        self.assertEqual(graded.data["result"]["percentage"], "80.00")

        saved_feedback = self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt.id}/feedback/",
            {"feedback": "بازخورد کلی آموزگار"},
            format="json",
        )
        self.assertEqual(saved_feedback.status_code, 200)
        self.assertEqual(saved_feedback.data["feedback"], "بازخورد کلی آموزگار")
        student_before_publish = self.student_client.get(f"/api/v1/student/results/{attempt.id}/")
        self.assertEqual(student_before_publish.status_code, 403)
        published = self.teacher_client.post(f"/api/v1/results/teacher/exams/{self.exam.id}/publish/")
        self.assertEqual(published.status_code, 200)
        self.assertEqual(published.data["published_count"], 1)
        student_after_publish = self.student_client.get(f"/api/v1/student/results/{attempt.id}/")
        self.assertEqual(student_after_publish.status_code, 200)
        self.assertEqual(student_after_publish.data["score"], "4.00")
        self.assertEqual(student_after_publish.data["feedback"], "بازخورد کلی آموزگار")

    def test_teacher_results_are_owner_scoped_and_aggregate_endpoints_work(self) -> None:
        attempt = self.finalized_attempt()
        self.assertEqual(
            self.other_teacher_client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/").status_code,
            404,
        )
        self.assertEqual(
            self.other_teacher_client.get(f"/api/v1/results/teacher/attempts/{attempt.id}/").status_code,
            404,
        )
        overview = self.teacher_client.get("/api/v1/results/teacher/overview/")
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.data["exam_counts"]["active"], 1)
        self.assertEqual(overview.data["participant_count"], 1)
        students = self.teacher_client.get("/api/v1/results/teacher/students/")
        self.assertEqual(students.status_code, 200)
        self.assertEqual(students.data[0]["email"], self.student.email)
        self.assertEqual(students.data[0]["needs_grading_count"], 1)

    def test_teacher_cannot_override_an_automatically_graded_short_answer(self) -> None:
        short = Question.objects.create(
            exam=self.exam,
            type=Question.Type.SHORT_ANSWER,
            text="Name the organelle.",
            order=2,
            marks=2,
            configuration={"expected_answers": ["mitochondrion"]},
        )
        started = self.student_client.post(f"/api/v1/student/exams/{self.exam.id}/start/")
        attempt_id = started.data["id"]
        self.student_client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{short.id}/",
            {"text": "mitochondrion"},
            format="json",
        )
        self.student_client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        blocked = self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt_id}/answers/{short.id}/grade/",
            {"manual_score": "0.00"},
            format="json",
        )
        self.assertEqual(blocked.status_code, 400)
