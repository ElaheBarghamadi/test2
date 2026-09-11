export type Role = "student" | "teacher" | "admin";
export type ExamStatus = "draft" | "scheduled" | "active" | "completed" | "archived";
export type QuestionType = "single_choice" | "multiple_choice" | "true_false" | "short_answer" | "essay";
export type AnswerValue = string | string[] | boolean | null;
export type AttemptStatus = "not_started" | "in_progress" | "expired" | "submitting" | "submitted";
export type SaveStatus = "idle" | "saving" | "saved" | "saved_locally" | "error";
export type ResultVisibility = "immediate" | "pending" | "hidden";

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  avatar?: string;
  schoolName?: string;
}

export interface Student extends User { role: "student"; grade: string; className: string; }
export interface Teacher extends User { role: "teacher"; department: string; }

export interface QuestionOption { id: string; label: string; value: string; isCorrect?: boolean; }

interface BaseQuestion {
  id: string;
  order: number;
  stem: string;
  helpText?: string;
  points: number;
  required?: boolean;
  explanation?: string;
  /** Bank metadata: how findable and reusable a question is. Never a grading input. */
  difficulty?: QuestionDifficulty;
  tags?: string[];
  isArchived?: boolean;
  /** Exams that already hold a copy of this bank question. */
  usageCount?: number;
  /** Attempts that have answered this exact question row. */
  answeredCount?: number;
  copiedFromId?: string | null;
  /** Owning exam, surfaced so the bank can point back at the one place a question is edited. */
  examId?: string;
  examTitle?: string;
  examStatus?: string;
}

export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface MultipleChoiceQuestion extends BaseQuestion {
  type: "single_choice";
  options: QuestionOption[];
  correctOptionId?: string;
}

export interface MultipleAnswerQuestion extends BaseQuestion {
  type: "multiple_choice";
  options: QuestionOption[];
  correctOptionIds?: string[];
}

export interface TrueFalseQuestion extends BaseQuestion {
  type: "true_false";
  correctAnswer?: boolean;
  /** Server option IDs are kept only to submit the student's selected true/false value. */
  optionIds?: { true: string; false: string };
}

export interface ShortAnswerQuestion extends BaseQuestion {
  type: "short_answer";
  placeholder?: string;
  /** Any accepted answer earns full credit; the server grades against the whole list. */
  expectedAnswers?: string[];
  caseSensitive?: boolean;
  maxLength?: number;
}

export interface WrittenQuestion extends BaseQuestion {
  type: "essay";
  placeholder?: string;
  maxLength?: number;
  gradingNote?: string;
}

/** Discriminated question union used by the student renderer and teacher builder. */
export type Question = MultipleChoiceQuestion | MultipleAnswerQuestion | TrueFalseQuestion | ShortAnswerQuestion | WrittenQuestion;

export interface ExamSchedule {
  startAt: string;
  endAt: string;
  timezone: string;
}

export interface ExamSettings {
  durationMinutes: number;
  totalMarks: number;
  allowBackNavigation: boolean;
  randomizeQuestions: boolean;
  /** Shuffle option order per attempt. Grading matches on option identity, never position. */
  randomizeOptions: boolean;
  /** False = the student cannot submit a blank answer; enforced by the server, warned about by the UI. */
  allowUnanswered: boolean;
  showResultImmediately: boolean;
  resultVisibility: ResultVisibility;
  showCorrectAnswers: boolean;
  attemptLimit: number;
  /** Pass mark as a percentage of the exam total; 0 disables the pass/fail verdict. */
  passingPercentage: number;
}

/** Published-result summary a student may see before opening the full result page. */
export interface StudentResultSummary {
  score: number;
  percentage: number | null;
  maximumScore: number;
  passingPercentage: number;
  passed: boolean | null;
  isFinal: boolean;
}

