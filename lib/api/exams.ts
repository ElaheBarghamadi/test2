import { apiRequest } from "@/lib/api/client";
import type { ApiExamWritePayload, ApiQuestionDto, ApiQuestionWritePayload, ApiTeacherExamDto, ApiTeacherExamListDto } from "@/lib/api/dtos";

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
  createQuestion: (examId: string, payload: ApiQuestionWritePayload) => apiRequest<ApiQuestionDto>(`/exams/${examId}/questions/`, { method: "POST", body: payload }),
  updateQuestion: (questionId: string, payload: ApiQuestionWritePayload) => apiRequest<ApiQuestionDto>(`/questions/${questionId}/`, { method: "PATCH", body: payload }),
  deleteQuestion: (questionId: string) => apiRequest<void>(`/questions/${questionId}/`, { method: "DELETE" }),
  reorderQuestions: (examId: string, questionIds: string[]) => apiRequest<ApiQuestionDto[]>(`/exams/${examId}/questions/reorder/`, { method: "POST", body: { question_ids: questionIds } }),
};
