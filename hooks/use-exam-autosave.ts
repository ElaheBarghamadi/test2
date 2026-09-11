"use client";

import { useEffect } from "react";
import { ApiError } from "@/lib/api/client";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

/** Debounce window: one save per burst of edits, not one per keystroke. */
const AUTOSAVE_DELAY_MS = 350;
/** A refused write is retried on a timer too, so a brief network drop cannot strand an answer. */
const RETRY_DELAY_MS = 5_000;

/**
 * Debounced, targeted persistence with a retry ladder.
 *
 * Only changed answers and flags reach the API. A conflict raised by the server is not a dead end:
 * `saveAnswers` already re-based a stale revision internally, and what is left (another window owns the
 * attempt, a refused write, a network error) keeps the queue dirty and schedules another attempt with
 * exponential backoff. Losing an answer to a dropped request is the failure mode this whole path exists
 * to avoid, so it never marks a refused write as saved.
 */
export function useExamAutosave(
  attempt: ExamAttempt | null,
  exam: Exam,
  markSaved: (revision: number, serverRevision?: number) => void,
  markSaveFailed: (revision: number) => void,
  options?: {
    examSession?: string;
    retry?: () => void;
    onConflict?: (conflict: NonNullable<Awaited<ReturnType<typeof examAttemptService.saveAnswers>>["conflict"]>) => void;
    /**
     * Called when the server refused writes because those questions have been passed. The caller restores
     * the saved answers for them; the hook neither retries (the rule will refuse again) nor reports a
     * failure, because nothing went wrong - the exam's own rule was applied.
     */
    onQuestionsLocked?: (questionIds: string[]) => Promise<void> | void;
  },
) {
  const examSession = options?.examSession;
  const onConflict = options?.onConflict;
  const retry = options?.retry;
  const onQuestionsLocked = options?.onQuestionsLocked;

  useEffect(() => {
    if (!attempt || attempt.status !== "in_progress") return;
    if (attempt.connectionStatus === "offline") return;
    if (attempt.saveStatus !== "saving" && attempt.saveStatus !== "error") return;
    const revision = attempt.answerRevision;
    const controller = new AbortController();
    const delay = attempt.saveStatus === "error" ? RETRY_DELAY_MS : AUTOSAVE_DELAY_MS;
    const timeout = window.setTimeout(() => {
      void examAttemptService
        .saveAnswers({ attempt, exam, revision, signal: controller.signal, examSession })
        .then(async (result) => {
          if (result.conflict) {
            if (result.conflict.code === "question_locked") {
              // The rule, not a fault: hand the refused ids back to the caller, then keep going with
              // whatever else was queued. Marking this a save failure would advertise a lost answer that
              // was never allowed to exist.
              await onQuestionsLocked?.(result.conflict.questionIds);
              if (retry) window.setTimeout(() => retry(), 0);
              return;
            }
            onConflict?.(result.conflict);
            if (result.conflict.code === "attempt_finalized") {
              // The server owns the final state now and has graded what was saved; nothing left to flush.
              markSaved(revision, result.serverRevision);
              return;
            }
            // Keep the queue dirty and fall into the error state, which re-arms this effect once for a
            // 5-second retry. A refused write is never presented as a saved answer.
            markSaveFailed(revision);
            return;
          }
          markSaved(revision, result.serverRevision);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          markSaveFailed(revision);
          if (error instanceof ApiError && error.status === 429) {
            // Rate limited: the queue stays intact and the next attempt waits for the server's own delay.
            window.setTimeout(() => retry?.(), Math.min(Math.max(error.retryAfterSeconds ?? 10, 5), 120) * 1_000);
          }
        });
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // `attempt.saveStatus === "error"` is deliberately in the dependency set: it is what re-arms the
    // timer after a failure without waiting for the student to type something else.
  }, [attempt?.answerRevision, attempt?.connectionStatus, attempt?.saveStatus, attempt?.status, attempt?.id, attempt?.answers, attempt?.pendingAnswerQuestionIds, attempt?.pendingFlagQuestionIds, exam, examSession, markSaved, markSaveFailed, onConflict, onQuestionsLocked, retry]);
}
