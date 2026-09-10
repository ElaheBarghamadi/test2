import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ExamWorkspace } from "@/components/exam/exam-workspace";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

const submit = vi.fn();
const detail = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/lib/api/attempts", () => ({
  attemptsApi: {
    detail: (...args: unknown[]) => detail(...args),
    saveAnswer: vi.fn().mockResolvedValue({}),
    saveAnswers: vi.fn().mockResolvedValue([]),
    setFlag: vi.fn().mockResolvedValue({}),
    submit: (...args: unknown[]) => submit(...args),
    result: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    listAvailable: vi.fn(),
  },
}));

const exam: Exam = {
  id: "exam-1", title: "آزمون زیست", description: "", subject: "زیست", grade: "۱۲", className: "۱",
  status: "active", startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z",
  schedule: { startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z", timezone: "Asia/Tehran" },
  questionCount: 1, participantCount: 0, teacherName: "", accent: "indigo",
  createdAt: "2026-03-01T05:30:00Z", updatedAt: "2026-03-01T05:30:00Z",
  settings: { durationMinutes: 45, totalMarks: 2, allowBackNavigation: true, randomizeQuestions: false, showResultImmediately: false, resultVisibility: "pending", showCorrectAnswers: false, attemptLimit: 2, passingPercentage: 50 },
  questions: [{ id: "q1", order: 1, stem: "کدام‌یک واحد توان است؟", type: "single_choice", points: 2, required: true, options: [{ id: "o1", label: "وات", value: "o1" }, { id: "o2", label: "ژول", value: "o2" }] }],
};

function attemptFixture(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1", examId: "exam-1", studentId: "s1", status: "expired", startedAt: "2026-03-20T05:30:00Z",
    lastTickAt: new Date().toISOString(), remainingSeconds: 0,
    answers: { q1: { questionId: "q1", value: "o1", flagged: false, updatedAt: "2026-03-20T05:31:00Z" } },
    currentQuestionIndex: 0, saveStatus: "saved", answerRevision: 1, connectionStatus: "online",
    attemptNumber: 1, attemptLimit: 2,
    ...overrides,
  };
}

beforeEach(() => {
  submit.mockReset().mockResolvedValue({ attempt: { id: "attempt-1", status: "submitted" }, result_available: false });
  detail.mockReset();
  push.mockReset();
});

afterEach(() => {
  useExamAttemptStore.setState({ attempt: null });
});

