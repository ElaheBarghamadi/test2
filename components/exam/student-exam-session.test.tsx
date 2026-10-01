import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { dropAllJournals, writeJournal } from "@/lib/exam/answer-journal";
import { StudentExamSession } from "@/components/exam/student-exam-session";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import type { ApiAvailableExamDto, ApiAttemptDto } from "@/lib/api/dtos";

/**
 * The whole loop, at the level a student experiences it: answers written while the browser could not reach
 * the server, then the page reloaded (a crash, a closed lid, a walk to the school wifi).
 *
 * The server's copy deliberately holds the *older* answer for q2, because that is precisely the state a real
 * reload sees: Django never received the edit. If the journal did not exist, the screen would come back with
 * the stale text and the student's writing would be gone.
 */

const listAvailable = vi.hoisted(() => vi.fn());
const detail = vi.hoisted(() => vi.fn());
const saveAnswer = vi.hoisted(() => vi.fn());
const saveAnswers = vi.hoisted(() => vi.fn());
const setFlag = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/api/attempts", () => ({
  attemptsApi: {
    listAvailable: (...args: unknown[]) => listAvailable(...args),
    detail: (...args: unknown[]) => detail(...args),
    start: vi.fn(),
    saveAnswer: (...args: unknown[]) => saveAnswer(...args),
    saveAnswers: (...args: unknown[]) => saveAnswers(...args),
    setFlag: (...args: unknown[]) => setFlag(...args),
    heartbeat: vi.fn().mockResolvedValue({ server_time: "2026-10-01T08:12:00Z", expires_at: null, remaining_seconds: 600, status: "in_progress", answer_revision: 2, answer_frontier: 0, session_locked_by_other: false, question_count: 2 }),
    claimSession: vi.fn(),
    recordSignal: vi.fn().mockResolvedValue({ accepted: true }),
    submit: vi.fn(),
    result: vi.fn(),
  },
}));

const SERVER_TIME = "2026-10-01T08:10:00.000Z";

const available: ApiAvailableExamDto = {
  id: "exam-1", title: "آزمون زیست", description: "", subject: "زیست", grade: "۱۲", class_name: "۱۲-ب",
  duration_minutes: 45, total_marks: 4, start_at: "2026-10-01T08:00:00.000Z", end_at: "2026-10-01T09:00:00.000Z",
  question_count: 2, max_attempts: 2, attempts_used: 1, passing_percentage: 50, result_visibility: "pending",
  teacher_name: "مریم رضایی", allow_unanswered: true, allow_previous_questions: true, question_layout: "paged",
  availability: "in_progress",
  attempt: { id: "attempt-1", status: "in_progress", started_at: "2026-10-01T08:00:00.000Z", submitted_at: null, attempt_number: 1, remaining_seconds: 600, result: null },
};

/** Two questions; the server holds an old answer for q2 and nothing for q1. */
const attemptDto: ApiAttemptDto = {
  id: "attempt-1", attempt_number: 1, attempt_limit: 2, answer_revision: 2, status: "in_progress",
  started_at: "2026-10-01T08:00:00.000Z", answer_frontier: 0, submitted_at: null, last_activity_at: SERVER_TIME,
  server_time: SERVER_TIME, expires_at: "2026-10-01T08:45:00.000Z", remaining_seconds: 600,
  exam: {
    id: "exam-1", title: "آزمون زیست", description: "", subject: "زیست", grade: "۱۲", class_name: "۱۲-ب",
    instructions: "", duration_minutes: 45, start_at: "2026-10-01T08:00:00.000Z", end_at: "2026-10-01T09:00:00.000Z",
    total_marks: 4, question_count: 2, passing_percentage: 50, result_visibility: "pending",
    navigation: { allow_previous_questions: true, randomize_questions: false, allow_unanswered: true, question_layout: "paged" },
  },
  questions: [
    { id: "q1", type: "multiple_choice", text: "کدام‌یک واحد توان است؟", instructions: "", marks: 2, order: 1, options: [{ id: "o1", text: "وات", order: 1 }, { id: "o2", text: "ژول", order: 2 }] },
    { id: "q2", type: "short_answer", text: "توان را تعریف کنید.", instructions: "", marks: 2, order: 2, options: [] },
  ],
  answers: [
    { id: "a2", question_id: "q2", selected_option_ids: [], text: "نسخهٔ قدیمی روی سرور", answered: true, is_flagged: false, updated_at: "2026-10-01T08:04:00.000Z" },
  ],
};

