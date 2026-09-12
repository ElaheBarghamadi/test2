import { cacheInvalidate, cachePeek, cacheStore, clearApiCache, isFresh, joinInflight, type CacheEntry } from "@/lib/api/cache";
import { getApiBaseUrl } from "@/lib/api/config";
import { syncSessionMirror } from "@/lib/api/session-mirror";
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
  /**
   * Read-through cache window in milliseconds, for GETs only. Younger than this, the stored body is the
   * answer; older, it is still painted straight away and corrected by a background revalidation. A list a
   * user just changed cannot go stale through this door, because writes clear the resource's entries.
   */
  cacheMs?: number;
  /** Extra resource roots a successful write must invalidate, for the saves whose effect is felt elsewhere. */
  invalidate?: string[];
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

interface SendResult<T> {
  payload: T;
  /** The server said our copy is unchanged, so `payload` is the caller's stored body, not a new one. */
  notModified: boolean;
  etag?: string;
}

async function send<T>(
  path: string,
  options: ApiRequestOptions,
  accessToken?: string | null,
  cached?: CacheEntry,
): Promise<SendResult<T>> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // The conditional header is what makes "revalidate" cheap: the server answers 304 and no JSON is
  // transferred at all. It rides on the request only when a stored body exists to compare against.
  if (cached?.etag) headers.set("If-None-Match", cached.etag);

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

  if (response.status === 304 && cached) {
    return { payload: cached.body as T, notModified: true, etag: cached.etag };
  }
  const payload = await readPayload(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload && typeof payload === "object" ? (payload as ApiErrorPayload) : null,
      responseMessage(payload && typeof payload === "object" ? (payload as ApiErrorPayload) : null, response.status),
    );
  }
  return { payload: payload as T, notModified: false, etag: response.headers.get("etag") ?? undefined };
}

/** One network attempt plus the cache bookkeeping around it. Errors are left to the caller. */
async function requestAndCache<T>(path: string, options: ApiRequestOptions, cached?: CacheEntry): Promise<T> {
  const token = (options.auth ?? true) ? tokenStorage.get()?.access : null;
  const result = await send<T>(path, options, token, cached);
  if ((options.method ?? "GET").toUpperCase() === "GET") {
    if (options.cacheMs) {
      // Only a read whose caller opted in is stored. A body nobody asked to keep must not become the answer
      // to a later call that did, and one-off reads (a session check, a token exchange) stay out of memory.
      // A 304 means the body we held *is* the current one, so only its age moves.
      cacheStore(path, result.notModified && cached ? { ...cached, storedAt: Date.now() } : { body: result.payload, etag: result.etag, storedAt: Date.now() });
    }
  } else {
    cacheInvalidate(path, options.invalidate ?? []);
  }
  return result.payload;
}

/**
 * The retry path for an expired access token: refresh once, replay once, and never recurse further.
 *
 * A cached body is deliberately not trusted here. A 401 means this session's token died, which is also the
 * moment the cache stops being a reasonable source for anything, so a failed replay throws rather than
 * quietly returning the last thing this user saw before signing out.
 */
async function requestWithRefresh<T>(path: string, options: ApiRequestOptions, cached?: CacheEntry): Promise<T> {
  try {
    return await requestAndCache<T>(path, options, cached);
  } catch (error) {
    const auth = options.auth ?? true;
    const canRefresh = auth && options.retryAfterRefresh !== false && error instanceof ApiError && error.status === 401;
    if (!canRefresh) throw error;

    const refreshed = await refreshSession();
    if (!refreshed) {
      tokenStorage.clear();
      clearApiCache();
      onAuthenticationFailure?.();
      throw error;
    }
    // retryAfterRefresh=false makes a second 401 terminal; no recursion or refresh loop.
    return requestAndCache<T>(path, { ...options, retryAfterRefresh: false }, cached);
  }
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const tokens = tokenStorage.get();
    if (!tokens?.refresh) return false;
    try {
      // This deliberately uses send directly: a refresh request can never refresh itself.
      const { payload: rotated } = await send<{ access: string; refresh?: string }>("/auth/token/refresh/", {
        method: "POST",
        body: { refresh: tokens.refresh },
        auth: false,
      });
      if (!rotated.access) return false;
      tokenStorage.updateAccess(rotated.access, rotated.refresh);
      // Rotated tokens are also why the server's page mirror has to be rewritten from here rather than
      // only from the auth store: a refresh can happen on any request, including during an exam.
      void syncSessionMirror();
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Central JSON API client: one controlled JWT refresh path, and the read cache in front of it. */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  // `auth: false` requests (login, refresh) carry no per-user state to reuse, so they never read the cache.
  const isGet = (options.method ?? "GET").toUpperCase() === "GET";
  const cached = isGet && options.auth !== false ? cachePeek(path) : undefined;
  if (cached && isFresh(cached, options.cacheMs ?? 0)) return cached.body as T;

  if (!isGet) return requestWithRefresh<T>(path, options);

  // Two components asking for the same list on one screen share one request.
  return joinInflight(path, async () => {
    if (cached) {
      // Stale-while-revalidate: paint what we have, then let the background answer replace it. The click
      // that made this request is no longer waiting on the network at all.
      void requestWithRefresh<T>(path, options, cached).catch(() => undefined);
      return cached.body as T;
    }
    try {
      return await requestWithRefresh<T>(path, options);
    } catch (error) {
      // A school network that drops for a second should not turn a list page into an error page. This only
      // ever applies to a read the caller opted into, and the next successful write corrects it.
      const retryable = error instanceof Error && !(error instanceof ApiError);
      const stored = cachePeek(path);
      if (retryable && stored) return stored.body as T;
      throw error;
    }
  });
}

/**
 * Sign-out and token loss: nothing of the previous user may still be answerable from memory. Re-exported
 * here so a caller clearing the session has one module to import, and the cache cannot be forgotten.
 */
export { clearApiCache } from "@/lib/api/cache";
