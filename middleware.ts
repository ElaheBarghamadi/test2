import { NextResponse, type NextRequest } from "next/server";

import { decideAccess, type AccessDecision, type SessionState } from "@/lib/auth/page-access";
import { gatingAvailable, readMirror, verifyToken, writeMirror, eraseMirror, type Mirror } from "@/lib/auth/session";
import type { Role } from "@/lib/types/domain";

/**
 * Server-side page gate. See `lib/auth/page-access.ts` for the policy and `lib/auth/session.ts` for where
 * the session it reads comes from.
 *
 * In one sentence: a request for `/student/*`, `/teacher/*` or `/admin/*` is answered by the gate, which
 * resolves the identity *before* rendering and then either lets the page through or redirects. The
 * identity comes from Django whenever Django can be asked, so a deleted or demoted account does not keep
 * its screen; the cookie's role hint is used only when it cannot.
 *
 * This is not the authentication layer. Every data route keeps its own permission classes, and a page that
 * renders is not a page that may read anything.
 */

/** Short enough that a role change lands quickly, long enough that a click storm is one API call. */
const VERIFY_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 300;

type Verification = Awaited<ReturnType<typeof verifyToken>>;
const memo = new Map<string, { at: number; verification: Verification }>();

/** A fingerprint, not a copy: the token itself is never used as a map key. */
function fingerprint(token: string): string {
  return `${token.length}:${token.slice(0, 8)}:${token.slice(-8)}`;
}

async function verifyOnce(token: string, expiry: number): Promise<Verification> {
  const key = fingerprint(token);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at <= VERIFY_TTL_MS) return hit.verification;
  const verification = await verifyToken(token, expiry);
  if (memo.size >= MAX_CACHE_ENTRIES) {
    const oldest = memo.keys().next().value;
    if (typeof oldest === "string") memo.delete(oldest);
  }
  // A refusal is cached too: it is the answer that ends a session, and re-asking on every request of a
  // logging-out user would only add latency to a redirect.
  memo.set(key, { at: Date.now(), verification });
  return verification;
}

interface Gate {
  session: SessionState;
  /** Django's answer, when there was one: the hint is rewritten with it, which is how a demotion sticks. */
  verifiedRole: Role | null;
  /** The mirrored token has expired, so its `exp` must not keep the gate rejecting a live session. */
  stale: boolean;
}

async function gateFor(request: NextRequest): Promise<Gate> {
  const mirror = readMirror(request);
  if (!mirror) return { session: { kind: "anonymous" }, verifiedRole: null, stale: false };

  const verification = await verifyOnce(mirror.accessToken, mirror.accessExpiry);
  if (verification.kind === "valid") {
    // Django's answer wins; its silence about the role falls back to the hint rather than to a guess.
    const role = verification.role ?? mirror.role;
    return { session: { kind: "verified", role }, verifiedRole: role, stale: false };
  }
  if (verification.kind === "invalid") return { session: { kind: "invalid" }, verifiedRole: null, stale: false };
  return { session: { kind: "unreachable", role: mirror.role }, verifiedRole: null, stale: verification.reason === "expired" };
}

/**
 * The mirror as it should stand after this request.
 *
 * `accessExpiry: 0` means "no expiry claim left to trust": a token whose lifetime ran out while the
 * browser was asleep still describes the same session, and the browser refreshes it and re-syncs on its
 * own. Keeping the mirror alive across that gap is what stops an idle user from being logged out by a
 * page gate that cannot see the refresh.
 */
function refreshedMirror(gate: Gate, request: NextRequest): Mirror | null {
  const mirror = readMirror(request);
  if (!mirror) return null;
  const role = gate.verifiedRole ?? (gate.session.kind === "unreachable" ? gate.session.role : null);
  return { role, accessToken: mirror.accessToken, accessExpiry: gate.stale ? 0 : mirror.accessExpiry, refresh: mirror.refresh };
}

function withMirror(response: NextResponse, action: AccessDecision["action"], mirror: Mirror | null) {
  // A session Django no longer recognises - or none at all: the mirror goes with the redirect.
  if (action === "logout" || action === "login") eraseMirror(response);
  // Anything else keeps the session and only corrects what the gate believes about it.
  else if (mirror) writeMirror(response, mirror);
  return response;
}

export async function middleware(request: NextRequest) {
  // Without a server-reachable API there is nothing to check a session against, and refusing every page
  // would take the app down rather than protect it. The data routes stay guarded either way.
  if (!gatingAvailable()) return NextResponse.next({ request: { headers: new Headers(request.headers) } });

  const gate = await gateFor(request);
  const decision = decideAccess(request.nextUrl.pathname, gate.session);
  const mirror = refreshedMirror(gate, request);

  if (decision.action !== "render") {
    return withMirror(NextResponse.redirect(new URL(decision.to, request.url)), decision.action, mirror);
  }
  const response = NextResponse.next({ request: { headers: new Headers(request.headers) } });
  // A shell rendered for one role must not be reused from a shared or browser cache by the next visitor.
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return withMirror(response, decision.action, mirror);
}

export const config = {
  // Pages only. `/api/auth/session` is the mirror's own writer and answers for itself; `/api/v1` is the
  // proxied data API, where Django is the authority; static assets carry nothing.
  matcher: ["/student/:path*", "/teacher/:path*", "/admin/:path*"],
};
