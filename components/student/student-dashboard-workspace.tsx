"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Award, BookOpenCheck, CalendarDays, Clock3, RefreshCw, Timer } from "lucide-react";
import { attemptsApi } from "@/lib/api/attempts";
import { apiErrorMessage } from "@/lib/api/client";
import { toStudentDashboardExam } from "@/lib/api/mappers";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { ExamCalendar } from "@/components/shared/exam-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/lib/state/auth-store";
import { cn, formatDateTime, formatTime, toPersianNumber } from "@/lib/utils";
import type { Exam } from "@/lib/types/domain";

/**
 * A quiet front door for the student: one ordered list, a small filter rail, and only the details needed
 * to act. The server remains authoritative for availability, time and results.
 */
type FilterKey = "all" | "action" | "upcoming" | "results";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "همه" },
  { key: "action", label: "نیازمند اقدام" },
  { key: "upcoming", label: "پیش‌رو" },
  { key: "results", label: "نتایج" },
];

const AVAILABILITY: Record<string, { label: string; variant: "success" | "warning" | "default" | "neutral" | "teal" }> = {
  available: { label: "آمادهٔ شروع", variant: "success" },
  in_progress: { label: "در حال انجام", variant: "warning" },
  upcoming: { label: "پیش‌رو", variant: "default" },
  completed: { label: "پایان یافته", variant: "neutral" },
};

/** Coarse on purpose: the authoritative countdown lives on the exam page, driven by the server clock. */
const CLOCK_TICK_MS = 30_000;

