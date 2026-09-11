import { apiRequest } from "@/lib/api/client";
import { toNotificationPage } from "@/lib/api/mappers";
import type { ApiNotificationPageDto } from "@/lib/api/dtos";
import type { NotificationItem } from "@/lib/types/domain";

export const notificationsApi = {
  /** The bell returns domain items directly: the wire shape is a flat DTO, so mapping is one line. */
  async list(options?: { unreadOnly?: boolean; limit?: number }): Promise<{ unreadCount: number; results: NotificationItem[] }> {
    const params = new URLSearchParams();
    if (options?.unreadOnly) params.set("unread_only", "true");
    if (options?.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return toNotificationPage(await apiRequest<ApiNotificationPageDto>(`/notifications/${query ? `?${query}` : ""}`));
  },
  markRead: (id: string) => apiRequest<void>(`/notifications/${id}/read/`, { method: "POST" }),
  markAllRead: () => apiRequest<{ updated: number; unread_count: number }>("/notifications/read-all/", { method: "POST" }),
};
