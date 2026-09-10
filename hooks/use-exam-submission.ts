"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Exam } from "@/lib/types/domain";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { useToastStore } from "@/lib/state/toast-store";

/**
 * One finalisation path for both the review button and the "time is up" auto-submit.
 *
 * Queued answers are flushed first, then the attempt is submitted; Django's submit is idempotent and
 * finalizes expired attempts itself, so a duplicate call from another tab cannot double-grade.
 */
export function useExamSubmission(exam: Exam) {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const attempt = useExamAttemptStore((state) => state.attempt);
  const markSaved = useExamAttemptStore((state) => state.markSaved);
  const beginSubmission = useExamAttemptStore((state) => state.beginSubmission);
  const finishSubmission = useExamAttemptStore((state) => state.finishSubmission);
  const failSubmission = useExamAttemptStore((state) => state.failSubmission);
  const inFlight = useRef(false);

  return useCallback(async (options?: { auto?: boolean }): Promise<boolean> => {
    if (!attempt || attempt.examId !== exam.id) return false;
    if (inFlight.current || attempt.status === "submitting" || attempt.status === "submitted") return false;
    if (attempt.id.startsWith("local-")) return false;
    inFlight.current = true;
    const attemptId = attempt.id;
    const revision = attempt.answerRevision;
    try {
      if (attempt.pendingAnswerQuestionIds?.length || attempt.pendingFlagQuestionIds?.length) {
        await examAttemptService.saveAnswers({ attempt, exam, revision });
        markSaved(revision);
      }
      beginSubmission();
      await examAttemptService.submitAttempt(attempt);
      finishSubmission();
      toast({
        title: options?.auto ? "زمان آزمون پایان یافت؛ پاسخ‌ها ارسال شدند" : "آزمون با موفقیت ارسال شد",
        description: options?.auto ? "همهٔ پاسخ‌های ذخیره‌شده داخل بازهٔ مجاز نمره گرفتند." : "وضعیت نتیجه برای شما آماده است.",
        variant: "success",
      });
      router.push(`/student/results/${attemptId}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ارسال آزمون انجام نشد. لطفاً دوباره تلاش کنید.";
      failSubmission(message);
      toast({ title: "ارسال خودکار ممکن نشد", description: "اتصال را بررسی کنید و از صفحهٔ مرور دوباره ارسال کنید.", variant: "error" });
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [attempt, exam.id, beginSubmission, failSubmission, finishSubmission, markSaved, router, toast]);
}
