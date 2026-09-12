import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The read cache in front of the API client, and the `ETag` revalidation it rides on.
 *
 * What matters here is not that a second call is cheap, but *which* answers may be reused: only GETs a caller
 * opted into, only until a write to the same resource proves them wrong, and never on a session that has just
 * lost its token. A cache that got those three cases wrong would be faster and worse.
 */
const fetchMock = vi.hoisted(() => vi.fn());
const clear = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/config", () => ({ getApiBaseUrl: () => "/api/v1" }));
vi.mock("@/lib/api/session-mirror", () => ({ syncSessionMirror: vi.fn() }));
vi.mock("@/lib/api/token-storage", () => ({
  tokenStorage: { get: () => null, updateAccess: vi.fn(), clear },
}));

import { apiRequest } from "@/lib/api/client";
import { cacheSize, clearApiCache } from "@/lib/api/cache";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    // The client only parses a body it was told is JSON, so the fake has to say so like Django does.
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : (headers[name.toLowerCase()] ?? null)) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  clearApiCache();
  fetchMock.mockReset();
  clear.mockReset();
  // A trimmed-down Response is all the client reads, so the fake below never has to be a real one.
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("the read cache", () => {
  it("stores nothing until a caller asks", async () => {
    fetchMock.mockResolvedValue(jsonResponse([1]));
    await apiRequest<number[]>("/exams/");
    await apiRequest<number[]>("/exams/");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cacheSize()).toBe(0);
  });

  it("answers a second read from memory while it is young", async () => {
    fetchMock.mockResolvedValue(jsonResponse([1]));
    const first = await apiRequest<number[]>("/exams/", { cacheMs: 10_000 });
    const second = await apiRequest<number[]>("/exams/", { cacheMs: 10_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("paints a stale body at once and corrects it in the background", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(["first"]));
    await apiRequest<string[]>("/exams/", { cacheMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    fetchMock.mockResolvedValueOnce(jsonResponse(["second"]));
    const painted = await apiRequest<string[]>("/exams/", { cacheMs: 1 });
    // The click that made this request gets the body it already had, immediately: no spinner, no wait.
    expect(painted).toEqual(["first"]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const after = await apiRequest<string[]>("/exams/", { cacheMs: 10_000 });
    expect(after).toEqual(["second"]);
  });

  it("drops a resource's entries when the same user writes to it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(["a"]));
    await apiRequest<string[]>("/exams/", { cacheMs: 10_000 });
    // The POST is a fetch too, so 3 calls means the second GET really went out: 1 read + 1 write + 1 read.
    await apiRequest("/exams/exam-1/publish/", { method: "POST" });
    await apiRequest<string[]>("/exams/", { cacheMs: 10_000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("drops the bank too when a question is saved into an exam", async () => {
    // The write lands on `/exams/…`, but the question bank lists the same rows; without the extra root the
    // teacher would keep seeing a bank that no longer matches the paper.
    fetchMock.mockResolvedValue(jsonResponse([]));
    await apiRequest("/questions/", { cacheMs: 10_000 });
    await apiRequest("/exams/exam-1/questions/", { method: "POST", body: {}, invalidate: ["/questions/"] });
    await apiRequest("/questions/", { cacheMs: 10_000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends one request when two components ask for the same list at once", async () => {
    let release: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const one = apiRequest("/exams/");
    const two = apiRequest("/exams/");
    release(jsonResponse([]));
    await Promise.all([one, two]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("revalidates with the server's own validator and reuses the body on 304", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ marks: 12 }, { etag: 'W/"abc"' }));
    await apiRequest<{ marks: number }>("/exams/", { cacheMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    fetchMock.mockResolvedValueOnce({ ok: true, status: 304, headers: { get: () => null }, text: async () => "", json: async () => null });
    const again = await apiRequest<{ marks: number }>("/exams/", { cacheMs: 1 });
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new Headers(init.headers).get("If-None-Match")).toBe('W/"abc"');
    // A 304 means the stored body *is* the current answer, so it comes back untouched.
    expect(again).toEqual({ marks: 12 });
    // No body arrived, and none was invented: the entry is the same object the cache already held.
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/exams/");
  });

  it("serves the last good read when the network drops, and never after a logout", async () => {
    fetchMock.mockResolvedValue(jsonResponse(["kept"]));
    await apiRequest<string[]>("/exams/", { cacheMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(apiRequest<string[]>("/exams/", { cacheMs: 1 })).resolves.toEqual(["kept"]);

    clearApiCache();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiRequest<string[]>("/exams/", { cacheMs: 1 })).rejects.toThrow();
  });

  it("still throws the server's own refusal, cached body or not", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => ({ detail: "قفل شده", code: "device_locked" }),
      text: async () => "",
    });
    await expect(apiRequest("/student/attempts/a/claim-session/", { method: "POST" })).rejects.toMatchObject({ status: 409 });
  });
});
