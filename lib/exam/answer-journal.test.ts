import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dropAllJournals,
  dropJournal,
  journalRecordFor,
  readJournal,
  writeJournal,
  type JournalRecord,
} from "@/lib/exam/answer-journal";
import type { ExamAttempt } from "@/lib/types/domain";

/**
 * The durable queue is the difference between "the answers are in a JavaScript object" and "the answers
 * survive the browser dying". These tests pin the two properties that make it safe to keep at all: a record
 * exists only while something is genuinely unsent, and a record that cannot be read safely is ignored.
 */

function attempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    examId: "exam-1",
    studentId: "s1",
    status: "in_progress",
    startedAt: "2026-10-01T08:00:00.000Z",
    lastTickAt: "2026-10-01T08:10:00.000Z",
    remainingSeconds: 1200,
    answers: {
      q1: { questionId: "q1", value: "option-b", flagged: false, updatedAt: "2026-10-01T08:05:00.000Z" },
      q2: { questionId: "q2", value: "پاسخ من", flagged: true, updatedAt: "2026-10-01T08:06:00.000Z" },
      q3: { questionId: "q3", value: null, flagged: false, updatedAt: "2026-10-01T08:00:00.000Z" },
    },
    currentQuestionIndex: 1,
    saveStatus: "saving",
    answerRevision: 4,
    serverRevision: 2,
    connectionStatus: "online",
    pendingAnswerQuestionIds: ["q1", "q2"],
    pendingFlagQuestionIds: ["q2"],
    ...overrides,
  };
}

const record: JournalRecord = {
  attemptId: "attempt-1",
  examId: "exam-1",
  answerRevision: 4,
  serverRevision: 2,
  pendingAnswerQuestionIds: ["q1", "q2"],
  pendingFlagQuestionIds: ["q2"],
  answers: {
    q1: { value: "option-b", flagged: false, updatedAt: "2026-10-01T08:05:00.000Z" },
    q2: { value: "پاسخ من", flagged: true, updatedAt: "2026-10-01T08:06:00.000Z" },
  },
  savedAt: "2026-10-01T08:06:01.000Z",
};

beforeEach(async () => { await dropAllJournals(); });
afterEach(async () => { await dropAllJournals(); });

describe("journalRecordFor", () => {
  it("keeps only the questions that are still unsent", () => {
    const kept = journalRecordFor(attempt());
    expect(kept?.attemptId).toBe("attempt-1");
    // q3 was never edited; a journal that copied the whole sheet would restore nothing but would risk
    // restoring stale values if the record outlived its attempt.
    expect(Object.keys(kept?.answers ?? {})).toEqual(["q1", "q2"]);
    expect(kept?.pendingAnswerQuestionIds).toEqual(["q1", "q2"]);
    expect(kept?.pendingFlagQuestionIds).toEqual(["q2"]);
  });

  it("keeps nothing once the server has accepted the queue", () => {
    // This is the rule that stops a reload from resurrecting an answer that is already saved.
    expect(journalRecordFor(attempt({ pendingAnswerQuestionIds: [], pendingFlagQuestionIds: [] }))).toBeNull();
  });

  it("keeps nothing for a draft that has no server identity yet", () => {
    expect(journalRecordFor(attempt({ id: "local-exam-1" }))).toBeNull();
  });

  it("keeps nothing for an attempt that can no longer be written to", () => {
    for (const status of ["not_started", "submitting", "submitted"] as const) {
      expect(journalRecordFor(attempt({ status }))).toBeNull();
    }
    // An expired attempt is still worth keeping: the review screen can submit it, and the flush happens then.
    expect(journalRecordFor(attempt({ status: "expired" }))).not.toBeNull();
  });

  it("does not duplicate a question queued for both its answer and its flag", () => {
    const kept = journalRecordFor(attempt({ pendingAnswerQuestionIds: ["q1", "q1"], pendingFlagQuestionIds: ["q1"] }));
    expect(kept?.pendingAnswerQuestionIds).toEqual(["q1"]);
    expect(Object.keys(kept?.answers ?? {})).toEqual(["q1"]);
  });
});

describe("the on-disk journal", () => {
  it("round-trips one attempt's unsent work, Persian text and all", async () => {
    await writeJournal(record);
    expect(await readJournal("attempt-1")).toEqual(record);
  });

  it("answers `null` for an attempt it has never seen", async () => {
    expect(await readJournal("attempt-404")).toBeNull();
    expect(await readJournal("")).toBeNull();
  });

  it("keeps attempts apart instead of merging one student's work into another's", async () => {
    await writeJournal(record);
    await writeJournal({ ...record, attemptId: "attempt-2", answers: { q9: { value: ["a", "b"], flagged: false, updatedAt: "2026-10-01T08:07:00.000Z" } } });
    expect(Object.keys((await readJournal("attempt-1"))?.answers ?? {})).toEqual(["q1", "q2"]);
    expect(Object.keys((await readJournal("attempt-2"))?.answers ?? {})).toEqual(["q9"]);
  });

  it("drops one attempt, and every attempt", async () => {
    await writeJournal(record);
    await writeJournal({ ...record, attemptId: "attempt-2" });
    await dropJournal("attempt-1");
    expect(await readJournal("attempt-1")).toBeNull();
    expect(await readJournal("attempt-2")).not.toBeNull();
    await dropAllJournals();
    expect(await readJournal("attempt-2")).toBeNull();
  });

  it("ignores a record it cannot trust rather than throwing inside an exam", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("examora-exam-journal", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve) => {
      const transaction = database.transaction("journal", "readwrite");
      const store = transaction.objectStore("journal");
      // Values a real browser can hold: a shape from an older build, and something that is not an object.
      store.put({ attemptId: "broken-1", examId: "exam-1", answers: "not-an-object" });
      store.put({ attemptId: "broken-2", examId: "exam-1", answers: { q1: { value: {}, flagged: "yes" } } });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => resolve();
    });
    expect(await readJournal("broken-1")).toBeNull();
    expect(await readJournal("broken-2")).toBeNull();
    database.close();
  });

  it("stays a no-op when the browser refuses storage at all", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    // A private window that throws on access, and a runtime that simply has no IndexedDB.
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, get() { throw new Error("blocked by policy"); } });
    await expect(writeJournal(record)).resolves.toBeUndefined();
    await expect(readJournal("attempt-1")).resolves.toBeNull();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    await expect(writeJournal(record)).resolves.toBeUndefined();
    await expect(readJournal("attempt-1")).resolves.toBeNull();
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else delete (globalThis as Record<string, unknown>).indexedDB;
  });
});
