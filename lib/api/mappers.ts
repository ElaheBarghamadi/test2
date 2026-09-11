import type {
  ApiAttemptDto,
  ApiAvailableExamDto,
  ApiExamSettingsDto,
  ApiExamWritePayload,
  ApiQuestionDto,
  ApiStudentQuestionDto,
  ApiQuestionWritePayload,
  ApiRole,
  ApiNotificationPageDto,
  ApiOptionDto,
  ApiStudentResultDto,
  ApiTeacherExamDto,
  ApiTeacherExamListDto,
  ApiUserDto,
} from "@/lib/api/dtos";
import type { AnswerValue, Exam, ExamAnswer, ExamAttempt, ExamDraft, ExamResult, NotificationItem, Question, Role, User } from "@/lib/types/domain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only a real server UUID may be echoed back as an option id; rows the builder has not saved yet must be created. */
const existingId = (value: string) => (UUID_PATTERN.test(value) ? value : undefined);
const accentFor = (id: string): Exam["accent"] => ["indigo", "violet", "teal", "amber"][id.charCodeAt(0) % 4] as Exam["accent"];
const number = (value: number | string | null | undefined, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const isoOrNow = (value: string | null | undefined) => value || new Date().toISOString();

/** The in-app bell: a thin, flat DTO, mapped here so the store never reads snake_case. */
export function toNotificationPage(dto: ApiNotificationPageDto): { unreadCount: number; results: NotificationItem[] } {
  return {
    unreadCount: dto.unread_count,
    results: dto.results.map((row) => ({ id: row.id, kind: row.kind, title: row.title, body: row.body, link: row.link ?? "", isRead: row.is_read, createdAt: row.created_at })),
  };
}

export function toUser(dto: ApiUserDto): User {
  const fullName = dto.full_name?.trim() || `${dto.first_name} ${dto.last_name}`.trim() || dto.email;
  return { id: dto.id, fullName, email: dto.email, role: dto.role as Role, avatar: dto.profile?.avatar ?? undefined, schoolName: dto.school?.name };
}

function frontendVisibility(value: ApiExamSettingsDto["result_visibility"]): Exam["settings"]["resultVisibility"] {
  return value;
}
function apiVisibility(value: Exam["settings"]["resultVisibility"]): ApiExamSettingsDto["result_visibility"] {
  return value;
}

/** Teacher mapper may include correct answers because it is used only in teacher-owned views. */
export function toTeacherQuestion(dto: ApiQuestionDto): Question {
  const base = {
    id: dto.id, order: dto.order, stem: dto.text, helpText: dto.instructions || undefined, points: number(dto.marks), explanation: dto.explanation || undefined,
    difficulty: dto.difficulty ?? "medium", tags: (dto.tags ?? []).map((tag) => tag.name), isArchived: dto.is_archived === true,
    usageCount: dto.usage_count ?? 0, answeredCount: dto.answered_count ?? 0, copiedFromId: dto.copied_from ?? null,
    examId: dto.exam, examTitle: dto.exam_title, examStatus: dto.exam_status,
  };
  const options = (dto.options || []).map((option) => ({ id: option.id, label: option.text, value: option.id, isCorrect: option.is_correct }));
  const config = dto.configuration || {};
  switch (dto.type) {
    case "multiple_choice":
      return { ...base, type: "single_choice", options, correctOptionId: options.find((option) => option.isCorrect)?.id };
    case "multiple_answer":
      return { ...base, type: "multiple_choice", options, correctOptionIds: options.filter((option) => option.isCorrect).map((option) => option.id) };
    case "true_false":
      return { ...base, type: "true_false", correctAnswer: orderedByPosition(dto)[0]?.is_correct === true, optionIds: trueFalseOptionIds(dto) };
    case "short_answer":
      return { ...base, type: "short_answer", placeholder: stringConfig(config, "placeholder"), expectedAnswers: arrayConfig(config, "expected_answers"), caseSensitive: config.case_sensitive === true, maxLength: numberConfig(config, "max_length") };
    case "written":
      return { ...base, type: "essay", placeholder: stringConfig(config, "placeholder"), maxLength: numberConfig(config, "max_length"), gradingNote: stringConfig(config, "grading_note") };
  }
}

/**
 * The two true/false controls are fixed wording («درست» / «نادرست»), so the client has to learn which
 * *stored option* stands for which. Payload array order is display order — the thing option shuffling is
 * allowed to change — so the pair is keyed on the option's own `order`, which is the contract the server
 * documents for true/false.
 */
function orderedByPosition(dto: { options?: ApiOptionDto[] }) {
  return [...(dto.options || [])].sort((left, right) => left.order - right.order);
}

function trueFalseOptionIds(dto: { options?: ApiOptionDto[] }) {
  const ordered = orderedByPosition(dto);
  return { true: ordered[0]?.id || "", false: ordered[1]?.id || "" };
}

/** Student mapper intentionally reads only fields returned by the student-safe serializer. */
export function toStudentQuestion(dto: ApiStudentQuestionDto): Question {
  const base = { id: dto.id, order: dto.order, stem: dto.text, helpText: dto.instructions || undefined, points: number(dto.marks) };
  const options = (dto.options || []).map((option) => ({ id: option.id, label: option.text, value: option.id }));
  switch (dto.type) {
    case "multiple_choice": return { ...base, type: "single_choice", options };
    case "multiple_answer": return { ...base, type: "multiple_choice", options };
    case "true_false": return { ...base, type: "true_false", optionIds: trueFalseOptionIds(dto) };
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
    randomizeOptions: dto.randomize_options === true,
    // Absent on a payload from before the rule existed; the server default is permissive.
    allowUnanswered: dto.allow_unanswered !== false,
    questionLayout: dto.question_layout === "single_page" ? "single_page" : "paged",
    showResultImmediately: dto.result_visibility === "immediate",
    resultVisibility: frontendVisibility(dto.result_visibility),
    showCorrectAnswers: dto.show_correct_answers,
    attemptLimit: dto.max_attempts,
    passingPercentage: number(dto.passing_percentage),
  };
}

export function toTeacherExam(dto: ApiTeacherExamDto | ApiTeacherExamListDto): Exam {
  const detailed = "questions" in dto;
  const questions = detailed ? dto.questions.map(toTeacherQuestion) : [];
  // The server keeps Exam.total_marks in sync with its questions; a missing value falls back to the
  // question sum rather than to zero, so the teacher never sees "۰ نمره" for a populated exam.
  const storedTotal = dto.total_marks;
  const totalMarks = storedTotal === null || storedTotal === undefined || storedTotal === "" ? questions.reduce((sum, question) => sum + question.points, 0) : number(storedTotal);
  const settings = toExamSettings(dto.settings, totalMarks);
  settings.durationMinutes = dto.duration_minutes;
  return {
    id: dto.id, title: dto.title, subject: dto.subject, grade: dto.grade, className: dto.class_name,
    description: detailed ? dto.description : "", instructions: detailed ? dto.instructions || undefined : undefined,
    status: dto.status, startAt: isoOrNow(dto.start_at), endAt: isoOrNow(dto.end_at),
    schedule: { startAt: dateTimeInput(dto.start_at), endAt: dateTimeInput(dto.end_at), timezone: "Asia/Tehran" },
    questionCount: detailed ? questions.length : dto.question_count,
    participantCount: dto.participant_count, attemptCount: dto.attempt_count,
    settings, questions, teacherName: dto.teacher_name, accent: accentFor(dto.id),
    createdAt: dto.created_at, updatedAt: dto.updated_at,
  };
}

/**
 * The schedule form edits a *wall clock* (`YYYY-MM-DDTHH:mm`), so an ISO instant has to be read back through
 * the exam's own timezone. Slicing the ISO string instead showed a Tehran exam three and a half hours early
 * on any machine that was not itself set to Tehran time.
 */
function dateTimeInput(value: string | null | undefined, timeZone = "Asia/Tehran") {
  if (!value) return "";
  const iso = value.length <= 16 ? `${value}${value.length === 10 ? "T00:00" : ""}:00Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${read("year")}-${read("month")}-${read("day")}T${read("hour")}:${read("minute")}`;
  } catch {
    return value.slice(0, 16);
  }
}
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
      question_layout: draft.settings.questionLayout,
      randomize_questions: draft.settings.randomizeQuestions,
      result_visibility: apiVisibility(draft.settings.resultVisibility),
      show_correct_answers: draft.settings.showCorrectAnswers,
      randomize_options: draft.settings.randomizeOptions,
      allow_unanswered: draft.settings.allowUnanswered,
      max_attempts: draft.settings.attemptLimit,
      passing_percentage: draft.settings.passingPercentage,
    },
  };
}

