"""Remove old network/browser metadata from finalized attempts.

Schedule this command daily in production. It uses EXAM_ACCESS_INFO_RETENTION_DAYS (30 days by default),
which can be overridden explicitly with --retention-days for a one-off run.
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.attempts.services import purge_expired_access_info


class Command(BaseCommand):
    help = "Scrub expired IP, User-Agent, and device-signature metadata from finalized attempts."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument("--retention-days", type=int, default=None)

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        days = options["retention_days"]
        if days is not None and days < 1:
            raise CommandError("--retention-days must be at least 1.")
        removed = purge_expired_access_info(retention_days=days)
        effective_days = days or settings.EXAM_ACCESS_INFO_RETENTION_DAYS
        self.stdout.write(
            self.style.SUCCESS(f"Scrubbed access metadata for {removed} attempt(s) older than {effective_days} days.")
        )
