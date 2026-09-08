import type { NextConfig } from "next";

const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
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
};
export default nextConfig;
