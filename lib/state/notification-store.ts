"use client";

import { create } from "zustand";
import { notificationsApi } from "@/lib/api/notifications";
import type { NotificationItem } from "@/lib/types/domain";

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  loadedAt: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  refresh: (force?: boolean) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/**
 * One shared bell state for the student and teacher shells.
 *
 * `refresh` skips the request unless the cache is older than the poll interval, so a route change inside
 * the dashboard does not fire a fetch every time; the live component additionally re-reads on tab focus
 * and on a timer. Nothing is pushed to the browser — an in-app inbox that is a few seconds stale is the
 * honest trade for not running a websocket server for 180 students.
 */
const FRESH_MS = 30_000;

export const useNotifications = create<NotificationState>((set, get) => ({
  items: [], unreadCount: 0, loading: false, loadedAt: 0, open: false,
  setOpen: (open) => set({ open }),
  refresh: async (force = false) => {
    const state = get();
    if (!force && state.loadedAt && Date.now() - state.loadedAt < FRESH_MS) return;
    if (state.loading) return;
    set({ loading: true });
    try {
      const page = await notificationsApi.list({ limit: 25 });
      set({ items: page.results, unreadCount: page.unreadCount, loading: false, loadedAt: Date.now() });
    } catch {
      // A failed bell refresh must not look like an empty inbox or block the page; keep the last known state.
      set({ loading: false });
    }
  },
  markRead: async (id) => {
    const previous = get().items;
    set({ items: previous.map((item) => (item.id === id ? { ...item, isRead: true } : item)), unreadCount: Math.max(0, get().unreadCount - 1) });
    try {
      await notificationsApi.markRead(id);
    } catch {
      set({ items: previous });
      void get().refresh(true);
    }
  },
  markAllRead: async () => {
    const previous = get().items;
    set({ items: previous.map((item) => ({ ...item, isRead: true })), unreadCount: 0 });
    try {
      await notificationsApi.markAllRead();
    } catch {
      set({ items: previous });
      void get().refresh(true);
    }
  },
}));
