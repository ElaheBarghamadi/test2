from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification
from .serializers import NotificationQuerySerializer, NotificationSerializer
from .services import unread_count


class NotificationListView(APIView):
    """The bell. Recipient-scoped by construction: there is no way to read anyone else's rows."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        params = NotificationQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        queryset = Notification.objects.filter(recipient=request.user)
        if params.validated_data["unread_only"]:
            queryset = queryset.filter(is_read=False)
        return Response(
            {
                "unread_count": unread_count(request.user),
                "results": NotificationSerializer(queryset[: params.validated_data["limit"]], many=True).data,
            }
        )


class NotificationCountView(APIView):
    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        return Response({"unread_count": unread_count(request.user)})


class NotificationReadView(APIView):
    def post(self, request, notification_id) -> Response:  # type: ignore[no-untyped-def]
        notification = get_object_or_404(Notification, pk=notification_id, recipient=request.user)
        notification.mark_read()
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        from django.utils import timezone

        updated = Notification.objects.filter(recipient=request.user, is_read=False).update(
            is_read=True, read_at=timezone.now(), updated_at=timezone.now()
        )
        return Response({"updated": updated, "unread_count": unread_count(request.user)})
