"use client";

import { useEffect } from "react";
import { ApiError } from "@/lib/api/client";
import { dropJournal, journalRecordFor, writeJournal } from "@/lib/exam/answer-journal";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

/** Debounce window: one save per burst of edits, not one per keystroke. */
const AUTOSAVE_DELAY_MS = 350;
/** A refused write is retried on a timer too, so a brief network drop cannot strand an answer. */
const RETRY_DELAY_MS = 5_000;
/**
 * The on-disk copy is taken slightly sooner than the network write, so a tab closed mid-burst still leaves
 * the student's last words on disk. It is a local write, so it costs nothing to be eager.
 */
const JOURNAL_DELAY_MS = 200;

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
  const attemptId = attempt?.id;
  // The two queued lists, joined, are the effect's real trigger: they change exactly when the set of unsent
  // questions does, while `answers` changes on every keystroke and would re-arm the timer for each one.
  const pendingAnswerQuestionIds = attempt?.pendingAnswerQuestionIds?.join(",") ?? "";
  const pendingFlagQuestionIds = attempt?.pendingFlagQuestionIds?.join(",") ?? "";

  /**
   * Mirror the unsent queue onto disk.
   *
   * This is what turns "the answers are safe" from a claim about a JavaScript object into a fact that
   * survives a reload, a crash or a closed window. It deliberately runs *before* the network write and
   * independently of it: the moment an edit exists, it is worth keeping, whether or not this device can
   * reach the server right now.
   *
   * When the queue drains the record is deleted, so a later reload cannot restore work the server already
   * has — the whole risk of keeping a local copy is restoring something stale, and that is what this rule
   * removes.
   */
  useEffect(() => {
    if (!attemptId || attemptId.startsWith("local-")) return;
    const record = journalRecordFor(attempt);
    if (!record) {
      void dropJournal(attemptId);
      return;
    }
    const timer = window.setTimeout(() => void writeJournal(record), JOURNAL_DELAY_MS);
    // Closing a tab does not wait for a timer, so the same snapshot is also written on the way out.
    const writeNow = () => void writeJournal(record);
    window.addEventListener("pagehide", writeNow);
    document.addEventListener("visibilitychange", writeNow);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", writeNow);
      document.removeEventListener("visibilitychange", writeNow);
    };
    // The dependency list is the whole rule: the record is built from the newest `attempt` at the moment the
    // effect runs, and `answerRevision` moves on every edit, so each run already holds the current values.
    // Depending on `attempt` itself would only add runs that produce the same record.
  }, [attemptId, attempt?.status, attempt?.connectionStatus, attempt?.answerRevision, attempt?.saveStatus, attempt?.serverRevision, pendingAnswerQuestionIds, pendingFlagQuestionIds]);

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
