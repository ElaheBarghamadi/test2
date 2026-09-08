"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleHelp, ListChecks, Send, ShieldCheck } from "lucide-react";
import type { AnswerValue, Exam } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { AutosaveIndicator } from "@/components/exam/autosave-indicator";
import { ExamProgress } from "@/components/exam/exam-progress";
import { ExamSessionBanner } from "@/components/exam/exam-session-banner";
import { ExamTimer } from "@/components/exam/exam-timer";
import { QuestionCard } from "@/components/exam/question-card";
import { QuestionNavigator } from "@/components/exam/question-navigator";
import { hasAnswer } from "@/components/exam/question-status";
import { useExamAutosave } from "@/hooks/use-exam-autosave";
import { useExamConnection } from "@/hooks/use-exam-connection";
import { useExamKeyboardNavigation } from "@/hooks/use-exam-keyboard-navigation";
import { useExamTimer } from "@/hooks/use-exam-timer";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { useToastStore } from "@/lib/state/toast-store";

export function ExamWorkspace({ exam }: { exam: Exam }) {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const attempt = useExamAttemptStore((state) => state.attempt);
  const setAnswer = useExamAttemptStore((state) => state.setAnswer);
  const setCurrentQuestion = useExamAttemptStore((state) => state.setCurrentQuestion);
  const toggleFlag = useExamAttemptStore((state) => state.toggleFlag);
  const tick = useExamAttemptStore((state) => state.tick);
  const markSaved = useExamAttemptStore((state) => state.markSaved);
  const markSaveFailed = useExamAttemptStore((state) => state.markSaveFailed);
  const setConnectionStatus = useExamAttemptStore((state) => state.setConnectionStatus);

  useExamTimer(attempt?.examId === exam.id ? attempt : null, tick);
  useExamAutosave(attempt?.examId === exam.id ? attempt : null, exam, markSaved, markSaveFailed);
  useExamConnection(setConnectionStatus);

  const answered = useMemo(() => attempt ? Object.values(attempt.answers).filter(hasAnswer).length : 0, [attempt]);
  const currentIndex = attempt?.currentQuestionIndex ?? 0;
  const question = exam.questions[currentIndex] ?? exam.questions[0];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === exam.questions.length - 1;
  const isLocked = attempt?.status === "expired" || attempt?.status === "submitting";
  const move = useCallback((direction: "next" | "previous") => {
    const next = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    if (next >= 0 && next < exam.questions.length) setCurrentQuestion(next);
  }, [currentIndex, exam.questions.length, setCurrentQuestion]);
  const updateAnswer = useCallback((value: AnswerValue) => setAnswer(question.id, value), [question.id, setAnswer]);

  useExamKeyboardNavigation({
    question,
    currentValue: attempt?.answers[question.id]?.value ?? null,
    onPrevious: () => move("previous"),
    onNext: () => move("next"),
    onAnswer: updateAnswer,
    enabled: !!attempt && attempt.status === "in_progress" && !navigatorOpen,
  });
  useEffect(() => {
    if (attempt?.examId === exam.id && attempt.status === "expired") {
      toast({ title: "زمان آزمون به پایان رسید", description: "پاسخ‌های شما حفظ شده‌اند؛ لطفاً وارد مرحلهٔ مرور و ارسال شوید.", variant: "error" });
    }
  }, [attempt?.examId, attempt?.status, exam.id, toast]);

  if (!attempt || attempt.examId !== exam.id) return <ExamSkeleton/>;
  return <div className="min-h-screen bg-surface"><header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur-xl"><div className="mx-auto flex h-auto max-w-[1480px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:h-[76px] sm:flex-nowrap sm:px-6"><div className="min-w-0"><Link href="/student/dashboard" className="text-[11px] font-bold text-muted-foreground hover:text-primary">خروج از آزمون</Link><h1 className="mt-1 truncate text-sm font-black sm:text-base">{exam.title}</h1></div><div className="order-3 hidden flex-1 justify-center sm:order-none sm:flex"><ExamProgress current={currentIndex + 1} total={exam.questions.length} answered={answered}/></div><div className="flex items-center gap-2"><div className="hidden md:block"><AutosaveIndicator status={attempt.saveStatus}/></div><ExamTimer seconds={attempt.remainingSeconds}/></div></div><div className="border-t px-4 py-2 sm:hidden"><ExamProgress current={currentIndex + 1} total={exam.questions.length} answered={answered}/></div></header><main className="mx-auto flex max-w-[1480px] gap-6 px-4 py-5 pb-32 sm:px-6 sm:py-7 xl:pb-7"><div className="min-w-0 flex-1"><ExamSessionBanner attempt={attempt} onRestoreConnection={() => setConnectionStatus(navigator.onLine ? "online" : "offline")}/><QuestionCard question={question} answer={attempt.answers[question.id]} flagged={attempt.answers[question.id]?.flagged ?? false} onAnswer={updateAnswer} onToggleFlag={() => toggleFlag(question.id)} disabled={isLocked}/><div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-soft sm:p-4"><Button variant="outline" size="lg" onClick={() => move("previous")} disabled={isFirst || !exam.settings.allowBackNavigation || isLocked}><ChevronRight className="h-4 w-4"/>سؤال قبل</Button>{isLast || attempt.status === "expired" ? <Button size="lg" onClick={() => router.push(`/student/exam/${exam.id}/review`)} disabled={attempt.status === "submitting"}>مرور و ارسال <Send className="h-4 w-4"/></Button> : <Button size="lg" onClick={() => move("next")} disabled={isLocked}>ثبت و ادامه <ChevronLeft className="h-4 w-4"/></Button>}</div><div className="mt-4 hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex"><ShieldCheck className="h-4 w-4 text-emerald-600"/>پاسخ‌ها به‌صورت خودکار ذخیره می‌شوند و پیش از ارسال نهایی قابل ویرایش‌اند.</div></div><QuestionNavigator exam={exam} attempt={attempt} currentIndex={currentIndex} onNavigate={setCurrentQuestion}/></main><div className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-2 rounded-2xl border bg-card/95 p-2 shadow-lift backdrop-blur-md xl:hidden"><Button variant="secondary" onClick={() => setNavigatorOpen(true)}><ListChecks className="h-4 w-4"/>سؤال‌ها</Button><AutosaveIndicator status={attempt.saveStatus} className="hidden min-[420px]:inline-flex"/><Button variant="ghost" size="sm" onClick={() => toast({ title: "میانبرهای صفحه‌کلید", description: "برای حرکت بین سؤال‌ها از کلیدهای جهت‌نما و برای گزینه‌ها از کلیدهای ۱ تا ۹ استفاده کنید." })}><CircleHelp className="h-4 w-4"/><span className="sr-only">راهنما</span></Button><ExamTimer seconds={attempt.remainingSeconds} className="border-0 bg-muted px-2 shadow-none [&>div>p:first-child]:hidden"/></div>{navigatorOpen && <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px] xl:hidden" onMouseDown={() => setNavigatorOpen(false)}><div className="h-full" onMouseDown={(event) => event.stopPropagation()}><QuestionNavigator exam={exam} attempt={attempt} currentIndex={currentIndex} onNavigate={setCurrentQuestion} mobile close={() => setNavigatorOpen(false)}/></div></div>}</div>;
}
function ExamSkeleton() { return <div className="min-h-screen bg-surface p-4 sm:p-8"><div className="mx-auto max-w-5xl animate-soft-pulse space-y-6"><div className="h-16 rounded-2xl bg-muted"/><div className="h-[440px] rounded-3xl bg-muted"/><div className="h-16 rounded-2xl bg-muted"/></div></div>; }
