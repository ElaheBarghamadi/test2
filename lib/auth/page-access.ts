/**
 * The page-access policy, as pure functions, so the rule that guards the screens can be tested without a
 * server, a browser or a database. `middleware.ts` reads the request and calls `decideAccess`; nothing in
 * this file knows about Next.js.
 *
 * Two doors guard this platform and they must not be confused:
 *
 * 1. **The API is the authority on data.** Every Django endpoint re-checks the bearer token's role and the
 *    object's owner, and `backend/apps/core/test_access_matrix.py` pins that. Nothing here can widen or
 *    weaken it.
 * 2. **The page is the authority on who may be shown a screen.** Before this module the only role check
 *    lived in the browser, so `curl /admin/users` answered 200 with the admin shell for anyone: the
 *    redirect happened after hydration, i.e. after the markup had been produced and sent. `decideAccess`
 *    runs before rendering, so an anonymous or wrong-role request never produces that markup at all.
 *
 * Failure stance, stated plainly: when Django cannot be reached the gate falls back to the session hint
 * rather than to a redirect, and a signed-in visitor whose role cannot be resolved is shown the shell. A
 * rendered shell is not an authorized read - every value on it still has to pass the API - and an
 * unreachable internal hop must not lock a whole school out of its own screens. That is the one place this
 * layer is weaker than an ideal one, and it is written down in `backend/docs/architecture.md`.
 */

import type { Role } from "@/lib/types/domain";

/** Written by the app itself after a verified login; never trusted as proof of anything. */
export const ROLE_COOKIE = "examora_role";
/**
 * A mirror of the bearer token, HttpOnly, kept so the server can ask "is this session alive, and is the
 * role in the hint still true?". It is never forwarded to Django as authorization, so it is not a
 * credential and it buys an attacker no data.
 */
export const ACCESS_COOKIE = "examora_access";

export const SESSION_COOKIES = [ROLE_COOKIE, ACCESS_COOKIE] as const;

/** The session, as far as the gate can tell. Each variant says how much is actually known. */
export type SessionState =
  /** No session marker at all. */
  | { kind: "anonymous" }
  /** Django confirmed the account. `role: null` means "signed in, role unreadable from the reply". */
  | { kind: "verified"; role: Role | null }
  /** Django refused a token that should still have been live: the session is gone. */
  | { kind: "invalid" }
  /** A session exists but could not be confirmed right now (expired mirror, unreachable API). */
  | { kind: "unreachable"; role: Role | null };

interface AccessRule {
  prefix: string;
  /** Roles allowed to be shown anything under this prefix. */
  allow: readonly Role[];
}

/**
 * `/teacher/*` also admits administrators because Django's teacher surfaces accept both roles
 * (`IsTeacherOrAdministrator`); a narrower page rule would only create screens an admin cannot open.
 * `/admin/*` is the other way round on purpose: a teacher must not be shown the shell either.
 */
export const ACCESS_RULES: readonly AccessRule[] = [
  { prefix: "/student", allow: ["student"] },
  { prefix: "/teacher", allow: ["teacher", "admin"] },
  { prefix: "/admin", allow: ["admin"] },
];

const ROLES = new Set<string>(["student", "teacher", "admin"]);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.has(value);
}

export type AccessDecision =
  | { action: "render" }
  /** Nothing signed in: go to the login screen, remembering where the visitor wanted to go. */
  | { action: "login"; to: string }
  /**
   * Signed in, but for a different panel. The session is kept: a teacher who types an admin URL is not
   * logged out, they are moved to the one screen they are allowed to see.
   */
  | { action: "foreign-role"; to: string }
  /**
   * The session is dead. Drop the cookies and start again, or every later request would repeat the same
   * bounce.
   */
  | { action: "logout"; to: string };

export function ruleFor(pathname: string): AccessRule | null {
  for (const rule of ACCESS_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule;
  }
  return null;
}

/**
 * Relative in-app path only. Blocks `//evil.test`, `/\\evil.test` and absolute URLs from turning `?next=`
 * into an open redirect, which is the classic way a login page is made to hand a session to a stranger.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  try {
    const url = new URL(value, "http://examora.invalid");
    if (url.origin !== "http://examora.invalid") return null;
    // `/` is the site root, and the root is where a signed-in visitor would land anyway: no `next` needed.
    return url.pathname === "/" && !url.search && !url.hash ? null : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function loginTarget(pathname: string): string {
  const next = safeNextPath(pathname);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

export function dashboardFor(role: Role): string {
  return `/${role}/dashboard`;
}

/** The whole rule set, in one pure function. `middleware.ts` supplies `session`, nothing else. */
export function decideAccess(pathname: string, session: SessionState): AccessDecision {
  const rule = ruleFor(pathname);
  if (!rule) return { action: "render" };

  if (session.kind === "invalid") return { action: "logout", to: loginTarget(pathname) };
  if (session.kind === "anonymous") return { action: "login", to: loginTarget(pathname) };

  // Signed in, identity unreadable right now: render the shell. Data still has to pass Django, and the
  // client-side guard moves the visitor as soon as `/auth/me/` answers.
  if (!session.role) return { action: "render" };
  if (rule.allow.includes(session.role)) return { action: "render" };
  return { action: "foreign-role", to: dashboardFor(session.role) };
}
