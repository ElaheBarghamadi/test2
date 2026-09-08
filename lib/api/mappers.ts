import type {
  ApiAttemptDto,
  ApiAvailableExamDto,
  ApiExamSettingsDto,
  ApiExamWritePayload,
  ApiQuestionDto,
  ApiQuestionWritePayload,
  ApiRole,
  ApiStudentResultDto,
  ApiTeacherExamDto,
  ApiTeacherExamListDto,
  ApiUserDto,
} from "@/lib/api/dtos";
import type { AnswerValue, Exam, ExamAnswer, ExamAttempt, ExamDraft, ExamResult, Question, Role, User } from "@/lib/types/domain";

const accentFor = (id: string): Exam["accent"] => ["indigo", "violet", "teal", "amber"][id.charCodeAt(0) % 4] as Exam["accent"];
const number = (value: number | string | null | undefined, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const isoOrNow = (value: string | null | undefined) => value || new Date().toISOString();

export function toUser(dto: ApiUserDto): User {
  const fullName = dto.full_name?.trim() || `${dto.first_name} ${dto.last_name}`.trim() || dto.email;
  return { id: dto.id, fullName, email: dto.email, role: dto.role as Role, avatar: dto.profile?.avatar ?? undefined, schoolName: dto.school?.name };
}

function frontendVisibility(value: ApiExamSettingsDto["result_visibility"]): Exam["settings"]["resultVisibility"] {
  return value === "manual" ? "pending" : value;
}
function apiVisibility(value: Exam["settings"]["resultVisibility"]): ApiExamSettingsDto["result_visibility"] {
  return value === "pending" ? "manual" : value;
}

/** Teacher mapper may include correct answers because it is used only in teacher-owned views. */
export function toTeacherQuestion(dto: ApiQuestionDto): Question {
  const base = { id: dto.id, order: dto.order, stem: dto.text, helpText: dto.instructions || undefined, points: number(dto.marks), explanation: dto.explanation || undefined };
  const options = (dto.options || []).map((option) => ({ id: option.id, label: option.text, value: option.id, isCorrect: option.is_correct }));
  const config = dto.configuration || {};
  switch (dto.type) {
    case "multiple_choice":
      return { ...base, type: "single_choice", options, correctOptionId: options.find((option) => option.isCorrect)?.id };
    case "multiple_answer":
      return { ...base, type: "multiple_choice", options, correctOptionIds: options.filter((option) => option.isCorrect).map((option) => option.id) };
    case "true_false":
      return { ...base, type: "true_false", correctAnswer: options.findIndex((option) => option.isCorrect) === 0, optionIds: { true: options[0]?.id || "", false: options[1]?.id || "" } };
    case "short_answer":
      return { ...base, type: "short_answer", placeholder: stringConfig(config, "placeholder"), expectedAnswer: arrayConfig(config, "expected_answers")[0], maxLength: numberConfig(config, "max_length") };
    case "written":
      return { ...base, type: "essay", placeholder: stringConfig(config, "placeholder"), maxLength: numberConfig(config, "max_length"), gradingNote: stringConfig(config, "grading_note") };
  }
}

/** Student mapper intentionally reads only fields returned by the student-safe serializer. */
export function toStudentQuestion(dto: ApiQuestionDto): Question {
  const base = { id: dto.id, order: dto.order, stem: dto.text, helpText: dto.instructions || undefined, points: number(dto.marks) };
  const options = (dto.options || []).map((option) => ({ id: option.id, label: option.text, value: option.id }));
  switch (dto.type) {
    case "multiple_choice": return { ...base, type: "single_choice", options };
    case "multiple_answer": return { ...base, type: "multiple_choice", options };
    case "true_false": return { ...base, type: "true_false", optionIds: { true: options[0]?.id || "", false: options[1]?.id || "" } };
    case "short_answer": return { ...base, type: "short_answer" };
    case "written": return { ...base, type: "essay" };
  }
}

function stringConfig(config: Record<string, unknown>, key: string) { return typeof config[key] === "string" ? config[key] : undefined; }
function arrayConfig(config: Record<string, unknown>, key: string) { return Array.isArray(config[key]) ? config[key].filter((v): v is string => typeof v === "string") : []; }
function numberConfig(config: Record<string, unknown>, key: string) { return typeof config[key] === "number" ? config[key] : undefined; }

function toExamSettings(dto: ApiExamSettingsDto, totalMarks = 0): Exam["settings"] {
  return {
    durationMinutes: 1, // overwritten by the exam-level mapper
    totalMarks,
    allowBackNavigation: dto.allow_previous_questions,
    randomizeQuestions: dto.randomize_questions,
    showResultImmediately: dto.result_visibility === "immediate",
    resultVisibility: frontendVisibility(dto.result_visibility),
    showCorrectAnswers: dto.show_correct_answers,
    attemptLimit: dto.max_attempts,
    passingScore: 0,
  };
}

export function toTeacherExam(dto: ApiTeacherExamDto | ApiTeacherExamListDto): Exam {
  const detailed = "questions" in dto;
  const questions = detailed ? dto.questions.map(toTeacherQuestion) : [];
  const totalMarks = number(dto.total_marks, questions.reduce((sum, question) => sum + question.points, 0));
  const settings = toExamSettings(dto.settings, totalMarks);
  settings.durationMinutes = dto.duration_minutes;
  return {
    id: dto.id, title: dto.title, subject: dto.subject, grade: dto.grade, className: dto.class_name,
    description: detailed ? dto.description : "", instructions: detailed ? dto.instructions || undefined : undefined,
    status: dto.status, startAt: isoOrNow(dto.start_at), endAt: isoOrNow(dto.end_at),
    schedule: { startAt: dateTimeInput(dto.start_at), endAt: dateTimeInput(dto.end_at), timezone: "Asia/Tehran" },
    questionCount: detailed ? questions.length : dto.question_count,
    participantCount: 0, settings, questions, teacherName: "", accent: accentFor(dto.id),
    createdAt: dto.created_at, updatedAt: dto.updated_at,
  };
}

function dateTimeInput(value: string | null | undefined) { return value ? value.slice(0, 16) : ""; }
/** Convert a datetime-local value using the timezone the teacher selected, not the browser's timezone. */
function apiDate(value: string, timeZone: string) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const nominalUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nominalUtc));
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const zonedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    return new Date(nominalUtc - (zonedAsUtc - nominalUtc)).toISOString();
  } catch { return new Date(value).toISOString(); }
}
export function toExamWritePayload(draft: ExamDraft): ApiExamWritePayload {
  return {
    title: draft.title.trim(), description: draft.description.trim(), subject: draft.subject.trim(), grade: draft.grade.trim(),
    class_name: draft.className.trim(), instructions: draft.instructions.trim(), duration_minutes: draft.settings.durationMinutes,
    start_at: apiDate(draft.schedule.startAt, draft.schedule.timezone), end_at: apiDate(draft.schedule.endAt, draft.schedule.timezone),
    settings: {
      allow_previous_questions: draft.settings.allowBackNavigation,
      randomize_questions: draft.settings.randomizeQuestions,
      result_visibility: apiVisibility(draft.settings.resultVisibility),
      show_correct_answers: draft.settings.showCorrectAnswers,
      max_attempts: draft.settings.attemptLimit,
    },
  };
}

