"use client";

import { create } from "zustand";
import { authApi } from "@/lib/api/auth";
import { apiErrorMessage, setAuthenticationFailureHandler } from "@/lib/api/client";
import { toUser } from "@/lib/api/mappers";
import { tokenStorage } from "@/lib/api/token-storage";
import { clearSessionMirror, syncSessionMirror } from "@/lib/api/session-mirror";
import { rolePanel } from "@/lib/auth/roles";
import type { ApiRegisterPayload } from "@/lib/api/dtos";
import type { User } from "@/lib/types/domain";

export type AuthStatus = "checking" | "authenticated" | "anonymous";
interface AuthState {
  user: User | null;
  status: AuthStatus;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (payload: ApiRegisterPayload) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  clearSession: () => void;
}

const anonymous = { user: null, status: "anonymous" as const };

export const dashboardForRole = (role: User["role"]) => `/${rolePanel[role]}/dashboard`;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "checking",
  bootstrap: async () => {
    if (get().status === "authenticated" || get().status === "checking" && get().user) return;
    if (!tokenStorage.get()) { set(anonymous); return; }
    set({ status: "checking" });
    try {
      // Do not trust a cached UI role: ask the server for the current safe user DTO.
      const user = toUser(await authApi.me());
      set({ user, status: "authenticated" });
      // The page gate may have no mirror yet (a cookie that expired, a first load after this code
      // shipped). Re-writing it from a live session is what stops a valid login looking like a stranger.
      await syncSessionMirror();
    } catch {
      tokenStorage.clear();
      void clearSessionMirror();
      set(anonymous);
    }
  },
  login: async (email, password) => {
    const response = await authApi.login(email.trim(), password);
    tokenStorage.set({ access: response.access, refresh: response.refresh });
    // Awaited on purpose: the redirect to a protected page is the very next thing that happens, and the
    // server-side gate must already know about this session by then.
    await syncSessionMirror();
    // Confirm current identity/role server-side even though login includes a safe user.
    const user = toUser(await authApi.me());
    set({ user, status: "authenticated" });
    return user;
  },
  register: async (payload) => {
    await authApi.register(payload);
    return get().login(payload.email, payload.password);
  },
  logout: async () => {
    const refresh = tokenStorage.get()?.refresh;
    try {
      if (refresh) await authApi.logout(refresh);
    } catch {
      // Clearing local credentials is still mandatory, even if the network/logout endpoint failed.
    } finally {
      tokenStorage.clear();
      await clearSessionMirror();
      set(anonymous);
    }
  },
  setUser: (user) => set({ user, status: "authenticated" }),
  // Synchronous by contract (the API client calls it from a failure handler), so the mirror is cleared
  // without awaiting it: a stale mirror only means the gate falls back to its hint on the next request.
  clearSession: () => { tokenStorage.clear(); void clearSessionMirror(); set(anonymous); },
}));

// apiRequest calls this after a failed refresh. It intentionally has no redirect side effect;
// role guards react to the anonymous state and route through the standard login flow.
setAuthenticationFailureHandler(() => useAuthStore.getState().clearSession());

/**
 * The credential is shared across tabs (`localStorage`), so the auth state has to follow it. Without this,
 * a tab that had already rendered as anonymous would keep saying "please log in" next to a tab that had just
 * logged in — the report this replaces: one tab in the account, the other demanding a login.
 */
if (typeof window !== "undefined") {
  tokenStorage.subscribe((present) => {
    const state = useAuthStore.getState();
    if (!present) {
      if (state.status !== "anonymous") state.clearSession();
      return;
    }
    if (state.status !== "authenticated") void state.bootstrap();
  });
}

export function authErrorMessage(error: unknown) { return apiErrorMessage(error, "ورود انجام نشد. ایمیل و گذرواژه را بررسی کنید."); }
