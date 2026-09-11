from django.urls import path

from .views import NotificationCountView, NotificationListView, NotificationReadAllView, NotificationReadView

app_name = "notifications"
urlpatterns = [
    path("", NotificationListView.as_view(), name="list"),
    path("unread-count/", NotificationCountView.as_view(), name="unread-count"),
    path("read-all/", NotificationReadAllView.as_view(), name="read-all"),
    path("<uuid:notification_id>/read/", NotificationReadView.as_view(), name="read"),
]
