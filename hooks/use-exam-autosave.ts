"use client";

import { useEffect } from "react";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import type { Exam, ExamAttempt } from "@/lib/types/domain";

/** Debounced, targeted persistence: only changed answers/flags reach the API. */
export function useExamAutosave(attempt: ExamAttempt | null, exam: Exam, markSaved: (revision: number) => void, markSaveFailed: (revision: number) => void) {
  useEffect(() => {
    if (!attempt || attempt.saveStatus !== "saving" || attempt.connectionStatus === "offline") return;
    const revision = attempt.answerRevision;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void examAttemptService.saveAnswers({ attempt, exam, revision, signal: controller.signal })
        .then(() => markSaved(revision))
        .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) markSaveFailed(revision); });
    }, 350);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [attempt?.answerRevision, attempt?.connectionStatus, attempt?.saveStatus, attempt?.id, attempt?.answers, attempt?.pendingAnswerQuestionIds, attempt?.pendingFlagQuestionIds, exam, markSaved, markSaveFailed]);
}
