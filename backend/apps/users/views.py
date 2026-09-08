from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import generics, permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import (
    CurrentUserSerializer,
    CurrentUserUpdateSerializer,
    EmailTokenObtainPairSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
)
from .models import User


class RegisterView(generics.CreateAPIView):
    permission_classes = (permissions.AllowAny,)
    serializer_class = RegisterSerializer

    def create(self, request, *args, **kwargs) -> Response:  # type: ignore[no-untyped-def]
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(CurrentUserSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginView(TokenObtainPairView):
    permission_classes = (permissions.AllowAny,)
    serializer_class = EmailTokenObtainPairSerializer


class RefreshView(TokenRefreshView):
    permission_classes = (permissions.AllowAny,)


class PasswordResetRequestView(APIView):
    """Send a reset URL without revealing whether the requested email is registered."""

    permission_classes = (permissions.AllowAny,)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user and user.has_usable_password():
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?uid={uid}&token={token}"
            send_mail(
                subject="بازیابی گذرواژه Examora",
                message=f"برای ساخت گذرواژه جدید، این پیوند را باز کنید:\n{reset_url}\n\nاگر این درخواست را ثبت نکرده‌اید، این ایمیل را نادیده بگیرید.",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
            )
        # This response deliberately has the same shape for known and unknown email addresses.
        return Response({"detail": "If this email belongs to an active account, a reset link has been sent."})


class PasswordResetConfirmView(APIView):
    permission_classes = (permissions.AllowAny,)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password has been reset."})


class LogoutView(APIView):
    """Blacklist the submitted refresh token; already-issued access tokens remain short-lived."""

    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        refresh_token = request.data.get("refresh")
        if not refresh_token:
            raise serializers.ValidationError({"refresh": "A refresh token is required."})
        try:
            RefreshToken(refresh_token).blacklist()
        except Exception as exc:
            raise serializers.ValidationError({"refresh": "The refresh token is invalid."}) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuthenticatedUserView(APIView):
    """Read-only auth namespace account endpoint used after a token is obtained."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        return Response(CurrentUserSerializer(request.user).data)


class PasswordChangeView(APIView):
    """Authenticated password change keeps privilege and role fields separate from credentials."""

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserProfileView(APIView):
    """Authenticated self-service account/profile endpoint."""

    def get(self, request) -> Response:  # type: ignore[no-untyped-def]
        return Response(CurrentUserSerializer(request.user).data)

    def patch(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = CurrentUserUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(CurrentUserSerializer(user).data)
