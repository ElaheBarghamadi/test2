from django.db import migrations, models


class Migration(migrations.Migration):
    """Guards the "a score never exceeds the frozen maximum" invariant at the database level."""

    dependencies = [
        ("results", "0004_backfill_result_maximum_score"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="examresult",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("score__isnull", True),
                    ("score__lte", models.F("maximum_score")),
                    _connector="OR",
                ),
                name="score_within_maximum",
            ),
        ),
    ]
