import type { NextConfig } from "next";

const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
/**
 * Response headers, applied by the server rather than by page code so no route can forget them.
 *
 * The frame-blocking and HSTS pair is only sent in a production build on purpose: the development preview
 * embeds this app in an iframe, and `X-Frame-Options: DENY` would blank it out. Anything deployed for
 * real gets the full set, and the clickjacking protection is what an exam platform needs (an overlay on
 * the submit button is the classic attack on a page like this).
 */
function apiCacheControl(): string {
  /*
   * `no-store` was the safe default for every response, and it also made every page visit a full round trip.
   * `must-revalidate` with a zero lifetime is the same guarantee with one difference that matters: the client
   * may keep the body and must ask whether it is still current, and the API answers with a bare 304 when it
   * is (see `apps/core/middleware.py`). Nothing is trusted for a moment longer than the server has confirmed.
   */
  return "private, max-age=0, must-revalidate";
}

function securityHeaders(isApi = false): Array<{ key: string; value: string }> {
  const headers = [
    // A proxied API response is JSON, and a mislabelled body must never be sniffed into a script.
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    // An exam client has no use for a camera, a microphone or a location fix: refuse them at the boundary
    // so no future feature can ask by accident, and no page can silently record the screen.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), display-capture=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // The API is reached through this origin in the recommended deployment, and its own responses are
    // private per session: a shared cache must not hand one teacher's row set to the next visitor.
    { key: "Cache-Control", value: isApi ? apiCacheControl() : "private, no-store" },
    // `Authorization` is what makes "private" mean per *session* rather than per *machine*: the browser (and
    // any proxy in front of a school) has to keep one entry per credential, so the next student to sit at
    // this computer is served their own answer, not the last teacher's list.
    ...(isApi ? [{ key: "Vary", value: "Authorization, Cookie" }] : []),
  ];
  if (process.env.NODE_ENV === "production") {
    headers.push(
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
    );
  }
  return headers;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Django's API contract is slash-terminated; do not normalize POST URLs before proxying.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // The target is server-only. Browser components always use NEXT_PUBLIC_API_BASE_URL,
    // allowing local/proxied requests without embedding a localhost URL in UI code.
    if (!apiProxyTarget) return [];
    return [{ source: "/api/v1/:path*", destination: `${apiProxyTarget}/api/v1/:path*/` }];
  },
  async headers() {
    // Enumerated instead of `/:path*`: `_next/static/*` is content-hashed and must stay cacheable forever,
    // and a blanket `no-store` there would cost real bandwidth for no protection.
    const sources = [
      "/",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/student/:path*",
      "/teacher/:path*",
      "/admin/:path*",
      "/api/v1/:path*",
    ];
    return sources.map((source) => ({
      source,
      headers: securityHeaders(source.startsWith("/api/v1/")),
    }));
  },
};
export default nextConfig;
