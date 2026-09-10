"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, FileQuestion, Flag, Send } from "lucide-react";
import type { Exam } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExamSessionBanner } from "@/components/exam/exam-session-banner";
import { ExamSubmissionDialog } from "@/components/exam/exam-submission-dialog";
import { ExamTimer } from "@/components/exam/exam-timer";
import { hasAnswer } from "@/components/exam/question-status";
import { useExamAutosave } from "@/hooks/use-exam-autosave";
import { useExamConnection } from "@/hooks/use-exam-connection";
import { useExamTimer } from "@/hooks/use-exam-timer";
import { useExamClock } from "@/hooks/use-exam-clock";
import { useExamSubmission } from "@/hooks/use-exam-submission";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { cn, toPersianNumber } from "@/lib/utils";

export function ExamReviewWorkspace({ exam, remote = false }: { exam: Exam; remote?: boolean }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const attempt = useExamAttemptStore((state) => state.attempt);
  const initialize = useExamAttemptStore((state) => state.initialize);
  const setCurrentQuestion = useExamAttemptStore((state) => state.setCurrentQuestion);
  const markSaved = useExamAttemptStore((state) => state.markSaved);
  const markSaveFailed = useExamAttemptStore((state) => state.markSaveFailed);
  const setConnectionStatus = useExamAttemptStore((state) => state.setConnectionStatus);
  useEffect(() => { if (!remote) initialize(exam); }, [exam, initialize, remote]);
  const { tick, sync } = useExamClock(attempt?.examId === exam.id ? attempt : null);
  useExamTimer(attempt?.examId === exam.id ? attempt : null, tick, sync);
  useExamAutosave(attempt?.examId === exam.id ? attempt : null, exam, markSaved, markSaveFailed);
  useExamConnection(setConnectionStatus);

  const counts = useMemo(() => {
    const answers = attempt?.answers ?? {};
    return {
      answered: Object.values(answers).filter(hasAnswer).length,
      flagged: Object.values(answers).filter((answer) => answer.flagged).length,
    };
  }, [attempt?.answers]);
  if (!attempt || attempt.examId !== exam.id) return <ReviewSkeleton/>;
  if (attempt.status === "not_started") return <NoActiveAttempt exam={exam}/>;
  if (attempt.status === "submitted") return <SubmittedAttempt exam={exam} attemptId={attempt.id}/>;
  const unanswered = exam.questions.length - counts.answered;
  function edit(index: number) { setCurrentQuestion(index); router.push(`/student/exam/${exam.id}`); }
  // Finalising lives in one shared hook so this button and the "time is up" auto-submit issued
  // from the exam screen behave identically: flush queued answers, submit, then route to the result.
  const submitAttempt = useExamSubmission(exam);
  function submit() { void submitAttempt(); }
  return <div className="min-h-screen bg-surface"><header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"><div><Link href={`/student/exam/${exam.id}`} className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-primary"><ArrowRight className="h-3.5 w-3.5"/>بازگشت به آزمون</Link><h1 className="mt-1 text-sm font-black">مرور پیش از ارسال</h1></div><ExamTimer seconds={attempt.remainingSeconds}/></div></header><main className="mx-auto max-w-6xl p-4 py-7 pb-28 sm:p-6 sm:py-10"><div className="grid gap-6 lg:grid-cols-[1.42fr_.78fr]"><section><div className="mb-6"><p className="section-label">یک نگاه نهایی</p><h2 className="mt-2 text-2xl font-black">پاسخ‌های {exam.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">سؤال‌های نشان‌دار و بدون پاسخ را با آرامش مرور کنید. تا پیش از ارسال نهایی می‌توانید هر پاسخ را تغییر دهید.</p></div><ExamSessionBanner attempt={attempt} onRestoreConnection={() => setConnectionStatus(navigator.onLine ? "online" : "offline")}/><Card><CardHeader><CardTitle>وضعیت همهٔ سؤال‌ها</CardTitle><CardDescription>برای ویرایش، هر سؤال را انتخاب کنید.</CardDescription></CardHeader><CardContent><div className="divide-y">{exam.questions.map((question, index) => { const answer = attempt.answers[question.id]; const answered = hasAnswer(answer); return <button key={question.id} onClick={() => edit(index)} disabled={attempt.status === "submitting"} className="flex w-full items-center gap-3 py-3 text-right transition-colors first:pt-0 hover:text-primary disabled:opacity-60"><span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-black", answered ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>{toPersianNumber(index + 1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{question.stem}</span><span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">{answered ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600"/>پاسخ ثبت شده</> : <><AlertTriangle className="h-3.5 w-3.5 text-amber-600"/>بدون پاسخ</>}{answer?.flagged && <><Flag className="h-3.5 w-3.5 fill-amber-500 text-amber-500"/>نشان‌دار</>}</span></span><span className="text-xs font-bold text-primary">ویرایش</span></button>; })}</div></CardContent></Card></section><aside className="space-y-4"><Card className="border-primary/20"><CardHeader><CardTitle>خلاصهٔ ارسال</CardTitle><CardDescription>وضعیت پاسخ‌دهی شما</CardDescription></CardHeader><CardContent><div className="grid grid-cols-2 gap-2"><ReviewMetric icon={CheckCircle2} value={counts.answered} label="پاسخ داده" tone="text-emerald-600"/><ReviewMetric icon={FileQuestion} value={unanswered} label="بدون پاسخ" tone="text-amber-600"/><ReviewMetric icon={Flag} value={counts.flagged} label="نشان‌دار" tone="text-primary"/><ReviewMetric icon={ClipboardCheck} value={exam.questions.length} label="کل سؤال‌ها" tone="text-violet-600"/></div><div className="mt-5 rounded-xl bg-amber-500/10 p-3 text-xs leading-6 text-amber-900 dark:text-amber-300"><AlertTriangle className="ml-1 inline h-4 w-4 align-text-bottom"/>پس از ارسال نهایی، امکان تغییر پاسخ‌ها وجود ندارد.</div><ul className="mt-4 space-y-1 text-[11px] text-muted-foreground"><li className="flex items-center justify-between gap-3"><span>کل نمرهٔ آزمون</span><b className="font-black text-foreground">{toPersianNumber(exam.settings.totalMarks)}</b></li>{exam.settings.passingPercentage > 0 && <li className="flex items-center justify-between gap-3"><span>حداقل نمرهٔ قبولی</span><b className="font-black text-foreground">{toPersianNumber(exam.settings.passingPercentage)}٪</b></li>}<li className="flex items-center justify-between gap-3"><span>نمایش نتیجه</span><b className="font-black text-foreground">{exam.settings.resultVisibility === "immediate" ? "بلافاصله پس از ارسال" : exam.settings.resultVisibility === "hidden" ? "پنهان از دانش‌آموز" : "پس از تصحیح معلم"}</b></li></ul><Button size="lg" className="mt-5 w-full" onClick={() => setDialogOpen(true)} disabled={attempt.status === "submitting"}><Send className="h-4 w-4"/>ارسال نهایی آزمون</Button><p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">حتی اگر پاسخی نداده باشید، ارسال آزمون همچنان با تأیید شما ممکن است.</p></CardContent></Card></aside></div></main><ExamSubmissionDialog open={dialogOpen} unanswered={unanswered} flagged={counts.flagged} loading={attempt.status === "submitting"} error={attempt.submissionError} onClose={() => setDialogOpen(false)} onConfirm={submit}/></div>;
}
function ReviewMetric({ icon: Icon, value, label, tone }: { icon: typeof CheckCircle2; value: number; label: string; tone: string }) { return <div className="rounded-xl bg-muted/60 p-3"><Icon className={cn("h-4 w-4", tone)}/><p className={cn("mt-3 text-xl font-black", tone)}>{toPersianNumber(value)}</p><p className="mt-1 text-[10px] font-bold text-muted-foreground">{label}</p></div>; }
function NoActiveAttempt({ exam }: { exam: Exam }) { return <div className="grid min-h-screen place-items-center bg-surface p-4"><Card className="max-w-md text-center"><CardContent className="p-8"><FileQuestion className="mx-auto h-8 w-8 text-primary"/><h1 className="mt-4 text-lg font-black">آزمون هنوز شروع نشده است</h1><p className="mt-2 text-sm leading-7 text-muted-foreground">برای مرور پاسخ‌ها، ابتدا آزمون «{exam.title}» را شروع کنید.</p><Button asChild className="mt-6"><Link href={`/student/exam/${exam.id}`}>بازگشت به آماده‌سازی آزمون</Link></Button></CardContent></Card></div>; }
function SubmittedAttempt({ exam, attemptId }: { exam: Exam; attemptId: string }) { return <div className="grid min-h-screen place-items-center bg-surface p-4"><Card className="max-w-md text-center"><CardContent className="p-8"><CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600"/><h1 className="mt-4 text-lg font-black">آزمون قبلاً ارسال شده است</h1><p className="mt-2 text-sm leading-7 text-muted-foreground">می‌توانید وضعیت نتیجهٔ «{exam.title}» را مشاهده کنید.</p><Button asChild className="mt-6"><Link href={`/student/results/${attemptId}`}>مشاهده وضعیت نتیجه</Link></Button></CardContent></Card></div>; }
function ReviewSkeleton() { return <div className="min-h-screen bg-surface p-8"><div className="mx-auto h-96 max-w-5xl animate-soft-pulse rounded-3xl bg-muted"/></div>; }
