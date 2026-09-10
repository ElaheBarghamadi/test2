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
}

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
  connectionStatus: "online" | "offline";
  submissionError?: string;
  /** Attempt 1-based index and the exam's allowed total, shown in the session header. */
  attemptNumber?: number;
  attemptLimit?: number;
  /** Dirty fields are client transport metadata, never displayed as exam content. */
  pendingAnswerQuestionIds?: string[];
  pendingFlagQuestionIds?: string[];
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
