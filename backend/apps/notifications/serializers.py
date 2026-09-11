from __future__ import annotations

from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ("id", "kind", "title", "body", "link", "exam", "attempt", "is_read", "created_at", "read_at")
        read_only_fields = fields


class NotificationQuerySerializer(serializers.Serializer):
    unread_only = serializers.BooleanField(required=False, default=False)
    limit = serializers.IntegerField(required=False, min_value=1, max_value=100, default=30)
