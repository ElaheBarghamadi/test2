export interface AuthTokens {
  access: string;
  refresh: string;
}

const ACCESS_KEY = "examora.access-token";
const REFRESH_KEY = "examora.refresh-token";

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

/**
 * JWTs are kept in sessionStorage because the current Django API returns bearer tokens,
 * not HttpOnly cookies. This limits persistence to the browser session; CSP/XSS hardening
 * and an HttpOnly-cookie strategy remain deployment concerns.
 */
export const tokenStorage = {
  get(): AuthTokens | null {
    const storage = browserStorage();
    if (!storage) return null;
    const access = storage.getItem(ACCESS_KEY);
    const refresh = storage.getItem(REFRESH_KEY);
    return access && refresh ? { access, refresh } : null;
  },
  set(tokens: AuthTokens) {
    const storage = browserStorage();
    storage?.setItem(ACCESS_KEY, tokens.access);
    storage?.setItem(REFRESH_KEY, tokens.refresh);
  },
  updateAccess(access: string, refresh?: string) {
    const storage = browserStorage();
    storage?.setItem(ACCESS_KEY, access);
    if (refresh) storage?.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    const storage = browserStorage();
    storage?.removeItem(ACCESS_KEY);
    storage?.removeItem(REFRESH_KEY);
  },
};
