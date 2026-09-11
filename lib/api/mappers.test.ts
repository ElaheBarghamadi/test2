import { describe, expect, it } from "vitest";
import type {
  ApiAttemptDto,
  ApiAvailableExamDto,
  ApiExamSettingsDto,
  ApiQuestionDto,
  ApiStudentResultDto,
  ApiTeacherExamDto,
  ApiTeacherExamListDto,
} from "@/lib/api/dtos";
import {
  toExamWritePayload,
  toQuestionWritePayload,
  toStudentAttempt,
  toStudentDashboardExam,
  toStudentResult,
  toTeacherExam,
  toTeacherQuestion,
} from "@/lib/api/mappers";
import type { ExamDraft, Question } from "@/lib/types/domain";

const SERVER_ID = "3f1a2b3c-4d5e-4f60-8a71-0123456789ab";
const OTHER_ID = "9b8c7d6e-5f4a-4321-9876-ba9876543210";

const settings: ApiExamSettingsDto = {
  allow_previous_questions: true,
  randomize_questions: false,
  randomize_options: false,
  allow_unanswered: true,
  result_visibility: "pending",
  show_correct_answers: false,
  max_attempts: 2,
  passing_percentage: "60.00",
};

function listDto(overrides: Partial<ApiTeacherExamListDto> = {}): ApiTeacherExamListDto {
  return {
    id: SERVER_ID, title: "آزمون فیزیک", subject: "فیزیک", grade: "۱۲", class_name: "۱",
    teacher: OTHER_ID, teacher_name: "الاهه برغمدی", status: "active", duration_minutes: 60,
    total_marks: "20.00", start_at: "2026-03-20T05:30:00Z", end_at: "2026-03-20T07:30:00Z",
    settings, question_count: 7, attempt_count: 3, participant_count: 12,
    created_at: "2026-03-01T05:30:00Z", updated_at: "2026-03-10T05:30:00Z",
    ...overrides,
  };
}

function detailDto(questions: ApiQuestionDto[]): ApiTeacherExamDto {
  return { ...listDto(), description: "توضیح", instructions: "راهنما", questions };
}

function choiceQuestion(overrides: Partial<ApiQuestionDto> = {}): ApiQuestionDto {
  return {
    id: SERVER_ID, exam: OTHER_ID, type: "multiple_choice", text: "کدام‌ها واحد نیرو هستند؟",
    instructions: "", marks: 2, order: 1,
    options: [
      { id: SERVER_ID, text: "نيوتن", order: 1, is_correct: true },
      { id: "local-option-2", text: "ژول", order: 2, is_correct: false },
    ],
    ...overrides,
  };
}

describe("toTeacherExam", () => {
  it("surfaces scheduling metadata and the pass mark instead of placeholders", () => {
    const exam = toTeacherExam(listDto());
    expect(exam).toMatchObject({
      questionCount: 7,
      participantCount: 12,
      attemptCount: 3,
      teacherName: "الاهه برغمدی",
      status: "active",
    });
    expect(exam.settings).toMatchObject({ durationMinutes: 60, totalMarks: 20, passingPercentage: 60, attemptLimit: 2, resultVisibility: "pending" });
    expect(exam.schedule.timezone).toBe("Asia/Tehran");
    // A list row has no question bodies, so marks fall back to the exam total.
    expect(exam.questions).toEqual([]);
  });

  it("carries the two new rules through the read path", () => {
    const exam = toTeacherExam(listDto({ settings: { ...settings, randomize_options: true, allow_unanswered: false } }));
    expect(exam.settings).toMatchObject({ randomizeOptions: true, allowUnanswered: false });
  });

  it("reads a scheduled instant back as the school's own wall clock", () => {
    // The edit form edits a wall clock, so 05:30Z has to come back as 09:00 Tehran — otherwise saving an
    // exam without touching the schedule silently moves it three and a half hours earlier. `toExamWritePayload`
    // below turns the same string back into the same instant, which is the round trip this pins down.
    expect(toTeacherExam(listDto()).schedule).toMatchObject({ startAt: "2026-03-20T09:00", endAt: "2026-03-20T11:00", timezone: "Asia/Tehran" });
  });

  it("trusts the server-computed exam total over summing question marks", () => {
    // Django refreshes Exam.total_marks on every question write, so the field is authoritative.
    const exam = toTeacherExam(detailDto([
      choiceQuestion({ marks: 3 }),
      choiceQuestion({ id: OTHER_ID, marks: 2, order: 2 }),
    ]));
    expect(exam.settings.totalMarks).toBe(20);
    expect(exam.questionCount).toBe(2);
  });

  it("falls back to the question marks when no total was returned at all", () => {
    const dto = { ...detailDto([choiceQuestion({ marks: 3 }), choiceQuestion({ id: OTHER_ID, marks: 2, order: 2 })]), total_marks: null } as unknown as ApiTeacherExamDto;
    expect(toTeacherExam(dto).settings.totalMarks).toBe(5);
  });

  it("treats a missing allow_unanswered as the permissive server default", () => {
    const legacy = { ...listDto(), settings: { ...settings, allow_unanswered: undefined } } as unknown as ApiTeacherExamListDto;
    expect(toTeacherExam(legacy).settings.allowUnanswered).toBe(true);
    expect(toTeacherExam(legacy).settings.randomizeOptions).toBe(false);
  });
});

