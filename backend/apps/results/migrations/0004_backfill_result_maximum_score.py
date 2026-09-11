"""Freeze the grading denominator on existing results.

`ExamResult.maximum_score` is added with a `score <= maximum_score` check, so historical rows must be
backfilled from their exam total before the constraint can hold. Rows whose exam total no longer matches
keep the exam total: it is the best available record of what the attempt was scored against.
"""

from __future__ import annotations

from django.db import migrations


def backfill(apps, schema_editor) -> None:
    ExamResult = apps.get_model("results", "ExamResult")
    Exam = apps.get_model("exams", "Exam")
    totals = {str(exam.id): exam.total_marks for exam in Exam.objects.only("id", "total_marks").iterator()}
    for result in ExamResult.objects.select_related("attempt").iterator():
        maximum = totals.get(str(result.attempt.exam_id))
        if maximum is None:
            continue
        # A stored score above the live total can only mean the exam changed after grading; keep the
        # result self-consistent so the constraint is not violated for historical rows.
        if result.score is not None and result.score > maximum:
            maximum = result.score
        result.maximum_score = maximum
        result.save(update_fields=("maximum_score", "updated_at"))


def noop(apps, schema_editor) -> None:
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("results", "0003_examresult_maximum_score_examresult_revised_at_and_more"),
        ("exams", "0005_questiontag_examsettings_allow_unanswered_and_more"),
    ]

    operations = [migrations.RunPython(backfill, noop, elidable=True)]
