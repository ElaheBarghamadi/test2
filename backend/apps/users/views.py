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
    """
    Create an account, and sign it in, in one request.

    The response carries the created account *and* the token pair, because the client used to need a second
    call (`/auth/login/`) right after this one — and that call is exactly where a slow connection leaves a
    user who exists on the server staring at a form that says sign-up failed. Anyone who retries then hits
    "email already registered". One request means one outcome: either the account and its session exist, or
    nothing was created.

    The account fields stay at the top level of the response so clients written against the earlier shape
    keep working; `access`/`refresh` are added beside them.
    """

    permission_classes = (permissions.AllowAny,)
    serializer_class = RegisterSerializer
    throttle_scope = "register"

    def create(self, request, *args, **kwargs) -> Response:  # type: ignore[no-untyped-def]
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response(
            {**CurrentUserSerializer(user).data, "access": str(refresh.access_token), "refresh": str(refresh)},
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    permission_classes = (permissions.AllowAny,)
    serializer_class = EmailTokenObtainPairSerializer
    # The one endpoint worth brute-forcing, so it is the one that says "slow down".
    throttle_scope = "login"


class RefreshView(TokenRefreshView):
    permission_classes = (permissions.AllowAny,)


class PasswordResetRequestView(APIView):
    """Send a reset URL without revealing whether the requested email is registered."""

    permission_classes = (permissions.AllowAny,)
    throttle_scope = "password_reset"

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
        return Response({"detail": "اگر این ایمیل به یک حساب فعال تعلق داشته باشد، پیوند بازیابی ارسال شده است."})


class PasswordResetConfirmView(APIView):
    permission_classes = (permissions.AllowAny,)
    throttle_scope = "password_reset"

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "گذرواژه با موفقیت تغییر کرد."})


class LogoutView(APIView):
    """Blacklist the submitted refresh token; already-issued access tokens remain short-lived."""

    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request) -> Response:  # type: ignore[no-untyped-def]
        refresh_token = request.data.get("refresh")
        if not refresh_token:
            raise serializers.ValidationError({"refresh": "برای خروج، توکن تازه‌سازی نشست لازم است."})
        try:
            token = RefreshToken(refresh_token)
        except Exception as exc:
            raise serializers.ValidationError({"refresh": "توکن تازه‌سازی نشست نامعتبر است."}) from exc
        # A logout request may only revoke its own session: without this, possession of any other
        # user's refresh string (a leaked reset email, a shared browser) would be a denial-of-service
        # against that account.
        # `user_id` is the user model's primary key as a string: this project's User is UUID-keyed, so
        # it is compared as text (int() here would raise a 500 on every logout).
        if str(token.payload.get("user_id")) != str(request.user.pk):
            raise serializers.ValidationError({"refresh": "این نشست به حساب شما تعلق ندارد."})
        token.blacklist()
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
