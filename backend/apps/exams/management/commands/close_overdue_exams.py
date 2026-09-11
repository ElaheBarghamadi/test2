"""Move exams whose window has closed into `completed`, and grade whatever was still open.

The platform has no scheduler, which is deliberate at this size; running this from cron (or a one-off
`manage.py` call after an exam day) keeps the teacher-facing state honest without adding infrastructure.
The transition is idempotent, so overlapping runs are harmless.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.exams.services import close_overdue_exams


class Command(BaseCommand):
    help = "Finalize active exams whose end time has passed, including their in-progress attempts."

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        closed = close_overdue_exams()
        self.stdout.write(self.style.SUCCESS(f"{closed} exam(s) moved to completed."))
