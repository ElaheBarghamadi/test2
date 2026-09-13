from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.exams.models import Exam, ExamSettings, Question, QuestionOption
from apps.results.models import ExamResult
from apps.users.models import StudentProfile, User

from .models import AttemptEvent, ExamAttempt, StudentAnswer


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

    def start(self, exam: Exam, *, session: str = ""):
        headers = {"HTTP_X_EXAM_SESSION": session} if session else {}
        return self.client.post(f"/api/v1/student/exams/{exam.id}/start/", **headers)

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
        # The dashboard names the teacher (a student sees that on paper too) but exposes no teacher
        # primary key, no settings object, and nothing else that could be probed with.
        self.assertEqual(by_id[str(available.id)]["teacher_name"], self.teacher.get_full_name())

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
            "max_attempts",
        }
        self.assertTrue(blocked_keys.isdisjoint(self.response_keys(detail.data)))
        # ``result_visibility`` is deliberately allowed: a student has to know when their own result
        # appears, and the same value is already public on the dashboard listing for this exam.
        self.assertEqual(detail.data["exam"]["result_visibility"], ExamSettings.ResultVisibility.IMMEDIATE)
        self.assertEqual(detail.data["exam"]["question_count"], 3)

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
        # A write to a session that has already been finalized is a conflict, not a validation error,
        # so clients can branch on the code instead of parsing a message.
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "attempt_finalized")
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
        self.assertEqual(no_edit.status_code, 409)
        self.assertEqual(no_edit.data["code"], "attempt_finalized")

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

    def test_teacher_can_override_an_automatically_graded_short_answer(self) -> None:
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
        # The key is a guess about the answer; the teacher's number is the decision, and it is allowed on a
        # keyed question too. `manual_score: null` hands the question back to the key.
        override = self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt_id}/answers/{short.id}/grade/",
            {"manual_score": "0.00", "feedback": "Correct idea, but the wording names the wrong organelle."},
            format="json",
        )
        self.assertEqual(override.status_code, 200)
        answer = override.data["answer"]
        self.assertEqual((answer["awarded_score"], answer["auto_awarded_score"]), ("0.00", "2.00"))
        self.assertTrue(answer["is_overridden"])
        self.assertEqual(answer["verdict"], "manual")
        # The published number follows the pen: the short answer's 2 marks are gone, and the written
        # question was left blank, so the sheet is worth nothing.
        self.assertEqual(override.data["result"]["score"], "0.00")
        # The key's tally is untouched: the answer was right, the teacher simply decided it was worth nothing.
        # Only the marks move, so "۱ پاسخ درست" and "۰ از ۲" can be true at the same time.
        self.assertEqual(override.data["result"]["correct_count"], 1)
        self.assertEqual(override.data["result"]["incorrect_count"], 0)

        cleared = self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt_id}/answers/{short.id}/grade/",
            {"manual_score": None},
            format="json",
        )
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.data["answer"]["awarded_score"], "2.00")
        self.assertEqual(cleared.data["result"]["score"], "2.00")
        self.assertEqual(cleared.data["result"]["correct_count"], 1)
        self.assertFalse(cleared.data["answer"]["is_overridden"])
        self.assertEqual(cleared.data["answer"]["verdict"], "correct")
        # The note survives an undone mark - they are two separate things the teacher wrote.
        self.assertTrue(cleared.data["answer"]["feedback"].startswith("Correct idea"))

        # A note alone is a valid write, and it must not move the number.
        noted = self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt_id}/answers/{short.id}/grade/",
            {"feedback": "Well explained."},
            format="json",
        )
        self.assertEqual(noted.data["answer"]["awarded_score"], "2.00")
        self.assertEqual(noted.data["answer"]["feedback"], "Well explained.")

        # A mark above the question's worth is still refused.
        too_much = self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt_id}/answers/{short.id}/grade/",
            {"manual_score": "9.00"},
            format="json",
        )
        self.assertEqual(too_much.status_code, 400)


class StudentExamConductingApiTests(StudentExamApiTests):
    """Dashboard progress, resumable timing, and the published pass verdict."""

    def test_available_and_attempt_payloads_carry_the_pass_mark(self) -> None:
        """The student must be able to see the pass mark before and during the exam, not only after."""
        exam = self.make_exam(result_visibility=ExamSettings.ResultVisibility.PENDING)
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=2)
        exam.total_marks = Decimal("2.00")
        exam.save()
        exam.settings.passing_percentage = Decimal("60.00")
        exam.settings.show_correct_answers = True
        exam.settings.save()

        item = next(entry for entry in self.client.get("/api/v1/student/exams/").data if entry["id"] == str(exam.id))
        self.assertEqual(item["passing_percentage"], 60.0)
        self.assertEqual(item["result_visibility"], "pending")
        self.assertNotIn("show_correct_answers", item)

        attempt_id = self.start(exam).data["id"]
        detail = self.client.get(f"/api/v1/student/attempts/{attempt_id}/")
        self.assertEqual(detail.data["exam"]["passing_percentage"], 60.0)
        self.assertEqual(detail.data["exam"]["total_marks"], 2.0)
        self.assertEqual(detail.data["exam"]["question_count"], 1)

    def test_dashboard_reports_progress_limits_and_live_remaining_time(self) -> None:
        exam = self.make_exam(max_attempts=2)
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=2)
        self.add_choice_question(exam, Question.Type.TRUE_FALSE, marks=1)
        exam.total_marks = Decimal("3.00")
        exam.save()

        started = self.start(exam)
        self.assertEqual(started.status_code, 201)

        response = self.client.get("/api/v1/student/exams/")
        item = next(entry for entry in response.data if entry["id"] == str(exam.id))
        self.assertEqual(item["availability"], "in_progress")
        self.assertEqual(item["question_count"], 2)
        self.assertEqual(item["max_attempts"], 2)
        self.assertEqual(item["attempts_used"], 1)
        self.assertEqual(item["total_marks"], "3.00")
        self.assertEqual(item["attempt"]["attempt_number"], 1)
        self.assertIsNone(item["attempt"]["result"])
        self.assertGreater(item["attempt"]["remaining_seconds"], 2600)
        self.assertLessEqual(item["attempt"]["remaining_seconds"], 45 * 60)

    def test_second_attempt_number_increments_and_limit_still_applies(self) -> None:
        exam = self.make_exam(max_attempts=2)
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")

        second = self.start(exam)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second.data["attempt_number"], 2)
        # Restarting while an attempt is still open reuses it instead of consuming a new try.
        reused = self.start(exam)
        self.assertEqual(reused.data["id"], second.data["id"])
        self.client.post(f"/api/v1/student/attempts/{second.data['id']}/submit/")

        third = self.client.post(f"/api/v1/student/exams/{exam.id}/start/")
        self.assertEqual(third.status_code, 400)
        self.assertIn("exam", third.data["detail"])

        item = next(entry for entry in self.client.get("/api/v1/student/exams/").data if entry["id"] == str(exam.id))
        self.assertEqual(item["attempts_used"], 2)
        self.assertEqual(item["availability"], "completed")

    def test_published_result_carries_marks_and_a_pass_verdict(self) -> None:
        exam = self.make_exam()
        exam.settings.passing_percentage = Decimal("50.00")
        exam.settings.save()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=2)
        exam.total_marks = Decimal("2.00")
        exam.save()

        attempt_id = self.start(exam).data["id"]
        # Deliberately wrong: the student picks the second option.
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.get(order=2).id)]},
            format="json",
        )
        submitted = self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertEqual(submitted.data["result"]["percentage"], "0.00")

        result = self.client.get(f"/api/v1/student/results/{attempt_id}/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["maximum_score"], 2.0)
        self.assertEqual(result.data["passing_percentage"], 50.0)
        self.assertIs(result.data["passed"], False)
        self.assertEqual(result.data["attempt_number"], 1)
        self.assertIsNotNone(result.data["submitted_at"])
        forbidden = {"is_correct", "configuration", "expected_answers", "explanation", "selected_option_ids"}
        self.assertTrue(forbidden.isdisjoint(self.response_keys(result.data)))

    def test_pass_verdict_is_absent_without_a_pass_mark(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=1)
        exam.total_marks = Decimal("1.00")
        exam.save()

        attempt_id = self.start(exam).data["id"]
        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        result = self.client.get(f"/api/v1/student/results/{attempt_id}/")
        self.assertEqual(result.data["passing_percentage"], 0.0)
        self.assertIsNone(result.data["passed"])

    def test_dashboard_result_summary_stays_hidden_until_publication(self) -> None:
        exam = self.make_exam(result_visibility=ExamSettings.ResultVisibility.HIDDEN)
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=1)
        exam.total_marks = Decimal("1.00")
        exam.save()

        attempt_id = self.start(exam).data["id"]
        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")

        item = next(entry for entry in self.client.get("/api/v1/student/exams/").data if entry["id"] == str(exam.id))
        self.assertIsNone(item["attempt"]["result"])
        blocked = self.client.get(f"/api/v1/student/results/{attempt_id}/")
        self.assertEqual(blocked.status_code, 403)


