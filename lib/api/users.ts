import { apiRequest } from "@/lib/api/client";
import type { ApiStudentDirectoryItemDto, ApiStudentGroupDto, ApiUserDto } from "@/lib/api/dtos";

export const usersApi = {
  me: () => apiRequest<ApiUserDto>("/users/me/"),
  update: (payload: Record<string, unknown>) => apiRequest<ApiUserDto>("/users/me/", { method: "PATCH", body: payload }),
  changePassword: (oldPassword: string, newPassword: string) => apiRequest<void>("/users/me/password/", { method: "POST", body: { old_password: oldPassword, new_password: newPassword } }),
  studentDirectory: (query?: { q?: string; grade?: string; className?: string }) => {
    const params = new URLSearchParams();
    if (query?.q) params.set("q", query.q);
    if (query?.grade) params.set("grade", query.grade);
    if (query?.className) params.set("class_name", query.className);
    const suffix = params.toString();
    return apiRequest<ApiStudentDirectoryItemDto[]>(`/users/students/${suffix ? `?${suffix}` : ""}`, { cacheMs: 10_000 });
  },
  studentGroups: () => apiRequest<ApiStudentGroupDto[]>("/users/groups/", { cacheMs: 10_000 }),
  createStudentGroup: (payload: { name: string; description?: string; student_ids?: string[] }) =>
    apiRequest<ApiStudentGroupDto>("/users/groups/", { method: "POST", body: payload, invalidate: ["/users/groups/", "/users/students/"] }),
  updateStudentGroup: (groupId: string, payload: { name?: string; description?: string; student_ids?: string[] }) =>
    apiRequest<ApiStudentGroupDto>(`/users/groups/${groupId}/`, { method: "PATCH", body: payload, invalidate: ["/users/groups/", "/users/students/"] }),
  deleteStudentGroup: (groupId: string) =>
    apiRequest<void>(`/users/groups/${groupId}/`, { method: "DELETE", invalidate: ["/users/groups/"] }),
};
