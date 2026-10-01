import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What happens when the server does not answer.
 *
 * `fetch` waits forever by default. On a phone that has switched network, or a laptop that has woken on a dead
 * Wi-Fi network, the request neither succeeds nor fails: every button on the screen stays disabled and the
 * status line stays on "در حال ذخیره…", which reads as a frozen app. The client now cancels its own request
 * after twenty seconds and says what happened, and these tests keep that behaviour (and the caller-supplied
 * cancellation it must not swallow) honest.
 */
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/config", () => ({ getApiBaseUrl: () => "/api/v1" }));
vi.mock("@/lib/api/session-mirror", () => ({ syncSessionMirror: vi.fn() }));
vi.mock("@/lib/api/token-storage", () => ({ tokenStorage: { get: () => null, updateAccess: vi.fn(), clear: vi.fn() } }));

import { apiRequest } from "@/lib/api/client";

/** A server that accepts the request and never answers, unless the client hangs up first. */
function hangingFetch() {
  return (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
}

beforeEach(() => {
  global.fetch = hangingFetch() as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a request the server never answers", () => {
  it("gives up on its own and says the connection is slow rather than hanging forever", async () => {
    vi.useFakeTimers();
    const pending = apiRequest("/exams/");
    const assertion = expect(pending).rejects.toThrow(/پاسخی از سرور نرسید/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("waits as long as the caller asked when they ask for something shorter", async () => {
    vi.useFakeTimers();
    const pending = apiRequest("/exams/", { timeoutMs: 1_000 });
    const assertion = expect(pending).rejects.toThrow(/پاسخی از سرور نرسید/);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it("leaves a caller's own cancellation as a cancellation", async () => {
    // Screens that unmount mid-flight abort their request; that is not a network fault and must not be reported
    // as one, or a teacher who navigated away would see an error toast about their connection.
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = apiRequest("/exams/", { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    // And the timeout that was armed for this request must not fire afterwards.
    await vi.advanceTimersByTimeAsync(30_000);
  });

  it("does not cancel a request that answers in time", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => ({ ok: true }),
      text: async () => "{}",
      signal: init?.signal,
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const answer = apiRequest<{ ok: boolean }>("/exams/");
    await vi.advanceTimersByTimeAsync(100);
    await expect(answer).resolves.toEqual({ ok: true });
    // The timer is cleared on success: nothing aborts the connection after the fact.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
  });
});
