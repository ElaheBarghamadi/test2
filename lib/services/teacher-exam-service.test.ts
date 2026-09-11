import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiExamSettingsDto, ApiQuestionDto, ApiTeacherExamDto } from "@/lib/api/dtos";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  createQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  reorderQuestions: vi.fn(),
}));

vi.mock("@/lib/api/exams", () => ({ examsApi: api }));

import { teacherExamService } from "@/lib/services/teacher-exam-service";
import type { ExamDraft, Question } from "@/lib/types/domain";

const EXISTING_ID = "b0cd4a56-8a3f-4c53-a3c0-8a4b6b3b3f01";
const DROPPED_ID = "b0cd4a56-8a3f-4c53-a3c0-8a4b6b3b3f02";

const settings: ApiExamSettingsDto = {
  allow_previous_questions: true,
  randomize_questions: false,
  randomize_options: false,
  allow_unanswered: true,
  result_visibility: "pending",
  show_correct_answers: false,
  max_attempts: 1,
  passing_percentage: "50.00",
};

function questionDto(id: string, order: number): ApiQuestionDto {
  return {
    id,
    exam: EXISTING_ID,
    type: "multiple_choice",
    text: `سؤال ${order}`,
    instructions: "",
    marks: "2.00",
    order,
    options: [
      { id: `${id}-a`, text: "گزینهٔ الف", order: 1, is_correct: true },
      { id: `${id}-b`, text: "گزینهٔ ب", order: 2, is_correct: false },
    ],
  };
}

function examDto(questions: ApiQuestionDto[]): ApiTeacherExamDto {
  return {
    id: EXISTING_ID, title: "آزمون شیمی", subject: "شیمی", grade: "۱۲", class_name: "۱",
    teacher: "teacher-1", teacher_name: "مریم رضایی", status: "draft", duration_minutes: 45,
    total_marks: "4.00", start_at: "2026-10-03T05:30:00Z", end_at: "2026-10-03T07:00:00Z",
    settings, instructions: "", description: "فصل ۲", question_count: questions.length,
    attempt_count: 0, participant_count: 0,
    created_at: "2026-09-01T05:30:00Z", updated_at: "2026-09-02T05:30:00Z",
    questions,
  };
}

/** A draft question that carries a *server* id, i.e. one the teacher opened from the exam. */
function existingQuestion(id: string, order: number): Question {
  return {
    id,
    order,
    type: "multiple_choice",
    stem: `سؤال ${order}`,
    points: 2,
    required: true,
    difficulty: "medium",
    options: [
      { id: `${id}-a`, label: "گزینهٔ الف", value: `${id}-a`, isCorrect: true },
      { id: `${id}-b`, label: "گزینهٔ ب", value: `${id}-b`, isCorrect: false },
    ],
    correctOptionIds: [`${id}-a`],
  } as unknown as Question;
}

function draft(questions: Question[], id = EXISTING_ID): ExamDraft {
  return {
    id,
    title: "آزمون شیمی",
    subject: "شیمی",
    grade: "۱۲",
    className: "۱",
    description: "فصل ۲",
    instructions: "",
    settings: {
      durationMinutes: 45, totalMarks: 4, allowBackNavigation: true, questionLayout: "paged", randomizeQuestions: false,
      randomizeOptions: false, allowUnanswered: true, showResultImmediately: false, resultVisibility: "pending",
      showCorrectAnswers: false, attemptLimit: 1, passingPercentage: 50,
    },
    schedule: { startAt: "2026-10-03T09:00", endAt: "2026-10-03T10:30", timezone: "Asia/Tehran" },
    questions,
  };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.update.mockResolvedValue(examDto([]));
  api.updateQuestion.mockResolvedValue(questionDto(EXISTING_ID, 1));
});

describe("teacherExamService.updateExam", () => {
  it("edits the rows the exam already holds instead of recreating them", async () => {
    api.detail
      .mockResolvedValueOnce(examDto([questionDto(EXISTING_ID, 1)]))
      .mockResolvedValue(examDto([questionDto(EXISTING_ID, 1)]));

    await teacherExamService.updateExam(EXISTING_ID, draft([existingQuestion(EXISTING_ID, 1)]), false);

    expect(api.updateQuestion).toHaveBeenCalledWith(EXISTING_ID, expect.objectContaining({ text: "سؤال 1" }));
    expect(api.createQuestion).not.toHaveBeenCalled();
    expect(api.deleteQuestion).not.toHaveBeenCalled();
    expect(api.reorderQuestions).toHaveBeenCalledWith(EXISTING_ID, [EXISTING_ID]);
  });

  it("deletes only the questions the teacher took out of the paper", async () => {
    api.detail
      .mockResolvedValueOnce(examDto([questionDto(EXISTING_ID, 1), questionDto(DROPPED_ID, 2)]))
      .mockResolvedValue(examDto([questionDto(EXISTING_ID, 1)]));

    await teacherExamService.updateExam(EXISTING_ID, draft([existingQuestion(EXISTING_ID, 1)]), false);

    expect(api.deleteQuestion).toHaveBeenCalledWith(DROPPED_ID);
    expect(api.deleteQuestion).not.toHaveBeenCalledWith(EXISTING_ID);
  });

  it("counts a question the server reused as retained, so the delete pass cannot erase it", async () => {
    const localOnly = { ...existingQuestion("question-local", 1), id: "question-local" };
    api.detail
      .mockResolvedValueOnce(examDto([questionDto(EXISTING_ID, 1)]))
      .mockResolvedValue(examDto([questionDto(EXISTING_ID, 1)]));
    // The draft still holds a client id for content the exam already has, so the API answers with the
    // existing row (200, `deduplicated`) rather than a second copy.
    api.createQuestion.mockResolvedValue({ ...questionDto(EXISTING_ID, 1), deduplicated: true });

    await teacherExamService.updateExam(EXISTING_ID, draft([localOnly]), false);

    expect(api.createQuestion).toHaveBeenCalledTimes(1);
    expect(api.deleteQuestion).not.toHaveBeenCalled();
    expect(api.reorderQuestions).toHaveBeenCalledWith(EXISTING_ID, [EXISTING_ID]);
  });
});

describe("teacherExamService.createExam", () => {
  it("sends every draft question to the new exam and publishes after the content lands", async () => {
    api.create.mockResolvedValue(examDto([]));
    api.detail.mockResolvedValue(examDto([questionDto(EXISTING_ID, 1), questionDto(DROPPED_ID, 2)]));
    api.createQuestion
      .mockResolvedValueOnce(questionDto(EXISTING_ID, 1))
      .mockResolvedValueOnce(questionDto(DROPPED_ID, 2));

    const saved = await teacherExamService.createExam(draft([existingQuestion("question-a", 1), existingQuestion("question-b", 2)], undefined), true);

    expect(api.createQuestion).toHaveBeenCalledTimes(2);
    expect(api.publish).toHaveBeenCalledWith(EXISTING_ID);
    expect(saved.questions.map((question) => question.id)).toEqual([EXISTING_ID, DROPPED_ID]);
  });
});
