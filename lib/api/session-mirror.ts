/**
 * Client-side half of the session mirror.
 *
 * The browser still authenticates the API with the bearer tokens in `localStorage`; these calls only keep
 * the server's HttpOnly copy in step, so the page gate knows about logins, refreshes and logouts as they
 * happen. Every call is best effort: if the mirror cannot be written the app keeps working, because the
 * gate falls back to its hint and the data routes are the real authority.
 */

import { tokenStorage, type AuthTokens } from "@/lib/api/token-storage";

const ENDPOINT = "/api/auth/session";

async function send(init: RequestInit) {
  try {
    await fetch(ENDPOINT, { ...init, credentials: "same-origin" });
  } catch {
    // A failed mirror sync must never surface as an API error to the user.
  }
}

export async function syncSessionMirror(tokens: AuthTokens | null = tokenStorage.get()): Promise<void> {
  if (!tokens?.access) {
    await clearSessionMirror();
    return;
  }
  await send({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access: tokens.access, refresh: tokens.refresh }),
  });
}

export async function clearSessionMirror(): Promise<void> {
  await send({ method: "DELETE" });
}