describe("toQuestionWritePayload", () => {
  it("drops option ids the server never issued so unsaved rows are created, not patched", () => {
    // API `multiple_answer` is the multi-select type; the domain calls it `multiple_choice`.
    const payload = toQuestionWritePayload(toTeacherQuestion(choiceQuestion({ type: "multiple_answer" })));
    expect(payload.type).toBe("multiple_answer");
    expect(payload.options?.[0]).toEqual({ id: SERVER_ID, text: "نيوتن", is_correct: true });
    expect(payload.options?.[1]?.id).toBeUndefined();
    expect(payload.options?.[1]).toMatchObject({ text: "ژول", is_correct: false });
  });

  it("sends exactly one correct option for single-choice questions", () => {
    const question = toTeacherQuestion(choiceQuestion());
    expect(question.type).toBe("single_choice");
    const payload = toQuestionWritePayload(question);
    expect(payload.type).toBe("multiple_choice");
    expect(payload.options?.every((option) => option.id === undefined || option.id === SERVER_ID)).toBe(true);
    expect(payload.options?.filter((option) => option.is_correct)).toHaveLength(1);
  });

  it("reuses stored true/false option ids so editing a live exam cannot orphan answers", () => {
    const question = toTeacherQuestion(choiceQuestion({
      type: "true_false",
      options: [
        { id: SERVER_ID, text: "درست", order: 1, is_correct: true },
        { id: OTHER_ID, text: "نادرست", order: 2, is_correct: false },
      ],
    }));
    expect(question.type).toBe("true_false");
    if (question.type !== "true_false") throw new Error("expected a true/false question");
    expect(question.correctAnswer).toBe(true);
    expect(toQuestionWritePayload(question).options).toEqual([
      { id: SERVER_ID, text: "درست", is_correct: true },
      { id: OTHER_ID, text: "نادرست", is_correct: false },
    ]);
  });

  it("only sends case sensitivity next to a real answer key", () => {
    const withKey: Question = { id: "q1", order: 1, stem: "نام اندامک", type: "short_answer", points: 1, required: true, expectedAnswers: ["میتوکندری"], caseSensitive: true, maxLength: 80 };
    expect(toQuestionWritePayload(withKey).configuration).toEqual({ expected_answers: ["میتوکندری"], case_sensitive: true, max_length: 80 });

    const withoutKey: Question = { ...withKey, expectedAnswers: [], caseSensitive: true, maxLength: undefined };
    expect(toQuestionWritePayload(withoutKey).configuration).toEqual({});
  });

  it("writes the essay grading note without empty noise", () => {
    const essay: Question = { id: "q1", order: 1, stem: "توضیح دهید", type: "essay", points: 4, required: true, maxLength: 1200, gradingNote: "  به استدلال نمره بدهید  " };
    expect(toQuestionWritePayload(essay).configuration).toEqual({ max_length: 1200, grading_note: "به استدلال نمره بدهید" });
  });
});

