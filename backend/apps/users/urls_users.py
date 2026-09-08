from django.urls import path

from .views import PasswordChangeView, UserProfileView

app_name = "users"
urlpatterns = [
    path("me/", UserProfileView.as_view(), name="me"),
    path("me/password/", PasswordChangeView.as_view(), name="password-change"),
]
