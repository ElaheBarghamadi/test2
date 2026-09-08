from __future__ import annotations

from typing import Any

from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """Keep DRF's standard details while giving clients one predictable envelope."""
    response = drf_exception_handler(exc, context)
    if response is not None:
        response.data = {"detail": response.data, "status_code": response.status_code}
    return response
