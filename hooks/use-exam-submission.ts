"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Exam } from "@/lib/types/domain";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { useToastStore } from "@/lib/state/toast-store";

/**
 * One finalisation path for the review button and for the "time is up" auto-submit.
 *
 * Queued answers are flushed first — and if the server refuses them the submit is *not* forced through,
 * because submitting an answer sheet the server has not accepted would grade a stale sheet. Django's
 * submit is idempotent and finalizes an expired attempt itself, so a duplicate call from a second tab or
 * a retry after a dropped response lands on the same finalized result instead of double-grading.
 */
export function useExamSubmission(exam: Exam, options?: { examSession?: string }) {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const attempt = useExamAttemptStore((state) => state.attempt);
  const markSaved = useExamAttemptStore((state) => state.markSaved);
  const beginSubmission = useExamAttemptStore((state) => state.beginSubmission);
  const finishSubmission = useExamAttemptStore((state) => state.finishSubmission);
  const failSubmission = useExamAttemptStore((state) => state.failSubmission);
  const setSessionConflict = useExamAttemptStore((state) => state.setSessionConflict);
  const inFlight = useRef(false);
  const examSession = options?.examSession;

  return useCallback(async (submitOptions?: { auto?: boolean }): Promise<boolean> => {
    if (!attempt || attempt.examId !== exam.id) return false;
    if (inFlight.current || attempt.status === "submitting" || attempt.status === "submitted") return false;
    if (attempt.id.startsWith("local-")) return false;
    inFlight.current = true;
    const attemptId = attempt.id;
    const revision = attempt.answerRevision;
    try {
      if (attempt.pendingAnswerQuestionIds?.length || attempt.pendingFlagQuestionIds?.length) {
        const flushed = await examAttemptService.saveAnswers({ attempt, exam, revision, examSession });
        if (flushed.conflict && flushed.conflict.code !== "attempt_finalized") {
          // Refusing to submit a sheet the server has not accepted is the safe half of this flow.
          const reason = flushed.conflict.code === "another_session_active"
            ? "نشست در پنجرهٔ دیگری فعال است. پیش از ارسال، همان پنجره را ببندید یا اینجا ادامه دهید."
            : flushed.conflict.message;
          failSubmission(reason);
          if (flushed.conflict.code === "another_session_active") setSessionConflict("another_session");
          toast({ title: "ارسال انجام نشد", description: reason, variant: "error" });
          return false;
        }
        markSaved(revision, flushed.serverRevision);
      }
      beginSubmission();
      await examAttemptService.submitAttempt(attempt, { examSession, trigger: submitOptions?.auto ? "auto" : "manual" });
      finishSubmission();
      setSessionConflict(null);
      toast({
        title: submitOptions?.auto ? "زمان آزمون پایان یافت؛ پاسخ‌ها ارسال شدند" : "آزمون با موفقیت ارسال شد",
        description: submitOptions?.auto ? "همهٔ پاسخ‌های ذخیره‌شده داخل بازهٔ مجاز نمره گرفتند." : "وضعیت نتیجه برای شما آماده است.",
        variant: "success",
      });
      router.push(`/student/results/${attemptId}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ارسال آزمون انجام نشد. لطفاً دوباره تلاش کنید.";
      failSubmission(message);
      toast({
        title: submitOptions?.auto ? "ارسال خودکار انجام نشد" : "ارسال آزمون انجام نشد",
        description: "پاسخ‌های شما محفوظ است؛ اتصال را بررسی کنید و دوباره ارسال کنید.",
        variant: "error",
      });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [attempt, exam.id, beginSubmission, failSubmission, finishSubmission, markSaved, router, setSessionConflict, toast, examSession]);
}
