"""`python manage.py check_lock` — is `requirements.lock` still what `pyproject.toml` declared?

Runs in CI next to the dependency audit: the audit asks "is any pinned version known-bad", this asks "is the
pin still inside the range the project declared". A security fix that raises a floor in `pyproject.toml` and
forgets the lockfile is exactly the failure this catches.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.core.lock_sync import check


class Command(BaseCommand):
    help = "Verify that every dependency declared in pyproject.toml is pinned inside its range in requirements.lock."

    def handle(self, *args, **options):  # type: ignore[no-untyped-def]
        problems = check()
        for problem in problems:
            self.stderr.write(f"  - {problem}")
        if problems:
            raise CommandError("requirements.lock does not match pyproject.toml")
        self.stdout.write(self.style.SUCCESS("requirements.lock matches pyproject.toml"))
