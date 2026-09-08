"use client";

import { useEffect } from "react";
import type { ExamAttempt } from "@/lib/types/domain";

export function useExamTimer(attempt: ExamAttempt | null, tick: () => void) {
  useEffect(() => {
    if (attempt?.status !== "in_progress") return;
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [attempt?.status, tick]);
}
