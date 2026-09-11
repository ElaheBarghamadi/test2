export interface AuthTokens {
  access: string;
  refresh: string;
}

interface SharedSession {
  access: string;
  refresh: string;
  savedAt: number;
}

const SHARED_KEY = "examora.session.v1";
const LEGACY_ACCESS_KEY = "examora.access-token";
const LEGACY_REFRESH_KEY = "examora.refresh-token";

/**
 * A session nobody has used for a working day is not worth reviving, and this is the only thing that keeps
 * a shared store from becoming "forever". Touched on read, so any request a tab makes extends it.
 */
export const IDLE_SESSION_MS = 8 * 60 * 60 * 1000;
/** Below this age a touch is skipped, so a burst of requests does not mean a write per request. */
const TOUCH_THROTTLE_MS = 60 * 1000;

/**
 * Bearer tokens live in `localStorage`, shared by every tab of the browser.
 *
 * They used to live in `sessionStorage`, which is per-tab: the second tab of the same browser had no
 * credential at all while the first one did, so a teacher opening an exam in a new tab was told to log in
 * again — and, worse, the server-side page gate *allowed* the page (cookies are shared) while the client
 * still rendered the logged-out shell. `localStorage` makes the credential match the cookie's reach.
 *
 * The trade is stated plainly: this keeps the tokens readable by JavaScript (they already were, and the
 * API is a bearer-token API — the durable fix is HttpOnly cookie auth at the API, not a per-tab store) and
 * it keeps them after the last tab closes, which the idle window above bounds.
 */
type Listener = (present: boolean) => void;

const listeners = new Set<Listener>();
let storageListenerInstalled = false;
let lastTouch = 0;

function local(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function session(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function emit(present: boolean) {
  for (const listener of listeners) {
    try {
      listener(present);
    } catch {
      // A listener that throws must not break the session store for everyone else.
    }
  }
}

function parse(raw: string | null): SharedSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SharedSession> | null;
    if (!value || typeof value.access !== "string" || typeof value.refresh !== "string") return null;
    return { access: value.access, refresh: value.refresh, savedAt: typeof value.savedAt === "number" ? value.savedAt : 0 };
  } catch {
    return null;
  }
}

/** A tab that predates this change kept its pair in `sessionStorage`; adopt it instead of logging out. */
function migrateLegacy(storage: Storage): SharedSession | null {
  const perTab = session();
  if (!perTab) return null;
  const access = perTab.getItem(LEGACY_ACCESS_KEY);
  const refresh = perTab.getItem(LEGACY_REFRESH_KEY);
  perTab.removeItem(LEGACY_ACCESS_KEY);
  perTab.removeItem(LEGACY_REFRESH_KEY);
  if (!access || !refresh) return null;
  const migrated: SharedSession = { access, refresh, savedAt: Date.now() };
  storage.setItem(SHARED_KEY, JSON.stringify(migrated));
  return migrated;
}

function read(): SharedSession | null {
  const storage = local();
  if (!storage) return null;
  const stored = parse(storage.getItem(SHARED_KEY)) ?? migrateLegacy(storage);
  if (!stored) return null;
  if (Date.now() - stored.savedAt > IDLE_SESSION_MS) {
    storage.removeItem(SHARED_KEY);
    return null;
  }
  const now = Date.now();
  if (now - stored.savedAt > TOUCH_THROTTLE_MS && now - lastTouch > TOUCH_THROTTLE_MS) {
    lastTouch = now;
    storage.setItem(SHARED_KEY, JSON.stringify({ ...stored, savedAt: now }));
  }
  return stored;
}

function write(value: SharedSession | null) {
  const storage = local();
  if (!storage) return;
  if (value) storage.setItem(SHARED_KEY, JSON.stringify(value));
  else storage.removeItem(SHARED_KEY);
  lastTouch = Date.now();
}

function watchCrossTab() {
  if (storageListenerInstalled || typeof window === "undefined") return;
  storageListenerInstalled = true;
  window.addEventListener("storage", (event) => {
    // `storage` fires only in the *other* tabs, which is exactly the notification a shared session needs:
    // a login, a logout or a rotated refresh token in one tab is now true in every tab.
    if (event.key && event.key !== SHARED_KEY) return;
    emit(Boolean(read()));
  });
}

export const tokenStorage = {
  get(): AuthTokens | null {
    const stored = read();
    return stored ? { access: stored.access, refresh: stored.refresh } : null;
  },
  set(tokens: AuthTokens) {
    write({ access: tokens.access, refresh: tokens.refresh, savedAt: Date.now() });
  },
  updateAccess(access: string, refresh?: string) {
    const current = read();
    write({ access, refresh: refresh ?? current?.refresh ?? "", savedAt: Date.now() });
  },
  clear() {
    write(null);
    const perTab = session();
    perTab?.removeItem(LEGACY_ACCESS_KEY);
    perTab?.removeItem(LEGACY_REFRESH_KEY);
  },
  /** React to the same session changing in another tab. Returns an unsubscribe function. */
  subscribe(listener: Listener) {
    watchCrossTab();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
