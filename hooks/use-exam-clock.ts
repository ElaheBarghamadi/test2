"use client";

import { useCallback } from "react";
import type { ExamAttempt } from "@/lib/types/domain";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";

/**
 * Pairs the smooth local countdown with the only clock that counts: the server's.
 *
 * `sync` re-reads the deadline, the status, the accepted revision and the navigation frontier through the
 * heartbeat endpoint — deliberately not the attempt detail, because 180 students polling a minute should
 * not each download the whole answer sheet. It lets a teacher's extension keep the exam running, keeps a
 * sleeping laptop from burning minutes it never used, keeps "you may not go back" in step with the server's
 * own record, and hands a failed read back as `null` so a dropped connection can never be mistaken for
 * "time is up".
 */
export function useExamClock(attempt: ExamAttempt | null, examSession?: string) {
  const tick = useExamAttemptStore((state) => state.tick);
  const syncClock = useExamAttemptStore((state) => state.syncClock);
  const acceptRevision = useExamAttemptStore((state) => state.acceptRevision);
  const setAnswerFrontier = useExamAttemptStore((state) => state.setAnswerFrontier);
  const setSessionConflict = useExamAttemptStore((state) => state.setSessionConflict);
  const attemptId = attempt?.id;
  const remote = Boolean(attemptId && !attemptId.startsWith("local-"));

  const sync = useCallback(async () => {
    if (!attemptId || !remote) return null;
    try {
      const timing = await examAttemptService.syncClock(attemptId, examSession);
      syncClock(timing.status, timing.remainingSeconds);
      if (typeof timing.serverRevision === "number") acceptRevision(timing.serverRevision);
      if (typeof timing.answerFrontier === "number") setAnswerFrontier(timing.answerFrontier);
      // The lock is reported rather than enforced by the client: the student decides which window continues.
      setSessionConflict(timing.sessionLockedByOther ? "another_session" : null);
      return timing;
    } catch {
      return null;
    }
    // The store is read through its actions, not through `attempt`, so a tick of the local countdown does
    // not re-create this callback and restart the timer that uses it.
  }, [acceptRevision, attemptId, examSession, remote, setAnswerFrontier, setSessionConflict, syncClock]);

  return { tick, sync };
}
