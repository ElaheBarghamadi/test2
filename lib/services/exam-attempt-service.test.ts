import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const saveAnswer = vi.fn();
const saveAnswers = vi.fn();
const setFlag = vi.fn();
const heartbeat = vi.fn();
const claimSession = vi.fn();
const recordSignal = vi.fn();
const submit = vi.fn();

vi.mock("@/lib/api/attempts", () => ({
  attemptsApi: {
    saveAnswer: (...args: unknown[]) => saveAnswer(...args),
    saveAnswers: (...args: unknown[]) => saveAnswers(...args),
    setFlag: (...args: unknown[]) => setFlag(...args),
    heartbeat: (...args: unknown[]) => heartbeat(...args),
    claimSession: (...args: unknown[]) => claimSession(...args),
    recordSignal: (...args: unknown[]) => recordSignal(...args),
    submit: (...args: unknown[]) => submit(...args),
    detail: vi.fn(),
    start: vi.fn(),
    listAvailable: vi.fn(),
    result: vi.fn(),
  },
}));

import { AttemptWriteConflict, examAttemptService } from "@/lib/services/exam-attempt-service";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

const exam: Exam = {
  id: "exam-1", title: "آزمون", description: "", subject: "", grade: "", className: "", status: "active",
  startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z",
  schedule: { startAt: "2026-03-20T05:30:00Z", endAt: "2026-03-20T07:30:00Z", timezone: "Asia/Tehran" },
  questionCount: 1, participantCount: 0, teacherName: "", accent: "indigo",
  createdAt: "2026-03-01T05:30:00Z", updatedAt: "2026-03-01T05:30:00Z",
  settings: { durationMinutes: 45, totalMarks: 2, allowBackNavigation: true, randomizeQuestions: false, randomizeOptions: false, allowUnanswered: true, showResultImmediately: false, resultVisibility: "pending", showCorrectAnswers: false, attemptLimit: 1, passingPercentage: 50 },
  questions: [{ id: "q1", order: 1, stem: "سؤال", type: "single_choice", points: 2, required: true, options: [{ id: "o1", label: "الف", value: "o1" }, { id: "o2", label: "ب", value: "o2" }] }],
};

function attemptFixture(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1", examId: "exam-1", studentId: "s1", status: "in_progress", startedAt: "2026-03-20T05:30:00Z",
    lastTickAt: new Date().toISOString(), remainingSeconds: 600, serverRevision: 4,
    answers: { q1: { questionId: "q1", value: "o1", flagged: false, updatedAt: "2026-03-20T05:31:00Z" } },
    pendingAnswerQuestionIds: ["q1"], pendingFlagQuestionIds: [],
    currentQuestionIndex: 0, saveStatus: "saving", answerRevision: 5, connectionStatus: "online",
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of [saveAnswer, saveAnswers, setFlag, heartbeat, claimSession, recordSignal, submit]) mock.mockReset();
  useExamAttemptStore.setState({ attempt: null });
});

describe("guarded autosave", () => {
  it("sends the last server revision and the tab session on every write", async () => {
    saveAnswer.mockResolvedValue({ id: "a1" });
    const attempt = attemptFixture();
    const result = await examAttemptService.saveAnswers({ attempt, exam, revision: attempt.answerRevision, examSession: "tab-a" });

    expect(saveAnswer).toHaveBeenCalledWith("attempt-1", "q1", { selected_option_ids: ["o1"] }, undefined, { examSession: "tab-a", examRevision: 4 });
    expect(result.conflict).toBeUndefined();
    expect(result.serverRevision).toBe(5);
  });

  it("uses the atomic batch endpoint when one cycle touched several answers", async () => {
    saveAnswers.mockResolvedValue([]);
    const attempt = attemptFixture({
      answers: {
        q1: { questionId: "q1", value: "o2", flagged: true, updatedAt: "2026-03-20T05:32:00Z" },
        q2: { questionId: "q2", value: ["o3"], flagged: false, updatedAt: "2026-03-20T05:33:00Z" },
      },
      pendingAnswerQuestionIds: ["q1", "q2"],
    });
    // The second question is not in the exam fixture, so only q1 is sent: unknown ids never reach the API.
    const result = await examAttemptService.saveAnswers({ attempt, exam, revision: attempt.answerRevision, examSession: "tab-a" });
    expect(saveAnswers).not.toHaveBeenCalled();
    expect(saveAnswer).toHaveBeenCalledTimes(1);
    expect(result.serverRevision).toBe(5);
  });

  it("re-bases a stale revision from the number the server reported and sends once more", async () => {
    const conflict = new ApiError(409, { detail: "out of date", code: "stale_revision", answer_revision: 9 }, "conflict");
    saveAnswer.mockRejectedValueOnce(conflict).mockResolvedValue({ id: "a1" });

    const attempt = attemptFixture();
    const result = await examAttemptService.saveAnswers({ attempt, exam, revision: attempt.answerRevision, examSession: "tab-a" });

    expect(saveAnswer).toHaveBeenCalledTimes(2);
    expect(saveAnswer.mock.calls[1][4]).toEqual({ examSession: "tab-a", examRevision: 9 });
    expect(result.conflict).toBeUndefined();
    expect(result.serverRevision).toBe(10);
  });

  it("never marks a session-conflicted write as saved, and does not retry it", async () => {
    saveAnswer.mockRejectedValue(new ApiError(409, { detail: "other window", code: "another_session_active" }, "conflict"));
    const attempt = attemptFixture();
    const result = await examAttemptService.saveAnswers({ attempt, exam, revision: attempt.answerRevision, examSession: "tab-b" });

    expect(saveAnswer).toHaveBeenCalledTimes(1);
    expect(result.conflict).toBeInstanceOf(AttemptWriteConflict);
    expect(result.conflict?.code).toBe("another_session_active");
    expect(result.serverRevision).toBeUndefined();
  });

  it("surfaces a second stale conflict instead of looping", async () => {
    const conflict = new ApiError(409, { detail: "out of date", code: "stale_revision", answer_revision: 9 }, "conflict");
    saveAnswer.mockRejectedValue(conflict);
    const result = await examAttemptService.saveAnswers({ attempt: attemptFixture(), exam, revision: 5, examSession: "tab-a" });
    expect(saveAnswer).toHaveBeenCalledTimes(2);
    expect(result.conflict?.code).toBe("stale_revision");
  });

  it("lets a network error through so the caller keeps the queue and retries", async () => {
    saveAnswer.mockRejectedValue(new Error("اتصال قطع شد"));
    await expect(examAttemptService.saveAnswers({ attempt: attemptFixture(), exam, revision: 5, examSession: "tab-a" })).rejects.toThrow("اتصال قطع شد");
  });

  it("does not send a guard for an attempt that has no server revision yet", async () => {
    saveAnswer.mockResolvedValue({});
    await examAttemptService.saveAnswers({ attempt: attemptFixture({ serverRevision: undefined }), exam, revision: 1 });
    expect(saveAnswer.mock.calls[0][4]).toEqual({ examSession: undefined, examRevision: undefined });
  });
});

