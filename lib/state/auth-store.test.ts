import { beforeEach, describe, expect, it, vi } from "vitest";

const me = vi.fn();
const login = vi.fn();
const logout = vi.fn();
const syncSessionMirror = vi.fn();
const clearSessionMirror = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authApi: {
    me: () => me(),
    login: (...args: unknown[]) => login(...args),
    logout: (...args: unknown[]) => logout(...args),
    register: vi.fn(),
  },
}));
vi.mock("@/lib/api/session-mirror", () => ({
  syncSessionMirror: (...args: unknown[]) => syncSessionMirror(...args),
  clearSessionMirror: (...args: unknown[]) => clearSessionMirror(...args),
}));

import { useAuthStore } from "@/lib/state/auth-store";
import { tokenStorage } from "@/lib/api/token-storage";

const SHARED_KEY = "examora.session.v1";
const userDto = { id: "u1", email: "t@example.ir", first_name: "مریم", last_name: "رضایی", role: "teacher" };

function tokensInOtherTab(access = "shared.access") {
  localStorage.setItem(SHARED_KEY, JSON.stringify({ access, refresh: "shared.refresh", savedAt: Date.now() }));
  window.dispatchEvent(new StorageEvent("storage", { key: SHARED_KEY }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  me.mockReset().mockResolvedValue(userDto);
  login.mockReset().mockResolvedValue({ access: "a", refresh: "r" });
  logout.mockReset().mockResolvedValue(undefined);
  syncSessionMirror.mockReset().mockResolvedValue(undefined);
  clearSessionMirror.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({ user: null, status: "checking" });
});

describe("auth store across tabs", () => {
  it("stays anonymous when this browser has no credential", async () => {
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(me).not.toHaveBeenCalled();
  });

  it("adopts a login that happened in another tab without a reload", async () => {
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe("anonymous");
    tokensInOtherTab();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe("authenticated"));
    expect(useAuthStore.getState().user?.role).toBe("teacher");
  });

  it("goes anonymous when another tab logs out", async () => {
    tokenStorage.set({ access: "a", refresh: "r" });
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe("authenticated");
    localStorage.removeItem(SHARED_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: SHARED_KEY }));
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe("anonymous"));
  });

  it("clears the shared credential on logout, so no tab is left signed in", async () => {
    tokenStorage.set({ access: "a", refresh: "r" });
    await useAuthStore.getState().bootstrap();
    await useAuthStore.getState().logout();
    expect(tokenStorage.get()).toBeNull();
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(clearSessionMirror).toHaveBeenCalled();
  });

  it("writes the server's mirror before redirecting after a login", async () => {
    await useAuthStore.getState().login("t@example.ir", "ChangeMe123!");
    expect(syncSessionMirror).toHaveBeenCalled();
    expect(tokenStorage.get()).toEqual({ access: "a", refresh: "r" });
    expect(useAuthStore.getState().status).toBe("authenticated");
  });
});