export interface Exam {
  id: string;
  title: string;
  subject: string;
  grade: string;
  className: string;
  description: string;
  instructions?: string;
  status: ExamStatus;
  startAt: string;
  endAt: string;
  schedule: ExamSchedule;
  questionCount: number;
  participantCount: number;
  /** Teacher view only: total attempts recorded across all students. */
  attemptCount?: number;
  settings: ExamSettings;
  questions: Question[];
  teacherName: string;
  accent: "indigo" | "violet" | "teal" | "amber";
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  /** Student dashboard context. Absent on teacher/admin views. */
  availability?: "available" | "upcoming" | "in_progress" | "completed";
  attemptsUsed?: number;
  attemptNumber?: number;
  attemptId?: string;
  remainingSeconds?: number | null;
  resultSummary?: StudentResultSummary | null;
}

export interface ExamDraft {
  id?: string;
  title: string;
  subject: string;
  grade: string;
  className: string;
  description: string;
  instructions: string;
  settings: ExamSettings;
  schedule: ExamSchedule;
  questions: Question[];
}

export interface ExamAnswer {
  questionId: string;
  value: AnswerValue;
  flagged: boolean;
  updatedAt: string;
}

/**
 * Client attempt model mirrors the shape of a future Django-backed attempt.
 * It intentionally separates local save and submission lifecycles.
 */
export interface ExamAttempt {
  id: string;
  examId: string;
  studentId: string;
  status: AttemptStatus;
  startedAt: string | null;
  lastTickAt: string | null;
  remainingSeconds: number;
  answers: Record<string, ExamAnswer>;
  currentQuestionIndex: number;
  saveStatus: SaveStatus;
  lastSavedAt?: string;
  answerRevision: number;
  /** Revision the server last accepted; every write echoes it so a stale request cannot win. */
  serverRevision?: number;
  /** Another window owns this attempt right now; writes are refused until the student takes over. */
  sessionConflict?: "another_session" | "finalized" | null;
  connectionStatus: "online" | "offline";
  submissionError?: string;
  /** Attempt 1-based index and the exam's allowed total, shown in the session header. */
  attemptNumber?: number;
  attemptLimit?: number;
  /** Dirty fields are client transport metadata, never displayed as exam content. */
  pendingAnswerQuestionIds?: string[];
  pendingFlagQuestionIds?: string[];
}

/** One server-recorded session/activity signal. An observation for the teacher, never a verdict. */
export interface AttemptSignal {
  id: string;
  kind: "session_switch" | "tab_hidden" | "tab_visible" | "disconnected" | "reconnected" | "auto_submitted" | "exam_closed" | "stale_write_rejected";
  at: string;
  detail?: Record<string, unknown>;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

export interface GradingQueueRow {
  attemptId: string;
  attemptNumber: number;
  studentId: string;
  studentName: string;
  examId: string;
  examTitle: string;
  submittedAt: string | null;
  gradedCount: number;
  manualCount: number;
  openCount: number;
  progress: number;
  resultStatus: "pending" | "hidden" | "published" | null;
}

export interface ExamResult {
  id: string;
  examId: string;
  status: "published" | "pending" | "hidden";
  score: number;
  maximumScore: number;
  percentage: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  pendingManualGrading: number;
  /** Total answers that needed the teacher's pen; `manual - pending` is "17 / 24 graded". */
  manualGradingCount?: number;
  /** Set when the number was recomputed after students had already seen it. */
  wasRevised?: boolean;
  passingPercentage: number;
  /** null while the score is not final or when the teacher left the pass mark unset. */
  passed: boolean | null;
  attemptNumber: number;
  submittedAt: string;
  feedback: string;
}

export interface TeacherResultRow {
  id: string;
  examId: string;
  studentId: string;
  studentName: string;
  className: string;
  score?: number;
  maximumScore: number;
  submissionStatus: "submitted" | "in_progress" | "not_started" | "needs_grading";
  submittedAt?: string;
  completionMinutes?: number;
}

export interface Activity { id: string; title: string; description: string; time: string; type: "exam" | "student" | "result" | "system"; }
