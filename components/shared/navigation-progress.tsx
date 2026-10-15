"use client";

import { useEffect, useRef, useState } from "react";
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
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;

    function begin(target?: string | URL | null) {
      // Same document, different anchor: not a navigation, and not worth a flash of the bar.
      if (target) {
        try {
          const next = new URL(String(target), window.location.href);
          if (next.pathname === window.location.pathname && next.search === window.location.search) return;
        } catch {
          return;
        }
      }
      setPending(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      // A refused request or a route error never settles the bar on its own; ten seconds is longer than any
      // real navigation here and shorter than "is this thing frozen?".
      timeoutRef.current = window.setTimeout(() => setPending(false), 10_000);
    }

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
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setPending(false);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [pathname]);

  if (!pending) return null;
  return (
    <div
      role="progressbar"
      aria-label="در حال بارگذاری صفحه"
      aria-busy="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
    >
      <span className="nav-progress-bar block h-full w-1/3 rounded-full bg-primary" />
    </div>
  );
}
