"use client";

import { useSyncExternalStore } from "react";

/**
 * Is the browser online?
 *
 * `navigator.onLine` is a hint, not a promise — it says a network interface exists, not that the API is
 * reachable — so nothing here is allowed to *decide* whether an action may run. It is used for one thing the
 * browser does know reliably: the connection is gone, so a save that is attempted now will fail slowly, and
 * the screen can say so before the teacher waits twenty seconds to find out.
 *
 * The server stays the authority on every value; this only decides what the UI warns about.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Server render: assume online, so the first paint never shows an offline warning it cannot justify.
    () => true,
  );
}
