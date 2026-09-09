import { apiRequest } from "@/lib/api/client";
import type { ApiManualGradeResponseDto, ApiTeacherAttemptDetailDto, ApiTeacherOverviewDto, ApiTeacherResultDto, ApiTeacherResultRowDto, ApiTeacherStudentOverviewDto } from "@/lib/api/dtos";

export const resultsApi = {
  teacherOverview: () => apiRequest<ApiTeacherOverviewDto>("/results/teacher/overview/"),
  teacherExamRows: (examId: string) => apiRequest<ApiTeacherResultRowDto[]>(`/results/teacher/exams/${examId}/`),
  teacherAttempt: (attemptId: string) => apiRequest<ApiTeacherAttemptDetailDto>(`/results/teacher/attempts/${attemptId}/`),
  gradeAnswer: (attemptId: string, questionId: string, payload: { manual_score: number; feedback?: string }) => apiRequest<ApiManualGradeResponseDto>(`/results/teacher/attempts/${attemptId}/answers/${questionId}/grade/`, { method: "PATCH", body: payload }),
  updateFeedback: (attemptId: string, feedback: string) => apiRequest<ApiTeacherResultDto>(`/results/teacher/attempts/${attemptId}/feedback/`, { method: "PATCH", body: { feedback } }),
  publishExamResults: (examId: string) => apiRequest<{ published_count: number; pending_manual_grading_count: number }>(`/results/teacher/exams/${examId}/publish/`, { method: "POST" }),
  teacherStudents: () => apiRequest<ApiTeacherStudentOverviewDto[]>("/results/teacher/students/"),
};
