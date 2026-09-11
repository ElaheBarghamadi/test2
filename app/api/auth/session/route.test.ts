import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The route that establishes the server-side session mirror.
 *
 * These assertions exist because of a bug this file caught: the handler built one response to carry the
 * cookies, then returned a *different* response to carry the body. `Set-Cookie` travelled with the first one
 * and was dropped, so no browser ever got a mirror — and `middleware.ts`, reading nothing, bounced a
 * signed-in student or teacher to the login screen. The gate is only as good as the response that actually
 * goes out, so that is what is checked here.
 */

const verifyToken = vi.fn();

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, verifyToken: (...args: unknown[]) => verifyToken(...args) };
});

const { POST, DELETE } = await import("@/app/api/auth/session/route");

function request(body: unknown): NextRequest {
  // The handler only reads `json()`; a real NextRequest would drag the whole web-standard stack into a unit
  // test for nothing.
  return { json: async () => body } as unknown as NextRequest;
}

function setCookies(response: { headers: Headers }): string[] {
  const raw = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (raw?.length) return raw;
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

beforeEach(() => {
  verifyToken.mockReset();
});

describe("POST /api/auth/session", () => {
  it("writes the mirror onto the response it returns", async () => {
    verifyToken.mockResolvedValue({ kind: "valid", role: "teacher" });
    const response = await POST(request({ access: "a.b.c", refresh: "r.s.t" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, role: "teacher" });

    const cookies = setCookies(response);
    expect(cookies.some((line) => line.startsWith("examora_role="))).toBe(true);
    // `~`, not ".": both tokens are JWTs with dots of their own, and the middleware has to split them again.
    expect(cookies.some((line) => line.startsWith("examora_access=a.b.c~r.s.t"))).toBe(true);
    // HttpOnly is the point: the browser's scripts must not be able to read or renew the mirror.
    expect(cookies.every((line) => /HttpOnly/i.test(line))).toBe(true);
  });

  it("takes the role from Django's answer, never from the body", async () => {
    verifyToken.mockResolvedValue({ kind: "valid", role: "student" });
    const response = await POST(request({ access: "a.b.c", refresh: "r", role: "admin" }));
    await expect(response.json()).resolves.toEqual({ ok: true, role: "student" });
    const encoded = setCookies(response).find((line) => line.startsWith("examora_role="))!.slice("examora_role=".length).split(";")[0];
    expect(Buffer.from(encoded, "base64url").toString("utf8")).toContain('"role":"student"');
  });

  it("keeps a session whose role cannot be read, without inventing one", async () => {
    verifyToken.mockResolvedValue({ kind: "unknown", reason: "offline" });
    const response = await POST(request({ access: "a.b.c", refresh: "r" }));
    await expect(response.json()).resolves.toEqual({ ok: true, role: null });
    const cookies = setCookies(response);
    // The role record is erased rather than guessed; the token cookie still goes out so the gate can verify.
    expect(cookies.some((line) => line.startsWith("examora_role=;") && /Max-Age=0/.test(line))).toBe(true);
    expect(cookies.some((line) => line.startsWith("examora_access="))).toBe(true);
  });

  it("clears the mirror when the token is refused", async () => {
    verifyToken.mockResolvedValue({ kind: "invalid" });
    const response = await POST(request({ access: "a.b.c", refresh: "r" }));

    expect(response.status).toBe(401);
    const cookies = setCookies(response);
    expect(cookies.some((line) => line.startsWith("examora_role=;") && /Max-Age=0/.test(line))).toBe(true);
    expect(cookies.some((line) => line.startsWith("examora_access=;") && /Max-Age=0/.test(line))).toBe(true);
  });

  it("rejects an empty body and clears nothing it was not asked about", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(setCookies(response).some((line) => line.startsWith("examora_access=;"))).toBe(true);
    expect(verifyToken).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/auth/session", () => {
  it("erases both mirror cookies", async () => {
    const response = await DELETE();
    const cookies = setCookies(response);
    expect(cookies.some((line) => line.startsWith("examora_role=;"))).toBe(true);
    expect(cookies.some((line) => line.startsWith("examora_access=;"))).toBe(true);
  });
});
