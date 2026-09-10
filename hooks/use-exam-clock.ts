"use client";

import { useCallback } from "react";
import type { ExamAttempt } from "@/lib/types/domain";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";

/**
 * Pairs the smooth local countdown with the only clock that counts: the server's.
 *
 * `sync` re-reads the deadline and status. It lets an exam the teacher extended keep running instead of
 * freezing at the old minute, and it is what the expiry handler checks before finalising anything — a
 * failed read returns null so a dropped connection can never be mistaken for "time is up".
 */
export function useExamClock(attempt: ExamAttempt | null) {
  const tick = useExamAttemptStore((state) => state.tick);
  const syncClock = useExamAttemptStore((state) => state.syncClock);
  const attemptId = attempt?.id;
  const remote = Boolean(attemptId && !attemptId.startsWith("local-"));

  const sync = useCallback(async () => {
    if (!attemptId || !remote) return null;
    try {
      const timing = await examAttemptService.syncClock(attemptId);
      syncClock(timing.status, timing.remainingSeconds);
      return timing;
    } catch {
      return null;
    }
  }, [attemptId, remote, syncClock]);

  return { tick, sync };
}
