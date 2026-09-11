import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExamReviewWorkspace } from "@/components/exam/exam-review-workspace";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

/**
 * The review list before sending the paper.
 *
 * Two things are pinned here. First, the crash a student hit right after submitting: this component read
 * `attempt.status` to decide which screen to show, and the shared submit hook was called *below* that
 * branch — so the render where the attempt became `submitted` ran one hook fewer and React threw
 * "rendered fewer hooks than expected". Second, the "no going back" rule: the list used to offer «ویرایش»
 * on every row, including rows the server would refuse to write, which sent the student to a dead end.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/lib/api/attempts", () => ({
  attemptsApi: {
    detail: vi.fn().mockResolvedValue({}),
    heartbeat: vi.fn().mockResolvedValue({ server_time: new Date().toISOString(), remaining_seconds: 900, status: "in_progress", answer_revision: 1 }),
    claimSession: vi.fn().mockResolvedValue({}),
    recordSignal: vi.fn().mockResolvedValue(undefined),
    saveAnswer: vi.fn().mockResolvedValue({}),
    saveAnswers: vi.fn().mockResolvedValue([]),
    setFlag: vi.fn().mockResolvedValue({}),
    submit: vi.fn().mockResolvedValue({ attempt: { id: "attempt-1", status: "submitted" }, result_available: false }),
    result: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    listAvailable: vi.fn().mockResolvedValue([]),
  },
}));

const questions = [1, 2, 3].map((index) => ({
  id: `q${index}`,
  order: index,
  stem: `سؤال ${index}`,
  type: "short_answer" as const,
  points: 2,
  required: true,
}));

function examFixture(settings: Partial<Exam["settings"]> = {}): Exam {
  return {
    id: "exam-1", title: "آزمون شیمی", description: "", subject: "شیمی", grade: "۱۲", className: "۱",
    status: "active", startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z",
    schedule: { startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z", timezone: "Asia/Tehran" },
    questionCount: 3, participantCount: 0, teacherName: "", accent: "indigo",
    createdAt: "2026-03-01T05:30:00Z", updatedAt: "2026-03-01T05:30:00Z",
    settings: {
      durationMinutes: 45, totalMarks: 6, allowBackNavigation: true, questionLayout: "paged", randomizeQuestions: false,
      randomizeOptions: false, allowUnanswered: true, showResultImmediately: false, resultVisibility: "pending",
      showCorrectAnswers: false, attemptLimit: 1, passingPercentage: 50, ...settings,
    },
    questions: questions as Exam["questions"],
  };
}

function attemptFixture(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1", examId: "exam-1", studentId: "s1", status: "in_progress",
    startedAt: "2026-03-20T05:30:00Z", lastTickAt: new Date().toISOString(), remainingSeconds: 900,
    answers: {
      q1: { questionId: "q1", value: "پاسخ یک", flagged: false, updatedAt: "2026-03-20T05:31:00Z" },
      q2: { questionId: "q2", value: "پاسخ دو", flagged: true, updatedAt: "2026-03-20T05:32:00Z" },
    },
    currentQuestionIndex: 2, saveStatus: "saved", answerRevision: 3, connectionStatus: "online",
    attemptNumber: 1, attemptLimit: 1, answerFrontier: 2,
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { useExamAttemptStore.setState({ attempt: null }); });

function rowOf(stem: string) {
  return screen.getByText(stem).closest("button") as HTMLButtonElement;
}

describe("ExamReviewWorkspace", () => {
  it("survives the render where the attempt becomes submitted", () => {
    // This is the exact transition that used to throw: the review list renders, the student sends the
    // paper, and the same component now takes a different branch with one hook fewer.
    useExamAttemptStore.setState({ attempt: attemptFixture() });
    const view = render(<ExamReviewWorkspace exam={examFixture()} remote/>);
    expect(screen.getAllByText("ویرایش").length).toBe(3);

    useExamAttemptStore.setState({ attempt: attemptFixture({ status: "submitted" }) });
    expect(() => view.rerender(<ExamReviewWorkspace exam={examFixture()} remote/>)).not.toThrow();
    expect(screen.getByText("آزمون قبلاً ارسال شده است")).toBeTruthy();
  });

  it("closes the rows the server would refuse to write, and keeps the rest open", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ answerFrontier: 2 }) });
    render(<ExamReviewWorkspace exam={examFixture({ allowBackNavigation: false })} remote/>);

    expect(rowOf("سؤال 1").disabled).toBe(true);
    expect(rowOf("سؤال 2").disabled).toBe(true);
    expect(rowOf("سؤال 3").disabled).toBe(false);
    expect(screen.getAllByText("قابل ویرایش نیست").length).toBe(2);
    expect(screen.getByText("ویرایش")).toBeTruthy();
    expect(screen.getByText(/۲ سؤالی که از آن‌ها گذشته‌اید قابل ویرایش نیست/)).toBeTruthy();
  });

  it("leaves every row open when the paper allows going back", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ answerFrontier: 2 }) });
    render(<ExamReviewWorkspace exam={examFixture({ allowBackNavigation: true })} remote/>);
    expect(screen.getAllByText("ویرایش").length).toBe(3);
    expect(screen.queryByText("قابل ویرایش نیست")).toBeNull();
  });

  it("treats a one-page sheet as always editable, because nothing was ever left behind", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ answerFrontier: 3 }) });
    render(<ExamReviewWorkspace exam={examFixture({ allowBackNavigation: false, questionLayout: "single_page" })} remote/>);
    expect(screen.getAllByText("ویرایش").length).toBe(3);
  });
});
