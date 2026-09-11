import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExamSessionNotice } from "@/components/exam/exam-session-notice";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { ExamReviewWorkspace } from "@/components/exam/exam-review-workspace";
import { ExamWorkspace } from "@/components/exam/exam-workspace";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

const claimSession = vi.fn();
const heartbeat = vi.fn();
const saveAnswer = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/lib/api/attempts", () => ({
  attemptsApi: {
    claimSession: (...args: unknown[]) => claimSession(...args),
    heartbeat: (...args: unknown[]) => heartbeat(...args),
    saveAnswer: (...args: unknown[]) => saveAnswer(...args),
    saveAnswers: vi.fn().mockResolvedValue([]),
    setFlag: vi.fn().mockResolvedValue({}),
    recordSignal: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn().mockResolvedValue({ attempt: { id: "attempt-1", status: "submitted" } }),
    detail: vi.fn(),
    start: vi.fn(),
    listAvailable: vi.fn(),
    result: vi.fn(),
  },
}));

const exam: Exam = {
  id: "exam-1", title: "آزمون", description: "", subject: "", grade: "", className: "", status: "active",
  startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z",
  schedule: { startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z", timezone: "Asia/Tehran" },
  questionCount: 1, participantCount: 0, teacherName: "", accent: "indigo",
  createdAt: "2026-03-01T05:30:00Z", updatedAt: "2026-03-01T05:30:00Z",
  settings: { durationMinutes: 45, totalMarks: 2, allowBackNavigation: true, questionLayout: "paged", randomizeQuestions: false, randomizeOptions: false, allowUnanswered: true, showResultImmediately: false, resultVisibility: "pending", showCorrectAnswers: false, attemptLimit: 1, passingPercentage: 0 },
  questions: [{ id: "q1", order: 1, stem: "سؤال", type: "single_choice", points: 2, required: true, options: [{ id: "o1", label: "الف", value: "o1" }] }],
};

function fixture(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1", examId: "exam-1", studentId: "s1", status: "in_progress", startedAt: "2026-03-20T05:30:00Z",
    lastTickAt: new Date().toISOString(), remainingSeconds: 600, serverRevision: 3, saveStatus: "error",
    answers: { q1: { questionId: "q1", value: "o1", flagged: false, updatedAt: "2026-03-20T05:31:00Z" } },
    pendingAnswerQuestionIds: ["q1"], pendingFlagQuestionIds: [],
    currentQuestionIndex: 0, answerRevision: 4, connectionStatus: "online",
    ...overrides,
  };
}

beforeEach(() => {
  claimSession.mockReset();
  heartbeat.mockReset().mockResolvedValue({ server_time: "2026-03-20T05:35:00Z", expires_at: "2026-03-20T06:15:00Z", remaining_seconds: 600, status: "in_progress", answer_revision: 3, session_locked_by_other: false, question_count: 1 });
  saveAnswer.mockReset();
  useExamAttemptStore.setState({ attempt: null });
});

describe("ExamSessionNotice", () => {
  it("explains a second window and offers the takeover, without touching the score", () => {
    render(<ExamSessionNotice conflict="another_session" saveStatus="saving" onClaim={() => undefined}/>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/پنجرهٔ دیگری باز است/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /ادامه در این پنجره/ })).toBeTruthy();
  });

  it("keeps a failed save recoverable and never claims the answer is lost", () => {
    const onRetry = vi.fn();
    render(<ExamSessionNotice saveStatus="error" onRetry={onRetry}/>);
    expect(screen.getByText(/هیچ چیزی پاک نشده است/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوبارهٔ ذخیره/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while the session is healthy", () => {
    const { container } = render(<ExamSessionNotice saveStatus="saved"/>);
    expect(container.textContent).toBe("");
  });
});

describe("session takeover from the exam screen", () => {
  it("claims the attempt, re-bases the revision and re-arms the queue", async () => {
    claimSession.mockResolvedValue({ status: "in_progress", remaining_seconds: 540, answer_revision: 7 });
    useExamAttemptStore.setState({ attempt: fixture({ sessionConflict: "another_session" }) });
    render(<ExamWorkspace exam={exam}/>);

    fireEvent.click(await screen.findByRole("button", { name: /ادامه در این پنجره/ }));
    await waitFor(() => expect(claimSession).toHaveBeenCalledWith("attempt-1", expect.objectContaining({ examSession: expect.any(String) })));

    const attempt = useExamAttemptStore.getState().attempt;
    expect(attempt?.sessionConflict).toBeNull();
    expect(attempt?.serverRevision).toBe(7);
    expect(attempt?.remainingSeconds).toBe(540);
    // The still-unsent answer is pushed again instead of being marked saved.
    expect(attempt?.saveStatus).toBe("saving");
    expect(attempt?.pendingAnswerQuestionIds).toEqual(["q1"]);
  });

  it("tells the student when the takeover itself cannot be completed", async () => {
    claimSession.mockRejectedValue(new Error("offline"));
    useExamAttemptStore.setState({ attempt: fixture({ sessionConflict: "another_session" }) });
    render(<ExamWorkspace exam={exam}/>);

    fireEvent.click(await screen.findByRole("button", { name: /ادامه در این پنجره/ }));
    await waitFor(() => expect(claimSession).toHaveBeenCalled());
    expect(useExamAttemptStore.getState().attempt?.sessionConflict).toBe("another_session");
    expect(useExamAttemptStore.getState().attempt?.serverRevision).toBe(3);
  });
});

describe("answer-sheet rule surfaced before submit", () => {
  it("names how many blanks block the student when the exam requires a full sheet", () => {
    useExamAttemptStore.setState({ attempt: fixture({ answers: { q1: { questionId: "q1", value: null, flagged: false, updatedAt: "2026-03-20T05:31:00Z" } } }) });
    render(<ExamReviewWorkspace exam={{ ...exam, settings: { ...exam.settings, allowUnanswered: false } }} remote/>);
    expect(screen.getByText(/پاسخ کامل می‌خواهد/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /ارسال نهایی آزمون/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("leaves submission open when blanks are allowed", () => {
    useExamAttemptStore.setState({ attempt: fixture({ answers: { q1: { questionId: "q1", value: null, flagged: false, updatedAt: "2026-03-20T05:31:00Z" } } }) });
    render(<ExamReviewWorkspace exam={exam} remote/>);
    expect((screen.getByRole("button", { name: /ارسال نهایی آزمون/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
