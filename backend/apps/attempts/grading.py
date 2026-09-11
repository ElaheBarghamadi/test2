"""The one place that decides what an answer is worth.

Grading used to live entirely inside `_grade_attempt`, which meant the only consumer of a verdict was the
final score. A teacher marking a sheet then saw just the questions awaiting a pen, and the auto-graded
half of the paper — which is most of it — was invisible: no mark per question, no way to see what the
machine had decided or why. This module keeps that decision in one function so the persisted score and
every teacher-facing read of a single answer are computed the same way and cannot drift apart.

The rules themselves are unchanged: exact correct-option set matching for choice types (multiple-answer is
full-credit only), trimmed exact matching against `expected_answers` for short answers, a teacher's pen for
written answers and short answers with no key, and zero for a question the student left blank.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from apps.exams.models import Question

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .models import StudentAnswer

ZERO = Decimal("0.00")

VERDICT_UNANSWERED = "unanswered"
VERDICT_CORRECT = "correct"
VERDICT_INCORRECT = "incorrect"
VERDICT_PENDING = "pending"
VERDICT_MANUAL = "manual"


def selected_option_ids(answer: StudentAnswer | None) -> list[str]:
    """The options a student picked, as strings.

    `_grade_attempt` caches this from its own prefetch (`_selected_option_ids`) because it walks the whole
    sheet in one transaction; a serializer showing a handful of answers reads the prefetched relation
    directly instead of assuming the cache is there.
    """
    if answer is None:
        return []
    cached = getattr(answer, "_selected_option_ids", None)
    if cached is not None:
        return [str(option_id) for option_id in cached]
    return [str(option.id) for option in answer.selected_options.all()]


def answer_has_value(question: Question, answer: StudentAnswer | None) -> bool:
    if answer is None:
        return False
    if question.type in {
        Question.Type.MULTIPLE_CHOICE,
        Question.Type.MULTIPLE_ANSWER,
        Question.Type.TRUE_FALSE,
    }:
        return bool(selected_option_ids(answer))
    data: Any = getattr(answer, "answer_data", None)
    text = data.get("text") if isinstance(data, dict) else None
    return isinstance(text, str) and bool(text.strip())


def requires_manual_grading(question: Question) -> bool:
    """Whether this question needs a human, before looking at whether the student answered it.

    Written answers always do; a short answer does only when the teacher never typed an expected answer,
    because there is then nothing to match against.
    """
    if question.type == Question.Type.WRITTEN:
        return True
    if question.type == Question.Type.SHORT_ANSWER:
        configuration = question.configuration or {}
        return not configuration.get("expected_answers", [])
    return False


@dataclass(frozen=True)
class AnswerMark:
    """What one answer is worth, and how that was decided."""

    awarded: Decimal
    verdict: str
    requires_manual: bool

    @property
    def is_auto(self) -> bool:
        return not self.requires_manual and self.verdict != VERDICT_UNANSWERED


def grade_answer(question: Question, answer: StudentAnswer | None) -> AnswerMark:
    """Grade one answer against one question. Never touches the database beyond the given rows."""
    marks = Decimal(str(question.marks))
    if not answer_has_value(question, answer):
        # A blank is a zero, not a task for the teacher: an unanswered written question never enters the
        # grading queue, so a sheet cannot stay "pending" over an empty page the student chose to skip.
        return AnswerMark(awarded=ZERO, verdict=VERDICT_UNANSWERED, requires_manual=False)

    assert answer is not None  # narrowed by answer_has_value
    if requires_manual_grading(question):
        if answer.manual_score is None:
            return AnswerMark(awarded=ZERO, verdict=VERDICT_PENDING, requires_manual=True)
        return AnswerMark(awarded=Decimal(str(answer.manual_score)), verdict=VERDICT_MANUAL, requires_manual=True)

    if question.type == Question.Type.SHORT_ANSWER:
        configuration = question.configuration or {}
        data: Any = answer.answer_data if isinstance(answer.answer_data, dict) else {}
        answer_text = str(data.get("text", "")).strip()
        case_sensitive = bool(configuration.get("case_sensitive", False))
        comparable_answer = answer_text if case_sensitive else answer_text.casefold()
        comparable_expected = {
            item.strip() if case_sensitive else item.strip().casefold()
            for item in configuration.get("expected_answers", [])
        }
        is_correct = comparable_answer in comparable_expected
    else:
        selected = {str(option_id) for option_id in selected_option_ids(answer)}
        correct_ids = {str(option.id) for option in question.options.all() if option.is_correct}
        # Multiple-answer deliberately awards full credit only for an exact set: half-right selections are
        # not half a correct answer in a fixed-key exam.
        is_correct = selected == correct_ids

    return AnswerMark(
        awarded=marks if is_correct else ZERO,
        verdict=VERDICT_CORRECT if is_correct else VERDICT_INCORRECT,
        requires_manual=False,
    )
