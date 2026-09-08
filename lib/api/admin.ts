import { apiRequest } from "@/lib/api/client";
import type { ApiAdminExamDto, ApiAdminOverviewDto, ApiAdminUserDto, ApiSchoolDto } from "@/lib/api/dtos";

export const adminApi = {
  overview: () => apiRequest<ApiAdminOverviewDto>("/admin/overview/"),
  schools: () => apiRequest<ApiSchoolDto[]>("/admin/schools/"),
  createSchool: (payload: { name: string; city: string; is_active?: boolean }) => apiRequest<ApiSchoolDto>("/admin/schools/", { method: "POST", body: payload }),
  updateSchool: (id: string, payload: Partial<{ name: string; city: string; is_active: boolean }>) => apiRequest<ApiSchoolDto>(`/admin/schools/${id}/`, { method: "PATCH", body: payload }),
  users: (query = "") => apiRequest<ApiAdminUserDto[]>(`/admin/users/${query ? `?${query}` : ""}`),
  createUser: (payload: Record<string, unknown>) => apiRequest<ApiAdminUserDto>("/admin/users/", { method: "POST", body: payload }),
  updateUser: (id: string, payload: Record<string, unknown>) => apiRequest<ApiAdminUserDto>(`/admin/users/${id}/`, { method: "PATCH", body: payload }),
  exams: (query = "") => apiRequest<ApiAdminExamDto[]>(`/admin/exams/${query ? `?${query}` : ""}`),
};
