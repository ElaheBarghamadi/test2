#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
from __future__ import annotations

import os
import sys

# `CheckConstraint(condition=…)` — used by the constraints in `apps/exams`, `apps/attempts` and
# `apps/results` — only exists from Django 5.1, where it replaced `check=`. On 5.0 and older, importing the
# models raises `TypeError: CheckConstraint.__init__() got an unexpected keyword argument 'condition'`
# from somewhere deep inside `models.py`, which says nothing about the actual problem: the interpreter
# running the command is not the one `requirements.lock` was built for. That is easy to hit, because
# `python manage.py …` silently picks up whatever Django happens to be installed globally.
MIN_DJANGO = (5, 1)
PINNED_DJANGO = "5.2.17"


def _fail_wrong_django(rendered: str, path: str) -> None:  # pragma: no cover - developer-facing
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    windows = os.name == "nt"
    python = r".venv\Scripts\python.exe" if windows else "./.venv/bin/python"
    pip = r".venv\Scripts\pip.exe" if windows else "./.venv/bin/pip"
    activate = r".venv\Scripts\activate" if windows else "source .venv/bin/activate"
    lines = [
        "",
        f"  Django {rendered} پیدا شد، ولی این پروژه به Django {MIN_DJANGO[0]}.{MIN_DJANGO[1]} یا تازه‌تر نیاز دارد",
        f"  (نسخهٔ قفل‌شده در requirements.lock: {PINNED_DJANGO}).",
        "",
        f"  مفسرِ در حال اجرا: {sys.executable}",
        f"  جنگوی در حال اجرا:  {path}",
        "  داخل محیط مجازی پروژه هستید؟ " + ("بله — ولی وابستگی‌هایش به‌روز نیستند." if in_venv else "خیر — این پایتونِ سراسری سیستم است."),
        "",
        "  راه‌حل، از پوشهٔ backend:",
        "",
        f"    python -m venv .venv{'' if in_venv else '   (اگر .venv وجود ندارد)'}",
        f"    {pip} install -r requirements.lock",
        f"    {python} manage.py migrate",
        "",
        f"  یا محیط مجازی را فعال کنید و بعد همان دستور قبلی را بزنید:  {activate}",
        "",
        "  نکته: `python manage.py …` بدون فعال‌کردن .venv همان پایتون سراسری را به کار می‌برد.",
        "",
    ]
    print("\n".join(lines), file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        import django
        from django.core.management import execute_from_command_line
    except ImportError as exc:  # pragma: no cover - standard Django bootstrap guard
        raise ImportError("Django is not installed. Install backend dependencies first.") from exc

    # Before anything imports a model: the failure has to name the version, not a constraint kwarg.
    digits = tuple(int(part) for part in django.__version__.split(".")[:2] if part.isdigit())
    if digits < MIN_DJANGO:  # pragma: no cover - developer-facing
        _fail_wrong_django(django.__version__, os.path.dirname(django.__file__))

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
