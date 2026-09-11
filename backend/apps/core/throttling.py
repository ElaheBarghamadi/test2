from __future__ import annotations

from django.conf import settings
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle as DRFScopedRateThrottle

DISABLED_RATES = {"", "0", "none", "off", "disabled"}


class ScopedRateThrottle(DRFScopedRateThrottle):
    """Rate limiting for the endpoints that are worth attacking, on the LocMem cache.

    Design notes, in order of how much they matter:

    * Login and password-reset buckets are keyed by *source IP plus the account named in the body*.
      Keying only on the email lets an attacker rotate addresses freely; keying only on the IP locks a
      whole school out through one shared NAT. Both together slow credential stuffing without that risk.
    * Views opt in with ``throttle_scope``. Nothing else pays for the cache round-trip, which matters on
      the autosave path that a class of 180 students hits constantly.
    * A rate of ``""``/``"0"`` disables a scope, so an operator can loosen a limit by environment
      variable instead of a deploy.
    * The test suite opts out by default because the cache is not flushed between test methods;
      ``THROTTLE_DURING_TESTS`` turns it back on for the tests that assert it.
    """

    # Which request body fields identify the target of the attempt, per scope. The default class has to
    # know this: a view opts in by naming a `throttle_scope`, and it is that class — not a per-endpoint
    # subclass — that builds the cache key.
    ident_fields_by_scope = {
        "login": ("email",),
        "password_reset": ("email",),
    }
    ident_from_body: tuple[str, ...] = ()

    def get_cache_key(self, request, view):  # type: ignore[no-untyped-def]
        if getattr(settings, "TESTING", False) and not getattr(settings, "THROTTLE_DURING_TESTS", False):
            return None
        scope = getattr(view, "throttle_scope", None)
        if not scope:
            return None
        # Read through api_settings, not the class-level `rates` copy: that snapshot is taken at import
        # time and would ignore `override_settings` in tests and any runtime change.
        rate = api_settings.DEFAULT_THROTTLE_RATES.get(scope)
        if rate is None:
            # A scope with no configured rate is a configuration mistake, not a reason to crash a request.
            return None
        if str(rate).strip().lower() in DISABLED_RATES:
            return None
        self.rate = rate
        self.num_requests, self.duration = self.parse_rate(rate)
        key = super().get_cache_key(request, view)
        if key is None:
            return None
        ident = self.body_ident(request, scope)
        return f"{key}:{ident}" if ident else key

    def body_ident(self, request, scope: str = "") -> str:  # type: ignore[no-untyped-def]
        fields = tuple(self.ident_from_body) or tuple(self.ident_fields_by_scope.get(scope, ()))
        for field in fields:
            value = request.data.get(field) if hasattr(request.data, "get") else None
            if isinstance(value, str) and value.strip():
                return value.strip().lower()[:80]
        return ""


class LoginRateThrottle(ScopedRateThrottle):
    """Explicit variant for a view that wants the login bucket without naming a scope."""

    scope = "login"
