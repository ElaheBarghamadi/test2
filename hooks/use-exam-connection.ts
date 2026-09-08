"use client";

import { useEffect } from "react";

/** Keeps the UI resilient to browser-level online/offline events without adding network polling. */
export function useExamConnection(setConnectionStatus: (status: "online" | "offline") => void) {
  useEffect(() => {
    const setOnline = () => setConnectionStatus("online");
    const setOffline = () => setConnectionStatus("offline");
    if (!navigator.onLine) setOffline();
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, [setConnectionStatus]);
}
