import { apiRequest } from "@/lib/api/client";
import type { ApiAttemptDto, ApiAvailableExamDto, ApiStudentAnswerDto, ApiStudentResultDto, ApiSubmitAttemptDto } from "@/lib/api/dtos";

export type ApiAnswerInput = { selected_option_ids: string[] } | { text: string };

export const attemptsApi = {
  listAvailable: () => apiRequest<ApiAvailableExamDto[]>("/student/exams/"),
  start: (examId: string) => apiRequest<ApiAttemptDto>(`/student/exams/${examId}/start/`, { method: "POST" }),
  detail: (attemptId: string) => apiRequest<ApiAttemptDto>(`/student/attempts/${attemptId}/`),
  saveAnswer: (attemptId: string, questionId: string, answer: ApiAnswerInput, signal?: AbortSignal) => apiRequest<ApiStudentAnswerDto>(`/student/attempts/${attemptId}/answers/${questionId}/`, { method: "PATCH", body: answer, signal }),
  setFlag: (attemptId: string, questionId: string, flagged: boolean, signal?: AbortSignal) => apiRequest<ApiStudentAnswerDto>(`/student/attempts/${attemptId}/flagged-questions/${questionId}/`, { method: flagged ? "POST" : "DELETE", signal }),
  submit: (attemptId: string) => apiRequest<ApiSubmitAttemptDto>(`/student/attempts/${attemptId}/submit/`, { method: "POST" }),
  result: (attemptId: string) => apiRequest<ApiStudentResultDto>(`/student/results/${attemptId}/`),
};
