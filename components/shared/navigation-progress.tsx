"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * A hairline that says "your click was heard".
 *
 * App Router gives no `isNavigating` flag, and the two things a page can wait for — the next route's
 * JavaScript and its data — happen with no visible signal at all. On a fast link that is fine; on a school
 * network it reads as a dead button, and people click again.
 *
 * Both navigation paths are covered rather than just links: `history.pushState`/`replaceState` are wrapped
 * because that is what `router.push` and `<Link>` both end up calling, so a programmatic redirect after a save
 * shows the bar too. A hash-only replace (Next's scroll restoration) is filtered out, or the bar would flash
 * every time a page scrolls to an anchor.
 *
 * ## Why there is no state in here
 *
 * `window.history.pushState` is a *global*, and the framework calls it at times React has reserved for
 * itself. Next's own `HistoryUpdater` (`next/dist/client/components/app-router.js`) calls it from inside a
 * `useInsertionEffect`, on every App Router navigation. An earlier version of this component answered with
 * `setPending(true)`, which is an update scheduled during the insertion-effect phase — React's console
 * answered `useInsertionEffect must not schedule updates.` on every click, with the stack pointing at this
 * file.
 *
 * So the bar is driven imperatively instead: the only thing ever written is `data-state` on a permanently
 * mounted element, which React does not render and therefore never fights over. Visibility, including
 * removal from the accessibility tree while idle, is CSS (`visibility: hidden`), not a toggled attribute.
 * A decoration should not cost a render, and it certainly should not be allowed to re-enter React from a
 * patched host API.
 */
const IDLE = "idle";
const ACTIVE = "active";
const DONE = "done";
/** Long enough to cover a slow route on a bad network, short enough that a stuck bar does not look frozen. */
const FALLBACK_MS = 10_000;
/** The "finished" beat: the bar fills, then the whole thing fades out. */
const SETTLE_MS = 320;

export function NavigationProgress() {
  const pathname = usePathname();
  const hostRef = useRef<HTMLDivElement>(null);
  const settleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let fallback: number | null = null;
    let settle: number | null = null;

    // Arrow functions, not `function` declarations: a declaration is hoisted, so TypeScript cannot know it
    // will only ever be called after the `host` null-check above, and drops the narrowing inside it.
    const clearTimers = () => {
      if (fallback !== null) window.clearTimeout(fallback);
      if (settle !== null) window.clearTimeout(settle);
      fallback = null;
      settle = null;
    };

    const finish = () => {
      if (host.dataset.state === IDLE) return;
      clearTimers();
      host.dataset.state = DONE;
      settle = window.setTimeout(() => { host.dataset.state = IDLE; settle = null; }, SETTLE_MS);
    };
    settleRef.current = finish;

    const begin = (target?: string | URL | null) => {
      // Same document, different anchor: not a navigation, and not worth a flash of the bar.
      if (target) {
        try {
          const next = new URL(String(target), window.location.href);
          if (next.pathname === window.location.pathname && next.search === window.location.search) return;
        } catch {
          return;
        }
      }
      clearTimers();
      host.dataset.state = ACTIVE;
      // A refused request or a route error never settles the bar on its own; ten seconds is longer than any
      // real navigation here and shorter than "is this thing frozen?".
      fallback = window.setTimeout(finish, FALLBACK_MS);
    };

    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    window.history.pushState = function patchedPush(...args: Parameters<typeof originalPush>) {
      begin(args[2]);
      return originalPush.apply(this, args);
    };
    window.history.replaceState = function patchedReplace(...args: Parameters<typeof originalReplace>) {
      begin(args[2]);
      return originalReplace.apply(this, args);
    };

    return () => {
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
      clearTimers();
      settleRef.current = () => {};
    };
  }, []);

  // The route settled. `usePathname()` is React's own state, so reading it here is safe — it is only the
  // *write* from inside `pushState` that had to go.
  useEffect(() => {
    settleRef.current();
  }, [pathname]);

  return (
    <div
      ref={hostRef}
      data-state={IDLE}
      role="progressbar"
      aria-label="در حال بارگذاری صفحه"
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
    >
      <span className="nav-progress-bar block h-full w-1/3 rounded-full bg-primary"/>
    </div>
  );
}
