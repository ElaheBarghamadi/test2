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

  /** Machine-readable reason when the server sends one (attempt conflicts, etc.). */
  get code(): string | null {
    const code = this.payload?.code;
    return typeof code === "string" ? code : null;
  }

  /** Seconds the server asked us to wait, for a 429. */
  get retryAfterSeconds(): number | null {
    return typeof this.payload?.retry_after === "number" ? this.payload.retry_after : null;
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

/**
 * Status-specific fallbacks, so a failure is never reduced to one generic sentence. The server's own
 * message always wins when there is one; these only cover transports that produced no useful text
 * (a proxy timeout, a 500 from an upstream, an HTML error page).
 */
const STATUS_COPY: Record<number, string> = {
  400: "درخواست پذیرفته نشد؛ مقادیر واردشده را بررسی کنید.",
  401: "نشست شما منقضی شده است. برای ادامه دوباره وارد شوید.",
  403: "دسترسی به این اطلاعات برای شما مجاز نیست.",
  404: "این مورد پیدا نشد؛ ممکن است حذف یا تغییر کرده باشد.",
  409: "این اقدام با وضعیت فعلی سرور در تضاد است. صفحه را تازه‌سازی کنید.",
  422: "دادهٔ ارسالی با قوانین سرور هم‌خوانی ندارد.",
  429: "درخواست‌ها بیش از حد مجاز شده است؛ کمی صبر کنید و دوباره تلاش کنید.",
  500: "سرور با خطا مواجه شد. تلاش شما محفوظ است؛ کمی بعد دوباره امتحان کنید.",
  502: "سرویس در دسترس نیست. کمی بعد دوباره تلاش کنید.",
  503: "سرویس موقتاً از دسترس خارج است. کمی بعد دوباره تلاش کنید.",
};

export function apiErrorMessage(error: unknown, fallback = "درخواست انجام نشد. لطفاً دوباره تلاش کنید.") {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback;
  const detail = error.payload?.detail;
  const message = typeof detail === "string" && detail.trim()
    ? detail
    : Array.isArray(detail)
      ? detail.map(String).join(" ")
      : detail && typeof detail === "object"
        ? Object.values(detail as Record<string, unknown>)
          .flatMap((value) => (Array.isArray(value) ? value : [value]))
          .map(String)
          .join(" ")
        : "";
  // A 429 also carries the server's own wait time; the client uses it to schedule the next attempt
  // instead of hammering the endpoint that just refused it.
  if (error.status === 429) return message || STATUS_COPY[429];
  return message || STATUS_COPY[error.status] || error.message || fallback;
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
