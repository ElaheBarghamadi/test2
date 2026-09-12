/** Wire types mirror the Django REST serializers. Keep them separate from UI/domain types. */
export type ApiRole = "student" | "teacher" | "admin" | "school_admin";
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
/** `count` is only present on the bank's tag list, where it drives the filter chips. */
/** The bank import answers with a plain list when nothing was dropped, and with a report when it skipped. */
export interface ApiQuestionImportResult {
  created: ApiQuestionDto[];
  skippedDuplicates: number;
}

export interface ApiQuestionTagDto { id: string; name: string; count?: number; }

export interface ApiQuestionDto {
  id: string; exam: string; type: ApiQuestionType; text: string; instructions: string;
  marks: number | string; order: number; options: ApiOptionDto[];
  /** Bank metadata; `exam_*` fields let the bank list rows without a second request. */
  difficulty?: "easy" | "medium" | "hard"; tags?: ApiQuestionTagDto[]; is_archived?: boolean;
  usage_count?: number; answered_count?: number; copied_from?: string | null;
  exam_title?: string; exam_subject?: string; exam_status?: ApiExamStatus;
  /** Set instead of 201 when the exam already held this exact question and no second copy was made. */
  deduplicated?: boolean;
  /** Teacher serializers only; intentionally absent on student endpoints. */
  configuration?: Record<string, unknown>; explanation?: string;
  created_at?: string; updated_at?: string;
  /**
   * Bank organisation. Absent on an older payload; a question that lives only in the bank has `exam: null`
   * and no `exam_title`, which is what tells the UI it is a shelf row rather than exam content.
   */
  folder?: string | null; folder_name?: string; category?: string; status?: "draft" | "ready";
}

/** A shelf in the teacher's own bank; `parent` turns the flat list into a tree on the client. */
export interface ApiQuestionFolderDto {
  id: string; name: string; parent: string | null; question_count: number;
  created_at?: string; updated_at?: string;
}

export interface ApiQuestionCategoryDto { category: string; count: number; }

/** One row of a published answer sheet: the student's own words, plus whatever the chosen rung releases. */
export interface ApiStudentResultAnswerDto {
  question_id: string; question_order: number; question_text: string; question_type: ApiQuestionType; marks: number | string;
  your_answer: string | null; selected_option_texts: string[];
  /** Present from the note rung up. */
  feedback?: string;
  /** Present only at `full_key`. */
  awarded_score?: number | string; verdict?: "correct" | "incorrect" | "partial" | "manual" | "pending" | "unanswered";
  correct_option_texts?: string[]; expected_answers?: string[]; explanation?: string;
}

/** The student attempt serializer omits the parent exam and all answer-key fields. */
export interface ApiStudentQuestionDto {
  id: string; type: ApiQuestionType; text: string; instructions: string;
  marks: number | string; order: number; options: ApiOptionDto[];
}

export interface ApiExamSettingsDto {
  allow_previous_questions: boolean;
  /** Absent on a payload stored before the layout existed; the server default is one question a page. */
  question_layout?: "paged" | "single_page";
  randomize_questions: boolean;
  randomize_options: boolean;
  allow_unanswered: boolean;
  result_visibility: "immediate" | "pending" | "hidden";
  show_correct_answers: boolean;
  /**
   * What a published result reveals. Null or absent means the teacher never chose a rung, and the server
   * derives it from `show_correct_answers` - so the client must not invent a default of its own.
   */
  result_detail?: "score_only" | "own_answers" | "own_answers_with_feedback" | "full_key" | null;
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
  difficulty?: "easy" | "medium" | "hard"; tags?: string[]; is_archived?: boolean;
  /** `id` keeps an existing option's identity (and its student answers) intact across edits. */
  options?: Array<{ id?: string; text: string; is_correct: boolean }>;
  configuration?: Record<string, unknown>; explanation?: string;
  /** Bank organisation, accepted on either path: a question can be filed the moment it is written. */
  folder?: string | null; category?: string; status?: "draft" | "ready";
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
  navigation: {
    allow_previous_questions: boolean;
    randomize_questions: boolean;
    allow_unanswered: boolean;
    question_layout?: "paged" | "single_page";
  };
}
export interface ApiAttemptDto {
  id: string; attempt_number: number; attempt_limit: number; answer_revision: number; status: ApiAttemptStatus; started_at: string;
  /** Highest question index an answer was written to - the server's record, and the no-return boundary. */
  answer_frontier?: number;
  submitted_at: string | null; last_activity_at: string; server_time: string; expires_at: string;
  remaining_seconds: number; exam: ApiStudentAttemptExamDto; questions: ApiStudentQuestionDto[];
  answers: ApiStudentAnswerDto[];
}
export interface ApiAvailableExamDto {
  id: string; title: string; description: string; subject: string; grade: string; class_name: string;
  duration_minutes: number; total_marks: number | string; start_at: string | null; end_at: string | null;
  question_count: number; max_attempts: number; attempts_used: number;
  passing_percentage: number | string; result_visibility: "immediate" | "pending" | "hidden";
  teacher_name: string;
  allow_unanswered: boolean;
  /** Both are server-side rules the start screen has to state truthfully before an attempt exists. */
  allow_previous_questions?: boolean;
  question_layout?: "paged" | "single_page";
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
  /** The rung this payload was cut at, resolved by the server. `answers` never contains more than it allows. */
  detail_level?: "score_only" | "own_answers" | "own_answers_with_feedback" | "full_key";
  answers?: ApiStudentResultAnswerDto[];
  percentage: number | string | null; maximum_score: number; correct_count: number; incorrect_count: number;
  unanswered_count: number; pending_manual_grading_count: number;
  /**
   * Teacher-side bookkeeping. The student endpoint deliberately does not send either, so the mapper falls
   * back to the pending count and treats an absent revision as "never revised"; declaring them as always
   * present is what the wire shape does not promise.
   */
  manual_grading_count?: number;
  passing_percentage: number; revised_at?: string | null;
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
  unanswered_count: number; pending_manual_grading_count: number; manual_grading_count: number; feedback: string;
  computed_at: string | null; published_at: string | null; revised_at: string | null;
}

