import { NextResponse, type NextRequest } from "next/server";

import { decodeExpiry, eraseMirror, readMirror, verifyToken, writeMirror } from "@/lib/auth/session";

/**
 * The mirror's only writer: `POST /api/auth/session` hands the server the tokens the browser just
 * received, and the server keeps an HttpOnly copy for `middleware.ts`.
 *
 * The role is read out of Django's answer to the token, never out of the request body, so a client cannot
 * claim a role it does not hold and the cookie is worthless to forge. When Django cannot be reached the
 * mirror is still written - without a role - because the alternative is refusing a session that exists and
 * bouncing a signed-in class to the login screen.
 */

export const dynamic = "force-dynamic";

interface SessionRequestBody {
  access?: unknown;
  refresh?: unknown;
}

function bearerOnly(value: unknown, max = 4096): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  // A cookie is not a place for a runaway string; a JWT is never near this size in this project.
  return trimmed.length > max ? "" : trimmed;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as SessionRequestBody | null;
  const access = bearerOnly(body?.access);
  const refresh = bearerOnly(body?.refresh);
  const response = NextResponse.json({ ok: Boolean(access), role: null }, { status: access ? 200 : 400 });
  if (!access) {
    eraseMirror(response);
    return response;
  }

  const verification = await verifyToken(access, decodeExpiry(access));
  if (verification.kind === "invalid") {
    // A refused token is the one answer that must also clear any mirror that was already there.
    eraseMirror(response);
    return NextResponse.json({ ok: false, code: "invalid_token" }, { status: 401 });
  }
  writeMirror(response, {
    role: verification.kind === "valid" ? verification.role : null,
    accessToken: access,
    accessExpiry: decodeExpiry(access) ?? 0,
    refresh,
  });
  return NextResponse.json({ ok: true, role: verification.kind === "valid" ? verification.role : null });
}

/** `DELETE` ends the session locally. Revoking the API token itself stays the browser's job (`/auth/logout/`). */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  eraseMirror(response);
  return response;
}

/** "Who does the server think this is?" - a role and nothing else, for the client's own re-check. */
export async function GET(request: NextRequest) {
  const mirror = readMirror(request);
  if (!mirror) return NextResponse.json({ authenticated: false, role: null }, { status: 401 });
  const verification = await verifyToken(mirror.accessToken, mirror.accessExpiry);
  const role = verification.kind === "valid" ? verification.role : mirror.role;
  return NextResponse.json({ authenticated: role !== null || verification.kind !== "invalid", role });
}
