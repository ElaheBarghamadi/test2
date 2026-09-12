"""Conditional GET support for the JSON API.

`next.config.ts` tells every browser to revalidate an API response before it trusts it. Revalidation is only
worth anything if the server can answer it cheaply, which is what this middleware is for: it puts a validator
on a read, and when the client comes back with that validator unchanged, it answers 304 with no body at all.

Two things this deliberately is not:

  * a cache that serves data on its own. Every decision here is made by comparing what the client already
    holds with what the view just produced; the view still runs, so access control, expiry and per-user
    scoping are never skipped;
  * a shared cache. The validator is salted with the requesting user's id, so an etag learned for one session
    cannot be used to test whether *another* user's payload is unchanged. On an exam platform that asymmetry
    is the whole point: a list of students is not the kind of thing whose hash should be a question oracle.
"""

from __future__ import annotations

import hashlib
from typing import Any

from django.http import HttpRequest, HttpResponse, HttpResponseNotModified

SAFE_METHODS = frozenset({"GET", "HEAD"})
API_PREFIX = "/api/"


def _validator(user_id: Any, body: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(str(user_id or "anonymous").encode("utf-8"))
    digest.update(b"\0")
    digest.update(body)
    # Weak, because it vouches for "the same payload this session was just given", not for byte-identical
    # representations across encodings or across users.
    return f'W/"{digest.hexdigest()[:32]}"'


class ConditionalApiGetMiddleware:
    """Adds `ETag`/`Cache-Control` to API reads and honours `If-None-Match` with a 304."""

    def __init__(self, get_response) -> None:  # type: ignore[no-untyped-def]
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        if not self._applies(request, response):
            return response

        body = getattr(response, "content", b"") or b""
        user = getattr(request, "user", None)
        etag = _validator(getattr(user, "id", None), body)
        # `must-revalidate` is the promise the frontend's headers are written around: a stored body may be
        # shown while it is being re-checked, and never after the server has stopped agreeing with it.
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = "private, max-age=0, must-revalidate"
        response.headers["Vary"] = "Cookie, Authorization"

        if request.headers.get("If-None-Match") == etag:
            not_modified = HttpResponseNotModified()
            not_modified.headers["ETag"] = etag
            not_modified.headers["Cache-Control"] = response.headers["Cache-Control"]
            not_modified.headers["Vary"] = response.headers["Vary"]
            return not_modified
        return response

    @staticmethod
    def _applies(request: HttpRequest, response: HttpResponse) -> bool:
        if not request.path.startswith(API_PREFIX):
            return False
        if request.method not in SAFE_METHODS:
            return False
        # A write, an error page, or a streamed file has no business being revalidated from a browser copy.
        if response.status_code != 200 or getattr(response, "streaming", False):
            return False
        return "application/json" in (response.headers.get("Content-Type") or "")