describe("ExamWorkspace session handling", () => {
  it("confirms the deadline with the server, then finalises and routes to the result", async () => {
    // The local countdown reached zero, so the session is already marked expired in the store.
    useExamAttemptStore.setState({ attempt: attemptFixture() });
    detail.mockResolvedValue({
      id: "attempt-1", attempt_number: 1, attempt_limit: 2, status: "expired", started_at: "2026-03-20T05:30:00Z",
      submitted_at: "2026-03-20T06:15:00Z", last_activity_at: "2026-03-20T06:15:00Z", server_time: "2026-03-20T06:15:00Z",
      expires_at: "2026-03-20T06:15:00Z", remaining_seconds: 0,
      exam: { id: "exam-1", title: exam.title, description: "", subject: "زیست", grade: "۱۲", class_name: "۱", instructions: "", duration_minutes: 45, start_at: exam.startAt, end_at: exam.endAt, total_marks: "2.00", question_count: 1, passing_percentage: 50, result_visibility: "pending", navigation: { allow_previous_questions: true, randomize_questions: false } },
      questions: [{ id: "q1", type: "multiple_choice", text: exam.questions[0].stem, instructions: "", marks: 2, order: 1, options: [{ id: "o1", text: "وات", order: 1 }, { id: "o2", text: "ژول", order: 2 }] }],
      answers: [{ id: "a1", question_id: "q1", selected_option_ids: ["o1"], text: null, answered: true, is_flagged: false, updated_at: "2026-03-20T05:31:00Z" }],
    });

    render(<ExamWorkspace exam={exam}/>);

    await waitFor(() => expect(submit).toHaveBeenCalledWith("attempt-1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/student/results/attempt-1"));
  });

  it("keeps writing when the teacher extended the exam while the clock ran out", async () => {
    useExamAttemptStore.setState({ attempt: attemptFixture() });
    detail.mockResolvedValue({
      id: "attempt-1", attempt_number: 1, attempt_limit: 2, status: "in_progress", started_at: "2026-03-20T05:30:00Z",
      submitted_at: null, last_activity_at: "2026-03-20T06:14:00Z", server_time: "2026-03-20T06:14:00Z",
      expires_at: "2026-03-20T06:24:00Z", remaining_seconds: 600,
      exam: { id: "exam-1", title: exam.title, description: "", subject: "زیست", grade: "۱۲", class_name: "۱", instructions: "", duration_minutes: 55, start_at: exam.startAt, end_at: exam.endAt, total_marks: "2.00", question_count: 1, passing_percentage: 50, result_visibility: "pending", navigation: { allow_previous_questions: true, randomize_questions: false } },
      questions: [{ id: "q1", type: "multiple_choice", text: exam.questions[0].stem, instructions: "", marks: 2, order: 1, options: [{ id: "o1", text: "وات", order: 1 }, { id: "o2", text: "ژول", order: 2 }] }],
      answers: [],
    });

    render(<ExamWorkspace exam={exam}/>);

    await waitFor(() => expect(detail).toHaveBeenCalledWith("attempt-1"));
    expect(submit).not.toHaveBeenCalled();
    // The server clock wins: the session is live again with the granted minutes.
    await waitFor(() => expect(useExamAttemptStore.getState().attempt?.status).toBe("in_progress"));
    expect(useExamAttemptStore.getState().attempt?.remainingSeconds).toBe(600);
  });

  it("never treats a failed clock read as the end of the exam", async () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ connectionStatus: "offline" }) });
    detail.mockRejectedValue(new Error("offline"));

    render(<ExamWorkspace exam={exam}/>);
    await waitFor(() => expect(detail).toHaveBeenCalled());

    expect(submit).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("warns before closing the tab mid-exam and stays silent once time is up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useExamAttemptStore.setState({ attempt: attemptFixture({ status: "in_progress", remainingSeconds: 300 }) });
    detail.mockResolvedValue({
      id: "attempt-1", attempt_number: 1, attempt_limit: 2, status: "in_progress", started_at: "2026-03-20T05:30:00Z",
      submitted_at: null, last_activity_at: "2026-03-20T05:30:00Z", server_time: "2026-03-20T05:30:00Z",
      expires_at: "2026-03-20T06:15:00Z", remaining_seconds: 300,
      exam: { id: "exam-1", title: exam.title, description: "", subject: "زیست", grade: "۱۲", class_name: "۱", instructions: "", duration_minutes: 45, start_at: exam.startAt, end_at: exam.endAt, total_marks: "2.00", question_count: 1, passing_percentage: 50, result_visibility: "pending", navigation: { allow_previous_questions: true, randomize_questions: false } },
      questions: [], answers: [],
    });

    const { unmount } = render(<ExamWorkspace exam={exam}/>);
    const duringExam = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(duringExam);
    expect(duringExam.defaultPrevented).toBe(true);

    unmount();
    useExamAttemptStore.setState({ attempt: attemptFixture({ status: "submitted" }) });
    render(<ExamWorkspace exam={exam}/>);
    const afterExam = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterExam);
    expect(afterExam.defaultPrevented).toBe(false);
    warn.mockRestore();
  });

  it("shows which attempt of the allowed budget the student is writing", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ status: "in_progress", remainingSeconds: 300 }) });
    detail.mockResolvedValue({ id: "attempt-1", status: "in_progress" });
    render(<ExamWorkspace exam={exam}/>);
    expect(screen.getByText(/تلاش ۱ از ۲/)).toBeTruthy();
  });
});