class AttemptConcurrencyAndSessionApiTests(StudentExamApiTests):
    """Server-side guards: nobody overwrites a newer answer, and one attempt has one writer."""

    def test_revision_advances_and_a_stale_write_is_rejected(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        options = [str(option.id) for option in question.options.order_by("order")]

        first = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [options[0]]},
            format="json",
            HTTP_X_EXAM_REVISION="0",
        )
        self.assertEqual(first.status_code, 200)
        detail = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data
        self.assertEqual(detail["answer_revision"], 1)

        # A retried request built from the old snapshot must not replace the newer answer.
        stale = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [options[1]]},
            format="json",
            HTTP_X_EXAM_REVISION="0",
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.data["code"], "stale_revision")
        self.assertEqual(stale.data["answer_revision"], 1)
        kept = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data
        self.assertEqual(kept["answers"][0]["selected_option_ids"], [options[0]])

        fresh = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [options[1]]},
            format="json",
            HTTP_X_EXAM_REVISION="1",
        )
        self.assertEqual(fresh.status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["answer_revision"], 2)

    def test_a_client_that_sends_no_revision_is_still_accepted(self) -> None:
        """Backwards compatibility: the guard is opt-in per request, so older clients keep working."""
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        response = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [str(question.options.first().id)]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_a_second_window_cannot_write_while_the_first_is_still_active(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        option = str(question.options.first().id)
        attempt_id = self.start(exam, session="tab-a").data["id"]
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [option]},
            format="json",
            HTTP_X_EXAM_SESSION="tab-a",
        )

        blocked = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [option]},
            format="json",
            HTTP_X_EXAM_SESSION="tab-b",
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.data["code"], "another_session_active")
        # A second tab may read freely; only writing is contested.
        self.assertEqual(self.client.get(f"/api/v1/student/attempts/{attempt_id}/", HTTP_X_EXAM_SESSION="tab-b").status_code, 200)

    def test_claiming_the_session_moves_writing_and_leaves_a_trace(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        option = str(question.options.first().id)
        attempt_id = self.start(exam, session="tab-a").data["id"]
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [option]},
            format="json",
            HTTP_X_EXAM_SESSION="tab-a",
        )

        claimed = self.client.post(f"/api/v1/student/attempts/{attempt_id}/claim-session/", {}, format="json", HTTP_X_EXAM_SESSION="tab-b")
        self.assertEqual(claimed.status_code, 200)
        self.assertEqual(claimed.data["status"], "in_progress")
        written = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [option]},
            format="json",
            HTTP_X_EXAM_SESSION="tab-b",
        )
        self.assertEqual(written.status_code, 200)

        attempt = ExamAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.client_session, "tab-b")
        self.assertEqual(attempt.session_switch_count, 1)
        kinds = list(AttemptEvent.objects.filter(attempt=attempt).values_list("kind", flat=True))
        self.assertIn(AttemptEvent.Kind.SESSION_SWITCH, kinds)

    def test_heartbeat_returns_the_clock_without_the_answer_sheet(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam, session="tab-a").data["id"]

        beat = self.client.post(f"/api/v1/student/attempts/{attempt_id}/heartbeat/", {}, format="json", HTTP_X_EXAM_SESSION="tab-a")
        self.assertEqual(beat.status_code, 200)
        # The key set is the contract: the heartbeat exists to be small, so a field is only added here when
        # the runner would otherwise have to fetch the whole answer sheet to learn it (answer_frontier is
        # the navigation frontier, which the runner shows as a locked question).
        self.assertEqual(
            set(beat.data),
            {
                "server_time", "expires_at", "remaining_seconds", "status", "answer_revision", "answer_frontier",
                "session_locked_by_other", "device_locked", "integrity", "question_count",
            },
        )
        self.assertGreater(beat.data["remaining_seconds"], 44 * 60)
        self.assertFalse(beat.data["session_locked_by_other"])
        self.assertEqual(beat.data["question_count"], 1)
        self.assertEqual(beat.data["answer_frontier"], 0)
        self.assertEqual(ExamAttempt.objects.get(pk=attempt_id).client_session, "tab-a")

    def test_client_signals_are_stored_and_unknown_ones_are_refused(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]

        hidden = self.client.post(f"/api/v1/student/attempts/{attempt_id}/signals/", {"kind": "tab_hidden"}, format="json")
        self.assertEqual(hidden.status_code, 200)
        self.assertEqual(hidden.data["policy"], "off", "the rules ride back on the signal that changed them")
        self.assertEqual(AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.TAB_HIDDEN).count(), 1)

        invented = self.client.post(f"/api/v1/student/attempts/{attempt_id}/signals/", {"kind": "guilty"}, format="json")
        self.assertEqual(invented.status_code, 400)
        # Clipboard watching is the teacher's to switch on, so a paste signal is refused while the exam is
        # unmonitored rather than being stored "just in case".
        paste = self.client.post(f"/api/v1/student/attempts/{attempt_id}/signals/", {"kind": "paste"}, format="json")
        self.assertEqual(paste.status_code, 400)
        self.assertFalse(AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.PASTE).exists())

        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        after_submit = self.client.post(f"/api/v1/student/attempts/{attempt_id}/signals/", {"kind": "tab_hidden"}, format="json")
        self.assertEqual(after_submit.status_code, 200, "a finalized attempt records nothing more, and does not error")
        self.assertEqual(AttemptEvent.objects.filter(attempt_id=attempt_id).count(), 1)

    def test_auto_submit_is_attributed_to_the_timer(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/", {"trigger": "auto"}, format="json")
        self.assertTrue(AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.AUTO_SUBMITTED).exists())

    def test_other_students_cannot_forge_signals_or_heartbeats(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        self.client.force_authenticate(self.other_student)
        self.assertEqual(self.client.post(f"/api/v1/student/attempts/{attempt_id}/heartbeat/", {}).status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/student/attempts/{attempt_id}/signals/", {"kind": "tab_hidden"}).status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/student/attempts/{attempt_id}/claim-session/", {}).status_code, 404)


