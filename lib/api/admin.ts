import { apiRequest } from "@/lib/api/client";
import type {
  ApiAdminDatabaseDto,
  ApiAdminExamDto,
  ApiAdminLiveAttemptDto,
  ApiAdminOverviewDto,
  ApiAdminRepairDto,
  ApiAdminStatsDto,
  ApiAdminUserDto,
  ApiSchoolDto,
} from "@/lib/api/dtos";

export const adminApi = {
  overview: () => apiRequest<ApiAdminOverviewDto>("/admin/overview/"),
  schools: () => apiRequest<ApiSchoolDto[]>("/admin/schools/"),
  createSchool: (payload: { name: string; city: string; is_active?: boolean }) => apiRequest<ApiSchoolDto>("/admin/schools/", { method: "POST", body: payload }),
  updateSchool: (id: string, payload: Partial<{ name: string; city: string; is_active: boolean }>) => apiRequest<ApiSchoolDto>(`/admin/schools/${id}/`, { method: "PATCH", body: payload }),
  users: (query = "") => apiRequest<ApiAdminUserDto[]>(`/admin/users/${query ? `?${query}` : ""}`),
  createUser: (payload: Record<string, unknown>) => apiRequest<ApiAdminUserDto>("/admin/users/", { method: "POST", body: payload }),
  updateUser: (id: string, payload: Record<string, unknown>) => apiRequest<ApiAdminUserDto>(`/admin/users/${id}/`, { method: "PATCH", body: payload }),
  exams: (query = "") => apiRequest<ApiAdminExamDto[]>(`/admin/exams/${query ? `?${query}` : ""}`),
  /** The console's figures. Scoped server-side: a school administrator gets one school, not a slice. */
  stats: () => apiRequest<ApiAdminStatsDto>("/admin/stats/", { cacheMs: 15_000 }),
  database: () => apiRequest<ApiAdminDatabaseDto>("/admin/database/"),
  /** Recomputes what is derived (missing results, marks totals, fingerprints). Idempotent by design. */
  repairDatabase: () => apiRequest<ApiAdminRepairDto>("/admin/database/repair/", { method: "POST", body: {}, invalidate: ["/admin/"] }),
  liveAttempts: (query = "") => apiRequest<{ attempts: ApiAdminLiveAttemptDto[]; count: number }>(`/admin/attempts/${query ? `?${query}` : ""}`),
  /** The actions that override a teacher's paper. Refused to everybody but the platform administrator. */
  examAction: (examId: string, action: "force-close" | "archive" | "restore" | "publish") =>
    apiRequest<{ status: string; closed_attempts?: number }>(`/admin/exams/${examId}/actions/${action}/`, { method: "POST", body: {}, invalidate: ["/admin/", "/exams/"] }),
  attemptAction: (attemptId: string, action: "finalize" | "unlock-device") =>
    apiRequest<Record<string, unknown>>(`/admin/attempts/${attemptId}/actions/${action}/`, { method: "POST", body: {}, invalidate: ["/admin/", "/results/"] }),
  revokeSessions: (userId: string) => apiRequest<{ revoked: number }>(`/admin/users/${userId}/revoke-sessions/`, { method: "POST", body: {}, invalidate: ["/admin/"] }),
};
