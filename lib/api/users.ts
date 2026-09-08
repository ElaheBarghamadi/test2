import { apiRequest } from "@/lib/api/client";
import type { ApiUserDto } from "@/lib/api/dtos";

export const usersApi = {
  me: () => apiRequest<ApiUserDto>("/users/me/"),
  update: (payload: Record<string, unknown>) => apiRequest<ApiUserDto>("/users/me/", { method: "PATCH", body: payload }),
  changePassword: (oldPassword: string, newPassword: string) => apiRequest<void>("/users/me/password/", { method: "POST", body: { old_password: oldPassword, new_password: newPassword } }),
};