class AttemptRandomizationAndAnswerSheetTests(StudentExamApiTests):
    """Option order is a display concern of the attempt, never a grading input."""

    def test_option_order_is_stable_per_attempt_and_grading_is_unaffected(self) -> None:
        exam = self.make_exam()
        exam.settings.randomize_options = True
        exam.settings.save()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_ANSWER, marks=3, correct_indexes={0, 2})
        correct = [str(option.id) for option in question.options.filter(is_correct=True).order_by("id")]

        attempt = self.start(exam).data
        first_order = [option["id"] for option in attempt["questions"][0]["options"]]
        self.assertEqual(set(first_order), {str(option.id) for option in question.options.all()})
        # True/false keeps its fixed pair so the boolean mapping cannot drift.
        saved = self.client.patch(
            f"/api/v1/student/attempts/{attempt['id']}/answers/{question.id}/",
            {"selected_option_ids": correct},
            format="json",
        )
        self.assertEqual(saved.status_code, 200)
        submitted = self.client.post(f"/api/v1/student/attempts/{attempt['id']}/submit/").data
        self.assertEqual(submitted["result"]["score"], "3.00")

        # A reconnect sees exactly the same order as the first view.
        again = self.client.get(f"/api/v1/student/attempts/{attempt['id']}/").data
        self.assertEqual([option["id"] for option in again["questions"][0]["options"]], first_order)

    def test_true_false_options_are_never_reordered(self) -> None:
        exam = self.make_exam()
        exam.settings.randomize_options = True
        exam.settings.save()
        self.add_choice_question(exam, Question.Type.TRUE_FALSE)
        payload = self.start(exam).data
        options = payload["questions"][0]["options"]
        self.assertEqual([option["text"] for option in options], ["True", "False"])
        self.assertEqual(options[0]["order"], 1)

    def test_two_attempts_may_disagree_but_each_stays_frozen(self) -> None:
        exam = self.make_exam()
        exam.settings.max_attempts = 2
        exam.settings.randomize_options = True
        exam.settings.save()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_ANSWER, correct_indexes={0, 1, 2})
        first = self.start(exam).data
        first_order = [option["id"] for option in first["questions"][0]["options"]]
        self.client.post(f"/api/v1/student/attempts/{first['id']}/submit/")
        second = self.start(exam).data
        second_order = [option["id"] for option in second["questions"][0]["options"]]
        self.assertEqual(set(first_order), set(second_order))
        self.assertEqual(
            ExamAttempt.objects.get(pk=first["id"]).option_order[str(question.id)],
            first_order,
            "the snapshot the student saw is the snapshot that was stored",
        )

    def test_option_order_is_absent_when_randomization_is_off(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt = self.start(exam)
        self.assertEqual(ExamAttempt.objects.get(pk=attempt.data["id"]).option_order, {})
        self.assertEqual([option["id"] for option in attempt.data["questions"][0]["options"]], [str(o.id) for o in question.options.order_by("order")])

    def test_exam_requiring_a_complete_answer_sheet_blocks_an_empty_submit(self) -> None:
        exam = self.make_exam()
        exam.settings.allow_unanswered = False
        exam.settings.save()
        first = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=1)
        attempt_id = self.start(exam).data["id"]

        blocked = self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("answers", blocked.data["detail"])
        self.assertEqual(ExamAttempt.objects.get(pk=attempt_id).status, ExamAttempt.Status.IN_PROGRESS)

        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{first.id}/",
            {"selected_option_ids": [str(first.options.first().id)]},
            format="json",
        )
        second = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data
        remaining = [question for question in second["questions"] if question["id"] != str(first.id)][0]
        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertEqual(ExamAttempt.objects.get(pk=attempt_id).status, ExamAttempt.Status.IN_PROGRESS, "still one question short")

        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{remaining['id']}/",
            {"selected_option_ids": [remaining["options"][0]["id"]]},
            format="json",
        )
        self.assertEqual(self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/").status_code, 200)

    def test_navigation_payload_shows_the_answer_sheet_rule(self) -> None:
        exam = self.make_exam()
        exam.settings.allow_unanswered = False
        exam.settings.save()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        payload = self.start(exam).data
        self.assertFalse(payload["exam"]["navigation"]["allow_unanswered"])
        self.assertNotIn("show_correct_answers", payload["exam"]["navigation"])


class LateStartGuardTests(StudentExamApiTests):
    """A student who arrives after the clock has effectively run out keeps their attempt."""

    def test_starting_seconds_before_the_closing_time_is_refused(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        exam.start_at = timezone.now() - timedelta(minutes=5)
        exam.end_at = timezone.now() + timedelta(seconds=30)
        exam.save()

        response = self.start(exam)
        self.assertEqual(response.status_code, 400)
        self.assertIn("exam", response.data["detail"])
        self.assertEqual(ExamAttempt.objects.filter(exam=exam, student=self.student).count(), 0)

    def test_a_wider_window_is_startable_and_keeps_the_exam_end_cap(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        exam.duration_minutes = 45
        exam.start_at = timezone.now() - timedelta(minutes=1)
        exam.end_at = timezone.now() + timedelta(minutes=10)
        exam.save()

        started = self.start(exam)
        self.assertEqual(started.status_code, 201)
        # Ten minutes of window beats 45 minutes of duration, and that cap is what the student is told.
        self.assertLessEqual(started.data["remaining_seconds"], 10 * 60)
        self.assertGreater(started.data["remaining_seconds"], 9 * 60)

    def test_extension_reopens_the_door_for_a_late_student(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        exam.start_at = timezone.now() - timedelta(minutes=5)
        exam.end_at = timezone.now() + timedelta(seconds=30)
        exam.save()
        self.assertEqual(self.start(exam).status_code, 400)

        teacher = APIClient()
        teacher.force_authenticate(self.teacher)
        # The exam is already active; extending it must move the cap that made the start impossible.
        self.assertEqual(teacher.post(f"/api/v1/exams/{exam.id}/extend/", {"extra_minutes": 20}, format="json").status_code, 200)
        started = self.start(exam)
        self.assertEqual(started.status_code, 201)
        self.assertGreater(started.data["remaining_seconds"], 60)


class NoReturnNavigationRuleApiTests(StudentExamApiTests):
    """The teacher's "no going back" switch, enforced by the server and scoped to the paged layout.

    `allow_previous_questions` used to be a label the student's browser chose to honour: a second tab, a
    reload or a direct request could keep editing a question that had already been passed. These tests pin
    the server-side frontier, and the two cases where the rule deliberately does *not* apply.
    """

    def build(self, *, allow_previous: bool, layout: str, questions: int = 3) -> tuple[Exam, list[Question]]:
        exam = self.make_exam()
        exam.settings.allow_previous_questions = allow_previous
        exam.settings.question_layout = layout
        exam.settings.save(update_fields=("allow_previous_questions", "question_layout", "updated_at"))
        created = [
            self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=1) for _ in range(questions)
        ]
        return exam, created

    def answer(self, attempt_id: str, question: Question, option_index: int = 0, **headers):
        option = str(question.options.order_by("order")[option_index].id)
        return self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [option]},
            format="json",
            **headers,
        )

    def test_a_passed_answer_is_final_in_a_paged_exam(self) -> None:
        exam, (first, second, _third) = self.build(allow_previous=False, layout=ExamSettings.QuestionLayout.PAGED)
        attempt_id = self.start(exam).data["id"]

        self.assertEqual(self.answer(attempt_id, first).status_code, 200)
        self.assertEqual(self.answer(attempt_id, second).status_code, 200)

        refused = self.answer(attempt_id, first, option_index=1)
        self.assertEqual(refused.status_code, 409, refused.data)
        self.assertEqual(refused.data["code"], "question_locked")
        self.assertEqual(refused.data["question_ids"], [str(first.id)])
        # The first answer keeps its original value: a refusal must not also destroy what was saved.
        kept = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data
        self.assertEqual(
            kept["answers"][0]["selected_option_ids"], [str(first.options.order_by("order")[0].id)]
        )
        self.assertEqual(kept["answer_frontier"], 1)
        self.assertEqual(
            StudentAnswer.objects.get(attempt_id=attempt_id, question=first).selected_options.count(), 1
        )

    def test_the_frontier_only_moves_forward_and_the_current_answer_stays_editable(self) -> None:
        exam, (first, second, _third) = self.build(allow_previous=False, layout=ExamSettings.QuestionLayout.PAGED)
        attempt_id = self.start(exam).data["id"]
        self.assertEqual(self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["answer_frontier"], 0)

        self.assertEqual(self.answer(attempt_id, first).status_code, 200)
        # Before anything later is answered, correcting the current question is still allowed.
        self.assertEqual(self.answer(attempt_id, first, option_index=2).status_code, 200)
        self.assertEqual(self.answer(attempt_id, second).status_code, 200)
        self.assertEqual(self.answer(attempt_id, second, option_index=2).status_code, 200)

    def test_returning_is_allowed_when_the_teacher_allows_it(self) -> None:
        exam, (first, second, _third) = self.build(allow_previous=True, layout=ExamSettings.QuestionLayout.PAGED)
        attempt_id = self.start(exam).data["id"]
        self.assertEqual(self.answer(attempt_id, first).status_code, 200)
        self.assertEqual(self.answer(attempt_id, second).status_code, 200)
        self.assertEqual(self.answer(attempt_id, first, option_index=1).status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["answers"][0]["selected_option_ids"],
            [str(first.options.order_by("order")[1].id)],
        )

    def test_one_page_layout_is_exempt_because_nothing_was_passed(self) -> None:
        exam, (first, second, _third) = self.build(
            allow_previous=False, layout=ExamSettings.QuestionLayout.SINGLE_PAGE
        )
        attempt_id = self.start(exam).data["id"]
        self.assertEqual(self.answer(attempt_id, first).status_code, 200)
        self.assertEqual(self.answer(attempt_id, second).status_code, 200)
        self.assertEqual(self.answer(attempt_id, first, option_index=1).status_code, 200)
        # The frontier still advances (it is the attempt's own record), it simply is not enforced here.
        self.assertEqual(self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["answer_frontier"], 1)

    def test_a_batch_holding_one_passed_question_writes_nothing(self) -> None:
        exam, (first, second, third) = self.build(allow_previous=False, layout=ExamSettings.QuestionLayout.PAGED)
        attempt_id = self.start(exam).data["id"]
        self.assertEqual(self.answer(attempt_id, second).status_code, 200)

        refused = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/",
            {
                "answers": [
                    {"question_id": str(first.id), "selected_option_ids": [str(first.options.first().id)]},
                    {"question_id": str(third.id), "selected_option_ids": [str(third.options.first().id)]},
                ]
            },
            format="json",
        )
        self.assertEqual(refused.status_code, 409, refused.data)
        self.assertEqual(refused.data["question_ids"], [str(first.id)])
        # All-or-nothing, so the legitimate half of the batch is untouched rather than half-applied...
        self.assertEqual(StudentAnswer.objects.filter(attempt_id=attempt_id, question=third).count(), 0)
        # ...and dropping the refused id makes the rest land, which is exactly the client's recovery.
        retried = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/",
            {"answers": [{"question_id": str(third.id), "selected_option_ids": [str(third.options.first().id)]}]},
            format="json",
        )
        self.assertEqual(retried.status_code, 200, retried.data)

    def test_flagging_a_passed_question_is_still_allowed(self) -> None:
        exam, (first, second, _third) = self.build(allow_previous=False, layout=ExamSettings.QuestionLayout.PAGED)
        attempt_id = self.start(exam).data["id"]
        self.assertEqual(self.answer(attempt_id, first).status_code, 200)
        self.assertEqual(self.answer(attempt_id, second).status_code, 200)
        # A flag marks a question for the student's own review; it changes no answer, so the rule leaves it
        # alone and the teacher's view of "what did they touch" stays complete.
        flagged = self.client.post(f"/api/v1/student/attempts/{attempt_id}/flagged-questions/{first.id}/")
        self.assertEqual(flagged.status_code, 200, flagged.data)
        self.assertTrue(flagged.data["is_flagged"])

    def test_the_rule_follows_the_attempt_snapshot_and_not_question_order(self) -> None:
        exam, (first, second, _third) = self.build(allow_previous=False, layout=ExamSettings.QuestionLayout.PAGED)
        attempt_id = self.start(exam).data["id"]
        # Rewrite the snapshot to reverse order: `first` is now the *last* question this student sees.
        ExamAttempt.objects.filter(pk=attempt_id).update(
            question_order=[str(question.id) for question in reversed(exam.questions.order_by("order"))]
        )
        self.assertEqual(self.answer(attempt_id, first).status_code, 200)
        # In `Question.order` terms second > first, so an order-based rule would accept this. Measured
        # against the snapshot, `second` sits at index 1 and is already behind the frontier.
        refused = self.answer(attempt_id, second)
        self.assertEqual(refused.status_code, 409, refused.data)
        self.assertEqual(refused.data["question_ids"], [str(second.id)])

    def test_a_refused_edit_is_recorded_for_the_teacher(self) -> None:
        exam, (first, second, _third) = self.build(allow_previous=False, layout=ExamSettings.QuestionLayout.PAGED)
        attempt_id = self.start(exam).data["id"]
        self.assertEqual(self.answer(attempt_id, first).status_code, 200)
        self.assertEqual(self.answer(attempt_id, second).status_code, 200)
        self.assertEqual(self.answer(attempt_id, first, option_index=1).status_code, 409)
        events = AttemptEvent.objects.filter(
            attempt_id=attempt_id, kind=AttemptEvent.Kind.QUESTION_LOCKED
        )
        self.assertEqual(events.count(), 1)
        self.assertEqual(events.first().detail["question_ids"], [str(first.id)])
        # An observation, never a penalty: nothing here touches the score or the clock.
        timing = self.client.post(f"/api/v1/student/attempts/{attempt_id}/heartbeat/").data
        self.assertEqual(timing["status"], "in_progress")


