import { apiRequest } from "@/lib/api/client";
import type { ApiAuthResponseDto, ApiRegisterPayload, ApiUserDto } from "@/lib/api/dtos";

export const authApi = {
  register: (payload: ApiRegisterPayload) => apiRequest<ApiUserDto>("/auth/register/", { method: "POST", body: payload, auth: false }),
  login: (email: string, password: string) => apiRequest<ApiAuthResponseDto>("/auth/login/", { method: "POST", body: { email, password }, auth: false }),
  me: () => apiRequest<ApiUserDto>("/auth/me/"),
  requestPasswordReset: (email: string) => apiRequest<{ detail: string }>("/auth/password-reset/", { method: "POST", body: { email }, auth: false }),
  confirmPasswordReset: (uid: string, token: string, newPassword: string) => apiRequest<{ detail: string }>("/auth/password-reset/confirm/", { method: "POST", body: { uid, token, new_password: newPassword }, auth: false }),
  logout: (refresh: string) => apiRequest<void>("/auth/logout/", { method: "POST", body: { refresh } }),
};