export function toQuestionWritePayload(question: Question): ApiQuestionWritePayload {
  const base = {
    text: question.stem.trim(), instructions: question.helpText?.trim() || "", marks: question.points, explanation: question.explanation?.trim() || "",
    ...(question.difficulty ? { difficulty: question.difficulty } : {}),
    // An explicit list (including an empty one) replaces the teacher's tags for this question.
    ...(question.tags ? { tags: question.tags.map((tag) => tag.trim()).filter(Boolean) } : {}),
    ...(question.isArchived !== undefined ? { is_archived: question.isArchived } : {}),
  };
  switch (question.type) {
    case "single_choice": return { ...base, type: "multiple_choice", configuration: {}, options: question.options.map((option) => ({ id: existingId(option.id), text: option.label.trim(), is_correct: option.id === question.correctOptionId })) };
    case "multiple_choice": return { ...base, type: "multiple_answer", configuration: {}, options: question.options.map((option) => ({ id: existingId(option.id), text: option.label.trim(), is_correct: question.correctOptionIds?.includes(option.id) ?? false })) };
    case "true_false": {
      // Reuse the stored option ids so editing a live exam cannot orphan saved answers or trip the
      // protected-delete rule; a freshly created true/false question simply has none.
      const ids = question.optionIds;
      return { ...base, type: "true_false", configuration: {}, options: [{ id: ids ? existingId(ids.true) : undefined, text: "درست", is_correct: question.correctAnswer === true }, { id: ids ? existingId(ids.false) : undefined, text: "نادرست", is_correct: question.correctAnswer === false }] };
    }
    case "short_answer": {
      const configuration: Record<string, unknown> = {};
      const expected = (question.expectedAnswers ?? []).map((item) => item.trim()).filter(Boolean);
      if (expected.length) configuration.expected_answers = expected;
      // Only meaningful alongside a key; the server ignores it for manual grading.
      if (expected.length && question.caseSensitive) configuration.case_sensitive = true;
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
  const result = dto.attempt?.result;
  return {
    id: dto.id, title: dto.title, description: dto.description, subject: dto.subject, grade: dto.grade, className: dto.class_name,
    status, startAt, endAt, schedule: { startAt, endAt, timezone: "Asia/Tehran" },
    questionCount: dto.question_count, participantCount: 0,
    settings: {
      durationMinutes: dto.duration_minutes, totalMarks: number(dto.total_marks),
      allowBackNavigation: dto.allow_previous_questions !== false,
      questionLayout: dto.question_layout === "single_page" ? "single_page" : "paged",
      randomizeQuestions: false, randomizeOptions: false, allowUnanswered: dto.allow_unanswered !== false,
      showResultImmediately: dto.result_visibility === "immediate", resultVisibility: dto.result_visibility,
      showCorrectAnswers: false, attemptLimit: dto.max_attempts,
      passingPercentage: number(result?.passing_percentage ?? dto.passing_percentage),
    },
    questions: [], teacherName: dto.teacher_name ?? "", accent: accentFor(dto.id), createdAt: startAt, updatedAt: startAt,
    availability: dto.availability, attemptsUsed: dto.attempts_used,
    attemptId: dto.attempt?.id, attemptNumber: dto.attempt?.attempt_number,
    remainingSeconds: dto.attempt?.remaining_seconds ?? null,
    resultSummary: result ? {
      score: number(result.score), percentage: result.percentage === null ? null : number(result.percentage),
      maximumScore: number(result.maximum_score), passingPercentage: number(result.passing_percentage),
      passed: result.passed, isFinal: result.is_final,
    } : null,
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
    instructions: dto.exam.instructions || undefined, status: "active", startAt, endAt, schedule: { startAt, endAt, timezone: "Asia/Tehran" }, questionCount: questions.length,
    participantCount: 0, settings: { durationMinutes: dto.exam.duration_minutes, totalMarks: number(dto.exam.total_marks, totalMarks), allowBackNavigation: dto.exam.navigation.allow_previous_questions, questionLayout: dto.exam.navigation.question_layout === "single_page" ? "single_page" : "paged", randomizeQuestions: dto.exam.navigation.randomize_questions, randomizeOptions: false, allowUnanswered: dto.exam.navigation.allow_unanswered !== false, showResultImmediately: dto.exam.result_visibility === "immediate", resultVisibility: dto.exam.result_visibility, showCorrectAnswers: false, attemptLimit: dto.attempt_limit, passingPercentage: number(dto.exam.passing_percentage) },
    questions, teacherName: "", accent: accentFor(dto.exam.id), createdAt: dto.started_at, updatedAt: dto.server_time,
    attemptId: dto.id, attemptNumber: dto.attempt_number,
  };
  // The server's revision seeds the client counter: a refresh must resume guarded writes, not restart
  // them from zero, or every reload would look like a stale request.
  return { exam, attempt: {
    id: dto.id, examId: dto.exam.id, studentId: "", status: dto.status, startedAt: dto.started_at, lastTickAt: dto.server_time,
    remainingSeconds: Math.max(0, dto.remaining_seconds), answers, currentQuestionIndex: 0, saveStatus: "saved", lastSavedAt: dto.server_time,
    answerRevision: dto.answer_revision ?? 0, serverRevision: dto.answer_revision ?? 0, sessionConflict: null,
    // Where the server has seen this attempt write to. The runner mirrors it so the "no going back" rule
    // looks the same on screen as it does at the API, and a reload resumes it rather than resetting it.
    answerFrontier: dto.answer_frontier ?? 0,
    connectionStatus: typeof navigator === "undefined" || navigator.onLine ? "online" : "offline",
    attemptNumber: dto.attempt_number, attemptLimit: dto.attempt_limit,
  } };
}

export function toStudentResult(dto: ApiStudentResultDto, attempt: ExamAttempt, exam: Exam): ExamResult {
  return {
    id: dto.id, examId: exam.id, status: dto.status === "published" ? "published" : "pending",
    score: number(dto.score), maximumScore: number(dto.maximum_score, exam.settings.totalMarks), percentage: number(dto.percentage),
    correct: dto.correct_count, incorrect: dto.incorrect_count, unanswered: dto.unanswered_count,
    pendingManualGrading: dto.pending_manual_grading_count, manualGradingCount: dto.manual_grading_count ?? dto.pending_manual_grading_count,
    wasRevised: Boolean(dto.revised_at), passingPercentage: number(dto.passing_percentage), passed: dto.passed,
    attemptNumber: dto.attempt_number || attempt.attemptNumber || 1,
    submittedAt: dto.submitted_at || attempt.startedAt || new Date().toISOString(), feedback: dto.feedback || "",
  };
}