export type ApiTeacherSubmissionStatus = "submitted" | "in_progress" | "needs_grading";
export interface ApiTeacherResultRowDto {
  id: string; student_id: string; student_name: string; student_email: string; grade: string; class_name: string;
  status: ApiAttemptStatus; submission_status: ApiTeacherSubmissionStatus; started_at: string | null;
  submitted_at: string | null; last_activity_at: string; completion_minutes: number | null;
  score: number | string | null; percentage: number | string | null; maximum_score: number | string;
  pending_manual_grading_count: number; manual_grading_count: number; attempt_number: number;
  result_status: "pending" | "hidden" | "published" | null;
}
export interface ApiTeacherAttemptAnswerDto {
  id: string; question_id: string; question_text: string; question_type: ApiQuestionType; question_order: number;
  maximum_score: number | string; selected_option_ids: string[]; selected_option_texts: string[];
  text: string | null; manual_grading_required: boolean; is_flagged: boolean; manual_score: number | string | null; feedback: string; updated_at: string;
  /**
   * What the answer is worth and how that was decided, straight from the grading function. A keyed question
   * used to arrive with no number at all, so the marking screen showed only what was left to do.
   */
  awarded_score: number | string;
  /**
   * What the key alone would have awarded, and whether a teacher's number replaced it. Optional because a
   * payload stored before overrides existed carries neither.
   */
  auto_awarded_score?: number | string;
  is_overridden?: boolean;
  verdict: "correct" | "incorrect" | "unanswered" | "pending" | "manual";
}
export interface ApiAttemptSignalDto {
  id: string; kind: string; detail: Record<string, unknown>; created_at: string;
}
export interface ApiTeacherAttemptDetailDto {
  id: string;
  exam: { id: string; title: string; total_marks: number | string };
  student: { id: string; full_name: string; email: string; grade: string; class_name: string };
  status: ApiAttemptStatus; started_at: string | null; submitted_at: string | null;
  attempt_number: number; server_time: string; remaining_seconds: number | null;
  session_switch_count: number; session_signals: ApiAttemptSignalDto[];
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
  teacher_name: string; teacher_email: string; school: { id: string; name: string; city: string; is_active?: boolean } | null;
  question_count: number; participant_count: number; created_at: string; updated_at: string;
}
export interface ApiAdminOverviewDto {
  /**
   * Which console this payload describes. `school` is the only school a school administrator may see, and
   * the interface uses it to hide the actions the API would refuse anyway.
   */
  scope?: { kind: "school" | "platform"; school: { id: string; name: string; city?: string; is_active?: boolean } | null };
  school_count: number; user_count: number; user_counts: Record<ApiRole, number>;
  active_exam_count: number; exam_count: number; unassigned_user_count: number;
  recent_users: ApiAdminUserDto[]; recent_exams: ApiAdminExamDto[];
}


/** Clock-only response for a live attempt; deliberately much smaller than the attempt detail. */
export interface ApiAttemptHeartbeatDto {
  /** Where the "no going back" rule currently sits; see `answerFrontier` in the domain model. */
  answer_frontier?: number;
  server_time: string; expires_at: string | null; remaining_seconds: number | null;
  status: ApiAttemptStatus; answer_revision: number; session_locked_by_other: boolean; question_count: number;
}