class RefusedWriteIsRecordedTests(StudentExamApiTests):
    """A rejected write must leave a trace, even though the write itself is rolled back.

    Both refusal paths create their activity row inside the transaction that the conflict unwinds, so an
    event written there disappears with it. These assertions are the reason that is now done in the view,
    after the rollback.
    """

    def test_a_stale_write_lands_in_the_activity_log(self) -> None:
        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        options = [str(option.id) for option in question.options.order_by("order")]

        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [options[0]]},
            format="json",
            HTTP_X_EXAM_REVISION="0",
        )
        refused = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [options[1]]},
            format="json",
            HTTP_X_EXAM_REVISION="0",
        )
        self.assertEqual(refused.status_code, 409)
        events = AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.STALE_WRITE_REJECTED)
        self.assertEqual(events.count(), 1, "the refused write left no trace for the teacher")
        self.assertEqual(events.first().detail["expected"], 0)
        self.assertEqual(events.first().detail["current"], 1)

    def test_a_locked_write_lands_in_the_activity_log(self) -> None:
        exam = self.make_exam()
        exam.settings.allow_previous_questions = False
        exam.settings.save(update_fields=("allow_previous_questions", "updated_at"))
        first = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        second = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        for question in (first, second):
            self.client.patch(
                f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
                {"selected_option_ids": [str(question.options.order_by("order")[0].id)]},
                format="json",
            )
        refused = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{first.id}/",
            {"selected_option_ids": [str(first.options.order_by("order")[1].id)]},
            format="json",
        )
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(
            AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.QUESTION_LOCKED).count(), 1
        )