export function toQuestionWritePayload(question: Question): ApiQuestionWritePayload {
  const base = { text: question.stem.trim(), instructions: question.helpText?.trim() || "", marks: question.points, explanation: question.explanation?.trim() || "" };
  switch (question.type) {
    case "single_choice": return { ...base, type: "multiple_choice", configuration: {}, options: question.options.map((option) => ({ text: option.label.trim(), is_correct: option.id === question.correctOptionId })) };
    case "multiple_choice": return { ...base, type: "multiple_answer", configuration: {}, options: question.options.map((option) => ({ text: option.label.trim(), is_correct: question.correctOptionIds?.includes(option.id) ?? false })) };
    case "true_false": return { ...base, type: "true_false", configuration: {}, options: [{ text: "درست", is_correct: question.correctAnswer === true }, { text: "نادرست", is_correct: question.correctAnswer === false }] };
    case "short_answer": {
      const configuration: Record<string, unknown> = {};
      if (question.expectedAnswer?.trim()) configuration.expected_answers = [question.expectedAnswer.trim()];
      if (question.maxLength) configuration.max_length = question.maxLength;
      if (question.placeholder?.trim()) configuration.placeholder = question.placeholder.trim();
      return { ...base, type: "short_answer", configuration };
    }
    case "essay": {
      const configuration: Record<string, unknown> = {};
      if (question.maxLength) configuration.max_length = question.maxLength;
      if (question.placeholder?.trim()) configuration.placeholder = question.placeholder.trim();
      if (question.gradingNote?.trim()) configuration.grading_note = question.gradingNote.trim();
      return { ...base, type: "written", configuration };
    }
  }
}

