"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpenCheck, CalendarDays, CheckCircle2, ChevronLeft, Clock3, FileText, ShieldCheck } from "lucide-react";
import type { Exam } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ExamWorkspace } from "@/components/exam/exam-workspace";
import { useExamAttemptStore } from "@/lib/state/exam-attempt-store";
import { formatDateTime, toPersianNumber } from "@/lib/utils";
import { describeIntegrity, rulesFromSettings } from "@/lib/exam/integrity";

export function ExamStartWorkspace({ exam, remote = false, onStart }: { exam: Exam; remote?: boolean; onStart?: () => Promise<void> }) {
  const attempt = useExamAttemptStore((state) => state.attempt);
  const initialize = useExamAttemptStore((state) => state.initialize);
  const start = useExamAttemptStore((state) => state.start);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => { if (!remote) initialize(exam); }, [exam, initialize, remote]);

  if (attempt?.examId === exam.id && ["in_progress", "expired", "submitting"].includes(attempt.status)) return <ExamWorkspace exam={exam}/>;
  if (attempt?.examId === exam.id && attempt.status === "submitted") return <CompletedAttemptScreen exam={exam} attemptId={attempt.id}/>;
  const attemptsLeft = Math.max(0, (exam.settings.attemptLimit ?? 1) - (exam.attemptsUsed ?? 0));
  // Question bodies only exist inside a session, so the count from the dashboard payload is what
  // decides whether there is anything to sit; treating an unloaded list as "empty" would lock every
  // first attempt out of the exam.
  const questionCount = exam.questions.length || exam.questionCount || 0;
  // The server refuses a start that would leave under a minute on the clock, so the screen says so first
  // instead of burning the student's attempt budget on an error toast.
  const secondsToClose = (new Date(exam.endAt).getTime() - Date.now()) / 1000;
  const closingImminently = Boolean(exam.endAt) && Number.isFinite(secondsToClose) && secondsToClose > 0 && secondsToClose < 60;
  const canStart = exam.status === "active" && attemptsLeft > 0 && questionCount > 0 && !closingImminently;
  const startBlock = exam.status !== "active" ? "این آزمون اکنون در حالت برگزاری نیست؛ با رسیدن زمان شروع، همین‌جا فعال می‌شود." : closingImminently ? "زمان این آزمون کمتر از یک دقیقه دیگر بسته می‌شود؛ برای اینکه یک تلاش شما از بین نرود، با آموزگار هماهنگ کنید تا زمان را تمدید کند." : attemptsLeft === 0 ? "تعداد تلاش‌های مجاز شما به پایان رسیده است. برای بررسی مجدد با معلم تماس بگیرید." : questionCount === 0 ? "این آزمون هنوز سؤالی ندارد و قابل شروع نیست." : null;  // Every line here is derived from the server's copy of the teacher's settings. Two of the old lines were
  // unconditional - a paged exam claimed skipped questions were locked even when the teacher allowed going
  // back, and a shuffled paper was announced as identical for everyone because the dashboard payload had no
  // shuffle fields to read. Both are now statements the server can back up.
  const singlePageLayout = exam.settings.questionLayout === "single_page";
  const canGoBack = exam.settings.allowBackNavigation;
  // In the one-page layout there is nothing to go back to and nothing locks, whatever the navigation switch
  // says: every question is on screen from the first second.
  const layoutRule = singlePageLayout
    ? "همهٔ سؤال‌ها در یک صفحه، زیر هم نمایش داده می‌شوند؛ همین صفحه را تا پایان پر کنید."
    : canGoBack
      ? "سؤال‌ها صفحه‌به‌صفحه نمایش داده می‌شوند و می‌توانید به سؤال‌های قبل برگردید."
      : "پس از ادامه دادن، بازگشت به سؤال‌های قبل ممکن نیست و سؤالِ ردشده قفل می‌شود.";
  const editRule = singlePageLayout
    ? "در حالت یک‌صفحه‌ای پاسخ هر سؤال تا پایان آزمون قابل ویرایش است."
    : canGoBack
      ? "پاسخ‌های پیشین را تا پیش از ارسال نهایی می‌توانید ویرایش کنید."
      : "پاسخی که قفل شد، حتی با رفرش صفحه بازنمی‌گردد.";
  const integrityRules = rulesFromSettings(exam.settings);
  const integrityDisclosure = describeIntegrity(integrityRules);
  const rules = [
    layoutRule,
    editRule,
    exam.settings.randomizeQuestions ? "ترتیب سؤال‌ها برای هر دانش‌آموز به‌صورت تصادفی است." : "ترتیب سؤال‌ها برای همهٔ دانش‌آموزان یکسان است.",
    ...(exam.settings.randomizeOptions ? ["گزینه‌های چندگزینه‌ای برای هر دانش‌آموز جابه‌جا می‌شود؛ روی نمره اثری ندارد."] : []),
    "پاسخ‌های شما به‌صورت خودکار در طول آزمون ذخیره می‌شوند.",
    ...(exam.settings.allowUnanswered === false ? ["برای ارسال باید به همهٔ سؤال‌ها پاسخ دهید."] : []),
    ...(integrityRules.policy !== "off" ? [integrityDisclosure] : []),
    `تلاش مجاز: ${toPersianNumber(exam.settings.attemptLimit ?? 1)}${exam.attemptsUsed ? ` · استفاده‌شده: ${toPersianNumber(exam.attemptsUsed)}` : ""}.`,
    exam.settings.resultVisibility === "immediate" ? "نمرهٔ بخش خودکار بلافاصله پس از ارسال نمایش داده می‌شود." : exam.settings.resultVisibility === "hidden" ? "نتیجه تنها برای معلم نمایش داده می‌شود." : "نتیجه پس از بررسی و انتشار معلم در دسترس شما قرار می‌گیرد.",
  ];
  const confirmationNotes = [
    layoutRule,
    "پاسخ‌ها در طول آزمون خودکار ذخیره می‌شوند.",
    ...(exam.settings.randomizeQuestions || exam.settings.randomizeOptions ? ["ترتیب سؤال‌ها یا گزینه‌ها ممکن است با بقیهٔ کلاس متفاوت باشد."] : []),
    ...(exam.settings.allowUnanswered === false ? ["برای ارسال باید به همهٔ سؤال‌ها پاسخ دهید."] : []),
    ...(integrityRules.policy !== "off" ? [integrityDisclosure] : []),
  ];  async function confirmStart() {
    setStarting(true); setStartError(null);
    try { if (onStart) await onStart(); else start(); setConfirmationOpen(false); }
    catch (error) { setStartError(error instanceof Error ? error.message : "شروع آزمون انجام نشد."); }
    finally { setStarting(false); }
  }
  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/student/dashboard" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5"/>بازگشت</Link>
          <span className="text-xs font-bold text-muted-foreground">{exam.subject}</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4 py-6 sm:px-6 sm:py-9">
        <Card className="overflow-hidden">
          <CardHeader className="p-5 sm:p-7">
            <p className="text-xs font-bold text-muted-foreground">آماده‌سازی آزمون</p>
            <CardTitle className="mt-1 text-2xl sm:text-3xl">{exam.title}</CardTitle>
            {exam.description && <CardDescription className="mt-2 text-sm leading-6">{exam.description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-5 p-5 pt-0 sm:p-7 sm:pt-0">
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Clock3, label: "مدت", value: `${toPersianNumber(exam.settings.durationMinutes)} دقیقه` },
                { icon: FileText, label: "سؤال‌ها", value: questionCount ? toPersianNumber(questionCount) : "—" },
                { icon: BookOpenCheck, label: "تلاش باقی‌مانده", value: `${toPersianNumber(attemptsLeft)} از ${toPersianNumber(exam.settings.attemptLimit ?? 1)}` },
              ].map((item) => { const Icon = item.icon; return <div key={item.label} className="rounded-xl bg-muted/50 p-3"><Icon className="h-4 w-4 text-muted-foreground"/><p className="mt-2 text-[10px] font-bold text-muted-foreground">{item.label}</p><p className="mt-0.5 text-sm font-black">{item.value}</p></div>; })}
            </div>

            <div className="rounded-xl border bg-background px-4 py-3 text-xs leading-6">
              <p className="flex items-start gap-2"><ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-success"/><span>{layoutRule}</span></p>
              <p className="mt-1.5 text-muted-foreground">پاسخ‌ها به‌صورت خودکار در طول آزمون ذخیره می‌شوند؛ زمان‌سنج با تأیید شما آغاز می‌شود.</p>
              {integrityRules.policy !== "off" && <p className="mt-2 flex items-start gap-2 border-t pt-2 text-muted-foreground"><ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-warning"/><span>{integrityDisclosure}</span></p>}
            </div>

            <details className="rounded-xl border px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold"><CalendarDays className="h-4 w-4 text-muted-foreground"/>زمان، نمره و قوانین</summary>
              <div className="mt-3 space-y-2">
                <div className="space-y-2 text-xs">
                  <SummaryRow label="شروع" value={exam.startAt ? formatDateTime(exam.startAt) : "—"}/>
                  <SummaryRow label="پایان بازه" value={exam.endAt ? formatDateTime(exam.endAt) : "—"}/>
                  <SummaryRow label="کل نمره" value={`${toPersianNumber(exam.settings.totalMarks)} نمره`}/>
                  {exam.settings.passingPercentage > 0 && <SummaryRow label="حداقل قبولی" value={`${toPersianNumber(exam.settings.passingPercentage)}٪`}/>}
                  <SummaryRow label="ارسال با سؤال خالی" value={exam.settings.allowUnanswered === false ? "باید به همه پاسخ دهید" : "ممکن است؛ سؤال خالی نمره نمی‌گیرد"}/>
                  <SummaryRow label="انتشار نتیجه" value={exam.settings.resultVisibility === "immediate" ? "فوری" : exam.settings.resultVisibility === "hidden" ? "تنها برای معلم" : "پس از بررسی معلم"}/>
                </div>
                <ul className="space-y-1 border-t pt-2 text-xs leading-5 text-muted-foreground">
                  {rules.filter((rule) => rule !== layoutRule && !rule.startsWith("پاسخ‌های شما")).map((rule) => <li key={rule} className="flex items-start gap-2"><CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-success"/>{rule}</li>)}
                </ul>
              </div>
            </details>

            {startBlock && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-300">{startBlock}</p>}
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">{startBlock ? "برای شروع با آموزگار هماهنگ کنید." : "زمان‌سنج پس از تأیید شروع می‌شود."}</p>
              <Button size="lg" disabled={!canStart} onClick={() => setConfirmationOpen(true)}>شروع آزمون <ArrowLeft className="h-4 w-4"/></Button>
            </div>
          </CardContent>
        </Card>
      </main>

      <Dialog open={confirmationOpen} onClose={() => !starting && setConfirmationOpen(false)} title="آمادهٔ شروع هستید؟" description={`با تأیید، زمان ${toPersianNumber(exam.settings.durationMinutes)} دقیقه‌ای آغاز می‌شود.`}>
        <div className="space-y-2 rounded-xl bg-muted/45 p-4 text-sm leading-6 text-muted-foreground">{confirmationNotes.map((note) => <p key={note} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-success"/>{note}</p>)}</div>
        {startError && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs font-bold text-destructive">{startError}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setConfirmationOpen(false)} disabled={starting}>برگشت</Button><Button data-autofocus onClick={() => void confirmStart()} disabled={starting}>{starting ? "در حال آغاز…" : "تأیید و شروع آزمون"}<ArrowLeft className="h-4 w-4"/></Button></div>
      </Dialog>
    </div>
  );
}
function SummaryRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/65 px-3 py-2"><span className="font-bold text-muted-foreground">{label}</span><span className="font-black">{value}</span></div>; }
function CompletedAttemptScreen({ exam, attemptId }: { exam: Exam; attemptId: string }) { return <div className="grid min-h-dvh place-items-center bg-surface p-4"><Card className="w-full max-w-md text-center"><CardContent className="p-8"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/10 text-success"><CheckCircle2 className="h-7 w-7"/></div><h1 className="mt-5 text-xl font-black">آزمون ارسال شده است</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">پاسخ‌های آزمون «{exam.title}» ثبت شده‌اند.</p><Button asChild className="mt-6"><Link href={`/student/results/${attemptId}`}>مشاهده وضعیت نتیجه <ArrowLeft className="h-4 w-4"/></Link></Button></CardContent></Card></div>; }
