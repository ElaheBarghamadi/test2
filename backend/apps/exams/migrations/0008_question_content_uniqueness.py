"""Fingerprints every existing question, cleans up the exact copies, then enforces one copy per exam.

Two things happen here, in this order:

1. Every question gets the hash of its content. Where an exam holds *identical* questions — the artifact of
   an older builder that re-created a question on each save — the earliest copy keeps its place and the
   later ones are deleted **only when no student has answered them**. A duplicate that already has answers is
   history the student lived through, so it is left alone and simply keeps no hash, which is exactly the
   case the partial constraint below excludes.
2. The unique constraint goes in, so nothing can create a second copy again.

`total_marks` is recomputed for any exam that lost rows, because that column is refreshed from the question
marks rather than trusted from the request.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import migrations, models


def _identity(question) -> str:
    """The content fingerprint, from the historical rows only.

    `apps.exams.content_identity` is deliberately not imported: a migration must keep working after that
    module changes, and the hash of a question that already exists must never move under it. The
    normalisation matches what the app function does today — trimmed, whitespace-collapsed, case-folded
    wording — and is only used to *group* rows here.
    """
    import hashlib
    import json
    import unicodedata
    from decimal import Decimal as _Decimal, InvalidOperation

    fold = str.maketrans({
        "\u064a": "\u06cc",
        "\u0643": "\u06a9",
        **{chr(0x0660 + index): chr(0x06F0 + index) for index in range(10)},
    })

    def word(value) -> str:
        text = unicodedata.normalize("NFKC", "" if value is None else str(value)).translate(fold)
        text = text.replace("\u200c", "").replace("\u200d", "")
        return " ".join(text.strip().casefold().split())

    try:
        marks = str(_Decimal(str(question.marks)).quantize(_Decimal("0.01")))
    except (InvalidOperation, ValueError):
        marks = str(question.marks)

    def canonical(value):
        if isinstance(value, dict):
            return {str(k): canonical(v) for k, v in sorted(value.items()) if not (v in (None, False, "", [], {}))}
        if isinstance(value, (list, tuple)):
            return [canonical(v) for v in value]
        return value if isinstance(value, (bool, int, float, str)) or value is None else str(value)

    payload = {
        "type": str(question.type),
        "text": word(question.text),
        "instructions": word(question.instructions),
        "explanation": word(question.explanation),
        "marks": marks,
        "configuration": canonical(question.configuration or {}),
        "options": [{"text": word(option.text), "is_correct": bool(option.is_correct)} for option in question.options.order_by("order")],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def backfill_and_dedupe(apps, schema_editor) -> None:
    Question = apps.get_model("exams", "Question")
    Exam = apps.get_model("exams", "Exam")
    StudentAnswer = apps.get_model("attempts", "StudentAnswer")

    for exam_id in list(Question.objects.values_list("exam_id", flat=True).distinct()):
        rows = list(Question.objects.filter(exam_id=exam_id).prefetch_related("options").order_by("order", "created_at"))
        seen: dict[str, object] = {}
        removed = False
        for question in rows:
            identity = _identity(question)
            if identity in seen:
                if StudentAnswer.objects.filter(question=question).exists():
                    # Keep the answered twin, unhashed: the constraint must not be able to refuse a row that
                    # is already part of a student's grade.
                    Question.objects.filter(pk=question.pk).update(content_hash="")
                    continue
                question.delete()
                removed = True
                continue
            seen[identity] = question
            if question.content_hash != identity:
                Question.objects.filter(pk=question.pk).update(content_hash=identity)
        if removed:
            total = Decimal("0.00")
            for marks in Question.objects.filter(exam_id=exam_id).values_list("marks", flat=True):
                total += marks or Decimal("0.00")
            Exam.objects.filter(pk=exam_id).update(total_marks=total.quantize(Decimal("0.01")))


def blank_hashes(apps, schema_editor) -> None:
    """Reverse is a no-op apart from dropping the fingerprints; deleted twins cannot come back."""
    apps.get_model("exams", "Question").objects.exclude(content_hash="").update(content_hash="")


class Migration(migrations.Migration):
    dependencies = [
        ("exams", "0007_question_content_hash"),
        ("attempts", "0006_examattempt_answer_frontier_alter_attemptevent_kind"),
    ]

    operations = [
        migrations.RunPython(backfill_and_dedupe, blank_hashes),
        migrations.AddConstraint(
            model_name="question",
            constraint=models.UniqueConstraint(
                fields=("exam", "content_hash"),
                condition=~models.Q(content_hash=""),
                name="unique_question_content_per_exam",
                violation_error_message="This exam already holds an identical question.",
            ),
        ),
    ]