export function toStudentDashboardExam(dto: ApiAvailableExamDto): Exam {
  const status = dto.availability === "upcoming" ? "scheduled" : dto.availability === "completed" ? "completed" : "active";
  const startAt = isoOrNow(dto.start_at); const endAt = isoOrNow(dto.end_at);
  return {
    id: dto.id, title: dto.title, description: dto.description, subject: dto.subject, grade: dto.grade, className: dto.class_name,
    status, startAt, endAt, schedule: { startAt, endAt, timezone: "Asia/Baku" }, questionCount: 0, participantCount: 0,
    settings: { durationMinutes: dto.duration_minutes, totalMarks: 0, allowBackNavigation: false, randomizeQuestions: false, showResultImmediately: false, resultVisibility: "pending", showCorrectAnswers: false, attemptLimit: 1, passingScore: 0 },
    questions: [], teacherName: "", accent: accentFor(dto.id), createdAt: startAt, updatedAt: startAt,
  };
}

function answerValue(question: Question, selected: string[], text: string | null): AnswerValue {
  if (question.type === "single_choice") return selected[0] ?? null;
  if (question.type === "multiple_choice") return selected;
  if (question.type === "true_false") return selected.length ? selected[0] === question.optionIds?.true : null;
  return text || null;
}

export function toStudentAttempt(dto: ApiAttemptDto): { exam: Exam; attempt: ExamAttempt } {
  const questions = dto.questions.map(toStudentQuestion);
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const answers: Record<string, ExamAnswer> = Object.fromEntries(questions.map((question) => [question.id, { questionId: question.id, value: null, flagged: false, updatedAt: dto.server_time }]));
  for (const response of dto.answers) {
    const question = questionById.get(response.question_id);
    if (!question) continue;
    answers[question.id] = { questionId: question.id, value: answerValue(question, response.selected_option_ids, response.text), flagged: response.is_flagged, updatedAt: response.updated_at };
  }
  const startAt = isoOrNow(dto.exam.start_at); const endAt = isoOrNow(dto.exam.end_at);
  const totalMarks = questions.reduce((sum, question) => sum + question.points, 0);
  const exam: Exam = {
    id: dto.exam.id, title: dto.exam.title, description: dto.exam.description, subject: dto.exam.subject, grade: dto.exam.grade, className: dto.exam.class_name,
    instructions: dto.exam.instructions || undefined, status: "active", startAt, endAt, schedule: { startAt, endAt, timezone: "Asia/Baku" }, questionCount: questions.length,
    participantCount: 0, settings: { durationMinutes: dto.exam.duration_minutes, totalMarks, allowBackNavigation: dto.exam.navigation.allow_previous_questions, randomizeQuestions: dto.exam.navigation.randomize_questions, showResultImmediately: false, resultVisibility: "pending", showCorrectAnswers: false, attemptLimit: 1, passingScore: 0 },
    questions, teacherName: "", accent: accentFor(dto.exam.id), createdAt: dto.started_at, updatedAt: dto.server_time,
  };
  return { exam, attempt: {
    id: dto.id, examId: dto.exam.id, studentId: "", status: dto.status, startedAt: dto.started_at, lastTickAt: dto.server_time,
    remainingSeconds: Math.max(0, dto.remaining_seconds), answers, currentQuestionIndex: 0, saveStatus: "saved", lastSavedAt: dto.server_time,
    answerRevision: 0, connectionStatus: typeof navigator === "undefined" || navigator.onLine ? "online" : "offline",
  } };
}

export function toStudentResult(dto: ApiStudentResultDto, attempt: ExamAttempt, exam: Exam): ExamResult {
  return {
    id: dto.id, examId: exam.id, status: dto.status === "published" ? "published" : "pending",
    score: number(dto.score), maximumScore: exam.settings.totalMarks, percentage: number(dto.percentage), correct: dto.correct_count,
    incorrect: dto.incorrect_count, unanswered: dto.unanswered_count, submittedAt: attempt.startedAt || new Date().toISOString(), feedback: dto.feedback || "",
  };
}
