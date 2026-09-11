"""Adds the content fingerprint of a question.

`content_hash` is what makes "the same question twice in one exam" detectable (see
`apps/exams/content_identity.py`). It starts out blank for every existing row: the next migration fills it
in, and a blank value is excluded from the uniqueness constraint, so a row that was never looked at cannot
fail the constraint on its way in.
"""

from __future__ import annotations

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("exams", "0006_examsettings_question_layout"),
    ]

    operations = [
        migrations.AddField(
            model_name="question",
            name="content_hash",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddIndex(
            model_name="question",
            index=models.Index(fields=("exam", "content_hash"), name="exams_quest_exam_id_9d0a5e_idx"),
        ),
    ]