export interface ApiNotificationDto {
  id: string; kind: string; title: string; body: string; link: string;
  exam: string | null; attempt: string | null; is_read: boolean; created_at: string; read_at: string | null;
}
export interface ApiNotificationPageDto { unread_count: number; results: ApiNotificationDto[]; }

export interface ApiGradingQueueRowDto {
  result_id: string; attempt_id: string; attempt_number: number; student_id: string; student_name: string;
  exam_id: string; exam_title: string; submitted_at: string | null;
  graded_count: number; manual_count: number; open_count: number; progress: number;
  result_status: "pending" | "hidden" | "published" | null;
}
export interface ApiGradingQueueDto { total: number; queue: ApiGradingQueueRowDto[]; }

/** One question's standing across the cohort, from the marking board. */
export interface ApiGradingBoardQuestionDto {
  id: string; order: number; text: string; type: ApiQuestionType; marks: number | string;
  requires_manual_grading: boolean;
  attempt_count: number; answered_count: number; blank_count: number;
  correct_count: number; incorrect_count: number;
  graded_count: number; pending_count: number;
  average_score: number | null;
  /** Nothing left for a pen: keyed questions are always complete, manual ones once every row is marked. */
  is_complete: boolean;
}
export interface ApiGradingBoardDto {
  exam: { id: string; title: string; total_marks: number | string };
  attempt_count: number;
  questions: ApiGradingBoardQuestionDto[];
  progress: { total: number; graded: number; percent: number };
}

/** One student's answer to one question, as the per-question marking screen shows it. */
export interface ApiGradingQuestionRowDto {
  attempt_id: string; attempt_number: number; student_id: string; student_name: string;
  grade: string; class_name: string; submitted_at: string | null;
  answer_id: string | null; selected_option_ids: string[]; selected_option_texts: string[];
  text: string | null; is_flagged: boolean;
  awarded_score: number | string; verdict: ApiTeacherAttemptAnswerDto["verdict"];
  manual_score: number | string | null; feedback: string;
  /**
   * False when the row was written before overrides existed - the desk then assumes every row takes a pen,
   * which is what the server does today. Kept so an older cached payload still renders.
   */
  editable?: boolean;
  /** What the key alone awarded, and whether a teacher's number replaced it. */
  auto_score?: number | string;
  is_overridden?: boolean;
}
export interface ApiGradingQuestionDto {
  id: string; order: number; text: string; type: ApiQuestionType; marks: number | string; instructions: string;
  requires_manual_grading: boolean;
  /** The answer key is a teacher-only view, and the marking screen is the one place it helps most. */
  correct_option_ids: string[]; expected_answers: string[]; explanation: string; difficulty: string;
  grading_notes: string;
}
export interface ApiGradingQuestionPageDto {
  exam: { id: string; title: string; total_marks: number | string };
  question: ApiGradingQuestionDto;
  progress: { index: number; total: number; questions: ApiGradingBoardQuestionDto[] };
  stats: ApiGradingBoardQuestionDto;
  rows: ApiGradingQuestionRowDto[];
}
export interface ApiGradingSaveResultDto {
  saved: number;
  results: Array<{ attempt_id: string; result: ApiTeacherResultDto }>;
  stats: ApiGradingBoardQuestionDto;
  questions: ApiGradingBoardQuestionDto[];
  progress: { total: number; graded: number; percent: number };
  rows: ApiGradingQuestionRowDto[];
}

export interface ApiTeacherOverviewDto {
  exam_counts: Record<ApiExamStatus, number>;
  participant_count: number; attempt_count: number; finalized_attempt_count: number;
  completion_rate: number;
  average_percentage: number | null; average_score: number | null;
  graded_result_count: number; verdict_count: number; passed_count: number; pass_rate: number | null;
  pending_manual_grading_count: number; pending_manual_answer_count: number; manual_answer_count: number;
  recent_activity: Array<{ id: string; title: string; student_name: string; status: ApiAttemptStatus; at: string }>;
  recently_completed_exams: Array<{
    id: string; title: string; subject: string; ended_at: string; attempt_count: number; participant_count: number;
  }>;
}

export interface ApiQuestionBankQuery {
  search?: string; type?: ApiQuestionType; difficulty?: "easy" | "medium" | "hard";
  tag?: string; subject?: string; exam?: string; archived?: boolean;
  /** A folder id, or the literal "unfiled" for questions that are in no folder. */
  folder?: string;
  category?: string;
  status?: "draft" | "ready";
  /** "bank" = questions attached to no exam, "exam" = only paper content, absent = both. */
  placement?: "any" | "bank" | "exam";
  ordering?: string;
}
