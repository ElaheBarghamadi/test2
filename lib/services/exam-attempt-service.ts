import { attemptsApi, type ApiAnswerInput, type AttemptWriteGuards } from "@/lib/api/attempts";
import { ApiError, apiErrorMessage } from "@/lib/api/client";
import { toStudentAttempt } from "@/lib/api/mappers";
import type { AnswerValue, Exam, ExamAttempt, Question } from "@/lib/types/domain";

export interface SaveAttemptRequest {
  attempt: ExamAttempt;
  exam: Exam;
  /** Local edit counter, used only to ignore an answer that is no longer the newest one. */
  revision: number;
  signal?: AbortSignal;
  /** Per-tab identity, so the server can tell a refresh from a second window. */
  examSession?: string;
}

/** A 409 from the attempt write guards, decoded so the caller can react to the *reason*. */
export class AttemptWriteConflict extends Error {
  constructor(
    public readonly code: "stale_revision" | "another_session_active" | "attempt_finalized",
    message: string,
    public readonly answerRevision?: number,
  ) {
    super(message);
    this.name = "AttemptWriteConflict";
  }
}

const CONFLICT_COPY: Record<AttemptWriteConflict["code"], string> = {
  stale_revision: "نسخهٔ تازه‌تری روی سرور ثبت شده بود.",
  another_session_active: "این آزمون در پنجرهٔ دیگری باز است و همان پنجره در حال نوشتن است.",
  attempt_finalized: "نشست آزمون بسته شده است؛ پاسخ‌های ذخیره‌شده نمره گرفته‌اند.",
};

function asConflict(error: unknown): AttemptWriteConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const payload = (error.payload ?? {}) as { code?: unknown; answer_revision?: unknown };
  const code = payload.code;
  if (code !== "stale_revision" && code !== "another_session_active" && code !== "attempt_finalized") return null;
  return new AttemptWriteConflict(code, CONFLICT_COPY[code], typeof payload.answer_revision === "number" ? payload.answer_revision : undefined);
}

function toAnswerInput(question: Question, value: AnswerValue): ApiAnswerInput {
  if (question.type === "single_choice") return { selected_option_ids: typeof value === "string" ? [value] : [] };
  if (question.type === "multiple_choice") return { selected_option_ids: Array.isArray(value) ? value : [] };
  if (question.type === "true_false") {
    const option = value === true ? question.optionIds?.true : value === false ? question.optionIds?.false : "";
    return { selected_option_ids: option ? [option] : [] };
  }
  return { text: typeof value === "string" ? value : "" };
}

export interface SaveAttemptResult {
  /** Revision the server now holds, once this write was accepted. */
  serverRevision?: number;
  /** Set when the server refused the write; the queue is deliberately left dirty. */
  conflict?: AttemptWriteConflict;
}

