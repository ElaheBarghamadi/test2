"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleHelp, ListChecks, Send, ShieldCheck } from "lucide-react";
import type { AnswerValue, Exam } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { AutosaveIndicator } from "@/components/exam/autosave-indicator";
import { ExamProgress } from "@/components/exam/exam-progress";
import { ExamSessionBanner } from "@/components/exam/exam-session-banner";
import { ExamSessionNotice } from "@/components/exam/exam-session-notice";
import { ExamTimer } from "@/components/exam/exam-timer";
import { QuestionCard } from "@/components/exam/question-card";
import { QuestionNavigator } from "@/components/exam/question-navigator";
import { hasAnswer } from "@/components/exam/question-status";
import { useExamAutosave } from "@/hooks/use-exam-autosave";
import { useExamConnection } from "@/hooks/use-exam-connection";
import { useExamKeyboardNavigation } from "@/hooks/use-exam-keyboard-navigation";
import { useExamTimer } from "@/hooks/use-exam-timer";
import { useExamClock } from "@/hooks/use-exam-clock";
import { useExamSession } from "@/hooks/use-exam-session";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { useExamSubmission } from "@/hooks/use-exam-submission";
import { examAttemptService } from "@/lib/services/exam-attempt-service";
import { useToastStore } from "@/lib/state/toast-store";
import { toPersianNumber } from "@/lib/utils";
import { attemptsApi } from "@/lib/api/attempts";
import { toStudentAttempt } from "@/lib/api/mappers";

/** The DOM id a question's card is mounted under, so the map can scroll to it on a one-page sheet. */
function questionAnchor(questionId: string) {
  return `exam-question-${questionId}`;
}

