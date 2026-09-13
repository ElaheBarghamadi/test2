import { apiRequest } from "@/lib/api/client";
import type { ApiExamBundleDto, ApiExamSettingsDto, ApiExamWritePayload, ApiQuestionCategoryDto, ApiQuestionFolderDto, ApiQuestionBankQuery, ApiQuestionImportResult, ApiQuestionDto, ApiQuestionTagDto, ApiQuestionWritePayload, ApiTeacherExamDto, ApiTeacherExamListDto } from "@/lib/api/dtos";

/**
 * How long a list may be painted from memory before the network is asked again.
 *
 * Ten seconds is a navigation window, not a data policy: it is long enough that going *back* to a list you
 * just left answers instantly, and short enough that a page nobody touched cannot keep showing a number from
 * five minutes ago. A list the same user changed is never stale through this door, because writes clear it.
 */
const LIST_CACHE_MS = 10_000;
/** Vocabulary that changes only when the teacher changes it: folders, tags, categories. */
const ORG_CACHE_MS = 60_000;
/** A save to the bank is felt by the exam builder too, and the other way round, so both roots move. */
const QUESTION_INVALIDATE = ["/questions/", "/exams/"];

export const examsApi = {
  list: () => apiRequest<ApiTeacherExamListDto[]>("/exams/", { cacheMs: LIST_CACHE_MS }),
  detail: (examId: string) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/`),
  create: (payload: ApiExamWritePayload) => apiRequest<ApiTeacherExamDto>("/exams/", { method: "POST", body: payload }),
  update: (examId: string, payload: ApiExamWritePayload) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/`, { method: "PATCH", body: payload }),
  /**
   * A settings-only PATCH. The exam write serializer takes `settings` on its own, so choosing what a published
   * result reveals does not require resending the title, the schedule, or anything else about the exam.
   */
  /** A paper as one JSON file — settings and questions, never a student's answers. */
  exportExam: (examId: string) => apiRequest<ApiExamBundleDto>(`/exams/${examId}/export/`),
  /** Rebuild a draft from that file. The importer owns the result; the schedule never comes back. */
  importExam: (bundle: unknown) => apiRequest<ApiTeacherExamDto & { imported?: { questions: number; settings_imported: boolean } }>(
    "/exams/import/",
    { method: "POST", body: bundle, invalidate: ["/exams/", "/questions/"] },
  ),
  updateSettings: (examId: string, settings: Partial<ApiExamSettingsDto>) => apiRequest<ApiTeacherExamDto>(`/exams/${examId}/`, { method: "PATCH", body: { settings } }),
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
    return apiRequest<ApiQuestionDto[]>(`/questions/${search ? `?${search}` : ""}`, { cacheMs: LIST_CACHE_MS });
  },
  bankTags: () => apiRequest<ApiQuestionTagDto[]>("/questions/tags/", { cacheMs: ORG_CACHE_MS }),
  bankCategories: () => apiRequest<ApiQuestionCategoryDto[]>("/questions/categories/", { cacheMs: ORG_CACHE_MS }),
  /**
   * Author a question straight onto the shelf, with no exam behind it. `status: "draft"` is what makes it a
   * save-and-continue: a draft stays out of every exam until its author marks it ready.
   */
  createBankQuestion: (payload: Omit<ApiQuestionWritePayload, never> & { status?: "draft" | "ready"; folder?: string | null; category?: string }) =>
    apiRequest<ApiQuestionDto>("/questions/", { method: "POST", body: payload, invalidate: QUESTION_INVALIDATE }),
  /** Bank metadata only: filing, categorising, and the draft/ready flag. Partial by design. */
  updateQuestionMeta: (questionId: string, payload: { folder?: string | null; category?: string; status?: "draft" | "ready" }) =>
    apiRequest<ApiQuestionDto>(`/questions/${questionId}/`, { method: "PATCH", body: payload, invalidate: QUESTION_INVALIDATE }),
  folders: () => apiRequest<ApiQuestionFolderDto[]>("/questions/folders/", { cacheMs: ORG_CACHE_MS }),
  createFolder: (payload: { name: string; parent?: string | null }) => apiRequest<ApiQuestionFolderDto>("/questions/folders/", { method: "POST", body: payload, invalidate: ["/questions/"] }),
  updateFolder: (folderId: string, payload: { name?: string; parent?: string | null }) => apiRequest<ApiQuestionFolderDto>(`/questions/folders/${folderId}/`, { method: "PATCH", body: payload, invalidate: ["/questions/"] }),
  deleteFolder: (folderId: string) => apiRequest<void>(`/questions/folders/${folderId}/`, { method: "DELETE", invalidate: ["/questions/"] }),
  /**
   * Copies bank questions into an exam. Copies, never moves, so no live answer sheet can change.
   *
   * Selections that repeat a question the destination exam already holds come back as a count rather than
   * as extra rows, because a duplicate question is the same statement graded twice.
   */
  async importQuestions(examId: string, questionIds: string[]): Promise<ApiQuestionImportResult> {
    const response = await apiRequest<ApiQuestionDto[] | { questions: ApiQuestionDto[]; created_count: number; skipped_duplicates: number }>(
      `/exams/${examId}/questions/import/`,
      { method: "POST", body: { question_ids: questionIds }, invalidate: QUESTION_INVALIDATE },
    );
    return Array.isArray(response) ? { created: response, skippedDuplicates: 0 } : { created: response.questions, skippedDuplicates: response.skipped_duplicates };
  },
  archiveQuestion: (questionId: string, action: "archive" | "restore") =>
    apiRequest<ApiQuestionDto>(`/questions/${questionId}/archive/`, { method: "POST", body: { action }, invalidate: QUESTION_INVALIDATE }),
  createQuestion: (examId: string, payload: ApiQuestionWritePayload) =>
    apiRequest<ApiQuestionDto>(`/exams/${examId}/questions/`, { method: "POST", body: payload, invalidate: QUESTION_INVALIDATE }),
  updateQuestion: (questionId: string, payload: ApiQuestionWritePayload) =>
    apiRequest<ApiQuestionDto>(`/questions/${questionId}/`, { method: "PATCH", body: payload, invalidate: QUESTION_INVALIDATE }),
  deleteQuestion: (questionId: string) => apiRequest<void>(`/questions/${questionId}/`, { method: "DELETE", invalidate: QUESTION_INVALIDATE }),
  reorderQuestions: (examId: string, questionIds: string[]) =>
    apiRequest<ApiQuestionDto[]>(`/exams/${examId}/questions/reorder/`, { method: "POST", body: { question_ids: questionIds }, invalidate: QUESTION_INVALIDATE }),
};
