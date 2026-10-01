/**
 * The durable half of the autosave promise.
 *
 * The runner already debounces writes and retries them on a ladder. What it could not survive was the tab
 * itself: the unsent queue lived in the Zustand store, so a crash, a closed window or a reload lost answers
 * the server had never received — the one failure this whole engine exists to prevent. This module keeps
 * that queue on disk instead (IndexedDB, not localStorage: bigger, structured, and not stringly typed) so a
 * reload restores exactly the edits that were never acknowledged, and nothing else.
 *
 * Four rules keep it honest:
 *  - It is written only while there is unsent work, and deleted the moment the server accepts the queue.
 *    A record therefore can never resurrect a value the server has already superseded.
 *  - It is never the authority. Where the server answered, the server's copy wins; the journal only
 *    re-applies the questions the client still lists as pending.
 *  - It holds no key, no token and no student identity beyond the attempt id — answers are exam content, and
 *    a record is removed when the session ends for any reason, including signing out on a shared computer.
 *  - It never blocks the exam. Private mode, a disabled store, quota or a corrupt record all degrade to
 *    "in-memory only", which is exactly where this feature started.
 */

import type { AnswerValue, ExamAttempt } from "@/lib/types/domain";

export interface JournalAnswer {
  value: AnswerValue;
  flagged: boolean;
  updatedAt: string;
}

export interface JournalRecord {
  attemptId: string;
  examId: string;
  /** The client's edit counter when the snapshot was taken; restored as a floor, never as a server number. */
  answerRevision: number;
  serverRevision?: number;
  pendingAnswerQuestionIds: string[];
  pendingFlagQuestionIds: string[];
  answers: Record<string, JournalAnswer>;
  savedAt: string;
}

const DB_NAME = "examora-exam-journal";
const DB_VERSION = 1;
const STORE = "journal";

let databasePromise: Promise<IDBDatabase | null> | null = null;

function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    // Some privacy modes throw on the property access itself.
    return false;
  }
}

/**
 * Open once per page and keep the handle.
 *
 * A refusal resolves to `null` rather than rejecting, because every caller treats "no storage" as a normal
 * state and the exam must not see a rejected promise it has to remember to catch.
 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (!storageAvailable()) return Promise.resolve(null);
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase | null>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "attemptId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return databasePromise;
}

/** One transaction, one result. Writes resolve on `complete`, so a late abort is not read as success. */
async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise<T | null>((resolve) => {
    let value: T | null = null;
    try {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      request.onsuccess = () => { value = (request.result as T) ?? null; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}

function asAnswers(value: unknown): Record<string, JournalAnswer> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const answers: Record<string, JournalAnswer> = {};
  for (const [questionId, raw] of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const candidate = raw as { value?: unknown; flagged?: unknown; updatedAt?: unknown };
    // `null` is a legitimate answer value (blank), so the check is on the *type* of the three fields.
    const acceptable = candidate.value === null || typeof candidate.value === "string" || typeof candidate.value === "boolean" || Array.isArray(candidate.value);
    if (!acceptable || typeof candidate.flagged !== "boolean") return null;
    answers[questionId] = {
      value: candidate.value as AnswerValue,
      flagged: candidate.flagged,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
    };
  }
  return answers;
}

/**
 * A record is only ever written by this module, but storage outlives code: a shape from an older build, a
 * half-written value or a hand-edited profile must be ignored rather than throw inside an exam.
 */
function parseRecord(raw: unknown): JournalRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const attemptId = candidate.attemptId;
  const examId = candidate.examId;
  if (typeof attemptId !== "string" || !attemptId || typeof examId !== "string") return null;
  const pendingAnswerQuestionIds = asStringArray(candidate.pendingAnswerQuestionIds);
  const pendingFlagQuestionIds = asStringArray(candidate.pendingFlagQuestionIds);
  const answers = asAnswers(candidate.answers);
  if (!pendingAnswerQuestionIds || !pendingFlagQuestionIds || !answers) return null;
  return {
    attemptId,
    examId,
    answerRevision: typeof candidate.answerRevision === "number" && Number.isFinite(candidate.answerRevision) ? candidate.answerRevision : 0,
    serverRevision: typeof candidate.serverRevision === "number" && Number.isFinite(candidate.serverRevision) ? candidate.serverRevision : undefined,
    pendingAnswerQuestionIds,
    pendingFlagQuestionIds,
    answers,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date(0).toISOString(),
  };
}

/**
 * What this attempt is currently holding unsent, or `null` when there is nothing to keep.
 *
 * Pure on purpose: the storage layer above is thin glue, and this is the rule that decides whether a record
 * exists at all, so it is the part worth testing without a browser.
 *
 * A draft (a `local-…` attempt the student has not started on the server yet) is deliberately not kept: it
 * has no server identity to be reattached to, and the start screen rebuilds it from the exam itself.
 */
export function journalRecordFor(attempt: ExamAttempt | null | undefined): JournalRecord | null {
  if (!attempt || !attempt.id || attempt.id.startsWith("local-")) return null;
  // Only a session that can still be written to is worth keeping. A submitted attempt has been graded from
  // what the server holds; restoring local edits for it would only offer the student work that cannot land.
  if (attempt.status !== "in_progress" && attempt.status !== "expired") return null;
  const pendingAnswerQuestionIds = [...new Set(attempt.pendingAnswerQuestionIds ?? [])];
  const pendingFlagQuestionIds = [...new Set(attempt.pendingFlagQuestionIds ?? [])];
  if (!pendingAnswerQuestionIds.length && !pendingFlagQuestionIds.length) return null;
  const answers: Record<string, JournalAnswer> = {};
  for (const questionId of new Set([...pendingAnswerQuestionIds, ...pendingFlagQuestionIds])) {
    const answer = attempt.answers[questionId];
    if (!answer) continue;
    answers[questionId] = { value: answer.value, flagged: answer.flagged, updatedAt: answer.updatedAt };
  }
  // Nothing resolvable to keep: writing an empty record would only be restored as a no-op later.
  if (!Object.keys(answers).length) return null;
  return {
    attemptId: attempt.id,
    examId: attempt.examId,
    answerRevision: attempt.answerRevision,
    serverRevision: attempt.serverRevision,
    pendingAnswerQuestionIds,
    pendingFlagQuestionIds,
    answers,
    savedAt: new Date().toISOString(),
  };
}

/** Keep the unsent work of one attempt. Resolves either way; a failed write is not the student's problem. */
export async function writeJournal(record: JournalRecord): Promise<void> {
  await run("readwrite", (store) => store.put(record));
}

export async function readJournal(attemptId: string): Promise<JournalRecord | null> {
  if (!attemptId) return null;
  return parseRecord(await run<unknown>("readonly", (store) => store.get(attemptId)));
}

export async function dropJournal(attemptId: string): Promise<void> {
  if (!attemptId) return;
  await run("readwrite", (store) => store.delete(attemptId));
}

/**
 * Every record, gone. Used when a session ends for reasons that outlive the exam: signing out, a refused
 * token, a password change. School computers are shared, and unsent answers are still somebody's exam.
 */
export async function dropAllJournals(): Promise<void> {
  await run("readwrite", (store) => store.clear());
}
