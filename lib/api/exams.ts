import { apiRequest } from "@/lib/api/client";
import type { ApiExamWritePayload, ApiQuestionBankQuery, ApiQuestionDto, ApiQuestionTagDto, ApiQuestionWritePayload, ApiTeacherExamDto, ApiTeacherExamListDto } from "@/lib/api/dtos";

export const examsApi = {
  list: () => apiRequest<ApiTeacherExamListDto[]>("/exams/"),
  detail: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/`),
  create: (payload: ApiExamWritePayload) => apiRequest<ApiTeacherExamDto>("/exams/", { method: "POST", body: payload }),
  update: (examId: string, payload: ApiExamWritePayload) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/`, { method: "PATCH", body: payload }),
  publish: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/publish/`, { method: "POST" }),
  /** Opens a scheduled exam immediately; used when the class is already sitting in the room. */
  start: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/start/`, { method: "POST" }),
  /** Grants extra minutes to a live exam. In-flight attempts inherit the new duration from the server. */
  extend: (examId: string, extraMinutes: number) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/extend/`, { method: "POST", body: { extra_minutes: extraMinutes } }),
  complete: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/complete/`, { method: "POST" }),
  archive: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/archive/`, { method: "POST" }),
  restore: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/restore/`, { method: "POST" }),
  duplicate: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/duplicate/`, { method: "POST" }),
  /** Searchable bank: every question this teacher owns, across exams. */
  bank: (query?: ApiQuestionBankQuery) => {
    const params = new URLSearchParams();
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && value !== null) params.set(key, String(value));
    });
    const search = params.toString();
    return apiRequest<ApiQuestionDto[]>(`/questions/${search ? `?${search}` : ""}`);
  },
  bankTags: () => apiRequest<ApiQuestionTagDto[]>("/questions/tags/"),
  /** Copies bank questions into an exam. Copies, never moves, so no live answer sheet can change. */
  importQuestions: (examId: string, questionIds: string[]) => apiRequest<ApiQuestionDto[]>(`/exams/${examId}/questions/import/`, { method: "POST", body: { question_ids: questionIds } }),
  archiveQuestion: (questionId: string, action: "archive" | "restore") => apiRequest<ApiQuestionDto>(`/questions/${questionId}/archive/`, { method: "POST", body: { action } }),
  createQuestion: (examId: string, payload: ApiQuestionWritePayload) => apiRequest<ApiQuestionDto>(`/exams/${examId}/questions/`, { method: "POST", body: payload }),
  updateQuestion: (questionId: string, payload: ApiQuestionWritePayload) => apiRequest<ApiQuestionDto>(`/questions/${questionId}/`, { method: "PATCH", body: payload }),
  deleteQuestion: (questionId: string) => apiRequest<void>(`/questions/${questionId}/`, { method: "DELETE" }),
  reorderQuestions: (examId: string, questionIds: string[]) => apiRequest<ApiQuestionDto[]>(`/exams/${examId}/questions/reorder/`, { method: "POST", body: { question_ids: questionIds } }),
};