export function StudentDashboardWorkspace() {
  const user = useAuthStore((state) => state.user);
  const [exams, setExams] = useState<Exam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await attemptsApi.listAvailable();
      setExams(items.map(toStudentDashboardExam));
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

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  const buckets = useMemo(() => {
    const by = (key: Exam["availability"]) => exams.filter((exam) => exam.availability === key);
    return {
      inProgress: by("in_progress"),
      available: by("available"),
      upcoming: by("upcoming").sort((a, b) => a.startAt.localeCompare(b.startAt)),
      finished: by("completed").sort((a, b) => (b.attemptId === undefined ? 0 : 1) - (a.attemptId === undefined ? 0 : 1)),
    };
  }, [exams]);

  const counts: Record<FilterKey, number> = {
    all: exams.length,
    action: buckets.inProgress.length + buckets.available.length,
    upcoming: buckets.upcoming.length,
    results: buckets.finished.length,
  };
  const shown = filter === "all"
    ? [...buckets.inProgress, ...buckets.available, ...buckets.upcoming, ...buckets.finished]
    : filter === "action" ? [...buckets.inProgress, ...buckets.available]
      : filter === "upcoming" ? buckets.upcoming
        : buckets.finished;
  const name = user?.fullName.split(" ")[0] || "دانش‌آموز";
  const calendarExams = [...buckets.upcoming, ...buckets.available, ...buckets.inProgress];

  return <PageTransition><PageContainer>
    <PageHeader
      eyebrow="فضای یادگیری"
      title={`سلام، ${name}`}
      description="آزمون‌ها و نتایج شما"
      breadcrumbs={[{ label: "دانش‌آموز" }, { label: "نمای کلی" }]}
      action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>تازه‌سازی</Button>}
    />

    {exams.length > 0 && <div className="mt-5 flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label="فیلتر آزمون‌ها">
      {FILTERS.map((item) => {
        const active = filter === item.key;
        const count = counts[item.key];
        return <button key={item.key} type="button" aria-pressed={active} onClick={() => setFilter(item.key)} className={cn("inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/45", !active && count === 0 && "text-muted-foreground")}>
          <span>{item.label}</span><span className={cn("text-[10px]", active ? "text-primary-foreground/75" : "text-muted-foreground")}>{toPersianNumber(count)}</span>
        </button>;
      })}
    </div>}

    {error && <Card className="mt-5 border-destructive/30"><CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4"/><span className="flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>تلاش دوباره</Button></CardContent></Card>}

    <section className="mt-6 space-y-3">
      {loading && !exams.length && <div className="space-y-3"><div className="h-32 animate-soft-pulse rounded-2xl bg-muted"/><div className="h-24 animate-soft-pulse rounded-2xl bg-muted"/></div>}
      {!loading && !exams.length && <Card><CardContent className="p-7 text-center"><BookOpenCheck className="mx-auto h-7 w-7 text-primary"/><h2 className="mt-3 font-black">فعلاً آزمونی ندارید</h2><p className="mt-1 text-sm text-muted-foreground">آزمون‌های در دسترس همین‌جا نمایش داده می‌شوند.</p><Button className="mt-4" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4"/>تازه‌سازی</Button></CardContent></Card>}
      {!loading && exams.length > 0 && shown.length === 0 && <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">در این دسته آزمونی نیست. «همه» را ببینید.</p>}
      {shown.map((exam) => <ExamCard key={exam.id} exam={exam} now={now}/>)}
      {calendarExams.length > 0 && <details className="rounded-xl border bg-card px-4 py-3"><summary className="cursor-pointer list-none text-sm font-bold">نمایش تقویم ماهانهٔ آزمون‌ها</summary><div className="mt-3"><ExamCalendar exams={calendarExams} role="student"/></div></details>}
    </section>
  </PageContainer></PageTransition>;
}

/** Turn a time gap into a short label a student can act on. */
export function humanRemaining(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "کمتر از یک دقیقه";
  if (minutes < 60) return `${toPersianNumber(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest >= 30 ? `${toPersianNumber(hours)} ساعت و نیم` : `${toPersianNumber(hours)} ساعت`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours >= 12 ? `${toPersianNumber(days)} روز و ${toPersianNumber(restHours)} ساعت` : `${toPersianNumber(days)} روز`;
}

/** One compact card per exam: status, the relevant time, and one clear next action. */
function ExamCard({ exam, now }: { exam: Exam; now: number }) {
  const availability = AVAILABILITY[exam.availability ?? exam.status] ?? { label: exam.status, variant: "neutral" as const };
  const result = exam.resultSummary;
  const attemptsUsed = exam.attemptsUsed ?? exam.attemptNumber ?? 0;
  const attemptsLeft = Math.max(0, (exam.settings.attemptLimit ?? 1) - attemptsUsed);
  const href = exam.availability === "completed" && exam.attemptId ? `/student/results/${exam.attemptId}` : `/student/exam/${exam.id}`;
  const action = exam.availability === "in_progress" ? "ادامهٔ آزمون"
    : exam.availability === "available" ? (attemptsLeft > 0 ? "شروع آزمون" : "جزئیات آزمون")
      : exam.availability === "upcoming" ? "جزئیات آزمون"
        : result ? "مشاهدهٔ نتیجه" : "وضعیت نتیجه";
  const windowLeft = exam.availability === "available" ? new Date(exam.endAt).getTime() - now : 0;
  const startsIn = exam.availability === "upcoming" ? new Date(exam.startAt).getTime() - now : 0;
  const Icon = exam.availability === "completed" ? Award : exam.availability === "upcoming" ? CalendarDays : exam.availability === "in_progress" ? Timer : BookOpenCheck;

  return (
    <Card className="transition-colors hover:border-primary/35">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="h-4 w-4"/></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={availability.variant}>{availability.label}</Badge>
            <span className="text-[11px] text-muted-foreground">{exam.subject}{exam.teacherName ? ` · ${exam.teacherName}` : ""}</span>
            {exam.availability === "in_progress" && exam.remainingSeconds !== null && exam.remainingSeconds !== undefined && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400"><Clock3 className="h-3 w-3"/>{formatTime(exam.remainingSeconds)} باقی</span>}
            {exam.availability === "upcoming" && <span className="text-[10px] text-muted-foreground">شروع {formatDateTime(exam.startAt, exam.schedule?.timezone)} · {humanRemaining(startsIn)}</span>}
          </div>
          <h2 className="mt-1.5 truncate text-sm font-black">{exam.title}</h2>
          {exam.description && <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{exam.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>{toPersianNumber(exam.questionCount)} سؤال</span>
            <span>{toPersianNumber(exam.settings.durationMinutes)} دقیقه</span>
            {exam.settings.totalMarks > 0 && <span>{toPersianNumber(exam.settings.totalMarks)} نمره</span>}
            <span>تلاش {toPersianNumber(attemptsUsed)}/{toPersianNumber(exam.settings.attemptLimit ?? 1)}</span>
            {exam.availability === "available" && windowLeft > 0 && <span className="font-bold text-primary">مهلت: {humanRemaining(windowLeft)}</span>}
            {exam.availability === "available" && attemptsLeft === 0 && <span className="font-bold text-destructive">تلاش مجاز تمام شده</span>}
          </div>
        </div>
        {result && <ResultRing result={result}/>}
        {exam.availability === "completed" && !result && <span className="rounded-xl border border-dashed px-3 py-2 text-[11px] font-bold text-muted-foreground">در انتظار تصحیح</span>}
        <Button asChild size="sm" variant={exam.availability === "available" || exam.availability === "in_progress" ? "default" : "outline"}>
          <Link href={href}>{action}<ArrowLeft className="h-4 w-4"/></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** The percentage and score stay together so a result is readable without another dashboard panel. */
function ResultRing({ result }: { result: NonNullable<Exam["resultSummary"]> }) {
  const percent = result.percentage === null ? null : Math.max(0, Math.min(100, Math.round(result.percentage)));
  const tone = percent === null ? "text-muted-foreground" : result.passed === false ? "text-warning" : "text-success";
  const circumference = 2 * Math.PI * 22;
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl bg-muted/45 px-2 py-1.5">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center">
        <svg viewBox="0 0 52 52" className="h-11 w-11 -rotate-90" aria-hidden="true">
          <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted"/>
          <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (percent ?? 0) / 100)} className={tone}/>
        </svg>
        <span className={cn("absolute text-[10px] font-black", tone)}>{percent === null ? "—" : `${toPersianNumber(percent)}٪`}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-[9px] font-bold text-muted-foreground">نمره</span>
        <span className="block text-xs font-black">{toPersianNumber(result.score)} <span className="text-[9px] font-bold text-muted-foreground">از {toPersianNumber(result.maximumScore)}</span></span>
        {result.passed !== null && <Badge variant={result.passed ? "success" : "destructive"} className="mt-0.5">{result.passed ? "قبول" : "مردود"}</Badge>}
      </span>
    </div>
  );
}
