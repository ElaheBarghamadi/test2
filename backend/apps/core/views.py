from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health_check(request):  # type: ignore[no-untyped-def]
    """Liveness endpoint intentionally does not expose settings or database details."""
    return JsonResponse({"status": "ok", "service": "examora-backend"})
