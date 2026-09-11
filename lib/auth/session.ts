/**
 * The session mirror: a small, HttpOnly record the Next.js server keeps for itself.
 *
 * Why it has to exist. The API credential is a bearer token in `localStorage`, because `fetch` cannot
 * read an HttpOnly cookie and the deployment sometimes points the browser straight at Django. That is the
 * right arrangement for *data*, but it leaves the Next.js server blind at render time: nothing the page
 * keeps in web storage travels with a document request, so the server could not refuse to render
 * `/admin/users` for a teacher. This module is the mirror that closes the gap - written after a token has
 * been checked against Django, read by `middleware.ts` before it renders.
 *
 * Two properties matter for safety:
 *  - **It is not a credential.** It is never forwarded to Django as authorization, so the cookie alone
 *    buys an attacker no data; being HttpOnly, page script cannot read it either.
 *  - **It is never refreshed server-side.** `ROTATE_REFRESH_TOKENS` with `BLACKLIST_AFTER_ROTATION` means
 *    whichever party rotates first blacklists the other's token, so rotation belongs to exactly one
 *    place: the browser. Every rotation re-syncs the mirror (see `lib/state/auth-store.ts`).
 */

import { ACCESS_COOKIE, ROLE_COOKIE, isRole } from "@/lib/auth/page-access";
import type { Role } from "@/lib/types/domain";

export { ACCESS_COOKIE, ROLE_COOKIE };

/** A little under the refresh window (7 days), so the mirror dies before the session it describes does. */
const MIRROR_MAX_AGE_SECONDS = 60 * 60 * 24 * 6;

export interface Mirror {
  /** The role as recorded at write time; `null` when it could not be read back. */
  role: Role | null;
  /** Kept to ask Django "still alive?" and to let the server re-check without the browser's help. */
  accessToken: string;
  /** `exp` of that token in epoch seconds; `0` when it was never readable. */
  accessExpiry: number;
  refresh: string;
}

export type Verification =
  /** Django confirmed the account; `role: null` means the reply carried nothing usable. */
  | { kind: "valid"; role: Role | null }
  /** Django refused a token that should still have been live: the session is gone. */
  | { kind: "invalid" }
  /** Nothing follows from this answer, so it must not be read as a logout. */
  | { kind: "unknown"; reason: "no-token" | "expired" | "offline" | "unconfigured" };

