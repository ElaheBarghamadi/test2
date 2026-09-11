"use client";

import { useCallback } from "react";
import type { ExamAttempt } from "@/lib/types/domain";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";

/**
 * Pairs the smooth local countdown with the only clock that counts: the server's.
 *
 * `sync` re-reads the deadline, the status and the accepted revision through the heartbeat endpoint —
 * deliberately not the attempt detail, because 180 students polling a minute should not each download
 * the whole answer sheet. It lets a teacher's extension keep the exam running, keeps a sleeping laptop
 * from burning minutes it never used, and hands a failed read back as `null` so a dropped connection can
 * never be mistaken for "time is up".
 */
export function useExamClock(attempt: ExamAttempt | null, examSession?: string) {
  const tick = useExamAttemptStore((state) => state.tick);
  const syncClock = useExamAttemptStore((state) => state.syncClock);
  const acceptRevision = useExamAttemptStore((state) => state.acceptRevision);
  const setSessionConflict = useExamAttemptStore((state) => state.setSessionConflict);
  const attemptId = attempt?.id;
  const remote = Boolean(attemptId && !attemptId.startsWith("local-"));

  const sync = useCallback(async () => {
    if (!attemptId || !remote) return null;
    try {
      const timing = await examAttemptService.syncClock(attemptId, examSession);
      syncClock(timing.status, timing.remainingSeconds);
      if (typeof timing.serverRevision === "number") acceptRevision(timing.serverRevision);
      // The lock is reported rather than enforced by the client: the student decides which window continues.
      setSessionConflict(timing.sessionLockedByOther ? "another_session" : null);
      return timing;
    } catch {
      return null;
    }
  }, [acceptRevision, attemptId, examSession, remote, setSessionConflict, syncClock]);

  return { tick, sync };
}
