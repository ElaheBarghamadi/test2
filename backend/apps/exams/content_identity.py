"""What makes two questions *the same question*.

The builder writes questions one at a time, and a page that re-saves a draft it has already sent used to
produce a second copy of every question — same stem, same options, same key. Two identical rows in one exam
are not a cosmetic problem: the student answers the same statement twice for double the marks, and the
delete-and-recreate that follows detaches the answers and grades of attempts that already happened.

So "completely duplicate" gets one definition, shared by the write path, the bank import and the migration
that cleaned up the copies the old code left behind:

* identity is the *content*: type, wording, instructions, configuration, marks and the ordered options with
  which one of them is the key;
* wording is normalised (NFKC, trimmed, whitespace collapsed, casefolded) because a stray space or a
  different letter case is the same question typed twice, not a new one;
* `order`, difficulty and tags are *not* part of it — reordering a paper or re-tagging a question must
  never look like a new question. `explanation` is part of it: a question whose feedback differs is a
  different question, and merging the two would silently drop one teacher's wording.

The hash is only ever an index-sized fingerprint of that tuple; the tuple itself stays in the rows, so a
collision would show up as a wrong dedupe rather than lost data.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping

BLANK = ""


# The Arabic and Persian forms of two letters, two families of digits and the zero-width joiner are typed
# differently and mean the same thing, so a fingerprint must not depend on which keyboard wrote them.
_FOLD = str.maketrans({
    "\u064a": "\u06cc",  # Arabic yeh -> Persian yeh
    "\u0643": "\u06a9",  # Arabic keheh -> Persian keheh
    **{chr(0x0660 + index): chr(0x06F0 + index) for index in range(10)},  # Arabic-Indic -> Persian digits
})


def normalize_wording(value: Any) -> str:
    """Case-, space- and keyboard-insensitive text, for comparing what a teacher typed."""
    text = unicodedata.normalize("NFKC", "" if value is None else str(value)).translate(_FOLD)
    text = text.replace("\u200c", "").replace("\u200d", "")
    return " ".join(text.strip().casefold().split())


def _marks(value: Any) -> str:
    try:
        return str(Decimal(str(value)).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return str(value)


def _canonical(value: Any) -> Any:
    """A JSON-stable form of `configuration`, so two dicts that mean the same hash the same.

    Empty values are dropped: a question that omits `case_sensitive` and one that sends `false` are the same
    question, and clients differ on which of the two they send.
    """
    if isinstance(value, Mapping):
        return {str(key): _canonical(item) for key, item in sorted(value.items()) if not _is_empty(item)}
    if isinstance(value, (list, tuple)):
        return [_canonical(item) for item in value]
    if isinstance(value, Decimal):
        return _marks(value)
    if isinstance(value, bool) or value is None or isinstance(value, (int, float, str)):
        return value
    return str(value)


def _is_empty(value: Any) -> bool:
    return value is None or value is False or value == "" or value == [] or value == {}


def content_identity(
    *,
    question_type: str,
    text: str,
    instructions: str = "",
    explanation: str = "",
    marks: Any = 1,
    configuration: Mapping[str, Any] | None = None,
    options: Iterable[Mapping[str, Any]] = (),
) -> str:
    """A stable fingerprint of one question's content. Options are taken in the order given."""
    payload = {
        "type": str(question_type),
        "text": normalize_wording(text),
        "instructions": normalize_wording(instructions),
        # The feedback a student may be shown is part of what the question is: two rows that differ only
        # there are not "the same question", and merging them would quietly drop one teacher's wording.
        "explanation": normalize_wording(explanation),
        "marks": _marks(marks),
        "configuration": _canonical(configuration or {}),
        "options": [
            {"text": normalize_wording(option.get("text")), "is_correct": bool(option.get("is_correct"))}
            for option in options
        ],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def question_content_hash(question: Any) -> str:
    """The identity of a saved question, read back from its own rows."""
    return content_identity(
        question_type=question.type,
        text=question.text,
        instructions=question.instructions,
        explanation=question.explanation,
        marks=question.marks,
        configuration=question.configuration or {},
        options=[{"text": option.text, "is_correct": option.is_correct} for option in question.options.order_by("order")],
    )
