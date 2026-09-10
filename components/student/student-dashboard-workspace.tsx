"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Clock3, FileText, ListChecks, RefreshCw, ShieldCheck, Timer } from "lucide-react";
import { attemptsApi } from "@/lib/api/attempts";
import { apiErrorMessage } from "@/lib/api/client";
import { toStudentDashboardExam } from "@/lib/api/mappers";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/state/auth-store";
import { cn, formatDate, formatDateTime, formatTime, toPersianNumber } from "@/lib/utils";
import type { Exam } from "@/lib/types/domain";

const availabilityLabel = {
  available: { label: "آمادهٔ شروع", variant: "success" },
  in_progress: { label: "در حال انجام", variant: "warning" },
  upcoming: { label: "پیش‌رو", variant: "default" },
  completed: { label: "پایان یافته", variant: "neutral" },
} as const;

export function StudentDashboardWorkspace() {
  const user = useAuthStore((state) => state.user);
  const [exams, setExams] = useState<Exam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const items = await attemptsApi.listAvailable();
      setExams(items.map(toStudentDashboardExam));
      setRefreshedAt(new Date());
    } catch (reason) {
      setError(apiErrorMessage(reason, "بارگذاری آزمون‌ها انجام نشد. اتصال خود را بررسی کنید."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // A tab that has been sitting open while a countdown runs should not show a stale resume timer.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const inProgress = useMemo(() => exams.filter((exam) => exam.availability === "in_progress"), [exams]);
  const available = useMemo(() => exams.filter((exam) => exam.availability === "available"), [exams]);
  const upcoming = useMemo(() => exams.filter((exam) => exam.availability === "upcoming").sort((a, b) => a.startAt.localeCompare(b.startAt)), [exams]);
  const completed = useMemo(() => exams.filter((exam) => exam.availability === "completed").sort((a, b) => (b.attemptId === undefined ? 0 : 1) - (a.attemptId === undefined ? 0 : 1)), [exams]);
  const passedCount = completed.filter((exam) => exam.resultSummary?.passed === true).length;
  const hero = inProgress[0] ?? available[0];
  const name = user?.fullName.split(" ")[0] || "دانش‌آموز";

  return <PageTransition><PageContainer>
    <PageHeader eyebrow="فضای یادگیری شما" title={`سلام، ${name} 👋`} description="آزمون‌ها، زمان باقی‌مانده و وضعیت نتیجه مستقیماً از سرویس آموزشی دریافت می‌شود." breadcrumbs={[{ label: "دانش‌آموز" }, { label: "نمای کلی" }]} action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>به‌روزرسانی</Button>}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard icon={FileText} label="آزمون‌های در دسترس" value={toPersianNumber(available.length + inProgress.length)} detail="آمادهٔ شروع یا در جریان" tone="indigo"/>
      <StatCard icon={CheckCircle2} label="تکمیل‌شده" value={toPersianNumber(completed.length)} detail={passedCount ? `${toPersianNumber(passedCount)} مورد با حکم قبولی` : "تلاش‌های نهایی‌شده"} tone="teal"/>
      <StatCard icon={Clock3} label="در حال پاسخ‌گویی" value={toPersianNumber(inProgress.length)} detail="با زمان در جریان سرور" tone="violet"/>
      <StatCard icon={CalendarDays} label="پیش‌رو" value={toPersianNumber(upcoming.length)} detail="طبق زمان‌بندی معلم" tone="amber"/>
    </div>

    {error && <Card className="mt-6 border-destructive/30"><CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4"/><span className="flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>تلاش دوباره</Button></CardContent></Card>}

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_.85fr]">
      <section className="space-y-6">
        {loading && !exams.length ? <Card className="h-52 animate-soft-pulse bg-muted"/> : hero ? <InProgressCard exam={hero}/> : <Card><CardContent className="p-7 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-primary"/><h2 className="mt-3 font-black">اکنون آزمون فعالی ندارید</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">به‌محض انتشار آزمون توسط معلم، همین‌جا با زمان باقی‌ماندهٔ دقیق نمایش داده می‌شود.</p></CardContent></Card>}

        {inProgress.length > 1 && <ExamGroup title="بقیهٔ آزمون‌های در جریان" description="زمان این تلاش‌ها همچنان در سرور شمرده می‌شود."><div className="grid gap-3">{inProgress.slice(1).map((exam) => <ExamRow key={exam.id} exam={exam}/>)}</div></ExamGroup>}

        {available.length > 0 && <ExamGroup title="آمادهٔ شروع" description="پیش از شروع، توضیح و قواعد آزمون را بخوانید."><div className="grid gap-3">{available.map((exam) => <ExamRow key={exam.id} exam={exam}/>)}</div></ExamGroup>}

        {upcoming.length > 0 && <ExamGroup title="آزمون‌های پیش‌رو" description="با رسیدن زمان شروع، همین کارت فعال می‌شود."><div className="grid gap-3">{upcoming.map((exam) => <ExamRow key={exam.id} exam={exam}/>)}</div></ExamGroup>}

        <ExamGroup title="تلاش‌های تکمیل‌شده" description="نمره فقط پس از انتشار نتیجهٔ معلم نمایش داده می‌شود.">
          {completed.length ? <div className="grid gap-3">{completed.map((exam) => <ExamRow key={exam.id} exam={exam}/>)}</div> : <Card><CardContent className="p-5 text-sm text-muted-foreground">هنوز تلاش نهایی‌شده‌ای ندارید.</CardContent></Card>}
        </ExamGroup>
      </section>

      <aside className="space-y-6">
        <Card><CardHeader><CardTitle>دسترسی امن آزمون</CardTitle><CardDescription>اطلاعات هر آزمون تنها هنگام شروع و از سرور دریافت می‌شود.</CardDescription></CardHeader><CardContent><div className="rounded-2xl bg-primary/5 p-4 text-sm leading-7 text-muted-foreground"><ShieldCheck className="ml-2 inline h-4 w-4 text-emerald-600 align-text-bottom"/>زمان، ترتیب سؤال‌ها و نمرهٔ نهایی در سرور محاسبه می‌شود؛ کلید پاسخ برای دانش‌آموز ارسال نمی‌شود.</div>{refreshedAt && <p className="mt-3 text-[11px] text-muted-foreground">آخرین به‌روزرسانی: {formatDateTime(refreshedAt.toISOString())}</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>تقویم آزمون‌ها</CardTitle></CardHeader><CardContent>{upcoming.length ? <div className="space-y-3">{upcoming.slice(0, 4).map((exam) => <div key={exam.id} className="flex items-center gap-3"><div className="rounded-xl bg-violet-500/10 px-2 py-1.5 text-center text-xs font-black text-violet-700 dark:text-violet-300">{formatDate(exam.startAt)}</div><div className="min-w-0"><p className="truncate text-xs font-extrabold">{exam.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{toPersianNumber(exam.settings.durationMinutes)} دقیقه · {toPersianNumber(exam.questionCount)} سؤال</p></div></div>)}</div> : <p className="text-sm text-muted-foreground">رویداد پیش‌رویی ثبت نشده است.</p>}</CardContent></Card>
      </aside>
    </div>
  </PageContainer></PageTransition>;
}

function ExamGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section><div className="mb-3"><h2 className="font-black">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{children}</section>;
}

/** The hero card: resume state is driven by the server countdown, never by a local guess. */
function InProgressCard({ exam }: { exam: Exam }) {
  const resuming = exam.availability === "in_progress";
  const attemptsLeft = Math.max(0, (exam.settings.attemptLimit ?? 1) - (exam.attemptsUsed ?? 0));
  return <Card className="relative overflow-hidden border-primary/15 bg-gradient-to-l from-primary/[.07] to-card">
    <div className="absolute -left-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl"/>
    <CardContent className="relative p-5 sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Badge variant={resuming ? "warning" : "success"}>{resuming ? "آزمون در حال انجام" : "اکنون آمادهٔ شروع"}</Badge>
          <p className="mt-4 text-xs font-bold text-muted-foreground">{exam.subject} · {toPersianNumber(exam.settings.durationMinutes)} دقیقه · {toPersianNumber(exam.questionCount)} سؤال</p>
          <h2 className="mt-1 text-xl font-black">{exam.title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{exam.description}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold">
            {resuming && exam.remainingSeconds !== null && exam.remainingSeconds !== undefined && <span className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300"><Timer className="h-3.5 w-3.5"/>{formatTime(exam.remainingSeconds)} باقی‌مانده</span>}
            <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-muted-foreground"><ListChecks className="h-3.5 w-3.5"/>تلاش {toPersianNumber(exam.attemptNumber ?? exam.attemptsUsed ?? 0)} از {toPersianNumber(exam.settings.attemptLimit ?? 1)}</span>
            {exam.settings.totalMarks > 0 && <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5"/>{toPersianNumber(exam.settings.totalMarks)} نمره</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <Button asChild size="lg">{<Link href={`/student/exam/${exam.id}`}>{resuming ? "ادامهٔ آزمون" : "مشاهده و شروع"} <ArrowLeft className="h-4 w-4"/></Link>}</Button>
          {!resuming && attemptsLeft === 0 && <p className="text-[11px] font-bold text-destructive">تعداد تلاش‌های مجاز به پایان رسیده است.</p>}
        </div>
      </div>
    </CardContent>
  </Card>;
}

function ExamRow({ exam }: { exam: Exam }) {
  const key = exam.availability ?? exam.status;
  const meta = availabilityLabel[key as keyof typeof availabilityLabel] ?? { label: exam.status, variant: "neutral" as const };
  const result = exam.resultSummary;
  const href = exam.availability === "completed" && exam.attemptId ? `/student/results/${exam.attemptId}` : `/student/exam/${exam.id}`;
  const action = exam.availability === "in_progress" ? "ادامهٔ آزمون" : exam.availability === "available" ? "شروع آزمون" : exam.availability === "completed" ? (result ? "مشاهدهٔ نتیجه" : "وضعیت تلاش") : "مشاهدهٔ جزئیات";
  return <Card><CardContent className="flex flex-wrap items-center gap-4 p-4">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={meta.variant}>{meta.label}</Badge><span className="text-[11px] font-bold text-muted-foreground">{exam.subject}</span></div>
      <p className="mt-2 truncate text-sm font-extrabold">{exam.title}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{exam.availability === "upcoming" ? formatDateTime(exam.startAt) : `${toPersianNumber(exam.settings.durationMinutes)} دقیقه`}</span>
        <span>{toPersianNumber(exam.questionCount)} سؤال</span>
        {exam.settings.totalMarks > 0 && <span>{toPersianNumber(exam.settings.totalMarks)} نمره</span>}
        <span>تلاش {toPersianNumber(exam.attemptsUsed ?? exam.attemptNumber ?? 0)}/{toPersianNumber(exam.settings.attemptLimit ?? 1)}</span>
        {exam.availability === "in_progress" && exam.remainingSeconds !== null && exam.remainingSeconds !== undefined && <span className="font-bold text-amber-700 dark:text-amber-400">{formatTime(exam.remainingSeconds)} باقی‌مانده</span>}
      </p>
    </div>
    {result && <div className="rounded-xl bg-muted/60 px-3 py-2 text-center"><p className="text-sm font-black">{toPersianNumber(result.score)} <span className="text-[10px] font-bold text-muted-foreground">از {toPersianNumber(result.maximumScore)}</span></p>{result.percentage !== null && <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{toPersianNumber(Math.round(result.percentage))}٪</p>}{result.passed !== null && <p className={result.passed ? "mt-1 text-[10px] font-black text-emerald-600" : "mt-1 text-[10px] font-black text-rose-600"}>{result.passed ? "قبول" : "مردود"}</p>}</div>}
    {exam.availability === "completed" && !result && <p className="max-w-[180px] text-[11px] leading-5 text-muted-foreground">نتیجه هنوز توسط معلم منتشر نشده است.</p>}
    <Button asChild size="sm" variant={exam.availability === "in_progress" || exam.availability === "available" ? "default" : "outline"}><Link href={href}>{action} <ArrowLeft className="h-3.5 w-3.5"/></Link></Button>
  </CardContent></Card>;
}
