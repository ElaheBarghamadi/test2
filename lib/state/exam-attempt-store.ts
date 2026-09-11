"use client";

import { create } from "zustand";
import type { AnswerValue, Exam, ExamAnswer, ExamAttempt } from "@/lib/types/domain";

interface AttemptState {
  attempt: ExamAttempt | null;
  initialize: (exam: Exam) => void;
  hydrateRemote: (attempt: ExamAttempt) => void;
  start: () => void;
  setAnswer: (questionId: string, value: AnswerValue) => void;
  toggleFlag: (questionId: string) => void;
  setCurrentQuestion: (index: number) => void;
  tick: () => void;
  syncClock: (status: ExamAttempt["status"], remainingSeconds: number) => void;
  markSaved: (revision: number, serverRevision?: number) => void;
  /** The revision the server last acknowledged; every guarded write is built from it. */
  acceptRevision: (serverRevision: number) => void;
  /** Another window owns the attempt, or the session was finalized elsewhere. */
  setSessionConflict: (conflict: ExamAttempt["sessionConflict"]) => void;
  markSaveFailed: (revision: number) => void;
  setConnectionStatus: (status: "online" | "offline") => void;
  /** Re-arm the autosave after a refused or failed write, without asking the student to type again. */
  retrySave: () => void;
  beginSubmission: () => void;
  finishSubmission: () => void;
  failSubmission: (message: string) => void;
}
const emptyAnswer = (questionId: string): ExamAnswer => ({ questionId, value: null, flagged: false, updatedAt: new Date().toISOString() });
const append = (items: string[] | undefined, item: string) => items?.includes(item) ? items : [...(items || []), item];
function withCurrentAnswer(attempt: ExamAttempt, questionId: string) { return attempt.answers[questionId] ?? emptyAnswer(questionId); }
function hasPending(attempt: ExamAttempt) { return !!(attempt.pendingAnswerQuestionIds?.length || attempt.pendingFlagQuestionIds?.length); }

