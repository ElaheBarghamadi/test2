import { afterEach, describe, expect, it } from "vitest";
import { eraseMirror, readMirror, writeMirror, apiOrigin, gatingAvailable, decodeExpiry, isExpired } from "@/lib/auth/session";

/**
 * The mirror the page gate reads, on its own.
 *
 * These tests exist because of a bug they would have caught: the two tokens were joined with a dot, and
 * read back by splitting on the *last* dot — which is inside the refresh token, since a JWT is
 * `header.payload.signature` itself. The middleware then sent Django a bearer string it had to refuse, and
 * every signed-in visitor was logged out by the gate that was supposed to let them in. Nothing but a
 * round-trip through both functions can see that; `tsc` is content with either shape.
 */

interface FakeJar {
  cookies: {
    set: (name: string, value: string) => void;
    get: (name: string) => { value: string } | undefined;
  };
  store: Map<string, string>;
}

function jar(initial: Record<string, string> = {}): FakeJar {
  const store = new Map(Object.entries(initial));
  return {
    store,
    cookies: {
      set: (name, value) => {
        if (value === "") store.delete(name);
        else store.set(name, value);
      },
      get: (name) => (store.has(name) ? { value: store.get(name)! } : undefined),
    },
  };
}

// Two well-formed-looking JWTs: three dot-segments each, which is what breaks a dot-separated join.
const ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaa";
const REFRESH = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.bbbb";

describe("writeMirror / readMirror", () => {
  it("round-trips both tokens and the role", () => {
    const response = jar();
    writeMirror(response as never, { role: "teacher", accessToken: ACCESS, accessExpiry: 1_800_000_000, refresh: REFRESH });

    const mirror = readMirror(response as never);
    expect(mirror).toEqual({ role: "teacher", accessToken: ACCESS, accessExpiry: 1_800_000_000, refresh: REFRESH });
  });

  it("does not let a JWT's own dots confuse the pair", () => {
    const response = jar();
    writeMirror(response as never, { role: null, accessToken: ACCESS, accessExpiry: 0, refresh: REFRESH });
    const stored = response.store.get("examora_access")!;
    expect(stored.split(".")).toHaveLength(5);
    const mirror = readMirror(response as never);
    expect(mirror?.accessToken).toBe(ACCESS);
    expect(mirror?.refresh).toBe(REFRESH);
    // A mirror without a readable role is kept, but the role cookie is cleared rather than guessed.
    expect(mirror?.role).toBeNull();
    expect(response.store.has("examora_role")).toBe(false);
  });

  it("still reads a mirror written before the separator changed", () => {
    // The old format joined the pair with "."; a session that predates the fix must not be destroyed by it.
    const legacy = jar({ examora_access: `${ACCESS}.${REFRESH}` });
    const mirror = readMirror(legacy as never);
    expect(mirror?.accessToken).toBe(ACCESS);
    expect(mirror?.refresh).toBe(REFRESH);
  });

  it("returns nothing for a cookie that cannot be a pair", () => {
    expect(readMirror(jar({ examora_access: "not-a-token" }) as never)).toBeNull();
    expect(readMirror(jar({}) as never)).toBeNull();
  });

  it("treats a role cookie we did not write as no evidence at all", () => {
    const source = jar({ examora_access: `${ACCESS}~${REFRESH}`, examora_role: "admin" });
    const mirror = readMirror(source as never);
    expect(mirror?.role).toBeNull();
    expect(mirror?.accessToken).toBe(ACCESS);
  });

  it("erases both cookies on logout", () => {
    const source = jar();
    writeMirror(source as never, { role: "student", accessToken: ACCESS, accessExpiry: 1, refresh: REFRESH });
    expect(source.store.size).toBe(2);
    eraseMirror(source as never);
    expect(source.store.size).toBe(0);
    expect(readMirror(source as never)).toBeNull();
  });
});

describe("apiOrigin and gatingAvailable", () => {
  const saved = { proxy: process.env.API_PROXY_TARGET, base: process.env.NEXT_PUBLIC_API_BASE_URL };
  afterEach(() => {
    // Assigning `undefined` would write the string "undefined", which reads as a configured origin.
    for (const [key, value] of Object.entries({ API_PROXY_TARGET: saved.proxy, NEXT_PUBLIC_API_BASE_URL: saved.base })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("prefers the server-only proxy target", () => {
    process.env.API_PROXY_TARGET = "http://127.0.0.1:8000/";
    process.env.NEXT_PUBLIC_API_BASE_URL = "/api/v1";
    expect(apiOrigin()).toBe("http://127.0.0.1:8000");
    expect(gatingAvailable()).toBe(true);
  });

  it("accepts an absolute deployed origin, and rejects a relative base", () => {
    process.env.API_PROXY_TARGET = "";
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.com/api/v1";
    expect(apiOrigin()).toBe("https://api.example.com/api/v1");
    process.env.NEXT_PUBLIC_API_BASE_URL = "/api/v1";
    expect(apiOrigin()).toBe("");
    // No reachable API means no gate: the app renders and the client guard decides, rather than every
    // protected page turning into a redirect loop.
    expect(gatingAvailable()).toBe(false);
  });
});

describe("token expiry", () => {
  it("reads `exp` out of the mirrored token", () => {
    const payload = btoa(JSON.stringify({ exp: 1_800_000_000 })).replace(/=+$/, "");
    expect(decodeExpiry(`header.${payload}.sig`)).toBe(1_800_000_000);
    expect(decodeExpiry("no-payload")).toBeNull();
  });

  it("only calls a positive number in the past expired", () => {
    expect(isExpired(1_000, 2_000)).toBe(true);
    expect(isExpired(3_000, 2_000)).toBe(false);
    // Zero is "no expiry claim to trust", which keeps a stale mirror from being treated as a dead session.
    expect(isExpired(0, 2_000)).toBe(false);
    expect(isExpired(null, 2_000)).toBe(false);
  });
});
