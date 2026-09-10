"use client";

import { useEffect } from "react";
import type { ExamAttempt } from "@/lib/types/domain";

/**
 * The countdown ticks locally so it stays smooth, but the server owns the deadline: it is re-read
 * periodically and whenever the tab becomes visible again. Without that, a teacher extending an exam
 * would leave every open session counting down to the old minute, and a sleeping laptop would burn
 * minutes it never used.
 */
export function useExamTimer(attempt: ExamAttempt | null, tick: () => void, sync?: () => Promise<unknown>) {
  useEffect(() => {
    if (attempt?.status !== "in_progress") return;
    const interval = window.setInterval(tick, 1000);
    const resync = sync ? window.setInterval(() => void sync(), 60_000) : undefined;
    const resyncOnFocus = () => { if (document.visibilityState === "visible") void sync?.(); };
    window.addEventListener("focus", resyncOnFocus);
    document.addEventListener("visibilitychange", resyncOnFocus);
    return () => {
      window.clearInterval(interval);
      if (resync) window.clearInterval(resync);
      window.removeEventListener("focus", resyncOnFocus);
      document.removeEventListener("visibilitychange", resyncOnFocus);
    };
  }, [attempt?.status, tick, sync]);
}
