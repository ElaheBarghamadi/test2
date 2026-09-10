/** Wire types mirror the Django REST serializers. Keep them separate from UI/domain types. */
export type ApiRole = "student" | "teacher" | "admin";
export type ApiExamStatus = "draft" | "scheduled" | "active" | "completed" | "archived";
export type ApiQuestionType = "multiple_choice" | "multiple_answer" | "true_false" | "short_answer" | "written";
export type ApiAttemptStatus = "in_progress" | "submitted" | "expired";

export interface ApiUserDto {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  role: ApiRole;
  profile?: { type?: ApiRole; avatar?: string | null; bio?: string; phone?: string; grade?: string; class_name?: string; department?: string };
  school?: { id: string; name: string; city: string } | null;
}

export interface ApiAuthResponseDto { access: string; refresh: string; user: ApiUserDto; }
export interface ApiRegisterPayload {
  email: string; first_name: string; last_name: string; password: string;
  role: Extract<ApiRole, "student" | "teacher">; school_code?: string;
}

export interface ApiOptionDto { id: string; text: string; order: number; is_correct?: boolean; }
export interface ApiQuestionDto {
  id: string; exam: string; type: ApiQuestionType; text: string; instructions: string;
  marks: number | string; order: number; options: ApiOptionDto[];
  /** Teacher serializers only; intentionally absent on student endpoints. */
  configuration?: Record<string, unknown>; explanation?: string;
  created_at?: string; updated_at?: string;
}

/** The student attempt serializer omits the parent exam and all answer-key fields. */
export interface ApiStudentQuestionDto {
  id: string; type: ApiQuestionType; text: string; instructions: string;
  marks: number | string; order: number; options: ApiOptionDto[];
}

export interface ApiExamSettingsDto {
  allow_previous_questions: boolean;
  randomize_questions: boolean;
  result_visibility: "immediate" | "pending" | "hidden";
  show_correct_answers: boolean;
  max_attempts: number;
  passing_percentage: number | string;
}

export interface ApiTeacherExamListDto {
  id: string; title: string; subject: string; grade: string; class_name: string;
  teacher: string; teacher_name: string; status: ApiExamStatus; duration_minutes: number;
  /** Null only on legacy rows; the mapper then sums question marks. */
  total_marks: number | string | null; start_at: string | null; end_at: string | null;
  settings: ApiExamSettingsDto; question_count: number; attempt_count: number; participant_count: number;
  created_at: string; updated_at: string;
}
export interface ApiTeacherExamDto extends ApiTeacherExamListDto {
  description: string; instructions: string; questions: ApiQuestionDto[];
}

export interface ApiExamWritePayload {
  title: string; description: string; subject: string; grade: string; class_name: string;
  instructions: string; duration_minutes: number; start_at: string | null; end_at: string | null;
  settings: ApiExamSettingsDto;
}
export interface ApiQuestionWritePayload {
  type: ApiQuestionType; text: string; instructions: string; marks: number;
  /** `id` keeps an existing option's identity (and its student answers) intact across edits. */
  options?: Array<{ id?: string; text: string; is_correct: boolean }>;
  configuration?: Record<string, unknown>; explanation?: string;
}

export interface ApiStudentAnswerDto {
  id: string; question_id: string; selected_option_ids: string[]; text: string | null;
  answered: boolean; is_flagged: boolean; updated_at: string;
}
export interface ApiStudentAttemptExamDto {
  id: string; title: string; description: string; subject: string; grade: string; class_name: string;
  instructions: string; duration_minutes: number; start_at: string | null; end_at: string | null;
  /** Marks, pass mark and release policy are student-safe; the answer key never is. */
  total_marks: number | string; question_count: number; passing_percentage: number | string;
  result_visibility: "immediate" | "pending" | "hidden";
  navigation: { allow_previous_questions: boolean; randomize_questions: boolean };
}
export interface ApiAttemptDto {
  id: string; attempt_number: number; attempt_limit: number; status: ApiAttemptStatus; started_at: string;
  submitted_at: string | null; last_activity_at: string; server_time: string; expires_at: string;
  remaining_seconds: number; exam: ApiStudentAttemptExamDto; questions: ApiStudentQuestionDto[];
  answers: ApiStudentAnswerDto[];
}
export interface ApiAvailableExamDto {
  id: string; title: string; description: string; subject: string; grade: string; class_name: string;
  duration_minutes: number; total_marks: number | string; start_at: string | null; end_at: string | null;
  question_count: number; max_attempts: number; attempts_used: number;
  passing_percentage: number | string; result_visibility: "immediate" | "pending" | "hidden";
  availability: "available" | "upcoming" | "completed" | "in_progress";
  attempt: {
    id: string; status: ApiAttemptStatus; started_at: string; submitted_at: string | null;
    attempt_number: number; remaining_seconds: number | null;
    /** Published-only summary; null while the teacher has not released the result. */
    result: {
      score: number | null; percentage: number | null; maximum_score: number;
      passing_percentage: number; passed: boolean | null; is_final: boolean;
    } | null;
  } | null;
}
export interface ApiStudentResultDto {
  id: string; status: "pending" | "hidden" | "published"; score: number | string;
  percentage: number | string | null; maximum_score: number; correct_count: number; incorrect_count: number;
  unanswered_count: number; pending_manual_grading_count: number; passing_percentage: number;
  passed: boolean | null; attempt_number: number; submitted_at: string | null; is_final: boolean;
  feedback: string; published_at: string | null;
}
export interface ApiSubmitAttemptDto {
  attempt: { id: string; status: ApiAttemptStatus; submitted_at: string | null };
  result_available: boolean; result?: ApiStudentResultDto;
}

