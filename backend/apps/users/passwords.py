"""Password-quality errors, in the language the people using this app actually read.

Django translates most validator messages through its own catalogs, but `MinimumLengthValidator` builds its
message with a plural form whose Persian entry is missing from the shipped catalog, so a password under
eight characters came back as an English sentence in the middle of a Persian form — the one error a
first-time user is most likely to hit. Rather than patch a translation catalog, each code this project can
produce is mapped here; Django's own text stays as the fallback so a future validator cannot silently lose
its reason.
"""

from __future__ import annotations

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

PASSWORD_MESSAGES: dict[str, str] = {
    "password_too_short": "گذرواژه باید دست‌کم ۸ کاراکتر داشته باشد.",
    "password_too_common": "این گذرواژه بسیار رایج است؛ گذرواژه‌ای یکتا انتخاب کنید.",
    "password_entirely_numeric": "گذرواژه نباید فقط از عدد تشکیل شده باشد.",
    "password_too_similar": "گذرواژه بیش از حد به ایمیل یا نام شما شبیه است؛ ترکیب دیگری انتخاب کنید.",
}


def password_errors(password: str, user=None) -> list[str]:  # type: ignore[no-untyped-def]
    """Every reason this password was refused, in Persian, ready for a serializer's error payload."""
    try:
        validate_password(password, user)
    except ValidationError as exc:
        return [PASSWORD_MESSAGES.get(error.code, error.messages[0]) for error in exc.error_list]
    return []
