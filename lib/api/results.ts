import { apiRequest } from "@/lib/api/client";
import type { ApiGradingQueueDto, ApiManualGradeResponseDto, ApiTeacherAttemptDetailDto, ApiTeacherOverviewDto, ApiTeacherResultDto, ApiTeacherResultRowDto, ApiTeacherStudentOverviewDto } from "@/lib/api/dtos";

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
  teacherAttempt: (attemptId: string) => apiRequest<ApiTeacherAttemptDetailDto>(`/results/teacher/attempts/${attemptId}/`),
  gradeAnswer: (attemptId: string, questionId: string, payload: { manual_score: number; feedback?: string }) => apiRequest<ApiManualGradeResponseDto>(`/results/teacher/attempts/${attemptId}/answers/${questionId}/grade/`, { method: "PATCH", body: payload }),
  updateFeedback: (attemptId: string, feedback: string) => apiRequest<ApiTeacherResultDto>(`/results/teacher/attempts/${attemptId}/feedback/`, { method: "PATCH", body: { feedback } }),
  publishExamResults: (examId: string) => apiRequest<{ published_count: number; pending_manual_grading_count: number }>(`/results/teacher/exams/${examId}/publish/`, { method: "POST" }),
  teacherStudents: () => apiRequest<ApiTeacherStudentOverviewDto[]>("/results/teacher/students/"),
};