/** Client state mirrors a server-owned attempt; timers and mutations start from server DTOs. */
export const useExamAttemptStore = create<AttemptState>((set, get) => ({
  attempt: null,
  initialize: (exam) => {
    if (get().attempt?.examId === exam.id) return;
    const answers = Object.fromEntries(exam.questions.map((question) => [question.id, emptyAnswer(question.id)]));
    set({ attempt: { id: `local-${exam.id}`, examId: exam.id, studentId: "", status: "not_started", startedAt: null, lastTickAt: null, remainingSeconds: exam.settings.durationMinutes * 60, answers, currentQuestionIndex: 0, saveStatus: "idle", answerRevision: 0, connectionStatus: "online" } });
  },
  // A reload or a session claim is a fresh start for the conflict flag; the pending queue is preserved
  // by the caller because those edits are still the student's own unsent work.
  hydrateRemote: (attempt) => set({ attempt: { ...attempt, sessionConflict: null, pendingAnswerQuestionIds: attempt.pendingAnswerQuestionIds ?? [], pendingFlagQuestionIds: attempt.pendingFlagQuestionIds ?? [] } }),
  start: () => set((state) => !state.attempt || state.attempt.status !== "not_started" ? state : { attempt: { ...state.attempt, status: "in_progress", startedAt: new Date().toISOString(), lastTickAt: new Date().toISOString() } }),
  setAnswer: (questionId, value) => set((state) => {
    if (!state.attempt || !["in_progress", "expired"].includes(state.attempt.status)) return state;
    const attempt = state.attempt; const revision = attempt.answerRevision + 1;
    return { attempt: { ...attempt, answerRevision: revision, saveStatus: attempt.connectionStatus === "offline" ? "saved_locally" : "saving", pendingAnswerQuestionIds: append(attempt.pendingAnswerQuestionIds, questionId), answers: { ...attempt.answers, [questionId]: { ...withCurrentAnswer(attempt, questionId), value, updatedAt: new Date().toISOString() } } } };
  }),
  toggleFlag: (questionId) => set((state) => {
    if (!state.attempt || !["in_progress", "expired"].includes(state.attempt.status)) return state;
    const attempt = state.attempt; const previous = withCurrentAnswer(attempt, questionId);
    return { attempt: { ...attempt, answerRevision: attempt.answerRevision + 1, saveStatus: attempt.connectionStatus === "offline" ? "saved_locally" : "saving", pendingFlagQuestionIds: append(attempt.pendingFlagQuestionIds, questionId), answers: { ...attempt.answers, [questionId]: { ...previous, flagged: !previous.flagged, updatedAt: new Date().toISOString() } } } };
  }),
  retrySave: () => set((state) => {
    if (!state.attempt || !hasPending(state.attempt) || state.attempt.status !== "in_progress") return state;
    const revision = state.attempt.answerRevision + 1;
    return { attempt: { ...state.attempt, answerRevision: revision, saveStatus: state.attempt.connectionStatus === "offline" ? "saved_locally" : "saving" } };
  }),
  setCurrentQuestion: (currentQuestionIndex) => set((state) => state.attempt ? { attempt: { ...state.attempt, currentQuestionIndex } } : state),
  tick: () => set((state) => {
    if (!state.attempt || state.attempt.status !== "in_progress") return state;
    const now = new Date(); const lastTick = state.attempt.lastTickAt ? new Date(state.attempt.lastTickAt) : now;
    const remainingSeconds = Math.max(0, state.attempt.remainingSeconds - Math.max(1, Math.floor((now.getTime() - lastTick.getTime()) / 1000)));
    return { attempt: { ...state.attempt, remainingSeconds, status: remainingSeconds === 0 ? "expired" : "in_progress", lastTickAt: now.toISOString() } };
  }),
  syncClock: (status, remainingSeconds) => set((state) => !state.attempt ? state : { attempt: { ...state.attempt, status, remainingSeconds: Math.max(0, remainingSeconds), lastTickAt: new Date().toISOString() } }),
  markSaved: (revision, serverRevision) => set((state) => {
    if (!state.attempt || state.attempt.connectionStatus === "offline") return state;
    // A newer edit occurred while this request was in flight. Keep every dirty field queued
    // and let the next revision persist the latest values rather than clearing stale work.
    if (state.attempt.answerRevision !== revision) return state;
    return { attempt: {
      ...state.attempt,
      pendingAnswerQuestionIds: [], pendingFlagQuestionIds: [], saveStatus: "saved", lastSavedAt: new Date().toISOString(),
      // The server told us which revision it now holds, so the next write is built from that, and a
      // queue that drained while offline cannot look stale to the server afterwards.
      serverRevision: typeof serverRevision === "number" ? serverRevision : Math.max(state.attempt.serverRevision ?? 0, (state.attempt.serverRevision ?? 0) + 1),
    } };
  }),
  acceptRevision: (serverRevision) => set((state) => !state.attempt ? state : { attempt: { ...state.attempt, serverRevision } }),
  setSessionConflict: (sessionConflict) => set((state) => !state.attempt ? state : { attempt: { ...state.attempt, sessionConflict, ...(sessionConflict ? {} : {}) } }),
  markSaveFailed: (revision) => set((state) => !state.attempt || state.attempt.answerRevision !== revision ? state : { attempt: { ...state.attempt, saveStatus: "error" } }),
  setConnectionStatus: (connectionStatus) => set((state) => {
    if (!state.attempt || state.attempt.connectionStatus === connectionStatus) return state;
    const retry = connectionStatus === "online" && hasPending(state.attempt);
    return { attempt: { ...state.attempt, connectionStatus, answerRevision: retry ? state.attempt.answerRevision + 1 : state.attempt.answerRevision, saveStatus: connectionStatus === "offline" ? "saved_locally" : retry ? "saving" : state.attempt.saveStatus } };
  }),
  beginSubmission: () => set((state) => state.attempt ? { attempt: { ...state.attempt, status: "submitting", submissionError: undefined } } : state),
  finishSubmission: () => set((state) => state.attempt ? { attempt: { ...state.attempt, status: "submitted", saveStatus: "saved", pendingAnswerQuestionIds: [], pendingFlagQuestionIds: [], submissionError: undefined } } : state),
  failSubmission: (message) => set((state) => state.attempt ? { attempt: { ...state.attempt, status: "in_progress", submissionError: message } } : state),
}));