export const examAttemptService = {
  /**
   * Flush the queued edits and settle any conflict the server raises, instead of dropping it.
   *
   * A rejected revision is re-based from the number the 409 itself reported and sent once more, so a
   * retried or offline-queued request can never overwrite a newer answer *or* lose its own. A session
   * owned by another window stops the retry and hands the decision to the student. Either way the
   * pending queue stays dirty until the server accepts, so nothing is ever shown as saved that is not.
   */
  async saveAnswers(request: SaveAttemptRequest): Promise<SaveAttemptResult> {
    const first = await this.writeAnswers(request);
    if (first.conflict?.code === "stale_revision" && first.conflict.answerRevision !== undefined) {
      return this.writeAnswers({ ...request, expectedRevision: first.conflict.answerRevision }, first.conflict);
    }
    return first;
  },

  /**
   * One guarded write. The single-question endpoint stays for the common case and the batch endpoint is
   * used when one save cycle touched several answers, because Django applies a batch atomically.
   */
  async writeAnswers(request: SaveAttemptRequest & { expectedRevision?: number }, previousConflict?: AttemptWriteConflict): Promise<SaveAttemptResult> {
    const { attempt, exam, signal } = request;
    const questions = new Map(exam.questions.map((question) => [question.id, question]));
    const answerUpdates = (attempt.pendingAnswerQuestionIds || []).flatMap((questionId) => {
      const question = questions.get(questionId);
      const answer = attempt.answers[questionId];
      return question && answer ? [{ questionId, payload: toAnswerInput(question, answer.value) }] : [];
    });
    const flagIds = attempt.pendingFlagQuestionIds || [];
    const guards: AttemptWriteGuards = {
      examSession: request.examSession,
      // An absent number means "no guard", which keeps older clients and first loads working.
      examRevision: request.expectedRevision ?? attempt.serverRevision,
    };
    try {
      if (answerUpdates.length === 1) {
        await attemptsApi.saveAnswer(attempt.id, answerUpdates[0].questionId, answerUpdates[0].payload, signal, guards);
      } else if (answerUpdates.length > 1) {
        await attemptsApi.saveAnswers(attempt.id, answerUpdates.map(({ questionId, payload }) => ({ question_id: questionId, ...payload })), signal, guards);
      }
      await Promise.all(flagIds.map((questionId) => {
        const answer = attempt.answers[questionId];
        return answer ? attemptsApi.setFlag(attempt.id, questionId, answer.flagged, signal, guards) : Promise.resolve();
      }));
      const accepted = typeof guards.examRevision === "number" ? guards.examRevision + 1 : undefined;
      // A flag-only cycle still advanced the server counter by at most one; when both kinds ran, the
      // second write moved it again, so the value is re-read on the next heartbeat rather than guessed.
      return { serverRevision: answerUpdates.length > 0 && flagIds.length === 0 ? accepted : undefined };
    } catch (error) {
      const conflict = asConflict(error);
      if (conflict) {
        // A retry that still conflicts is reported as the original problem: the caller keeps the queue
        // and shows one message, rather than reporting a second failure the student did not cause.
        if (previousConflict && conflict.code === "stale_revision") return { conflict: previousConflict };
        return { conflict };
      }
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw error;
    }
  },

  /**
   * Re-read the deadline, the status and the accepted revision.
   *
   * This is the heartbeat endpoint, not the attempt detail: a class of 180 students polling every minute
   * should not download every question and every answer just to learn how many seconds are left.
   */
  async syncClock(attemptId: string, examSession?: string): Promise<{ status: ExamAttempt["status"]; remainingSeconds: number; serverRevision?: number; sessionLockedByOther: boolean }> {
    const beat = await attemptsApi.heartbeat(attemptId, { examSession });
    return {
      status: beat.status,
      remainingSeconds: beat.remaining_seconds ?? 0,
      serverRevision: beat.answer_revision,
      sessionLockedByOther: beat.session_locked_by_other === true,
    };
  },

  /** Deliberate takeover: continue this attempt in this window after a session conflict. */
  async claimSession(attemptId: string, examSession?: string) {
    const beat = await attemptsApi.claimSession(attemptId, { examSession });
    return { status: beat.status, remainingSeconds: beat.remaining_seconds ?? 0, serverRevision: beat.answer_revision };
  },

  /** Browser-observed activity signal. The server stamps the time and decides what is storable. */
  async recordSignal(attemptId: string, kind: "tab_hidden" | "tab_visible" | "disconnected" | "reconnected", examSession?: string) {
    await attemptsApi.recordSignal(attemptId, kind, { examSession });
  },

  async submitAttempt(attempt: ExamAttempt, options?: { examSession?: string; trigger?: "manual" | "auto" }) {
    if (attempt.connectionStatus === "offline") throw new Error("برای ارسال نهایی، اتصال اینترنت را بررسی و دوباره تلاش کنید.");
    if (!attempt.id || attempt.id.startsWith("local-")) throw new Error("نشست آزمون معتبر نیست. لطفاً دوباره تلاش کنید.");
    try {
      return await attemptsApi.submit(attempt.id, { examSession: options?.examSession, trigger: options?.trigger });
    } catch (error) {
      // A conflict here is not a failure to retry: the attempt is final (or owned elsewhere) and the
      // student needs to know which, in one sentence, instead of a generic "something went wrong".
      const conflict = asConflict(error);
      if (conflict) throw new Error(conflict.code === "attempt_finalized" ? "آزمون پیش‌تر نهایی شده است. نتیجه در همان صفحهٔ نتیجه قابل مشاهده است." : conflict.message);
      throw new Error(apiErrorMessage(error, "ارسال آزمون انجام نشد. لطفاً دوباره تلاش کنید."));
    }
  },
};
