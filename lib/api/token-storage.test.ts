import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_SESSION_MS, tokenStorage } from "@/lib/api/token-storage";

const SHARED_KEY = "examora.session.v1";

/** Another tab wrote the shared key and the browser told this document about it. */
function announceFromAnotherTab() {
  window.dispatchEvent(new StorageEvent("storage", { key: SHARED_KEY }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T06:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tokenStorage", () => {
  it("hands the session to a second tab of the same browser", () => {
    tokenStorage.set({ access: "A.access", refresh: "A.refresh" });
    // A brand-new tab has an empty sessionStorage and the same localStorage — this is the whole point.
    sessionStorage.clear();
    expect(tokenStorage.get()).toEqual({ access: "A.access", refresh: "A.refresh" });
    expect(sessionStorage.getItem("examora.access-token")).toBeNull();
  });

  it("adopts a pair that an older build left in sessionStorage instead of logging the user out", () => {
    sessionStorage.setItem("examora.access-token", "old.access");
    sessionStorage.setItem("examora.refresh-token", "old.refresh");
    expect(tokenStorage.get()).toEqual({ access: "old.access", refresh: "old.refresh" });
    expect(sessionStorage.getItem("examora.access-token")).toBeNull();
    expect(JSON.parse(localStorage.getItem(SHARED_KEY) ?? "{}").access).toBe("old.access");
  });

  it("drops a session nobody has used for a working day", () => {
    tokenStorage.set({ access: "A.access", refresh: "A.refresh" });
    vi.setSystemTime(new Date(Date.now() + IDLE_SESSION_MS + 1000));
    expect(tokenStorage.get()).toBeNull();
    expect(localStorage.getItem(SHARED_KEY)).toBeNull();
  });

  it("refuses to read a session that another tab logged out of", () => {
    tokenStorage.set({ access: "A.access", refresh: "A.refresh" });
    const seen: boolean[] = [];
    const unsubscribe = tokenStorage.subscribe((present) => seen.push(present));
    localStorage.removeItem(SHARED_KEY);
    announceFromAnotherTab();
    expect(seen).toEqual([false]);
    expect(tokenStorage.get()).toBeNull();
    unsubscribe();
  });

  it("shows a rotated token to a tab that cached the old one", () => {
    tokenStorage.set({ access: "A.access", refresh: "A.refresh" });
    const notified: boolean[] = [];
    const unsubscribe = tokenStorage.subscribe((present) => notified.push(present));
    localStorage.setItem(SHARED_KEY, JSON.stringify({ access: "B.access", refresh: "B.refresh", savedAt: Date.now() }));
    announceFromAnotherTab();
    expect(notified).toEqual([true]);
    expect(tokenStorage.get()).toEqual({ access: "B.access", refresh: "B.refresh" });
    unsubscribe();
  });

  it("writes a rotated access token without losing the refresh token", () => {
    tokenStorage.set({ access: "A.access", refresh: "A.refresh" });
    tokenStorage.updateAccess("A.access2");
    expect(tokenStorage.get()).toEqual({ access: "A.access2", refresh: "A.refresh" });
    tokenStorage.updateAccess("A.access3", "A.refresh3");
    expect(tokenStorage.get()).toEqual({ access: "A.access3", refresh: "A.refresh3" });
  });

  it("ignores a shared value it cannot understand", () => {
    localStorage.setItem(SHARED_KEY, "not json");
    expect(tokenStorage.get()).toBeNull();
    localStorage.setItem(SHARED_KEY, JSON.stringify({ access: 42 }));
    expect(tokenStorage.get()).toBeNull();
  });
});
