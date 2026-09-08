"use client";

import { create } from "zustand";

export interface Toast { id: string; title: string; description?: string; variant?: "default" | "success" | "error"; }
interface ToastState { toasts: Toast[]; push: (toast: Omit<Toast, "id">) => void; remove: (id: string) => void; }

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    window.setTimeout(() => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })), 4200);
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));
