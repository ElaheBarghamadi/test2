import { getApiBaseUrl } from "@/lib/api/config";
import { tokenStorage } from "@/lib/api/token-storage";

export interface ApiErrorPayload {
  detail?: unknown;
  status_code?: number;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: ApiErrorPayload | null,
    message?: string,
  ) {
    super(message ?? "خطا در ارتباط با سرور");
    this.name = "ApiError";
  }

  get fieldErrors(): Record<string, string[]> {
    const detail = this.payload?.detail;
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
    return Object.fromEntries(
      Object.entries(detail as Record<string, unknown>).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(String) : [String(value)],
      ]),
    );
  }
}

export function apiErrorMessage(error: unknown, fallback = "درخواست انجام نشد. لطفاً دوباره تلاش کنید.") {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback;
  const detail = error.payload?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(String).join(" ");
  if (detail && typeof detail === "object") {
    return Object.values(detail as Record<string, unknown>)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map(String)
      .join(" ");
  }
  return error.message || fallback;
}

interface ApiRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: HeadersInit;
  /** Requests that establish/refresh a session explicitly opt out. */
  auth?: boolean;
  /** Internal guard: at most one refresh and one retry for a request. */
  retryAfterRefresh?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;
let onAuthenticationFailure: (() => void) | null = null;

/** Auth state installs this callback once so failed refreshes clear the whole client session. */
export function setAuthenticationFailureHandler(handler: (() => void) | null) {
  onAuthenticationFailure = handler;
}

function responseMessage(payload: ApiErrorPayload | null, status: number) {
  if (typeof payload?.detail === "string") return payload.detail;
  return status === 401 ? "نشست شما منقضی شده است." : "درخواست توسط سرور پذیرفته نشد.";
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response.text();
  return response.json();
}

async function send<T>(path: string, options: ApiRequestOptions, accessToken?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("اتصال به سرور برقرار نشد. شبکه و نشانی API را بررسی کنید.");
  }

  const payload = await readPayload(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload && typeof payload === "object" ? (payload as ApiErrorPayload) : null,
      responseMessage(payload && typeof payload === "object" ? (payload as ApiErrorPayload) : null, response.status),
    );
  }
  return payload as T;
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const tokens = tokenStorage.get();
    if (!tokens?.refresh) return false;
    try {
      // This deliberately uses send directly: a refresh request can never refresh itself.
      const response = await send<{ access: string; refresh?: string }>("/auth/token/refresh/", {
        method: "POST",
        body: { refresh: tokens.refresh },
        auth: false,
      });
      if (!response.access) return false;
      tokenStorage.updateAccess(response.access, response.refresh);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Central JSON API client with one controlled JWT refresh/retry path. */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  const token = auth ? tokenStorage.get()?.access : null;
  try {
    return await send<T>(path, options, token);
  } catch (error) {
    const canRefresh = auth && options.retryAfterRefresh !== false && error instanceof ApiError && error.status === 401;
    if (!canRefresh) throw error;

    const refreshed = await refreshSession();
    if (!refreshed) {
      tokenStorage.clear();
      onAuthenticationFailure?.();
      throw error;
    }
    // retryAfterRefresh=false makes a second 401 terminal; no recursion or refresh loop.
    return apiRequest<T>(path, { ...options, retryAfterRefresh: false });
  }
}