describe("toExamWritePayload", () => {
  const draft: ExamDraft = {
    title: "  آزمون شیمی  ", description: "", subject: "شیمی", grade: "۱۱", className: "۲", instructions: "",
    schedule: { startAt: "2026-03-20T09:00", endAt: "2026-03-20T11:00", timezone: "Asia/Tehran" },
    settings: { durationMinutes: 90, totalMarks: 20, allowBackNavigation: false, questionLayout: "paged", randomizeQuestions: true, randomizeOptions: true, allowUnanswered: false, showResultImmediately: false, resultVisibility: "pending", showCorrectAnswers: true, attemptLimit: 3, passingPercentage: 45 },
    questions: [],
  };

  it("converts wall-clock times in the teacher's timezone, not the browser's", () => {
    const payload = toExamWritePayload(draft);
    // Tehran is UTC+3:30, so 09:00 there is 05:30Z regardless of where the app runs.
    expect(payload.start_at).toBe("2026-03-20T05:30:00.000Z");
    expect(payload.end_at).toBe("2026-03-20T07:30:00.000Z");
    expect(toExamWritePayload({ ...draft, schedule: { ...draft.schedule, timezone: "UTC" } }).start_at).toBe("2026-03-20T09:00:00.000Z");
  });

  it("persists the pass mark and trims before sending", () => {
    const payload = toExamWritePayload(draft);
    expect(payload.title).toBe("آزمون شیمی");
    expect(payload.settings).toEqual({
      allow_previous_questions: false,
      // The layout rides on the same settings object, so a payload that dropped it would silently turn a
      // one-page exam back into a paged one on the next save.
      question_layout: "paged",
      randomize_questions: true,
      randomize_options: true,
      allow_unanswered: false,
      result_visibility: "pending",
      show_correct_answers: true,
      max_attempts: 3,
      passing_percentage: 45,
    });
  });
});

describe("toStudentDashboardExam", () => {
  function availableDto(overrides: Partial<ApiAvailableExamDto> = {}): ApiAvailableExamDto {
    return {
      id: SERVER_ID, title: "آزمون زیست", description: "فصل ۲", subject: "زیست", grade: "۱۲", class_name: "۳",
      duration_minutes: 45, total_marks: "12.00", start_at: "2026-03-20T05:30:00Z", end_at: "2026-03-20T07:30:00Z",
      question_count: 6, max_attempts: 2, attempts_used: 1, passing_percentage: 50, result_visibility: "pending", allow_unanswered: true,
      allow_previous_questions: true, question_layout: "paged", teacher_name: "الاهه برغمدی",
      availability: "in_progress", attempt: { id: OTHER_ID, status: "in_progress", started_at: "2026-03-20T05:30:00Z", submitted_at: null, attempt_number: 1, remaining_seconds: 1234, result: null },
      ...overrides,
    };
  }

  it("exposes the live attempt so the dashboard can offer a real resume", () => {
    const exam = toStudentDashboardExam(availableDto());
    expect(exam).toMatchObject({ availability: "in_progress", attemptId: OTHER_ID, attemptNumber: 1, remainingSeconds: 1234, attemptsUsed: 1, questionCount: 6, teacherName: "الاهه برغمدی" });
    expect(exam.settings).toMatchObject({ attemptLimit: 2, totalMarks: 12, passingPercentage: 50, resultVisibility: "pending" });
    expect(exam.resultSummary).toBeNull();
  });

  it("states the delivery rules before an attempt exists", () => {
    const exam = toStudentDashboardExam(availableDto());
    expect(exam.settings).toMatchObject({ allowBackNavigation: true, questionLayout: "paged" });
    const strict = toStudentDashboardExam(availableDto({ allow_previous_questions: false, question_layout: "single_page" }));
    // The start screen quotes these two, so the pair has to survive the mapping: a one-page exam never
    // loses its right to edit, and a missing field still means the server default rather than a refusal.
    expect(strict.settings).toMatchObject({ allowBackNavigation: false, questionLayout: "single_page" });
    expect(toStudentDashboardExam(availableDto({ allow_previous_questions: undefined, question_layout: undefined }))).toMatchObject({ settings: { allowBackNavigation: true, questionLayout: "paged" } });
  });

  it("maps a published result into a score and a pass verdict", () => {
    const exam = toStudentDashboardExam(availableDto({
      availability: "completed",
      attempts_used: 2,
      attempt: { id: OTHER_ID, status: "submitted", started_at: "2026-03-20T05:30:00Z", submitted_at: "2026-03-20T06:10:00Z", attempt_number: 2, remaining_seconds: 0, result: { score: 8, percentage: 66.66, maximum_score: 12, passing_percentage: 50, passed: true, is_final: true } },
    }));
    expect(exam.status).toBe("completed");
    expect(exam.remainingSeconds).toBe(0);
    expect(exam.resultSummary).toEqual({ score: 8, percentage: 66.66, maximumScore: 12, passingPercentage: 50, passed: true, isFinal: true });
  });

  it("keeps an unpublished result invisible instead of inventing a zero", () => {
    const exam = toStudentDashboardExam(availableDto({ availability: "completed", attempt: { ...availableDto().attempt!, status: "submitted", remaining_seconds: 0, result: null } }));
    expect(exam.resultSummary).toBeNull();
  });

  it("marks upcoming exams as scheduled so the CTA cannot start them early", () => {
    expect(toStudentDashboardExam(availableDto({ availability: "upcoming", attempt: null })).status).toBe("scheduled");
  });
});