/** Teacher result serializers include management context and may contain null scores while grading. */
export interface ApiTeacherResultDto {
  id: string; attempt: string; student_name: string; exam_title: string;
  status: "pending" | "hidden" | "published"; score: number | string | null;
  percentage: number | string | null; correct_count: number; incorrect_count: number;
  unanswered_count: number; pending_manual_grading_count: number; feedback: string;
  computed_at: string | null; published_at: string | null;
}

export interface ApiTeacherOverviewDto {
  exam_counts: Record<ApiExamStatus, number>;
  participant_count: number;
  attempt_count: number;
  pending_manual_grading_count: number;
  recent_activity: Array<{ id: string; title: string; student_name: string; status: ApiAttemptStatus; at: string }>;
}
export type ApiTeacherSubmissionStatus = "submitted" | "in_progress" | "needs_grading";
export interface ApiTeacherResultRowDto {
  id: string; student_id: string; student_name: string; student_email: string; grade: string; class_name: string;
  status: ApiAttemptStatus; submission_status: ApiTeacherSubmissionStatus; started_at: string | null;
  submitted_at: string | null; last_activity_at: string; completion_minutes: number | null;
  score: number | string | null; percentage: number | string | null; maximum_score: number | string;
  pending_manual_grading_count: number; result_status: "pending" | "hidden" | "published" | null;
}
export interface ApiTeacherAttemptAnswerDto {
  id: string; question_id: string; question_text: string; question_type: ApiQuestionType; question_order: number;
  maximum_score: number | string; selected_option_ids: string[]; selected_option_texts: string[];
  text: string | null; manual_grading_required: boolean; is_flagged: boolean; manual_score: number | string | null; feedback: string; updated_at: string;
}
export interface ApiTeacherAttemptDetailDto {
  id: string;
  exam: { id: string; title: string; total_marks: number | string };
  student: { id: string; full_name: string; email: string; grade: string; class_name: string };
  status: ApiAttemptStatus; started_at: string | null; submitted_at: string | null;
  answers: ApiTeacherAttemptAnswerDto[];
  result: ApiTeacherResultDto | null;
}
export interface ApiTeacherStudentOverviewDto {
  id: string; full_name: string; email: string; grade: string; class_name: string;
  attempt_count: number; completed_attempt_count: number; in_progress_attempt_count: number;
  needs_grading_count: number; last_activity_at: string | null; last_exam_title: string;
}
export interface ApiManualGradeResponseDto {
  answer: ApiTeacherAttemptAnswerDto;
  result: ApiTeacherResultDto;
}

export interface ApiSchoolDto {
  id: string; name: string; city: string; join_code: string; is_active: boolean;
  user_count: number; exam_count: number; created_at: string; updated_at: string;
}
export interface ApiAdminUserDto {
  id: string; email: string; first_name: string; last_name: string; full_name: string;
  role: ApiRole; is_active: boolean; school: { id: string; name: string; city: string } | null;
  profile: { grade?: string; class_name?: string; department?: string }; last_login: string | null; created_at: string;
}
export interface ApiAdminExamDto {
  id: string; title: string; subject: string; grade: string; class_name: string; status: ApiExamStatus;
  duration_minutes: number; total_marks: number | string; start_at: string | null; end_at: string | null;
  teacher_name: string; teacher_email: string; school: { id: string; name: string; city: string } | null;
  question_count: number; participant_count: number; created_at: string; updated_at: string;
}
export interface ApiAdminOverviewDto {
  school_count: number; user_count: number; user_counts: Record<ApiRole, number>;
  active_exam_count: number; exam_count: number; unassigned_user_count: number;
  recent_users: ApiAdminUserDto[]; recent_exams: ApiAdminExamDto[];
}