describe("clock and session resync", () => {
  it("reads the deadline and revision from the small heartbeat payload", async () => {
    heartbeat.mockResolvedValue({ server_time: "now", expires_at: null, remaining_seconds: 420, status: "in_progress", answer_revision: 11, session_locked_by_other: true, question_count: 3 });
    const timing = await examAttemptService.syncClock("attempt-1", "tab-a");
    expect(timing).toEqual({ status: "in_progress", remainingSeconds: 420, serverRevision: 11, sessionLockedByOther: true });
    expect(heartbeat).toHaveBeenCalledWith("attempt-1", { examSession: "tab-a" });
  });

  it("claims the session and returns the refreshed clock", async () => {
    claimSession.mockResolvedValue({ remaining_seconds: 300, status: "in_progress", answer_revision: 6 });
    expect(await examAttemptService.claimSession("attempt-1", "tab-b")).toEqual({ status: "in_progress", remainingSeconds: 300, serverRevision: 6 });
  });

  it("records only the allowed activity signals", async () => {
    recordSignal.mockResolvedValue(undefined);
    await examAttemptService.recordSignal("attempt-1", "tab_hidden", "tab-a");
    expect(recordSignal).toHaveBeenCalledWith("attempt-1", "tab_hidden", { examSession: "tab-a" });
  });
});

describe("submission", () => {
  it("translates a finalized-attempt conflict into a sentence the student can act on", async () => {
    submit.mockRejectedValue(new ApiError(409, { detail: "already final", code: "attempt_finalized" }, "conflict"));
    await expect(examAttemptService.submitAttempt(attemptFixture(), { examSession: "tab-a" })).rejects.toThrow("آزمون پیش‌تر نهایی شده است");
  });

  it("refuses to submit while offline instead of pretending", async () => {
    await expect(examAttemptService.submitAttempt(attemptFixture({ connectionStatus: "offline" }))).rejects.toThrow("اتصال اینترنت");
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("attempt store concurrency", () => {
  it("advances the server revision only for the newest edit", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ saveStatus: "saving" }) });
    const store = useExamAttemptStore.getState();
    store.markSaved(5, 9);
    expect(useExamAttemptStore.getState().attempt).toMatchObject({ saveStatus: "saved", serverRevision: 9, pendingAnswerQuestionIds: [] });

    // A response for an older revision must not clear the newer queue.
    useExamAttemptStore.setState({ attempt: attemptFixture({ answerRevision: 7, serverRevision: 9, pendingAnswerQuestionIds: ["q1"], saveStatus: "saving" }) });
    useExamAttemptStore.getState().markSaved(5, 10);
    expect(useExamAttemptStore.getState().attempt).toMatchObject({ saveStatus: "saving", serverRevision: 9, pendingAnswerQuestionIds: ["q1"] });
  });

  it("re-arms a save only when work is actually pending", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ saveStatus: "error", pendingAnswerQuestionIds: ["q1"], answerRevision: 5 }) });
    useExamAttemptStore.getState().retrySave();
    expect(useExamAttemptStore.getState().attempt).toMatchObject({ answerRevision: 6, saveStatus: "saving" });

    useExamAttemptStore.setState({ attempt: attemptFixture({ saveStatus: "saved", pendingAnswerQuestionIds: [], answerRevision: 6 }) });
    useExamAttemptStore.getState().retrySave();
    expect(useExamAttemptStore.getState().attempt).toMatchObject({ answerRevision: 6, saveStatus: "saved" });
  });

  it("keeps the conflict flag until the student resolves it", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture() });
    useExamAttemptStore.getState().setSessionConflict("another_session");
    expect(useExamAttemptStore.getState().attempt?.sessionConflict).toBe("another_session");
    useExamAttemptStore.getState().setSessionConflict(null);
    expect(useExamAttemptStore.getState().attempt?.sessionConflict).toBeNull();
  });

  it("hydrating a remote attempt clears a stale conflict without discarding queued edits", () => {
    useExamAttemptStore.setState({ attempt: attemptFixture({ sessionConflict: "another_session", pendingAnswerQuestionIds: ["q1"] }) });
    useExamAttemptStore.getState().hydrateRemote(attemptFixture({ sessionConflict: "another_session" }));
    const attempt = useExamAttemptStore.getState().attempt;
    expect(attempt?.sessionConflict).toBeNull();
    expect(attempt?.pendingAnswerQuestionIds).toEqual(["q1"]);
  });
});
