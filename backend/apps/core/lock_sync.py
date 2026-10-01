"""Keep `requirements.lock` honest about `pyproject.toml`.

The pins in the lockfile are the security boundary of this project: `djangorestframework==3.17.2` is what makes
`DATA_UPLOAD_MAX_MEMORY_SIZE` apply to `request.data`, and `PyJWT==2.15.1` is what fixes the JWK-set parsing
advisories. Both files are edited by hand, and nothing used to notice when they disagreed — a raised floor in
`pyproject.toml` with the old pin left in the lockfile installs the version the project just declared
unacceptable.

The rule: every dependency declared in `pyproject.toml` must be pinned in the lock, and the pin must satisfy the
declared specifiers. Markers are parsed but not evaluated, because a pin may legitimately be platform-specific
(`tzdata` is Windows-only, `typing-extensions` is only needed below Python 3.13) — what matters here is that a
security floor is not quietly skipped on the platform that needs it.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

PIN = re.compile(r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*(?P<version>[^\s;]+)\s*(?:;\s*(?P<marker>.+))?$")
SPECIFIER = re.compile(r"(?P<operator>>=|<=|==|!=|>|<)\s*(?P<version>[0-9][0-9A-Za-z.\-]*)")
REQUIREMENT = re.compile(r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)")

BACKEND_DIR = Path(__file__).resolve().parents[2]


def normalise(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def numeric(version: str) -> tuple[int, ...]:
    """`3.17.2` -> (3, 17, 2): enough for the plain release numbers this project pins."""
    parts = []
    for chunk in version.split("."):
        digits = re.match(r"\d+", chunk)
        parts.append(int(digits.group()) if digits else 0)
    return tuple(parts)


def parse_lock(path: Path) -> dict[str, tuple[str, str | None]]:
    pinned: dict[str, tuple[str, str | None]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = PIN.match(line)
        if match:
            pinned[normalise(match["name"])] = (match["version"], match["marker"])
    return pinned


def declared_requirements(path: Path) -> list[str]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return list(data.get("project", {}).get("dependencies", []))


def check(backend_dir: Path = BACKEND_DIR) -> list[str]:
    """Returns a list of human-readable problems; empty means the two files agree."""
    pinned = parse_lock(backend_dir / "requirements.lock")
    problems: list[str] = []
    for requirement in declared_requirements(backend_dir / "pyproject.toml"):
        name_match = REQUIREMENT.match(requirement)
        if not name_match:
            problems.append(f"cannot read the dependency name in {requirement!r}")
            continue
        name = normalise(name_match["name"])
        if name not in pinned:
            problems.append(f"{name} is declared in pyproject.toml but not pinned in requirements.lock")
            continue
        version = pinned[name][0]
        for operator, wanted in SPECIFIER.findall(requirement):
            got, want = numeric(version), numeric(wanted)
            satisfied = {
                ">=": got >= want,
                "<=": got <= want,
                "==": got == want,
                "!=": got != want,
                ">": got > want,
                "<": got < want,
            }[operator]
            if not satisfied:
                problems.append(f"{name}=={version} violates the declared {operator}{wanted}")
    return problems
