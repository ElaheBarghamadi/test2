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
from decimal import Decimal, ROUND_HALF_UP
from typing import TYPE_CHECKING, Any

from apps.exams.models import Question

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .models import StudentAnswer

ZERO = Decimal("0.00")

VERDICT_UNANSWERED = "unanswered"
VERDICT_CORRECT = "correct"
VERDICT_PARTIAL = "partial"
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
    cached_attachments = getattr(answer, "_prefetched_objects_cache", {}).get("attachments")
    if cached_attachments is not None:
        if cached_attachments:
            return True
    elif answer.attachments.exists():
        return True
    if question.type in {
        Question.Type.MULTIPLE_CHOICE,
        Question.Type.MULTIPLE_ANSWER,
        Question.Type.TRUE_FALSE,
    }:
        return bool(selected_option_ids(answer))
    data: Any = getattr(answer, "answer_data", None)
    if question.type == Question.Type.MATCHING:
        matches = data.get("matches") if isinstance(data, dict) else None
        return isinstance(matches, dict) and any(isinstance(value, str) and value for value in matches.values())
    text = data.get("text") if isinstance(data, dict) else None
    return isinstance(text, str) and bool(text.strip())


def requires_manual_grading(question: Question) -> bool:
    """Whether this question needs a human, before looking at whether the student answered it.

    Written answers always do; a short answer does only when the teacher never typed an expected answer,
    because there is then nothing to match against. If image/audio responses are enabled, the prompt can be
    answered in a form the automatic key cannot inspect, so this question is routed to the teacher's desk.
    """
    configuration = question.configuration if isinstance(question.configuration, dict) else {}
    if configuration.get("allow_image_answer") or configuration.get("allow_audio_answer"):
        return True
    if question.type == Question.Type.WRITTEN:
        return True
    if question.type == Question.Type.SHORT_ANSWER:
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


def grade_answer(question: Question, answer: StudentAnswer | None, *, ignore_manual: bool = False) -> AnswerMark:
    """Grade one answer against one question. Never touches the database beyond the given rows.

    `ignore_manual` recomputes what the key alone would have awarded. The marking desk shows the two side by
    side when a teacher has overridden an auto-graded answer, so "the machine said ۲, you said ۰" is visible
    instead of silent - and both numbers come from this one function, so they cannot drift.
    """
    marks = Decimal(str(question.marks))
    # A teacher's pen outranks the key, on every question type - not only on the ones that need a human.
    # The key is a guess about the answer; the mark the teacher entered after looking at it is a decision,
    # and the desk has to be able to say "the auto grade was wrong here" without the total disagreeing.
    # The override is checked before the blank test, because a teacher may also award marks to a question
    # the student left empty.
    if not ignore_manual and answer is not None and answer.manual_score is not None:
        return AnswerMark(
            awarded=Decimal(str(answer.manual_score)),
            verdict=VERDICT_MANUAL,
            requires_manual=requires_manual_grading(question),
        )
    if not answer_has_value(question, answer):
        # A blank is a zero, not a task for the teacher: an unanswered written question never enters the
        # grading queue, so a sheet cannot stay "pending" over an empty page the student chose to skip.
        return AnswerMark(awarded=ZERO, verdict=VERDICT_UNANSWERED, requires_manual=False)

    assert answer is not None  # narrowed by answer_has_value
    if requires_manual_grading(question):
        return AnswerMark(awarded=ZERO, verdict=VERDICT_PENDING, requires_manual=True)

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
    elif question.type == Question.Type.MATCHING:
        configuration = question.configuration if isinstance(question.configuration, dict) else {}
        pairs = configuration.get("matching_pairs", [])
        options_by_text = {option.text.strip().casefold(): str(option.id) for option in question.options.all()}
        expected = {
            str(pair.get("id")): options_by_text.get(str(pair.get("answer", "")).strip().casefold(), "")
            for pair in pairs if isinstance(pair, dict) and pair.get("id")
        }
        expected = {prompt_id: option_id for prompt_id, option_id in expected.items() if option_id}
        if not expected:
            return AnswerMark(awarded=ZERO, verdict=VERDICT_INCORRECT, requires_manual=False)
        data: Any = answer.answer_data if isinstance(answer.answer_data, dict) else {}
        matches = data.get("matches") if isinstance(data.get("matches"), dict) else {}
        correct_count = sum(str(matches.get(prompt_id, "")) == option_id for prompt_id, option_id in expected.items())
        awarded = (marks * Decimal(correct_count) / Decimal(len(expected))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if correct_count == len(expected):
            verdict = VERDICT_CORRECT
        elif correct_count:
            verdict = VERDICT_PARTIAL
        else:
            verdict = VERDICT_INCORRECT
        return AnswerMark(awarded=awarded, verdict=verdict, requires_manual=False)
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