export function ExamWorkspace({ exam }: { exam: Exam }) {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const attempt = useExamAttemptStore((state) => state.attempt);
  const setAnswer = useExamAttemptStore((state) => state.setAnswer);
  const setCurrentQuestion = useExamAttemptStore((state) => state.setCurrentQuestion);
  const toggleFlag = useExamAttemptStore((state) => state.toggleFlag);
  const markSaved = useExamAttemptStore((state) => state.markSaved);
  const markSaveFailed = useExamAttemptStore((state) => state.markSaveFailed);
  const setConnectionStatus = useExamAttemptStore((state) => state.setConnectionStatus);
  const setSessionConflict = useExamAttemptStore((state) => state.setSessionConflict);
  const retrySave = useExamAttemptStore((state) => state.retrySave);
  const reconcileAnswers = useExamAttemptStore((state) => state.reconcileAnswers);
  const setAnswerFrontier = useExamAttemptStore((state) => state.setAnswerFrontier);
  const live = attempt?.examId === exam.id ? attempt : null;
  const examSession = useExamSession(live?.status === "in_progress");
  const [claiming, setClaiming] = useState(false);

  const { tick, sync } = useExamClock(live, examSession);
  useExamTimer(live, tick, sync);

  /**
   * A refusal by the "no going back" rule is not a lost answer: the value on screen was never allowed to
   * exist. Both sides are settled from the server's copy — the refused questions take back what is stored
   * there, the frontier moves to where the server says it is, and the rest of the queue is flushed.
   */
  const onQuestionsLocked = useCallback(async (questionIds: string[]) => {
    if (!live || questionIds.length === 0) return;
    try {
      const fresh = toStudentAttempt(await attemptsApi.detail(live.id, { examSession })).attempt;
      reconcileAnswers(fresh.answers, questionIds, fresh.answerFrontier);
      setAnswerFrontier(fresh.answerFrontier ?? 0);
    } catch {
      // No fresh read available: at least drop the refused ids from the queue so a retry loop cannot form.
      reconcileAnswers(live.answers, questionIds);
    }
    toast({ title: "این سؤال قفل شده است", description: "پاسخی که سرور نگه داشته همان است که نمایش داده می‌شود؛ ویرایش تازه‌ای ثبت نشد." });
  }, [attempt?.answers, examSession, live, reconcileAnswers, setAnswerFrontier, toast]);

  useExamAutosave(live, exam, markSaved, markSaveFailed, {
    examSession,
    retry: retrySave,
    // A refused write is surfaced as a decision, not a red toast: which window owns the attempt is the
    // student's call, and the queue stays dirty until they make it.
    onConflict: (conflict) => {
      if (!conflict) return;
      if (conflict.code === "another_session_active") setSessionConflict("another_session");
      else if (conflict.code === "attempt_finalized") setSessionConflict("finalized");
    },
    onQuestionsLocked,
  });
  useExamConnection(setConnectionStatus);

  useEffect(() => {
    if (live?.status !== "in_progress" || !examSession) return;
    // Reported for the teacher's activity log only. The tab cannot hide what the server already sees,
    // and nothing here changes a score.
    const report = () => void examAttemptService.recordSignal(live.id, document.hidden ? "tab_hidden" : "tab_visible", examSession).catch(() => undefined);
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [examSession, live?.id, live?.status]);

  async function claimSession() {
    if (!live) return;
    setClaiming(true);
    try {
      const claimed = await examAttemptService.claimSession(live.id, examSession);
      useExamAttemptStore.getState().syncClock(claimed.status, claimed.remainingSeconds);
      if (typeof claimed.serverRevision === "number") useExamAttemptStore.getState().acceptRevision(claimed.serverRevision);
      setSessionConflict(null);
      retrySave();
      toast({ title: "آزمون در این پنجره ادامه پیدا می‌کند", description: "پنجرهٔ دیگر دیگر نمی‌تواند روی همین نشست بنویسد.", variant: "success" });
    } catch {
      toast({ title: "گرفتن نشست ممکن نشد", description: "اتصال را بررسی کنید و دوباره تلاش کنید.", variant: "error" });
    } finally {
      setClaiming(false);
    }
  }

  const answered = useMemo(() => attempt ? Object.values(attempt.answers).filter(hasAnswer).length : 0, [attempt]);
  const currentIndex = attempt?.currentQuestionIndex ?? 0;
  const question = exam.questions[currentIndex] ?? exam.questions[0];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === exam.questions.length - 1;
  const isLocked = attempt?.status === "expired" || attempt?.status === "submitting";
  // The teacher's two delivery choices, read together: one page has nothing to go back to, so the
  // no-return rule only describes the paged sheet — exactly as the server enforces it.
  const singlePage = exam.settings.questionLayout === "single_page";
  const noReturn = !exam.settings.allowBackNavigation && !singlePage;
  const frontier = attempt?.answerFrontier ?? 0;
  const indexById = useMemo(() => new Map(exam.questions.map((item, index) => [item.id, index] as const)), [exam.questions]);
  const isQuestionLocked = useCallback((questionId: string) => noReturn && (indexById.get(questionId) ?? 0) < frontier, [frontier, indexById, noReturn]);
  const goTo = useCallback((index: number) => {
    setCurrentQuestion(index);
    if (!singlePage) return;
    const target = exam.questions[index];
    // On a one-page sheet the map is a scroll shortcut, not a page turn.
    if (target) requestAnimationFrame(() => document.getElementById(questionAnchor(target.id))?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [exam.questions, setCurrentQuestion, singlePage]);
  const move = useCallback((direction: "next" | "previous") => {
    const next = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    if (next >= 0 && next < exam.questions.length) goTo(next);
  }, [currentIndex, exam.questions.length, goTo]);
  const updateAnswer = useCallback((value: AnswerValue) => setAnswer(question.id, value), [question.id, setAnswer]);

  useExamKeyboardNavigation({
    question,
    currentValue: attempt?.answers[question.id]?.value ?? null,
    onPrevious: () => move("previous"),
    onNext: () => move("next"),
    onAnswer: updateAnswer,
    // Arrow keys turn pages. On a one-page sheet there are no pages, and the keys would only move an
    // invisible cursor while the student is looking at all of them at once.
    enabled: !!attempt && attempt.status === "in_progress" && !navigatorOpen && !singlePage,
  });
  // When the countdown runs out the exam finalises itself: queued answers are flushed and the
  // attempt is submitted, so a student who never clicks "submit" still keeps every saved answer.
  const submit = useExamSubmission(exam, { examSession });
  const autoSubmittedAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (!attempt || attempt.examId !== exam.id || attempt.status !== "expired") return;
    if (autoSubmittedAttempt.current === attempt.id) return;
    autoSubmittedAttempt.current = attempt.id;
    const attemptId = attempt.id;
    void (async () => {
      // The local countdown can hit zero on an exam the teacher has since extended, so the server
      // decides. A failed read (no connection) must not finalize anything either; the review screen
      // still offers a manual submit, and Django finalizes expired attempts on its own.
      const timing = await sync();
      if (timing && timing.status === "in_progress" && timing.remainingSeconds > 0) {
        autoSubmittedAttempt.current = null;
        toast({ title: "زمان آزمون افزوده شد", description: `${toPersianNumber(Math.ceil(timing.remainingSeconds / 60))} دقیقهٔ تازه برای این آزمون باز شده است.`, variant: "success" });
        return;
      }
      if (timing && timing.status === "submitted") {
        router.push(`/student/results/${attemptId}`);
        return;
      }
      await submit({ auto: true });
    })();
  }, [attempt, exam.id, router, submit, sync, toast]);
  useEffect(() => {
    if (attempt?.status !== "in_progress") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [attempt?.status]);

  if (!attempt || attempt.examId !== exam.id) return <ExamSkeleton/>;
  const saveLine = <AutosaveIndicator status={attempt.saveStatus} className="hidden xl:inline-flex"/>;
  const rulesNote = (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:flex-nowrap">
      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600"/>
      <span>{noReturn ? "پاسخ هر سؤالی که رد می‌کنید ذخیره و قفل می‌شود؛ تا پایان آزمون می‌توانید سؤال‌های بعدی را کامل کنید." : "پاسخ‌ها به‌صورت خودکار ذخیره می‌شوند و پیش از ارسال نهایی قابل ویرایش‌اند."}</span>
    </div>
  );
  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-auto max-w-[1480px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:h-[76px] sm:flex-nowrap sm:px-6">
          <div className="min-w-0"><Link href="/student/dashboard" className="text-[11px] font-bold text-muted-foreground hover:text-primary">خروج از آزمون</Link><h1 className="mt-1 truncate text-sm font-black sm:text-base">{exam.title}</h1></div>
          <div className="order-3 hidden flex-1 justify-center sm:order-none sm:flex"><ExamProgress current={currentIndex + 1} total={exam.questions.length} answered={answered} showPosition={!singlePage}/></div>
          <div className="flex items-center gap-2">
            {attempt.attemptNumber ? <span className="hidden rounded-xl border bg-card px-2.5 py-2 text-[11px] font-bold text-muted-foreground lg:inline-flex">تلاش {toPersianNumber(attempt.attemptNumber)} از {toPersianNumber(exam.settings.attemptLimit)}</span> : null}
            <ExamTimer seconds={attempt.remainingSeconds}/>
          </div>
        </div>
        <div className="border-t px-4 py-2 sm:hidden"><ExamProgress current={currentIndex + 1} total={exam.questions.length} answered={answered} showPosition={!singlePage}/></div>
      </header>
      <main className="mx-auto flex max-w-[1480px] gap-6 px-4 py-5 pb-32 sm:px-6 sm:py-7 xl:pb-10">
        <div className="min-w-0 flex-1">
          <ExamSessionBanner attempt={attempt} onRestoreConnection={() => { setConnectionStatus(navigator.onLine ? "online" : "offline"); if (navigator.onLine) retrySave(); }}/>
          <ExamSessionNotice conflict={attempt.sessionConflict} saveStatus={attempt.saveStatus} claiming={claiming} onClaim={claimSession} onRetry={retrySave}/>
          {singlePage ? (
            <div className="space-y-4">
              {exam.questions.map((item, index) => (
                <div key={item.id} id={questionAnchor(item.id)} className="scroll-mt-28">
                  <QuestionCard
                    question={item}
                    position={index + 1}
                    answer={attempt.answers[item.id]}
                    flagged={attempt.answers[item.id]?.flagged ?? false}
                    onAnswer={(value) => setAnswer(item.id, value)}
                    onToggleFlag={() => toggleFlag(item.id)}
                    disabled={isLocked}
                  />
                </div>
              ))}
            </div>
          ) : (
            <QuestionCard question={question} position={currentIndex + 1} answer={attempt.answers[question.id]} flagged={attempt.answers[question.id]?.flagged ?? false} onAnswer={updateAnswer} onToggleFlag={() => toggleFlag(question.id)} disabled={isLocked} locked={isQuestionLocked(question.id)} onLeaveLock={isLast ? () => router.push(`/student/exam/${exam.id}/review`) : () => move("next")}/>
          )}
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-soft sm:p-4">
            {singlePage ? (
              <span className="text-[11px] font-bold text-muted-foreground">{toPersianNumber(exam.questions.length)} سؤال در یک صفحه</span>
            ) : (
              <Button variant="outline" size="lg" onClick={() => move("previous")} disabled={isFirst || !exam.settings.allowBackNavigation || isLocked}><ChevronRight className="h-4 w-4"/>سؤال قبل</Button>
            )}
            <div className="flex items-center gap-2 sm:gap-3">
              {saveLine}
              {singlePage || isLast || attempt.status === "expired" ? <Button size="lg" onClick={() => router.push(`/student/exam/${exam.id}/review`)} disabled={attempt.status === "submitting"}>مرور و ارسال <Send className="h-4 w-4"/></Button> : <Button size="lg" onClick={() => move("next")} disabled={isLocked}>ثبت و ادامه <ChevronLeft className="h-4 w-4"/></Button>}
            </div>
          </div>
          {rulesNote}
        </div>
        <QuestionNavigator exam={exam} attempt={attempt} currentIndex={currentIndex} onNavigate={goTo} lockedBefore={noReturn ? frontier : 0} showPosition={!singlePage}/>
      </main>
      <div className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-2 rounded-2xl border bg-card/95 p-2 shadow-lift backdrop-blur-md xl:hidden">
        <Button variant="secondary" onClick={() => setNavigatorOpen(true)}><ListChecks className="h-4 w-4"/>سؤال‌ها</Button>
        <AutosaveIndicator status={attempt.saveStatus} className="hidden min-[420px]:inline-flex"/>
        <Button variant="ghost" size="sm" onClick={() => toast({ title: "میانبرهای صفحه‌کلید", description: singlePage ? "در حالت یک‌صفحه‌ای با کلیدهای ۱ تا ۹ می‌توانید گزینهٔ سؤال آخر را انتخاب کنید." : "برای حرکت بین سؤال‌ها از کلیدهای جهت‌نما و برای گزینه‌ها از کلیدهای ۱ تا ۹ استفاده کنید." })}><CircleHelp className="h-4 w-4"/><span className="sr-only">راهنما</span></Button>
        <ExamTimer seconds={attempt.remainingSeconds} className="border-0 bg-muted px-2 shadow-none [&>div>p:first-child]:hidden"/>
      </div>
      {navigatorOpen && <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px] xl:hidden" onMouseDown={() => setNavigatorOpen(false)}><div className="h-full" onMouseDown={(event) => event.stopPropagation()}><QuestionNavigator exam={exam} attempt={attempt} currentIndex={currentIndex} onNavigate={goTo} mobile close={() => setNavigatorOpen(false)} lockedBefore={noReturn ? frontier : 0} showPosition={!singlePage}/></div></div>}
    </div>
  );
}
function ExamSkeleton() { return <div className="min-h-screen bg-surface p-4 sm:p-8"><div className="mx-auto max-w-5xl animate-soft-pulse space-y-6"><div className="h-16 rounded-2xl bg-muted"/><div className="h-[440px] rounded-3xl bg-muted"/><div className="h-16 rounded-2xl bg-muted"/></div></div>; }
