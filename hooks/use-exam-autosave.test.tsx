import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { dropAllJournals, readJournal, writeJournal } from "@/lib/exam/answer-journal";
import { useExamAutosave } from "@/hooks/use-exam-autosave";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

/**
 * The promise this feature makes, tested end to end at the hook: an edit that has not reached the server is
 * on disk before the tab can disappear, and it leaves the disk the moment the server owns it.
 *
 * The service is mocked, because the question here is not whether Django accepts a write — the attempt
 * engine's own tests cover that — but whether the browser keeps the answer while Django cannot be asked.
 */

const saveAnswers = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/exam-attempt-service", () => ({
  examAttemptService: { saveAnswers: (...args: unknown[]) => saveAnswers(...args) },
}));

const exam = {
  id: "exam-1", title: "آزمون زیست", questions: [], settings: { durationMinutes: 45 },
} as unknown as Exam;

function attempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1", examId: "exam-1", studentId: "s1", status: "in_progress",
    startedAt: "2026-10-01T08:00:00.000Z", lastTickAt: "2026-10-01T08:10:00.000Z", remainingSeconds: 600,
    answers: {
      q1: { questionId: "q1", value: "o1", flagged: false, updatedAt: "2026-10-01T08:05:00.000Z" },
      q2: { questionId: "q2", value: "نوشتهٔ دانش‌آموز", flagged: true, updatedAt: "2026-10-01T08:06:00.000Z" },
    },
    currentQuestionIndex: 1, saveStatus: "saving", answerRevision: 3, serverRevision: 2, connectionStatus: "online",
    pendingAnswerQuestionIds: ["q2"], pendingFlagQuestionIds: ["q2"],
    ...overrides,
  };
}

const markSaved = vi.fn();
const markSaveFailed = vi.fn();

function mount(live: ExamAttempt | null, options: Parameters<typeof useExamAutosave>[4] = {}) {
  return renderHook(() => useExamAutosave(live, exam, markSaved, markSaveFailed, options));
}

beforeEach(async () => {
  saveAnswers.mockReset().mockResolvedValue({ serverRevision: 3 });
  markSaved.mockReset();
  markSaveFailed.mockReset();
  await dropAllJournals();
});
afterEach(async () => { await dropAllJournals(); });

describe("useExamAutosave and the durable queue", () => {
  it("puts the unsent answers on disk, without waiting for the server", async () => {
    mount(attempt({ connectionStatus: "offline" }));
    await waitFor(async () => {
      const kept = await readJournal("attempt-1");
      expect(kept).not.toBeNull();
      expect(kept?.answers.q2).toEqual({ value: "نوشتهٔ دانش‌آموز", flagged: true, updatedAt: "2026-10-01T08:06:00.000Z" });
    }, { timeout: 2000 });
    // Offline means no write was attempted at all, which is exactly the case the journal exists for.
    expect(saveAnswers).not.toHaveBeenCalled();
  });

  it("keeps the answer when the write reaches the server and fails", async () => {
    saveAnswers.mockRejectedValue(new Error("network down"));
    mount(attempt());
    await waitFor(() => expect(markSaveFailed).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(async () => expect(await readJournal("attempt-1")).not.toBeNull(), { timeout: 2000 });
  });

  it("gives the disk copy up the moment the server accepts the queue", async () => {
    // A record left behind here is the one dangerous state: the next load would restore an answer the
    // server has already superseded.
    await writeJournal({
      attemptId: "attempt-1", examId: "exam-1", answerRevision: 1,
      pendingAnswerQuestionIds: ["q2"], pendingFlagQuestionIds: [], answers: { q2: { value: "قدیمی", flagged: false, updatedAt: "2026-10-01T08:06:00.000Z" } },
      savedAt: "2026-10-01T08:06:01.000Z",
    });
    mount(attempt({ pendingAnswerQuestionIds: [], pendingFlagQuestionIds: [], saveStatus: "saved" }));
    await waitFor(async () => expect(await readJournal("attempt-1")).toBeNull(), { timeout: 2000 });
  });

  it("never journals a draft that has no server identity", async () => {
    mount(attempt({ id: "local-exam-1" }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await readJournal("local-exam-1")).toBeNull();
  });

  it("never journals a sheet that is already final", async () => {
    mount(attempt({ status: "submitted" }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await readJournal("attempt-1")).toBeNull();
  });
});
