import { apiRequest } from "@/lib/api/client";
import type { ApiAttemptDto, ApiAttemptHeartbeatDto, ApiAvailableExamDto, ApiStudentAnswerDto, ApiStudentResultDto, ApiSubmitAttemptDto } from "@/lib/api/dtos";

export type ApiAnswerInput = { selected_option_ids: string[] } | { text: string };
export type ApiBatchAnswerInput = ApiAnswerInput & { question_id: string };

/**
 * Two headers carry the server-side write guards. They ride as headers, not body fields, so the strict
 * per-endpoint payload validators (which reject unknown keys) stay exactly as they were.
 *
 * `examSession` is a random id one browser tab keeps in sessionStorage for the whole attempt, so a
 * refresh keeps its identity while a second window gets a different one. `examRevision` is the attempt
 * revision that payload was built from; the server refuses a write built on an older one.
 */
export interface AttemptWriteGuards { examSession?: string; examRevision?: number; }

function guardHeaders(guards?: AttemptWriteGuards): HeadersInit | undefined {
  if (!guards) return undefined;
  const headers: Record<string, string> = {};
  if (guards.examSession) headers["X-Exam-Session"] = guards.examSession;
  // A missing revision is deliberately not sent: that means "no guard", which keeps older clients working.
  if (typeof guards.examRevision === "number") headers["X-Exam-Revision"] = String(guards.examRevision);
  return Object.keys(headers).length ? headers : undefined;
}

export const attemptsApi = {
  listAvailable: () => apiRequest<ApiAvailableExamDto[]>("/student/exams/"),
  start: (examId: string, guards?: AttemptWriteGuards) => apiRequest<ApiAttemptDto>(`/student/exams/${examId}/start/`, { method: "POST", headers: guardHeaders(guards) }),
  detail: (attemptId: string, guards?: AttemptWriteGuards) => apiRequest<ApiAttemptDto>(`/student/attempts/${attemptId}/`, { headers: guardHeaders(guards) }),
  saveAnswer: (attemptId: string, questionId: string, answer: ApiAnswerInput, signal?: AbortSignal, guards?: AttemptWriteGuards) => apiRequest<ApiStudentAnswerDto>(`/student/attempts/${attemptId}/answers/${questionId}/`, { method: "PATCH", body: answer, signal, headers: guardHeaders(guards) }),
  saveAnswers: (attemptId: string, answers: ApiBatchAnswerInput[], signal?: AbortSignal, guards?: AttemptWriteGuards) => apiRequest<ApiStudentAnswerDto[]>(`/student/attempts/${attemptId}/answers/`, { method: "PATCH", body: { answers }, signal, headers: guardHeaders(guards) }),
  setFlag: (attemptId: string, questionId: string, flagged: boolean, signal?: AbortSignal, guards?: AttemptWriteGuards) => apiRequest<ApiStudentAnswerDto>(`/student/attempts/${attemptId}/flagged-questions/${questionId}/`, { method: flagged ? "POST" : "DELETE", signal, headers: guardHeaders(guards) }),
  submit: (attemptId: string, guards?: AttemptWriteGuards & { trigger?: "manual" | "auto" }) => apiRequest<ApiSubmitAttemptDto>(`/student/attempts/${attemptId}/submit/`, {
    method: "POST",
    // The trigger is the one thing the server records from the client here, and only to attribute the
    // submission in the activity log; finalization itself never depends on it.
    body: guards?.trigger ? { trigger: guards.trigger } : undefined,
    headers: guardHeaders(guards),
  }),
  result: (attemptId: string) => apiRequest<ApiStudentResultDto>(`/student/results/${attemptId}/`),
  /** Clock-only resync: the deadline and the accepted revision, without the answer sheet in the payload. */
  heartbeat: (attemptId: string, guards?: AttemptWriteGuards) => apiRequest<ApiAttemptHeartbeatDto>(`/student/attempts/${attemptId}/heartbeat/`, { method: "POST", headers: guardHeaders(guards) }),
  claimSession: (attemptId: string, guards?: AttemptWriteGuards) => apiRequest<ApiAttemptHeartbeatDto>(`/student/attempts/${attemptId}/claim-session/`, { method: "POST", headers: guardHeaders(guards) }),
  /** Browser-observed signal. Timestamps and verdicts stay on the server. */
  recordSignal: (attemptId: string, kind: "tab_hidden" | "tab_visible" | "disconnected" | "reconnected", guards?: AttemptWriteGuards) => apiRequest<void>(`/student/attempts/${attemptId}/signals/`, { method: "POST", body: { kind }, headers: guardHeaders(guards) }),
};