class CohortGradingApiTests(TestCase):
    """Marking one question across the class, and the marks the exam already awarded on its own.

    Two ways through the same paper: finishing one student's sheet, and applying one rubric to thirty
    people. Both read the shared verdict function, so a number on a row is the number in the total — which
    is what these assertions hold.
    """

    def setUp(self) -> None:
        self.teacher = User.objects.create_user(
            email="marker@example.com", password="ChangeMe123!", role=User.Role.TEACHER, first_name="مریم", last_name="رضایی"
        )
        self.other_teacher = User.objects.create_user(
            email="other-marker@example.com", password="ChangeMe123!", role=User.Role.TEACHER
        )
        self.student = User.objects.create_user(
            email="writer@example.com", password="ChangeMe123!", role=User.Role.STUDENT, first_name="سارا", last_name="احمدی"
        )
        self.second_student = User.objects.create_user(
            email="writer2@example.com", password="ChangeMe123!", role=User.Role.STUDENT, first_name="نگار", last_name="محمدی"
        )
        # A profile is created with the account, so the class fields are set rather than inserted.
        StudentProfile.objects.update_or_create(user=self.student, defaults={"grade": "12", "class_name": "12-A"})
        # A profile is created with the account, so the class fields are set rather than inserted.
        StudentProfile.objects.update_or_create(user=self.second_student, defaults={"grade": "12", "class_name": "12-B"})
        self.teacher_client = APIClient()
        self.teacher_client.force_authenticate(self.teacher)
        self.other_client = APIClient()
        self.other_client.force_authenticate(self.other_teacher)
        self.exam = Exam.objects.create(
            title="Cohort assessment",
            description="Manual and automatic marks together.",
            subject="Biology",
            teacher=self.teacher,
            status=Exam.Status.ACTIVE,
            duration_minutes=45,
        )
        self.exam.settings.result_visibility = ExamSettings.ResultVisibility.PENDING
        self.exam.settings.save()
        self.keyed = Question.objects.create(
            exam=self.exam, type=Question.Type.MULTIPLE_CHOICE, text="Which is a unit of power?", order=1, marks=2
        )
        self.right_option = QuestionOption.objects.create(question=self.keyed, text="وات", is_correct=True, order=1)
        self.wrong_option = QuestionOption.objects.create(question=self.keyed, text="ژول", is_correct=False, order=2)
        self.written = Question.objects.create(
            exam=self.exam,
            type=Question.Type.WRITTEN,
            text="Explain diffusion.",
            order=2,
            marks=4,
            configuration={"max_length": 500},
        )

    def client_for(self, user: User) -> APIClient:
        client = APIClient()
        client.force_authenticate(user)
        return client

    def finalize(self, student: User, *, option: QuestionOption | None, text: str) -> ExamAttempt:
        client = self.client_for(student)
        started = client.post(f"/api/v1/student/exams/{self.exam.id}/start/")
        self.assertEqual(started.status_code, 201)
        attempt_id = started.data["id"]
        if option is not None:
            saved = client.patch(
                f"/api/v1/student/attempts/{attempt_id}/answers/{self.keyed.id}/",
                {"selected_option_ids": [str(option.id)]},
                format="json",
            )
            self.assertEqual(saved.status_code, 200)
        answered = client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{self.written.id}/",
            {"text": text},
            format="json",
        )
        self.assertEqual(answered.status_code, 200)
        submitted = client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        self.assertEqual(submitted.status_code, 200)
        return ExamAttempt.objects.get(pk=attempt_id)

    def question_url(self, question: Question) -> str:
        return f"/api/v1/results/teacher/exams/{self.exam.id}/grading/{question.id}/"

    def test_the_sheet_shows_what_the_exam_awarded_by_itself(self) -> None:
        attempt = self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        detail = self.teacher_client.get(f"/api/v1/results/teacher/attempts/{attempt.id}/")
        self.assertEqual(detail.status_code, 200)
        keyed, written = detail.data["answers"]
        # A keyed question used to carry no number here at all, which turned the marking screen into a to-do
        # list instead of the student's paper.
        self.assertEqual((keyed["verdict"], keyed["awarded_score"], keyed["maximum_score"]), ("correct", "2.00", "2.00"))
        self.assertFalse(keyed["manual_grading_required"])
        self.assertEqual((written["verdict"], written["awarded_score"]), ("pending", "0.00"))
        self.assertTrue(written["manual_grading_required"])

        second = self.finalize(self.second_student, option=self.wrong_option, text="A shorter answer.")
        rows = self.teacher_client.get(f"/api/v1/results/teacher/attempts/{second.id}/").data["answers"]
        self.assertEqual(rows[0]["verdict"], "incorrect")
        self.assertEqual(rows[0]["awarded_score"], "0.00")

    def test_board_counts_the_cohort_per_question(self) -> None:
        self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        self.finalize(self.second_student, option=self.wrong_option, text="Another answer.")
        board = self.teacher_client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/grading/")
        self.assertEqual(board.status_code, 200)
        keyed, written = board.data["questions"]
        self.assertEqual(board.data["attempt_count"], 2)
        self.assertFalse(keyed["requires_manual_grading"])
        self.assertEqual((keyed["answered_count"], keyed["correct_count"], keyed["incorrect_count"]), (2, 1, 1))
        self.assertTrue(keyed["is_complete"])
        self.assertEqual(keyed["average_score"], 1.0)
        self.assertTrue(written["requires_manual_grading"])
        self.assertEqual((written["graded_count"], written["pending_count"]), (0, 2))
        self.assertFalse(written["is_complete"])
        self.assertEqual(board.data["progress"], {"total": 2, "graded": 0, "percent": 0})

    def test_one_question_lists_every_attempt_with_the_key_and_the_editable_flag(self) -> None:
        first = self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        second = self.finalize(self.second_student, option=self.wrong_option, text="Another answer.")
        page = self.teacher_client.get(self.question_url(self.written))
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.data["question"]["marks"], "4.00")
        self.assertEqual(page.data["question"]["text"], "Explain diffusion.")
        self.assertTrue(page.data["question"]["requires_manual_grading"])
        self.assertEqual((page.data["progress"]["index"], page.data["progress"]["total"]), (2, 2))
        self.assertEqual(len(page.data["rows"]), 2)
        self.assertEqual({row["attempt_id"] for row in page.data["rows"]}, {str(first.id), str(second.id)})
        for row in page.data["rows"]:
            self.assertTrue(row["editable"])
            self.assertIsNone(row["manual_score"])
            self.assertEqual(row["verdict"], "pending")
        profile_row = next(row for row in page.data["rows"] if row["student_id"] == str(self.student.id))
        self.assertEqual((profile_row["grade"], profile_row["class_name"]), ("12", "12-A"))
        self.assertEqual(profile_row["text"], "Movement of particles.")

        # A keyed question opens the same screen, not a read-only table: the distribution is still there and
        # every row can be marked by hand. `auto_score` is what the key said, so an override shows as a change.
        keyed_page = self.teacher_client.get(self.question_url(self.keyed))
        self.assertEqual(keyed_page.data["question"]["correct_option_ids"], [str(self.right_option.id)])
        self.assertTrue(all(row["editable"] is True for row in keyed_page.data["rows"]))
        self.assertTrue(all(row["is_overridden"] is False for row in keyed_page.data["rows"]))
        self.assertTrue(all(row["verdict"] in {"correct", "incorrect"} for row in keyed_page.data["rows"]))
        self.assertTrue(all(row["auto_score"] in {"0.00", "2.00"} for row in keyed_page.data["rows"]))

        saved = self.teacher_client.post(
            self.question_url(self.keyed),
            {"grades": [{"attempt_id": str(first.id), "mark": "0.50", "feedback": "Half the key."}]},
            format="json",
        )
        self.assertEqual(saved.status_code, 200)
        row = next(item for item in saved.data["rows"] if item["attempt_id"] == str(first.id))
        self.assertEqual((row["awarded_score"], row["auto_score"]), ("0.50", row["auto_score"]))
        self.assertTrue(row["is_overridden"])
        # The queue is untouched. `total` counts only the written question, twice over (one per attempt);
        # marking a keyed answer by hand must not add to it, and must not unblock it either.
        self.assertEqual((saved.data["progress"]["total"], saved.data["progress"]["graded"]), (2, 0))
        self.assertEqual(first.result.pending_manual_grading_count, 1)

    def test_batch_save_marks_every_row_and_regrades_each_attempt(self) -> None:
        first = self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        second = self.finalize(self.second_student, option=self.wrong_option, text="Another answer.")
        saved = self.teacher_client.post(
            self.question_url(self.written),
            {
                "grades": [
                    {"attempt_id": str(first.id), "mark": "4.00", "feedback": "کامل."},
                    {"attempt_id": str(second.id), "mark": "1.00"},
                ]
            },
            format="json",
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data["saved"], 2)
        # 2 auto + 4 manual for the first student, 0 + 1 for the second.
        self.assertEqual({row["result"]["score"] for row in saved.data["results"]}, {"6.00", "1.00"})
        self.assertEqual(saved.data["stats"]["pending_count"], 0)
        self.assertTrue(saved.data["stats"]["is_complete"])
        self.assertEqual(saved.data["progress"], {"total": 2, "graded": 2, "percent": 100})
        marks = {row["attempt_id"]: row["manual_score"] for row in saved.data["rows"]}
        self.assertEqual(marks, {str(first.id): "4.00", str(second.id): "1.00"})
        feedback = {row["attempt_id"]: row["feedback"] for row in saved.data["rows"]}
        self.assertEqual(feedback[str(first.id)], "کامل.")
        self.assertEqual(ExamResult.objects.filter(attempt__in=[first, second], pending_manual_grading_count=0).count(), 2)

    def test_one_bad_row_refuses_the_whole_screen(self) -> None:
        first = self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        second = self.finalize(self.second_student, option=self.wrong_option, text="Another answer.")
        refused = self.teacher_client.post(
            self.question_url(self.written),
            {"grades": [{"attempt_id": str(first.id), "mark": "3.00"}, {"attempt_id": str(second.id), "mark": "9.00"}]},
            format="json",
        )
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(len(refused.data["detail"]["rows"]), 1)
        # Nothing landed, so the teacher fixes the row and resends the screen without double-applying.
        page = self.teacher_client.get(self.question_url(self.written))
        self.assertTrue(all(row["manual_score"] is None for row in page.data["rows"]))
        self.assertEqual(StudentAnswer.objects.filter(question=self.written, manual_score__isnull=False).count(), 0)

    def test_a_row_from_another_exam_is_refused(self) -> None:
        self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        foreign = Exam.objects.create(
            title="Other exam", description="", subject="Other", teacher=self.teacher, status=Exam.Status.ACTIVE, duration_minutes=30
        )
        foreign_attempt = ExamAttempt.objects.create(
            exam=foreign, student=self.student, attempt_number=1, status=ExamAttempt.Status.SUBMITTED
        )
        refused = self.teacher_client.post(
            self.question_url(self.written), {"grades": [{"attempt_id": str(foreign_attempt.id), "mark": "1.00"}]}, format="json"
        )
        self.assertEqual(refused.status_code, 400)
        self.assertIn("not part of the exam", str(refused.data))

    def test_an_already_keyed_question_can_be_graded_by_hand_here(self) -> None:
        """The cohort screen takes a mark on a keyed question too, and the key's number stays visible beside it.

        This used to answer 400, which left the teacher no way to say "the key is wrong" without editing the
        question - a change that would silently move every other student's mark too.
        """
        self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        attempt_id = str(ExamAttempt.objects.first().id)
        saved = self.teacher_client.post(
            self.question_url(self.keyed),
            {"grades": [{"attempt_id": attempt_id, "mark": "0.00", "feedback": "The key accepted a typo."}]},
            format="json",
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data["saved"], 1)
        row = next(item for item in saved.data["rows"] if item["attempt_id"] == attempt_id)
        self.assertEqual((row["awarded_score"], row["auto_score"], row["is_overridden"]), ("0.00", "2.00", True))
        # A note with no mark is a valid row, and `mark: null` undoes an override.
        noted = self.teacher_client.post(
            self.question_url(self.keyed),
            {"grades": [{"attempt_id": attempt_id, "feedback": "Reviewed twice."}]},
            format="json",
        )
        self.assertEqual(noted.status_code, 200)
        noted_row = next(item for item in noted.data["rows"] if item["attempt_id"] == attempt_id)
        self.assertEqual((noted_row["awarded_score"], noted_row["feedback"]), ("0.00", "Reviewed twice."))
        undone = self.teacher_client.post(
            self.question_url(self.keyed),
            {"grades": [{"attempt_id": attempt_id, "mark": None}]},
            format="json",
        )
        self.assertEqual(undone.status_code, 200)
        undone_row = next(item for item in undone.data["rows"] if item["attempt_id"] == attempt_id)
        self.assertEqual((undone_row["awarded_score"], undone_row["is_overridden"]), ("2.00", False))

        # A row that sends neither mark nor note is refused, per row, not for the whole screen.
        refused = self.teacher_client.post(
            self.question_url(self.keyed), {"grades": [{"attempt_id": attempt_id}]}, format="json"
        )
        self.assertEqual(refused.status_code, 400)

    def test_an_empty_grades_list_is_refused(self) -> None:
        self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        refused = self.teacher_client.post(self.question_url(self.written), {"grades": []}, format="json")
        self.assertEqual(refused.status_code, 400)

    def test_another_teacher_cannot_open_the_board_or_a_question(self) -> None:
        self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        self.assertEqual(self.other_client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/grading/").status_code, 404)
        self.assertEqual(self.other_client.get(self.question_url(self.written)).status_code, 404)
        self.assertEqual(
            self.other_client.post(
                self.question_url(self.written),
                {"grades": [{"attempt_id": str(ExamAttempt.objects.first().id), "mark": "1.00"}]},
                format="json",
            ).status_code,
            404,
        )

    def test_a_student_cannot_reach_the_marking_endpoints(self) -> None:
        attempt = self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        client = self.client_for(self.student)
        self.assertEqual(client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/grading/").status_code, 403)
        self.assertEqual(
            client.post(
                self.question_url(self.written), {"grades": [{"attempt_id": str(attempt.id), "mark": "4.00"}]}, format="json"
            ).status_code,
            403,
        )

    def test_the_key_never_reaches_a_student(self) -> None:
        attempt = self.finalize(self.student, option=self.right_option, text="Movement of particles.")
        client = self.client_for(self.student)
        self.assertEqual(client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/grading/").status_code, 403)
        detail = client.get(f"/api/v1/student/attempts/{attempt.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertNotIn("correct_option_ids", str(detail.data))
        self.assertNotIn("awarded_score", str(detail.data))


class ResultDetailVisibilityApiTests(StudentExamApiTests):
    """What a published result reveals, rung by rung.

    One keyed question, answered wrongly on purpose, so each rung has something different to hide: the sheet,
    the teacher's note, and the key itself. The default rung is the smallest one, and an exam written before
    the ladder existed still means exactly what `show_correct_answers` always meant.
    """

    def sheet(self, *, result_detail=None, show_correct_answers: bool = False, with_written: bool = False):
        exam = self.make_exam()
        exam.settings.result_detail = result_detail
        exam.settings.show_correct_answers = show_correct_answers
        exam.settings.save()
        keyed = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE, marks=2)
        keyed.explanation = "وات یکای توان است."
        keyed.save()
        written = (
            Question.objects.create(exam=exam, type=Question.Type.WRITTEN, text="توان را تعریف کنید.", order=2, marks=3)
            if with_written
            else None
        )
        exam.total_marks = Decimal("5.00" if written else "2.00")
        exam.save()

        attempt_id = self.start(exam).data["id"]
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{keyed.id}/",
            {"selected_option_ids": [str(keyed.options.get(order=2).id)]},
            format="json",
        )
        if written is not None:
            self.client.patch(
                f"/api/v1/student/attempts/{attempt_id}/answers/{written.id}/",
                {"text": "نرخ انجام کار."},
                format="json",
            )
        self.client.post(f"/api/v1/student/attempts/{attempt_id}/submit/")
        return exam, attempt_id

    @staticmethod
    def mark_by_hand(question: Question, *, score: str, note: str = "") -> None:
        """A teacher's decision on one answer, then the re-grade that clears it from the queue.

        Written through the ORM on purpose: this class is about what the student is allowed to read, and a
        result that is still waiting for a pen never gets past the smallest rung.
        """
        from apps.attempts.services import _grade_attempt

        answer = StudentAnswer.objects.select_related("attempt").get(question=question)
        answer.manual_score = Decimal(score)
        answer.feedback = note
        answer.save(update_fields=("manual_score", "feedback", "updated_at"))
        _grade_attempt(answer.attempt, finalized_at=timezone.now())

    def published(self, attempt_id) -> dict:  # type: ignore[type-arg]
        response = self.client.get(f"/api/v1/student/results/{attempt_id}/")
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_score_only_shows_nothing_but_the_number(self) -> None:
        _, attempt_id = self.sheet(result_detail=ExamSettings.ResultDetail.SCORE_ONLY)
        data = self.published(attempt_id)
        self.assertEqual((data["detail_level"], data["answers"]), ("score_only", []))
        self.assertEqual(data["score"], "0.00")

    def test_own_answers_lists_the_sheet_and_says_nothing_about_right_or_wrong(self) -> None:
        _, attempt_id = self.sheet(result_detail=ExamSettings.ResultDetail.OWN_ANSWERS)
        row = self.published(attempt_id)["answers"][0]
        self.assertEqual(row["question_text"], "multiple_choice question")
        self.assertEqual(row["selected_option_texts"], ["Second"])
        self.assertNotIn("verdict", row)
        self.assertNotIn("awarded_score", row)
        self.assertNotIn("explanation", row)
        self.assertNotIn("feedback", row)

    def test_notes_open_the_note_rung_and_nothing_more(self) -> None:
        exam, attempt_id = self.sheet(result_detail=ExamSettings.ResultDetail.OWN_ANSWERS_WITH_FEEDBACK)
        keyed = exam.questions.get(type=Question.Type.MULTIPLE_CHOICE)
        self.mark_by_hand(keyed, score="1.00", note="یک گزینه درست بود.")
        rows = self.published(attempt_id)["answers"]
        self.assertEqual([row["feedback"] for row in rows], ["یک گزینه درست بود."])
        # A note is not a verdict: the rung stops at the words, and the key stays closed.
        self.assertTrue(all("verdict" not in row and "awarded_score" not in row for row in rows))

    def test_full_key_releases_the_key_and_the_model_answer(self) -> None:
        exam, attempt_id = self.sheet(result_detail=ExamSettings.ResultDetail.FULL_KEY, with_written=True)
        self.mark_by_hand(exam.questions.get(type=Question.Type.WRITTEN), score="2.00")
        rows = self.published(attempt_id)["answers"]
        keyed = next(row for row in rows if row["question_type"] == Question.Type.MULTIPLE_CHOICE)
        self.assertEqual((keyed["verdict"], keyed["awarded_score"]), ("incorrect", "0.00"))
        self.assertEqual(keyed["correct_option_texts"], ["First"])
        self.assertEqual(keyed["explanation"], "وات یکای توان است.")
        written = next(row for row in rows if row["question_type"] == Question.Type.WRITTEN)
        self.assertEqual((written["verdict"], written["awarded_score"]), ("manual", "2.00"))

    def test_a_sheet_still_being_graded_waits_at_the_smallest_rung(self) -> None:
        # A written answer in the queue forces score-only, whatever the teacher chose: a half-marked sheet
        # published as "۰ از ۳" reads as a grade, not as work in progress.
        _, attempt_id = self.sheet(result_detail=ExamSettings.ResultDetail.FULL_KEY, with_written=True)
        data = self.published(attempt_id)
        self.assertEqual((data["detail_level"], data["answers"], data["is_final"]), ("score_only", [], False))
        # Grading the last answer opens the rung the teacher chose - nothing else has to be published again.
        written = ExamAttempt.objects.get(id=attempt_id).exam.questions.get(type=Question.Type.WRITTEN)
        self.mark_by_hand(written, score="2.00")
        after = self.published(attempt_id)
        self.assertEqual((after["detail_level"], len(after["answers"])), (ExamSettings.ResultDetail.FULL_KEY, 2))

    def test_the_legacy_switch_still_means_the_full_key(self) -> None:
        shown, attempt_id = self.sheet(show_correct_answers=True)
        self.assertEqual(self.published(attempt_id)["detail_level"], ExamSettings.ResultDetail.FULL_KEY)
        self.assertTrue(all("verdict" in row for row in self.published(attempt_id)["answers"]))

        hidden, other_id = self.sheet()
        self.assertEqual(self.published(other_id)["detail_level"], ExamSettings.ResultDetail.SCORE_ONLY)
        self.assertIsNone(shown.settings.result_detail)

    def test_the_teacher_writes_the_rung_and_an_unknown_one_is_refused(self) -> None:
        exam, _ = self.sheet()
        self.client.force_authenticate(self.teacher)
        updated = self.client.patch(
            f"/api/v1/exams/{exam.id}/", {"settings": {"result_detail": "own_answers"}}, format="json"
        )
        self.assertEqual(updated.status_code, 200)
        exam.settings.refresh_from_db()
        self.assertEqual(exam.settings.result_detail, "own_answers")

        refused = self.client.patch(
            f"/api/v1/exams/{exam.id}/", {"settings": {"result_detail": "everything"}}, format="json"
        )
        self.assertEqual(refused.status_code, 400)
        self.assertIn("result_detail", refused.data["detail"]["settings"])

    def test_duplication_carries_the_rung_over(self) -> None:
        exam, _ = self.sheet(result_detail=ExamSettings.ResultDetail.OWN_ANSWERS_WITH_FEEDBACK)
        self.client.force_authenticate(self.teacher)
        duplicate = self.client.post(f"/api/v1/exams/{exam.id}/duplicate/")
        self.assertEqual(duplicate.status_code, 201)
        self.assertEqual(
            Exam.objects.get(id=duplicate.data["id"]).settings.result_detail,
            ExamSettings.ResultDetail.OWN_ANSWERS_WITH_FEEDBACK,
        )


class ExamIntegrityApiTests(StudentExamApiTests):
    """Anti-cheating is the teacher's switch: what is recorded, what is blocked, and what it costs.

    The rules under test are deliberately asymmetrical. Observations are cheap and reversible, so `observe`
    stores them; a limit that closes an exam or a lock that refuses a device changes a student's result, so
    only `enforce` may do that, and nothing in this system decides anything while the policy is `off`.
    """

    def monitor(self, exam: Exam, *, policy: str, **rules) -> None:
        settings = exam.settings
        settings.integrity_policy = policy
        for field, value in rules.items():
            setattr(settings, field, value)
        settings.save()
        exam.refresh_from_db()

    def signal(self, attempt_id, kind: str, **headers):
        return self.client.post(f"/api/v1/student/attempts/{attempt_id}/signals/", {"kind": kind}, format="json", **headers)

    def test_nothing_is_recorded_or_restricted_until_the_teacher_asks(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]

        rules = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["integrity"]
        self.assertEqual(rules["policy"], "off")
        self.assertFalse(rules["records"], "an unmonitored exam must not be watched with the badge hidden")
        self.assertFalse(rules["enforced"])
        self.assertIsNone(rules["tab_switches_remaining"], "no budget, so nothing to spend")
        self.assertEqual(self.signal(attempt_id, "copy").status_code, 400)
        self.assertEqual(AttemptEvent.objects.filter(attempt_id=attempt_id).count(), 0)

    def test_observing_records_without_consequence(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        self.monitor(exam, policy="observe", max_tab_switches=1, block_copy_paste=True)

        self.assertEqual(self.signal(attempt_id, "tab_hidden").status_code, 200)
        self.assertEqual(self.signal(attempt_id, "tab_hidden").status_code, 200)
        self.assertEqual(self.signal(attempt_id, "copy").status_code, 200, "clipboard watching is on")

        attempt = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data
        self.assertEqual(attempt["status"], "in_progress", "observing never ends an exam")
        self.assertEqual(attempt["integrity"]["tab_switches"], 2)
        self.assertEqual(attempt["integrity"]["copy_events"], 1)
        self.assertFalse(attempt["integrity"]["block_copy_paste"], "a rule that cannot bite is not sent as if it could")
        self.assertEqual(attempt["integrity"]["tab_switches_remaining"], None)

    def test_the_tab_budget_closes_the_exam_when_enforced(self) -> None:
        from apps.results.models import ExamResult

        exam = self.make_exam()
        question = self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        attempt_id = self.start(exam).data["id"]
        self.monitor(exam, policy="enforce", max_tab_switches=2)
        option = str(question.options.order_by("order").first().id)
        self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [option]},
            format="json",
        )

        first = self.signal(attempt_id, "tab_hidden")
        self.assertEqual(first.data["tab_switches_remaining"], 1)
        second = self.signal(attempt_id, "tab_hidden")
        self.assertEqual(second.data["status"], "expired", "the last allowed switch is the one that closes it")
        self.assertEqual(second.data["tab_switches_remaining"], 0)

        self.assertTrue(
            AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.TAB_LIMIT_REACHED).exists()
        )
        # Work already saved is graded, not thrown away; only the window closes.
        result = ExamResult.objects.get(attempt_id=attempt_id)
        self.assertEqual(float(result.score), float(question.marks))
        refused = self.client.patch(
            f"/api/v1/student/attempts/{attempt_id}/answers/{question.id}/",
            {"selected_option_ids": [option]},
            format="json",
        )
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.data["code"], "attempt_finalized")

    def test_a_device_lock_refuses_another_browser_but_never_a_refresh(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        self.monitor(exam, policy="enforce", lock_to_one_device=True)
        desktop = "Mozilla/5.0 (Windows NT 10.0) Chrome/120"
        phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604"

        attempt_id = self.client.post(
            f"/api/v1/student/exams/{exam.id}/start/", HTTP_X_EXAM_SESSION="tab-a", HTTP_USER_AGENT=desktop
        ).data["id"]
        # The same browser, a second tab: a student who closed the window must be able to carry on.
        same_browser = self.client.post(
            f"/api/v1/student/attempts/{attempt_id}/claim-session/", HTTP_X_EXAM_SESSION="tab-b", HTTP_USER_AGENT=desktop
        )
        self.assertEqual(same_browser.status_code, 200)

        # A different device has to be refused, both as a quiet heartbeat and as an explicit claim.
        ExamAttempt.objects.filter(pk=attempt_id).update(last_activity_at=timezone.now() - timedelta(minutes=2))
        beat = self.client.post(
            f"/api/v1/student/attempts/{attempt_id}/heartbeat/", HTTP_X_EXAM_SESSION="tab-c", HTTP_USER_AGENT=phone
        )
        self.assertEqual(beat.status_code, 200, "a heartbeat reports a refusal instead of failing")
        self.assertTrue(beat.data["device_locked"])
        self.assertTrue(beat.data["integrity"]["lock_to_one_device"])
        refused = self.client.post(
            f"/api/v1/student/attempts/{attempt_id}/claim-session/", HTTP_X_EXAM_SESSION="tab-c", HTTP_USER_AGENT=phone
        )
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.data["code"], "device_locked")
        # The refusal has to survive the error it returns: a rolled-back event would hide the attempt from the
        # teacher's log, which is the only reason the check exists at all.
        AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.SESSION_LOCK_REFUSED).delete()
        self.client.post(
            f"/api/v1/student/attempts/{attempt_id}/claim-session/", HTTP_X_EXAM_SESSION="tab-c", HTTP_USER_AGENT=phone
        )
        self.assertTrue(
            AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.SESSION_LOCK_REFUSED).exists(),
            "a refused takeover is recorded even though the request failed",
        )
        self.assertEqual(ExamAttempt.objects.get(pk=attempt_id).client_session, "tab-b", "ownership did not move")

        # Turn the teacher's switch off and the same handover is allowed again.
        self.monitor(exam, policy="off")
        ExamAttempt.objects.filter(pk=attempt_id).update(last_activity_at=timezone.now() - timedelta(minutes=2))
        allowed = self.client.post(
            f"/api/v1/student/attempts/{attempt_id}/claim-session/", HTTP_X_EXAM_SESSION="tab-d", HTTP_USER_AGENT=phone
        )
        self.assertEqual(allowed.status_code, 200)

    def test_enforcement_needs_both_the_master_switch_and_the_rule(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        self.monitor(exam, policy="observe", require_fullscreen=True, block_copy_paste=True)
        attempt_id = self.start(exam).data["id"]
        rules = self.client.get(f"/api/v1/student/attempts/{attempt_id}/").data["integrity"]
        self.assertEqual(
            (rules["require_fullscreen"], rules["block_copy_paste"]),
            (False, False),
            "a rule the teacher cannot be penalised for is not sent to the runner as one",
        )
        self.signal(attempt_id, "fullscreen_exit")
        self.assertTrue(AttemptEvent.objects.filter(attempt_id=attempt_id, kind=AttemptEvent.Kind.FULLSCREEN_EXIT).exists())

    def test_the_teacher_reads_the_rules_next_to_the_counts(self) -> None:
        exam = self.make_exam()
        self.add_choice_question(exam, Question.Type.MULTIPLE_CHOICE)
        self.monitor(exam, policy="enforce", max_tab_switches=5, block_copy_paste=True)
        attempt_id = self.start(exam).data["id"]
        self.signal(attempt_id, "tab_hidden")
        self.signal(attempt_id, "paste")

        self.client.force_authenticate(self.teacher)
        board = self.client.get(f"/api/v1/results/teacher/attempts/{attempt_id}/").data
        self.assertEqual(board["integrity"]["policy"], "enforce")
        self.assertEqual((board["integrity"]["tab_switches"], board["integrity"]["copy_events"]), (1, 1))
        kinds = [event["kind"] for event in board["session_signals"]]
        self.assertIn("paste", kinds)
        self.assertIn("tab_hidden", kinds)


class AutoMarksAndExportApiTests(CohortGradingApiTests):
    """The desk's bulk actions: confirm what the exam already decided, and never grade an essay by batch.

    `finalize` in the class above always writes both answers; these tests need sheets with a blank in them,
    which is exactly the case where a bulk action is useful (zero the empty rows) and where it is dangerous
    (zero a page of prose nobody has read yet).
    """

    def submit_sheet(self, student: User, *, option: QuestionOption | None = None, text: str | None = None) -> ExamAttempt:
        client = self.client_for(student)
        started = client.post(f"/api/v1/student/exams/{self.exam.id}/start/")
        self.assertEqual(started.status_code, 201)
        attempt_id = started.data["id"]
        if option is not None:
            client.patch(
                f"/api/v1/student/attempts/{attempt_id}/answers/{self.keyed.id}/",
                {"selected_option_ids": [str(option.id)]},
                format="json",
            )
        if text is not None:
            client.patch(
                f"/api/v1/student/attempts/{attempt_id}/answers/{self.written.id}/",
                {"text": text},
                format="json",
            )
        self.assertEqual(client.post(f"/api/v1/student/attempts/{attempt_id}/submit/").status_code, 200)
        return ExamAttempt.objects.get(pk=attempt_id)

    def test_confirming_the_key_leaves_every_score_where_it_was(self) -> None:
        from apps.results.models import ExamResult

        right = self.submit_sheet(self.student, option=self.right_option, text="Movement of particles.")
        wrong = self.submit_sheet(self.second_student, option=self.wrong_option, text="A shorter answer.")
        before = {str(attempt.id): ExamResult.objects.get(attempt=attempt).score for attempt in (right, wrong)}

        done = self.teacher_client.post(
            f"/api/v1/results/teacher/exams/{self.exam.id}/auto-marks/", {"confirm_key": True}, format="json"
        )
        self.assertEqual(done.status_code, 200, done.data)
        # Two keyed rows get the teacher's name on them; the two essays still need a human.
        self.assertEqual(done.data["confirmed"], 2)
        self.assertEqual(done.data["left_for_a_human"], 2)
        self.assertEqual(done.data["zeroed"], 0)
        for attempt in (right, wrong):
            result = ExamResult.objects.get(attempt=attempt)
            self.assertEqual(result.score, before[str(attempt.id)], "confirming must not move a number")

        keyed_rows = self.teacher_client.get(self.question_url(self.keyed)).data["rows"]
        self.assertTrue(all(row["manual_score"] is not None for row in keyed_rows), "each keyed row is now an ordinary editable mark")

    def test_a_bulk_action_never_grades_an_essay_the_teacher_has_not_read(self) -> None:
        attempt = self.submit_sheet(self.student, option=self.right_option, text="Diffusion is the net movement of particles.")
        done = self.teacher_client.post(f"/api/v1/results/teacher/exams/{self.exam.id}/auto-marks/", {}, format="json")
        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.data["left_for_a_human"], 1)
        answer = StudentAnswer.objects.get(attempt=attempt, question=self.written)
        self.assertIsNone(answer.manual_score, "an answered written row stays pending unless the teacher zeroes it on purpose")
        result = ExamResult.objects.get(attempt=attempt)
        self.assertEqual(result.pending_manual_grading_count, 1)

    def test_zeroing_the_blank_rows_is_explicit_and_clears_the_queue(self) -> None:
        from apps.results.models import ExamResult

        attempt = self.submit_sheet(self.student, option=self.right_option)  # no essay at all
        done = self.teacher_client.post(
            f"/api/v1/results/teacher/exams/{self.exam.id}/auto-marks/",
            {"confirm_key": False, "zero_unanswered": True},
            format="json",
        )
        self.assertEqual(done.status_code, 200)
        # The blank essay was already awarded zero by the key, so this only closes the queue entry.
        self.assertEqual(done.data["zeroed"], 1)
        self.assertEqual(done.data["confirmed"], 0)
        result = ExamResult.objects.get(attempt=attempt)
        self.assertEqual(result.pending_manual_grading_count, 0)
        self.assertEqual(float(result.score), 2.0, "a zero the teacher chose is still the same zero")

    def test_a_teacher_mark_on_a_row_outranks_the_bulk_action(self) -> None:
        attempt = self.submit_sheet(self.student, option=self.wrong_option, text="x")
        self.teacher_client.patch(
            f"/api/v1/results/teacher/attempts/{attempt.id}/answers/{self.keyed.id}/grade/",
            {"manual_score": "1.00", "feedback": "یک واحد درست."},
            format="json",
        )
        done = self.teacher_client.post(f"/api/v1/results/teacher/exams/{self.exam.id}/auto-marks/", {}, format="json")
        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.data["confirmed"], 0, "the sheet has nothing left for the bulk action to decide")
        self.assertEqual(
            StudentAnswer.objects.get(attempt=attempt, question=self.keyed).manual_score,
            Decimal("1.00"),
            "a written override is not overwritten by a button",
        )

    def test_somebody_elses_paper_is_not_markable_and_not_exportable(self) -> None:
        self.submit_sheet(self.student, option=self.right_option, text="x")
        refused = self.other_client.post(f"/api/v1/results/teacher/exams/{self.exam.id}/auto-marks/", {}, format="json")
        self.assertEqual(refused.status_code, 404, "a foreign paper does not exist for this teacher")
        self.assertEqual(self.other_client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/export/").status_code, 404)

    def test_the_export_is_a_spreadsheet_of_what_the_desk_shows(self) -> None:
        self.submit_sheet(self.student, option=self.right_option, text="Movement of particles.")
        self.submit_sheet(self.second_student, option=self.wrong_option)
        response = self.teacher_client.get(f"/api/v1/results/teacher/exams/{self.exam.id}/export/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        self.assertIn("attachment", response["Content-Disposition"])
        body = response.content.decode("utf-8-sig")
        header, *rows = [line for line in body.strip().split("\n")]
        self.assertEqual(len(rows), 2, "one row per finalized attempt")
        self.assertIn("دانش‌آموز", header)
        self.assertIn("سؤال 1", header)
        self.assertEqual(len(header.split(",")), 10 + 2, "totals plus one column per question")
        self.assertTrue(any("سارا" in row for row in rows), "names are in the file, in Persian")
        self.assertTrue(any(row.split(",")[5] == "2.00" for row in rows), "the awarded mark is the one on screen")