/** base64url without `Buffer`: the mirror is read in the edge runtime as well as in Node. */
function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function attributes(maxAge: number) {
  return {
    httpOnly: true,
    // Lax, not Strict: the gate has to work on a top-level navigation the user arrived at by link.
    sameSite: "lax" as const,
    path: "/",
    // Only meaningful over https, and local development must keep working over http.
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

interface CookieHost {
  cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void };
}

interface CookieReader {
  cookies: { get: (name: string) => { value: string } | undefined };
}

/**
 * Two cookies, not one, because they are trusted differently: the role record is ours (and never a
 * credential), while the token mirror is Django's own JWT, so anything derived from it is only a hint.
 */
export function writeMirror(response: CookieHost, mirror: Mirror) {
  // `null` means "a session we could not read a role for": the token cookie still goes out, the role
  // record is cleared rather than guessed, so the gate renders instead of redirecting to a dashboard.
  const record = mirror.role
    ? encodeBase64Url(JSON.stringify({ v: 1, role: mirror.role, aexp: mirror.accessExpiry }))
    : "";
  if (record) response.cookies.set(ROLE_COOKIE, record, attributes(MIRROR_MAX_AGE_SECONDS));
  else response.cookies.set(ROLE_COOKIE, "", attributes(0));
  // One cookie carries the pair the browser would otherwise re-send. The separator is `~`, not `.`: a JWT
  // is itself `header.payload.signature`, so a dot join cannot be split again without guessing — and the
  // first version of this line guessed, handing the gate a bearer string Django had to refuse.
  response.cookies.set(ACCESS_COOKIE, [mirror.accessToken, mirror.refresh].filter(Boolean).join("~"), attributes(MIRROR_MAX_AGE_SECONDS));
}

export function eraseMirror(response: CookieHost) {
  for (const name of [ROLE_COOKIE, ACCESS_COOKIE]) response.cookies.set(name, "", attributes(0));
}

function readRecord(source: CookieReader): { role: Role | null; accessExpiry: number } {
  const raw = source.cookies.get(ROLE_COOKIE)?.value;
  if (!raw) return { role: null, accessExpiry: 0 };
  try {
    const parsed = JSON.parse(decodeBase64Url(raw)) as { v?: unknown; role?: unknown; aexp?: unknown };
    if (parsed.v !== 1) return { role: null, accessExpiry: 0 };
    return {
      role: isRole(parsed.role) ? parsed.role : null,
      accessExpiry: typeof parsed.aexp === "number" && parsed.aexp > 0 ? parsed.aexp : 0,
    };
  } catch {
    // A cookie that is not ours is no evidence of anything; treat it as absent rather than parsing on.
    return { role: null, accessExpiry: 0 };
  }
}

/** The full mirror, or `null` when the request carries no usable session. */
export function readMirror(source: CookieReader): Mirror | null {
  const raw = source.cookies.get(ACCESS_COOKIE)?.value;
  if (!raw) return null;
  const { role, accessExpiry } = readRecord(source);
  const split = raw.indexOf("~");
  let accessToken: string;
  let refresh: string;
  if (split >= 0) {
    accessToken = raw.slice(0, split);
    refresh = raw.slice(split + 1);
  } else {
    // A mirror written before the separator changed: the join was a dot, so the only sound reading is
    // "three dot-segments are one token". Refusing outright would log out every session that predates
    // this fix on its next page view, which is a worse outcome than one more request.
    const parts = raw.split(".");
    if (parts.length < 6) return null;
    accessToken = parts.slice(0, 3).join(".");
    refresh = parts.slice(3).join(".");
  }
  if (!accessToken) return null;
  return { role, accessToken, accessExpiry, refresh };
}

/** `exp` of the mirrored access token, without trusting it for anything but "is it worth asking?". */
export function decodeExpiry(token: string): number | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(segment)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Server-side API origin. Empty means "the server cannot reach the API", which disables the gate. */
export function apiOrigin(): string {
  const proxied = process.env.API_PROXY_TARGET?.trim().replace(/\/+$/, "");
  if (proxied) return proxied;
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "");
  return configured && /^https?:\/\//.test(configured) ? configured : "";
}

export function nowSeconds(now = Date.now()): number {
  return Math.floor(now / 1000);
}

export function isExpired(expiresAt: number | null | undefined, now = nowSeconds()): boolean {
  return typeof expiresAt === "number" && expiresAt > 0 && expiresAt <= now;
}

/**
 * Ask Django who this token belongs to.
 *
 * `unknown` is not "logged out": an unreachable API must not bounce a whole school to the login screen.
 * The role in the answer is the only part that is authoritative, and re-reading it is what makes a
 * demotion land on the next page load instead of whenever the browser notices.
 */
export async function verifyToken(token: string | undefined, expiresAt?: number | null): Promise<Verification> {
  if (!token) return { kind: "unknown", reason: "no-token" };
  if (isExpired(expiresAt)) return { kind: "unknown", reason: "expired" };
  const origin = apiOrigin();
  if (!origin) return { kind: "unknown", reason: "unconfigured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${origin}/api/v1/auth/me/`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { kind: "invalid" };
    if (!response.ok) return { kind: "unknown", reason: "offline" };
    const body = (await response.json()) as { role?: unknown };
    return { kind: "valid", role: isRole(body.role) ? body.role : null };
  } catch {
    return { kind: "unknown", reason: "offline" };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the server can reach the API at all: with no origin, there is nothing to gate on. */
export function gatingAvailable(): boolean {
  return apiOrigin() !== "";
}
