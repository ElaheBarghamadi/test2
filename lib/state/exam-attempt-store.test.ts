import { beforeEach, describe, expect, it } from "vitest";
import { journalRecordFor, type JournalRecord } from "@/lib/exam/answer-journal";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import type { ExamAttempt } from "@/lib/types/domain";

/**
 * Restoring a journal is the one moment where a local copy is allowed to beat the server's. It is therefore
 * allowed to beat it for *exactly* what the record names and nothing more, and only while the window is
 * still open — the tests below pin both halves of that sentence.
 */

const store = () => useExamAttemptStore.getState();

function serverAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    examId: "exam-1",
    studentId: "s1",
    status: "in_progress",
    startedAt: "2026-10-01T08:00:00.000Z",
    lastTickAt: "2026-10-01T08:10:00.000Z",
    remainingSeconds: 900,
    answers: {
      // What the server already accepted for q1 and q2.
      q1: { questionId: "q1", value: "option-a", flagged: false, updatedAt: "2026-10-01T08:04:00.000Z" },
      q2: { questionId: "q2", value: "پاسخ قدیمی", flagged: false, updatedAt: "2026-10-01T08:04:10.000Z" },
    },
    currentQuestionIndex: 1,
    saveStatus: "saved",
    answerRevision: 1,
    serverRevision: 1,
    connectionStatus: "online",
    ...overrides,
  };
}

const journal: JournalRecord = {
  attemptId: "attempt-1",
  examId: "exam-1",
  answerRevision: 7,
  serverRevision: 1,
  pendingAnswerQuestionIds: ["q2"],
  pendingFlagQuestionIds: ["q2"],
  answers: { q2: { value: "پاسخ ویرایش‌شده", flagged: true, updatedAt: "2026-10-01T08:09:00.000Z" } },
  savedAt: "2026-10-01T08:09:01.000Z",
};

function load(attempt: ExamAttempt | null) {
  store().hydrateRemote(attempt ?? serverAttempt());
  if (attempt === null) useExamAttemptStore.setState({ attempt: null });
}

beforeEach(() => { useExamAttemptStore.setState({ attempt: null }); });

describe("restoreJournal", () => {
  it("takes back the unsent edit and re-arms the autosave", () => {
    load(serverAttempt());
    store().restoreJournal(journal);
    const attempt = store().attempt!;
    expect(attempt.answers.q2!.value).toBe("پاسخ ویرایش‌شده");
    expect(attempt.answers.q2!.flagged).toBe(true);
    expect(attempt.pendingAnswerQuestionIds).toEqual(["q2"]);
    expect(attempt.pendingFlagQuestionIds).toEqual(["q2"]);
    // "saving" is what the autosave effect listens for; without it the restored answer would sit there
    // until the student typed something else.
    expect(attempt.saveStatus).toBe("saving");
    expect(attempt.answerRevision).toBeGreaterThan(journal.answerRevision);
  });

  it("leaves every question the record does not name exactly as the server has it", () => {
    load(serverAttempt());
    store().restoreJournal(journal);
    expect(store().attempt!.answers.q1!.value).toBe("option-a");
    expect(store().attempt!.pendingAnswerQuestionIds).not.toContain("q1");
  });

  it("restores a flag without touching the answer the server holds", () => {
    // A flag-only edit is a legitimate unsent change; the value beside it is not the student's to reclaim.
    load(serverAttempt());
    store().restoreJournal({ ...journal, pendingAnswerQuestionIds: [], answers: { q2: { value: "چیزی که هرگز ذخیره نشده", flagged: true, updatedAt: "2026-10-01T08:09:00.000Z" } } });
    const attempt = store().attempt!;
    expect(attempt.answers.q2!.flagged).toBe(true);
    expect(attempt.answers.q2!.value).toBe("پاسخ قدیمی");
    expect(attempt.pendingAnswerQuestionIds).toEqual([]);
    expect(attempt.pendingFlagQuestionIds).toEqual(["q2"]);
  });

  it("ignores a record that belongs to another attempt", () => {
    load(serverAttempt());
    store().restoreJournal({ ...journal, attemptId: "attempt-2" });
    expect(store().attempt!.answers.q2!.value).toBe("پاسخ قدیمی");
    expect(store().attempt!.pendingAnswerQuestionIds).toEqual([]);
  });

  it("ignores a record whose window has closed", () => {
    // A submitted sheet is graded from what the server holds; offering the student local edits would be a
    // promise the API cannot keep.
    load(serverAttempt({ status: "submitted" }));
    store().restoreJournal(journal);
    expect(store().attempt!.answers.q2!.value).toBe("پاسخ قدیمی");
    expect(store().attempt!.saveStatus).toBe("saved");
  });

  it("keeps the edit on disk but does not pretend it is being sent while the tab is offline", () => {
    load(serverAttempt({ connectionStatus: "offline" }));
    store().restoreJournal(journal);
    expect(store().attempt!.answers.q2!.value).toBe("پاسخ ویرایش‌شده");
    expect(store().attempt!.saveStatus).toBe("saved_locally");
  });

  it("does nothing at all when the record is empty", () => {
    load(serverAttempt());
    store().restoreJournal({ ...journal, pendingAnswerQuestionIds: [], pendingFlagQuestionIds: [], answers: {} });
    expect(store().attempt!.answerRevision).toBe(1);
    expect(store().attempt!.saveStatus).toBe("saved");
  });

  it("skips ids the current paper no longer has instead of queueing a write the server would refuse", () => {
    load(serverAttempt());
    store().restoreJournal({ ...journal, pendingAnswerQuestionIds: ["q2", "deleted-question"] });
    expect(store().attempt!.pendingAnswerQuestionIds).toEqual(["q2"]);
  });

  it("closes the loop: what it restores is what the journal wanted kept, and an accepted write empties it", () => {
    load(serverAttempt());
    store().restoreJournal(journal);
    const restored = store().attempt!;
    expect(journalRecordFor(restored)).not.toBeNull();
    // The write goes out and the server accepts it at the revision the client was holding.
    store().markSaved(restored.answerRevision, 2);
    expect(journalRecordFor(store().attempt!)).toBeNull();
  });
});
