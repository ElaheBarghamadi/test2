/**
 * A read-through cache for the JSON API, in the browser's memory and nothing else.
 *
 * Every screen in this app is a client component that fetches on mount, so going back to the exam list used
 * to mean a full round trip for data that changed, if at all, since the teacher left. This cache fixes that
 * without pretending to be a source of truth:
 *
 *   * only GETs are stored, and only for callers that ask (`cacheMs`);
 *   * a body younger than `cacheMs` is served without touching the network at all;
 *   * an older body is served *immediately* and revalidated in the background, so a click never waits for
 *     the server to answer — the page paints, then quietly corrects itself;
 *   * any successful write drops the cached reads of the resource it touched, which is why a teacher's own
 *     edit is never visible twice as "stale";
 *   * nothing here survives a reload or a logout, and nothing here is written to disk. An exam answer is
 *     never cached in the first place, so a shared school computer never keeps a student's work.
 *
 * Revalidation is honest only because the API answers with an `ETag` (see
 * `apps/core/middleware.py`): the cached body is reused when the server says it is unchanged, and the
 * server's `Cache-Control: private, max-age=0, must-revalidate` makes every entry re-checked, never trusted.
 */

export interface CacheEntry {
  body: unknown;
  /** The server's validator for this exact body, from the response's `ETag`. */
  etag?: string;
  storedAt: number;
}

const entries = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/** Two requests for the same path while the first is in flight become one. */
export function joinInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function cachePeek(path: string): CacheEntry | undefined {
  return entries.get(path);
}

export function cacheStore(path: string, entry: CacheEntry): void {
  entries.set(path, entry);
}

/**
 * The resource root of a path (`/exams/123/questions/` → `/exams`). Writes invalidate at this level rather
 * than by exact path on purpose: a save that changes one row can change what every list of that resource
 * looks like, and guessing which ones is how a UI ends up showing a number that no longer exists.
 */
export function resourceRoot(path: string): string {
  const withoutQuery = path.split("?")[0];
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments.length ? `/${segments[0]}` : "/";
}

export function cacheInvalidate(path: string, extra: string[] = []): void {
  const roots = new Set([resourceRoot(path), ...extra.map(resourceRoot)]);
  for (const key of [...entries.keys()]) {
    if (roots.has(resourceRoot(key))) entries.delete(key);
  }
}

export function clearApiCache(): void {
  entries.clear();
  inflight.clear();
}

export function isFresh(entry: CacheEntry | undefined, cacheMs: number, now = Date.now()): boolean {
  return Boolean(entry && cacheMs > 0 && now - entry.storedAt < cacheMs);
}

/** How much is held in memory, for a debug read and for the tests that assert a write really dropped it. */
export function cacheSize(): number {
  return entries.size;
}
