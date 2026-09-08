/** Public API origin only. Never put Django secrets in NEXT_PUBLIC variables. */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!configured) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL تنظیم نشده است.");
  }
  return configured.replace(/\/$/, "");
}
