import { apiRequest } from "@/lib/api/client";
import type { ApiGradingBoardDto, ApiGradingQuestionPageDto, ApiGradingSaveResultDto, ApiGradingQueueDto, ApiManualGradeResponseDto, ApiTeacherAttemptDetailDto, ApiTeacherOverviewDto, ApiTeacherResultDto, ApiTeacherResultRowDto, ApiTeacherStudentOverviewDto } from "@/lib/api/dtos";

export interface AutoMarksResult {
  confirmed: number; zeroed: number; left_for_a_human: number; attempts: number; results: number;
  progress: { total: number; graded: number; percent: number };
  questions: unknown[];
}

export const resultsApi = {
  teacherOverview: () => apiRequest<ApiTeacherOverviewDto>("/results/teacher/overview/"),
  /** Attempts with answers still waiting, with "17 / 24 graded" progress from the grading snapshot. */
  gradingQueue: (params?: { examId?: string; studentId?: string }) => {
    const query = new URLSearchParams();
    if (params?.examId) query.set("exam_id", params.examId);
    if (params?.studentId) query.set("student_id", params.studentId);
    const search = query.toString();
    return apiRequest<ApiGradingQueueDto>(`/results/teacher/grading-queue/${search ? `?${search}` : ""}`);
  },
  teacherExamRows: (examId: string, submissionStatus?: "all" | "submitted" | "needs_grading" | "in_progress") => {
    const query = submissionStatus && submissionStatus !== "all" ? `?submission_status=${submissionStatus}` : "";
    return apiRequest<ApiTeacherResultRowDto[]>(`/results/teacher/exams/${examId}/${query}`);
  },
  /** Marking board: every question of the exam with how much of the cohort still needs a pen. */
  gradingBoard: (examId: string) => apiRequest<ApiGradingBoardDto>(`/results/teacher/exams/${examId}/grading/`),
  /** One question across every finalized attempt, plus the key so the rubric is on screen while marking. */
  gradingQuestion: (examId: string, questionId: string) => apiRequest<ApiGradingQuestionPageDto>(`/results/teacher/exams/${examId}/grading/${questionId}/`),
  /** Save a whole screen of marks at once; one bad row refuses the batch rather than half-applying it. */
  /** `mark: null` hands a keyed question back to the key; a row with only `feedback` leaves the number alone. */
  saveQuestionGrades: (examId: string, questionId: string, grades: Array<{ attempt_id: string; mark?: string | number | null; feedback?: string }>) => apiRequest<ApiGradingSaveResultDto>(`/results/teacher/exams/${examId}/grading/${questionId}/`, { method: "POST", body: { grades } }),
  teacherAttempt: (attemptId: string) => apiRequest<ApiTeacherAttemptDetailDto>(`/results/teacher/attempts/${attemptId}/`),
  gradeAnswer: (attemptId: string, questionId: string, payload: { manual_score?: number | string | null; feedback?: string }) => apiRequest<ApiManualGradeResponseDto>(`/results/teacher/attempts/${attemptId}/answers/${questionId}/grade/`, { method: "PATCH", body: payload }),
  updateFeedback: (attemptId: string, feedback: string) => apiRequest<ApiTeacherResultDto>(`/results/teacher/attempts/${attemptId}/feedback/`, { method: "PATCH", body: { feedback } }),
  publishExamResults: (examId: string) => apiRequest<{ published_count: number; pending_manual_grading_count: number }>(`/results/teacher/exams/${examId}/publish/`, { method: "POST" }),
  teacherStudents: () => apiRequest<ApiTeacherStudentOverviewDto[]>("/results/teacher/students/"),
  /**
   * The desk's bulk action: confirm the marks the exam already awarded, and — only when asked — zero the
   * blank rows. An essay with words in it is left for the teacher, and the response counts what is left.
   */
  autoMarks: (examId: string, payload: { confirm_key?: boolean; zero_unanswered?: boolean }) =>
    apiRequest<AutoMarksResult>(`/results/teacher/exams/${examId}/auto-marks/`, { method: "POST", body: payload, invalidate: ["/results/"] }),
  /** The same numbers the desk shows, as a spreadsheet the school can keep. */
  exportCsv: (examId: string) => apiRequest<string>(`/results/teacher/exams/${examId}/export/`),
};