describe("toStudentAttempt", () => {
  function attemptDto(overrides: Partial<ApiAttemptDto> = {}): ApiAttemptDto {
    return {
      id: OTHER_ID, attempt_number: 2, attempt_limit: 3, answer_revision: 7, status: "in_progress",
      started_at: "2026-03-20T05:30:00Z", submitted_at: null, last_activity_at: "2026-03-20T05:35:00Z",
      server_time: "2026-03-20T05:36:00Z", expires_at: "2026-03-20T06:15:00Z", remaining_seconds: 2340,
      exam: {
        id: SERVER_ID, title: "آزمون ریاضی", description: "", subject: "ریاضی", grade: "۱۲", class_name: "۱",
        instructions: "دقت کنید", duration_minutes: 45, start_at: "2026-03-20T05:30:00Z", end_at: "2026-03-20T06:15:00Z",
        total_marks: "6.00", question_count: 3, passing_percentage: "55.00", result_visibility: "immediate",
        navigation: { allow_previous_questions: false, randomize_questions: true, allow_unanswered: false, question_layout: "single_page" },
      },
      questions: [
        { id: "q1", type: "multiple_choice", text: "یک گزینه", instructions: "", marks: 2, order: 1, options: [{ id: SERVER_ID, text: "الف", order: 1 }, { id: OTHER_ID, text: "ب", order: 2 }] },
        { id: "q2", type: "multiple_answer", text: "چند گزینه", instructions: "", marks: 2, order: 2, options: [{ id: SERVER_ID, text: "الف", order: 1 }, { id: OTHER_ID, text: "ب", order: 2 }] },
        { id: "q3", type: "true_false", text: "درست است؟", instructions: "", marks: 2, order: 3, options: [{ id: SERVER_ID, text: "درست", order: 1 }, { id: OTHER_ID, text: "نادرست", order: 2 }] },
      ],
      answers: [
        { id: "a1", question_id: "q1", selected_option_ids: [OTHER_ID], text: null, answered: true, is_flagged: true, updated_at: "2026-03-20T05:33:00Z" },
        { id: "a2", question_id: "q2", selected_option_ids: [SERVER_ID, OTHER_ID], text: null, answered: true, is_flagged: false, updated_at: "2026-03-20T05:34:00Z" },
        { id: "a3", question_id: "q3", selected_option_ids: [SERVER_ID], text: null, answered: true, is_flagged: false, updated_at: "2026-03-20T05:35:00Z" },
      ],
      ...overrides,
    };
  }

  it("restores every answer shape into the domain value the renderers expect", () => {
    const { attempt } = toStudentAttempt(attemptDto());
    expect(attempt.answers.q1.value).toBe(OTHER_ID);
    expect(attempt.answers.q1.flagged).toBe(true);
    expect(attempt.answers.q2.value).toEqual([SERVER_ID, OTHER_ID]);
    // True/false is stored as the selected option but answered as a boolean.
    expect(attempt.answers.q3.value).toBe(true);
    expect(attempt.answers.q3.flagged).toBe(false);
  });

  it("carries the attempt budget and the server countdown into the session", () => {
    const { attempt, exam } = toStudentAttempt(attemptDto());
    expect(attempt).toMatchObject({ id: OTHER_ID, attemptNumber: 2, attemptLimit: 3, remainingSeconds: 2340, saveStatus: "saved", answerRevision: 7, serverRevision: 7, sessionConflict: null });
    expect(exam.settings).toMatchObject({ attemptLimit: 3, passingPercentage: 55, totalMarks: 6, resultVisibility: "immediate", allowBackNavigation: false, questionLayout: "single_page", randomizeQuestions: true, allowUnanswered: false, randomizeOptions: false });
    expect(exam.attemptId).toBe(OTHER_ID);
    expect(exam.attemptNumber).toBe(2);
    expect(attempt.answers.q3.value).toBe(true);
  });

  it("carries the server's no-return frontier into the session", () => {
    expect(toStudentAttempt(attemptDto()).attempt.answerFrontier).toBe(0);
    expect(toStudentAttempt(attemptDto({ answer_frontier: 2 })).attempt.answerFrontier).toBe(2);
  });

  it("never lets the countdown go negative", () => {
    expect(toStudentAttempt(attemptDto({ remaining_seconds: -12, status: "expired" })).attempt.remainingSeconds).toBe(0);
  });
});

