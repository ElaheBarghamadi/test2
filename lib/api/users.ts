import { apiRequest } from "@/lib/api/client";
import { toStudentAudienceItem, toStudentGroup } from "@/lib/api/mappers";
import type { ApiStudentDirectoryItemDto, ApiStudentGroupDto, ApiUserDto } from "@/lib/api/dtos";
import type { StudentAudienceItem, StudentGroup } from "@/lib/types/domain";

export interface StudentGroupInput {
  name: string;
  description?: string;
  student_ids?: string[];
}

export const usersApi = {
  me: () => apiRequest<ApiUserDto>("/users/me/"),
  update: (payload: Record<string, unknown>) => apiRequest<ApiUserDto>("/users/me/", { method: "PATCH", body: payload }),
  changePassword: (oldPassword: string, newPassword: string) => apiRequest<void>("/users/me/password/", { method: "POST", body: { old_password: oldPassword, new_password: newPassword } }),
  /**
   * The roster a teacher is allowed to group.
   *
   * The server decides who is in it — school members for a teacher who belongs to a school, participants and
   * existing group members for one who does not — so this list is never filtered on the client.
   */
  studentDirectory: async (query?: { q?: string; grade?: string; className?: string }): Promise<StudentAudienceItem[]> => {
    const params = new URLSearchParams();
    if (query?.q) params.set("q", query.q);
    if (query?.grade) params.set("grade", query.grade);
    if (query?.className) params.set("class_name", query.className);
    const suffix = params.toString();
    const rows = await apiRequest<ApiStudentDirectoryItemDto[]>(`/users/students/${suffix ? `?${suffix}` : ""}`, { cacheMs: 10_000 });
    return rows.map(toStudentAudienceItem);
  },
  studentGroups: async (): Promise<StudentGroup[]> => {
    const rows = await apiRequest<ApiStudentGroupDto[]>("/users/groups/", { cacheMs: 10_000 });
    return rows.map(toStudentGroup);
  },
  createStudentGroup: async (payload: StudentGroupInput): Promise<StudentGroup> =>
    toStudentGroup(await apiRequest<ApiStudentGroupDto>("/users/groups/", { method: "POST", body: payload, invalidate: ["/users/groups/", "/users/students/"] })),
  updateStudentGroup: async (groupId: string, payload: Partial<StudentGroupInput>): Promise<StudentGroup> =>
    toStudentGroup(await apiRequest<ApiStudentGroupDto>(`/users/groups/${groupId}/`, { method: "PATCH", body: payload, invalidate: ["/users/groups/", "/users/students/"] })),
  deleteStudentGroup: (groupId: string) =>
    apiRequest<void>(`/users/groups/${groupId}/`, { method: "DELETE", invalidate: ["/users/groups/"] }),
};