beforeEach(async () => {
  listAvailable.mockReset().mockResolvedValue([available]);
  detail.mockReset().mockResolvedValue(attemptDto);
  saveAnswer.mockReset().mockResolvedValue({ id: "a2", question_id: "q2", selected_option_ids: [], text: "نوشتهٔ ذخیره‌نشده", answered: true, is_flagged: false, updated_at: SERVER_TIME });
  saveAnswers.mockReset().mockResolvedValue([]);
  setFlag.mockReset().mockResolvedValue({});
  useExamAttemptStore.setState({ attempt: null });
  await dropAllJournals();
});

afterEach(async () => {
  useExamAttemptStore.setState({ attempt: null });
  await dropAllJournals();
});

describe("a reload after answers were written offline", () => {
  it("brings the unsent answer back from disk and sends it without the student retyping", async () => {
    await writeJournal({
      attemptId: "attempt-1", examId: "exam-1", answerRevision: 5, serverRevision: 2,
      pendingAnswerQuestionIds: ["q2"], pendingFlagQuestionIds: [],
      answers: { q2: { value: "نوشتهٔ ذخیره‌نشده", flagged: false, updatedAt: "2026-10-01T08:09:00.000Z" } },
      savedAt: "2026-10-01T08:09:01.000Z",
    });

    render(<StudentExamSession examId="exam-1" mode="start"/>);

    // The runner comes up on the question the student was writing.
    await waitFor(() => expect(useExamAttemptStore.getState().attempt?.answers.q2?.value).toBe("نوشتهٔ ذخیره‌نشده"));
    const restored = useExamAttemptStore.getState().attempt!;
    expect(restored.pendingAnswerQuestionIds).toEqual(["q2"]);

    // …and the autosave flushes it on its own, with the value from disk, not the stale one from the server.
    await waitFor(() => {
      const written = saveAnswer.mock.calls.some(([, questionId, payload]) => questionId === "q2" && (payload as { text?: string }).text === "نوشتهٔ ذخیره‌نشده");
      expect(written).toBe(true);
    }, { timeout: 3000 });
  });

  it("leaves the server's copy alone for a question that had nothing unsent", async () => {
    await writeJournal({
      attemptId: "attempt-1", examId: "exam-1", answerRevision: 5, serverRevision: 2,
      pendingAnswerQuestionIds: ["q2"], pendingFlagQuestionIds: [],
      answers: { q2: { value: "نوشتهٔ ذخیره‌نشده", flagged: false, updatedAt: "2026-10-01T08:09:00.000Z" } },
      savedAt: "2026-10-01T08:09:01.000Z",
    });

    render(<StudentExamSession examId="exam-1" mode="start"/>);
    await waitFor(() => expect(useExamAttemptStore.getState().attempt).not.toBeNull());
    await screen.findByText("کدام‌یک واحد توان است؟");
    expect(useExamAttemptStore.getState().attempt!.answers.q1!.value).toBeNull();
  });

  it("does not resurrect a record whose attempt the server has already closed", async () => {
    detail.mockResolvedValue({ ...attemptDto, status: "submitted", submitted_at: SERVER_TIME });
    await writeJournal({
      attemptId: "attempt-1", examId: "exam-1", answerRevision: 5, serverRevision: 2,
      pendingAnswerQuestionIds: ["q2"], pendingFlagQuestionIds: [],
      answers: { q2: { value: "نوشتهٔ ذخیره‌نشده", flagged: false, updatedAt: "2026-10-01T08:09:00.000Z" } },
      savedAt: "2026-10-01T08:09:01.000Z",
    });

    render(<StudentExamSession examId="exam-1" mode="start"/>);
    await waitFor(() => expect(useExamAttemptStore.getState().attempt).not.toBeNull());
    // A submitted sheet is graded from what the server holds; local edits are not offered back to it.
    expect(useExamAttemptStore.getState().attempt!.answers.q2!.value).toBe("نسخهٔ قدیمی روی سرور");
    expect(useExamAttemptStore.getState().attempt!.pendingAnswerQuestionIds).toEqual([]);
  });
});