describe("toStudentResult", () => {
  const { attempt, exam } = toStudentAttempt({
    id: OTHER_ID, attempt_number: 1, attempt_limit: 1, answer_revision: 3, status: "submitted", started_at: "2026-03-20T05:30:00Z",
    submitted_at: "2026-03-20T06:00:00Z", last_activity_at: "2026-03-20T06:00:00Z", server_time: "2026-03-20T06:00:00Z",
    expires_at: "2026-03-20T06:15:00Z", remaining_seconds: 0,
    exam: { id: SERVER_ID, title: "آزمون", description: "", subject: "", grade: "", class_name: "", instructions: "", duration_minutes: 45, start_at: null, end_at: null, total_marks: "10.00", question_count: 0, passing_percentage: 0, result_visibility: "pending", navigation: { allow_previous_questions: true, randomize_questions: false, allow_unanswered: true } },
    questions: [], answers: [],
  });

  const base: ApiStudentResultDto = {
    id: "r1", status: "published", score: "6.00", percentage: 60, maximum_score: 10, correct_count: 3,
    incorrect_count: 1, unanswered_count: 1, pending_manual_grading_count: 0, manual_grading_count: 0, revised_at: null, passing_percentage: 55,
    passed: true, attempt_number: 1, submitted_at: "2026-03-20T06:00:00Z", is_final: true, feedback: "خوب بود", published_at: null,
  };

  it("maps marks, the pass verdict and the manual-grading flag", () => {
    expect(toStudentResult(base, attempt, exam)).toMatchObject({ score: 6, maximumScore: 10, percentage: 60, passingPercentage: 55, passed: true, pendingManualGrading: 0, status: "published", attemptNumber: 1, feedback: "خوب بود" });
  });

  it("flags a result that still awaits the teacher", () => {
    const result = toStudentResult({ ...base, status: "pending", percentage: null, passed: null, pending_manual_grading_count: 2 }, attempt, exam);
    expect(result.status).toBe("pending");
    // The count is passed through so the UI can say how many answers are still queued.
    expect(result.pendingManualGrading).toBe(2);
    expect(result.passed).toBeNull();
  });

  it("coerces the decimal strings DRF emits for model fields", () => {
    const result = toStudentResult({ ...base, score: "7.25", percentage: "72.50" }, attempt, exam);
    expect(result).toMatchObject({ score: 7.25, percentage: 72.5 });
  });

  it("falls back to the attempt timestamps when the payload has none", () => {
    const result = toStudentResult({ ...base, submitted_at: null }, attempt, exam);
    expect(result.submittedAt).toBe(attempt.startedAt);
  });
});
