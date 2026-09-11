"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Award, BookOpenCheck, CalendarDays, CheckCircle2, ClipboardList, Clock3, Flag, Gauge, Lightbulb, RefreshCw, Save, ShieldCheck, Sparkles, Timer, Trophy } from "lucide-react";
import { attemptsApi } from "@/lib/api/attempts";
import { apiErrorMessage } from "@/lib/api/client";
import { toStudentDashboardExam } from "@/lib/api/mappers";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { ExamCalendar } from "@/components/shared/exam-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/state/auth-store";
import { cn, formatDateTime, formatTime, toPersianNumber } from "@/lib/utils";
import type { Exam } from "@/lib/types/domain";

/**
 * The student's front door.
 *
 * The page used to stack five sections — in progress, ready, upcoming, results, waiting — so a student with
 * one exam to take still scrolled past four headings to find it, and the only number that actually matters
 * to them (how much of the exam window is left) appeared nowhere. One filter rail with counts, a card per
 * exam that carries its own clock, and a result ring in the sidebar say the same things in one screen.
 *
 * Every number here is the server's: availability, remaining time, results. The client never decides what
 * a student may start; the API refuses it regardless of what this page shows.
 */
type FilterKey = "all" | "in_progress" | "available" | "upcoming" | "results";

const FILTERS: Array<{ key: FilterKey; label: string; icon: typeof Gauge }> = [
  { key: "all", label: "همه", icon: ClipboardList },
  { key: "in_progress", label: "در جریان", icon: Timer },
  { key: "available", label: "آمادهٔ شروع", icon: BookOpenCheck },
  { key: "upcoming", label: "پیش‌رو", icon: CalendarDays },
  { key: "results", label: "نتایج", icon: Trophy },
];

const ACCENTS: Record<Exam["accent"], { tile: string; glow: string }> = {
  indigo: { tile: "from-indigo-500/15 to-indigo-500/[.03] text-indigo-600 dark:text-indigo-400", glow: "bg-indigo-500/10" },
  violet: { tile: "from-violet-500/15 to-violet-500/[.03] text-violet-600 dark:text-violet-400", glow: "bg-violet-500/10" },
  teal: { tile: "from-teal-500/15 to-teal-500/[.03] text-teal-600 dark:text-teal-400", glow: "bg-teal-500/10" },
  amber: { tile: "from-amber-500/15 to-amber-500/[.03] text-amber-600 dark:text-amber-400", glow: "bg-amber-500/10" },
};

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
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [now, setNow] = useState(() => Date.now());

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

  const resultsReady = buckets.finished.filter((exam) => exam.resultSummary);
  const resultsWaiting = buckets.finished.filter((exam) => !exam.resultSummary);
  const counts: Record<FilterKey, number> = {
    all: exams.length,
    in_progress: buckets.inProgress.length,
    available: buckets.available.length,
    upcoming: buckets.upcoming.length,
    results: resultsReady.length + resultsWaiting.length,
  };
  const shown = filter === "all"
    ? [...buckets.inProgress, ...buckets.available, ...buckets.upcoming, ...buckets.finished]
    : filter === "in_progress" ? buckets.inProgress
      : filter === "available" ? buckets.available
        : filter === "upcoming" ? buckets.upcoming
          : buckets.finished;
  const hero = filter === "all" ? buckets.inProgress[0] ?? buckets.available[0] ?? null : null;
  const nextUp = buckets.upcoming[0] ?? buckets.available.find((exam) => new Date(exam.startAt).getTime() > now) ?? null;
  const name = user?.fullName.split(" ")[0] || "دانش‌آموز";
  const calendarExams = [...buckets.upcoming, ...buckets.available, ...buckets.inProgress];

  return <PageTransition><PageContainer>
    <PageHeader
      eyebrow="فضای یادگیری شما"
      title={`سلام، ${name} 👋`}
      description="آزمون‌ها، زمان باقی‌مانده و وضعیت نتیجه مستقیماً از سرویس آموزشی دریافت می‌شود."
      breadcrumbs={[{ label: "دانش‌آموز" }, { label: "نمای کلی" }]}
      action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>به‌روزرسانی</Button>}
    />

    {nextUp && <NextUpBand exam={nextUp} now={now}/>}

    <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="نمایش آزمون‌ها">
      {FILTERS.map((item) => {
        const Icon = item.icon;
        const active = filter === item.key;
        const count = counts[item.key];
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => setFilter(item.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-xs font-black transition-all",
              active ? "border-primary bg-primary text-white shadow-soft" : "bg-card hover:border-primary/45",
              !active && count === 0 && "text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4"/>{item.label}
            <span className={cn("rounded-lg px-1.5 py-0.5 text-[10px]", active ? "bg-white/20" : "bg-muted text-muted-foreground")}>{toPersianNumber(count)}</span>
          </button>
        );
      })}
    </div>

    {error && <Card className="mt-5 border-destructive/30"><CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4"/><span className="flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>تلاش دوباره</Button></CardContent></Card>}

    <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_.85fr]">
      <section className="space-y-4">
        {loading && !exams.length && <div className="space-y-3"><div className="h-40 animate-soft-pulse rounded-3xl bg-muted"/><div className="h-28 animate-soft-pulse rounded-3xl bg-muted"/></div>}

        {!loading && !exams.length && (
          <Card>
            <CardContent className="p-8 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-gradient-to-br from-indigo-500/15 to-teal-500/10 text-primary"><Sparkles className="h-6 w-6"/></span>
              <h2 className="mt-4 text-lg font-black">هنوز آزمون فعالی برای شما منتشر نشده است</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">به‌محض اینکه معلم آزمونی را زمان‌بندی یا منتشر کند، همین‌جا با زمان دقیق شروع و پایان آن ظاهر می‌شود. برای اطلاع از انتشار، اعلان‌های حساب خود را روشن نگه دارید.</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4"/>تازه‌سازی</Button>
                <Button asChild><Link href="/student/profile">مشخصات حساب<ArrowLeft className="h-4 w-4"/></Link></Button>
              </div>
            </CardContent>
          </Card>
        )}

        {hero && <HeroCard exam={hero} now={now}/>}

        {shown.filter((exam) => exam.id !== hero?.id).length === 0 && !loading && exams.length > 0 && !hero && (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">در این دسته چیزی برای نمایش نیست. از کلیدهای بالا دستهٔ دیگر را ببینید.</CardContent></Card>
        )}

        <div className="space-y-3">
          {shown.filter((exam) => exam.id !== hero?.id).map((exam) => <ExamCard key={exam.id} exam={exam} now={now}/>)}
        </div>
      </section>

      <aside className="space-y-5">
        <ResultsSummaryCard ready={resultsReady} waiting={resultsWaiting.length}/>
        <HowItWorksCard/>
        <Card>
          <CardHeader><CardTitle className="text-sm">دسترسی امن آزمون</CardTitle><CardDescription>اطلاعات هر آزمون تنها هنگام شروع و از سرور دریافت می‌شود.</CardDescription></CardHeader>
          <CardContent>
            <div className="rounded-2xl bg-primary/5 p-4 text-xs leading-6 text-muted-foreground"><ShieldCheck className="ml-1.5 inline h-4 w-4 text-emerald-600 align-text-bottom"/>زمان، ترتیب سؤال‌ها و نمرهٔ نهایی در سرور محاسبه می‌شود؛ کلید پاسخ برای دانش‌آموز ارسال نمی‌شود.</div>
            {refreshedAt && <p className="mt-3 text-[11px] text-muted-foreground">آخرین به‌روزرسانی: {formatDateTime(refreshedAt.toISOString())}</p>}
          </CardContent>
        </Card>
        <ExamCalendar exams={calendarExams} role="student"/>
      </aside>
    </div>
  </PageContainer></PageTransition>;
}

/** The one number a student is really asking about: how long until it starts. */
function NextUpBand({ exam, now }: { exam: Exam; now: number }) {
  const startsIn = new Date(exam.startAt).getTime() - now;
  const open = startsIn <= 0;
  return (
    <Card className="relative mt-5 overflow-hidden border-primary/20 bg-gradient-to-l from-primary/[.09] via-card to-card">
      <div className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full bg-primary/10 blur-3xl"/>
      <CardContent className="relative flex flex-wrap items-center gap-4 p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary"><Gauge className="h-5 w-5"/></span>
        <div className="min-w-0 flex-1">
          <p className="section-label">{open ? "اکنون باز است" : "تا شروع"}</p>
          <p className="mt-1 truncate text-base font-black">{exam.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{exam.subject} · شروع {formatDateTime(exam.startAt, exam.schedule?.timezone)}</p>
        </div>
        <div className="text-left">
          <p className="text-2xl font-black tabular-nums leading-8 text-primary">{open ? "آماده" : humanRemaining(startsIn)}</p>
          <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{toPersianNumber(exam.questionCount)} سؤال · {toPersianNumber(exam.settings.durationMinutes)} دقیقه</p>
        </div>
        <Button asChild size="sm">{<Link href={`/student/exam/${exam.id}`}>{open ? "رفتن به آزمون" : "مشاهدهٔ توضیح"}<ArrowLeft className="h-4 w-4"/></Link>}</Button>
      </CardContent>
    </Card>
  );
}

/** Turn a millisecond gap into the words a student reads, not a raw countdown. */
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

/** The card a student acts on: what it is, how much time is left, and one clear button. */
function ExamCard({ exam, now }: { exam: Exam; now: number }) {
  const availability = AVAILABILITY[exam.availability ?? exam.status] ?? { label: exam.status, variant: "neutral" as const };
  const accent = ACCENTS[exam.accent] ?? ACCENTS.indigo;
  const result = exam.resultSummary;
  const attemptsUsed = exam.attemptsUsed ?? exam.attemptNumber ?? 0;
  const attemptsLeft = Math.max(0, (exam.settings.attemptLimit ?? 1) - attemptsUsed);
  const href = exam.availability === "completed" && exam.attemptId ? `/student/results/${exam.attemptId}` : `/student/exam/${exam.id}`;
  const action = exam.availability === "in_progress" ? "ادامهٔ آزمون" : exam.availability === "available" ? "مشاهده و شروع" : exam.availability === "upcoming" ? "جزئیات آزمون" : result ? "مشاهدهٔ برگهٔ نتیجه" : "وضعیت نتیجه";
  const windowLeft = exam.availability === "available" ? new Date(exam.endAt).getTime() - now : 0;
  const Icon = exam.availability === "completed" ? Award : exam.availability === "upcoming" ? CalendarDays : exam.availability === "in_progress" ? Timer : BookOpenCheck;

  return (
    <Card className="group transition-all hover:border-primary/40 hover:shadow-soft">
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br", accent.tile)}><Icon className="h-5 w-5"/></span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={availability.variant}>{availability.label}</Badge>
            <span className="text-[11px] font-bold text-muted-foreground">{exam.subject}{exam.teacherName ? ` · ${exam.teacherName}` : ""}</span>
            {exam.availability === "in_progress" && exam.remainingSeconds !== null && exam.remainingSeconds !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/12 px-2 py-0.5 text-[10px] font-black text-amber-700 dark:text-amber-400"><Clock3 className="h-3 w-3"/>{formatTime(exam.remainingSeconds)} باقی است</span>
            )}
            {exam.availability === "upcoming" && <span className="text-[10px] font-bold text-muted-foreground">شروع: {formatDateTime(exam.startAt, exam.schedule?.timezone)}</span>}
          </div>
          <p className="mt-2 truncate text-sm font-black">{exam.title}</p>
          {exam.description && <p className="mt-1 line-clamp-1 text-[11px] leading-5 text-muted-foreground">{exam.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{toPersianNumber(exam.questionCount)} سؤال</span>
            <span>{toPersianNumber(exam.settings.durationMinutes)} دقیقه</span>
            {exam.settings.totalMarks > 0 && <span>{toPersianNumber(exam.settings.totalMarks)} نمره</span>}
            <span>تلاش {toPersianNumber(attemptsUsed)}/{toPersianNumber(exam.settings.attemptLimit ?? 1)}</span>
            {exam.availability === "available" && attemptsLeft === 0 && <span className="font-bold text-destructive">تعداد تلاش‌ها تمام شده است</span>}
          </div>
          {exam.availability === "available" && windowLeft > 0 && (
            <div className="mt-3 max-w-sm">
              <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground">
                <span>{humanRemaining(windowLeft)} تا پایان مهلت</span>
                <span>{formatDateTime(exam.endAt, exam.schedule?.timezone)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-l from-primary to-teal-500" style={{ width: `${windowProgress(exam, now)}%` }}/></div>
            </div>
          )}
        </div>

        {result && <ResultRing result={result}/>}
        {exam.availability === "completed" && !result && (
          <div className="w-[132px] rounded-2xl border border-dashed p-3 text-center">
            <p className="text-[11px] font-black text-muted-foreground">در انتظار بررسی آموزگار</p>
            <p className="mt-1 text-[10px] leading-5 text-muted-foreground">پاسخ‌ها ثبت شده و نمره پس از تصحیح منتشر می‌شود.</p>
          </div>
        )}

        <Button asChild size="sm" variant={exam.availability === "available" || exam.availability === "in_progress" ? "default" : "outline"}>
          <Link href={href}>{action}<ArrowLeft className="h-4 w-4"/></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function windowProgress(exam: Exam, now: number) {
  const start = new Date(exam.startAt).getTime();
  const end = new Date(exam.endAt).getTime();
  if (!(end > start)) return 0;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

/** A ring instead of a bare number: the percentage reads instantly, and the colour carries the verdict. */
function ResultRing({ result }: { result: NonNullable<Exam["resultSummary"]> }) {
  const percent = result.percentage === null ? null : Math.max(0, Math.min(100, Math.round(result.percentage)));
  const tone = percent === null ? "text-muted-foreground" : result.passed === false ? "text-amber-600" : "text-emerald-600";
  const circumference = 2 * Math.PI * 22;
  return (
    <div className="flex w-[132px] shrink-0 items-center gap-3 rounded-2xl border bg-muted/30 p-2.5">
      <span className="relative grid h-14 w-14 shrink-0 place-items-center">
        <svg viewBox="0 0 52 52" className="h-14 w-14 -rotate-90" aria-hidden="true">
          <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted"/>
          <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (percent ?? 0) / 100)} className={tone}/>
        </svg>
        <span className={cn("absolute text-[11px] font-black", tone)}>{percent === null ? "—" : `${toPersianNumber(percent)}٪`}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold text-muted-foreground">نمرهٔ شما</span>
        <span className="block text-sm font-black">{toPersianNumber(result.score)} <span className="text-[10px] font-bold text-muted-foreground">از {toPersianNumber(result.maximumScore)}</span></span>
        {result.passed !== null && <Badge variant={result.passed ? "success" : "destructive"} className="mt-1">{result.passed ? "قبول" : "مردود"}</Badge>}
      </span>
    </div>
  );
}

function ResultsSummaryCard({ ready, waiting }: { ready: Exam[]; waiting: number }) {
  const withPercent = ready.filter((exam) => exam.resultSummary?.percentage !== null && exam.resultSummary?.percentage !== undefined);
  const average = withPercent.length ? Math.round(withPercent.reduce((sum, exam) => sum + Number(exam.resultSummary?.percentage ?? 0), 0) / withPercent.length) : null;
  const best = withPercent.length ? Math.round(Math.max(...withPercent.map((exam) => Number(exam.resultSummary?.percentage ?? 0)))) : null;
  const passed = ready.filter((exam) => exam.resultSummary?.passed === true).length;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">کارنامهٔ شما</CardTitle><CardDescription>{ready.length ? `${toPersianNumber(ready.length)} نتیجهٔ منتشرشده` : "هنوز نتیجه‌ای منتشر نشده است."}</CardDescription></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 text-center">
          {([[Gauge, "میانگین", average === null ? "—" : `${toPersianNumber(average)}٪`], [Trophy, "بهترین", best === null ? "—" : `${toPersianNumber(best)}٪`], [CheckCircle2, "قبولی", `${toPersianNumber(passed)}/${toPersianNumber(ready.length)}`]] as const).map(([Icon, label, value]) => (
            <div key={label} className="rounded-2xl bg-muted/45 p-3">
              <Icon className="mx-auto h-4 w-4 text-primary"/>
              <p className="mt-1.5 text-sm font-black">{value}</p>
              <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        {waiting > 0 && <p className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-500/[.08] p-3 text-[11px] leading-5 text-amber-800 dark:text-amber-300"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0"/>{toPersianNumber(waiting)} برگه در انتظار نمرهٔ دستی آموزگار است؛ پس از انتشار، نتیجهٔ نهایی جای آن را می‌گیرد.</p>}
      </CardContent>
    </Card>
  );
}

function HowItWorksCard() {
  const rows = [
    [Save, "پاسخ‌ها خودکار ذخیره می‌شوند", "نیازی به دکمهٔ ذخیره نیست؛ با قطع اینترنت هم آخرین پاسخ شما محفوظ می‌ماند."],
    [Flag, "سؤال‌های دشوار را نشاندار کنید", "نشان‌دار کردن روی نمره اثر ندارد و فقط برای مرور دوبارهٔ شماست."],
    [Timer, "زمان در سرور شمرده می‌شود", "بستن تب یا رفتن از صفحه زمان را متوقف نمی‌کند."],
    [ArrowLeft, "بازگشت به سؤال قبلی", "اگر معلم اجازهٔ بازگشت را بسته باشد، پس از رد شدن از یک سؤال نمی‌توانید به آن برگردید."],
  ] as const;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">قبل از شروع، این‌ها را بدانید</CardTitle></CardHeader>
      <CardContent className="space-y-2.5">
        {rows.map(([Icon, title, detail]) => (
          <div key={title} className="flex items-start gap-2.5 rounded-2xl bg-muted/40 p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-background text-primary shadow-soft"><Icon className="h-4 w-4"/></span>
            <span className="min-w-0">
              <span className="block text-[11px] font-black">{title}</span>
              <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">{detail}</span>
            </span>
          </div>
        ))}
        <p className="flex items-center gap-1.5 pt-1 text-[10px] font-bold text-muted-foreground"><Lightbulb className="h-3.5 w-3.5 text-amber-500"/>اگر زمان آزمون به پایان برسد، آخرین پاسخ‌های ذخیره‌شده ارسال می‌شود.</p>
      </CardContent>
    </Card>
  );
}

/** The resume card: its countdown is the server's, never a local guess. */
function HeroCard({ exam, now }: { exam: Exam; now: number }) {
  const resuming = exam.availability === "in_progress";
  const attemptsLeft = Math.max(0, (exam.settings.attemptLimit ?? 1) - (exam.attemptsUsed ?? 0));
  const windowLeft = new Date(exam.endAt).getTime() - now;
  return (
    <Card className="relative overflow-hidden border-primary/15 bg-gradient-to-l from-primary/[.07] to-card">
      <div className="pointer-events-none absolute -left-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl"/>
      <CardContent className="relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Badge variant={resuming ? "warning" : "success"}>{resuming ? "آزمون در حال انجام" : "اکنون آمادهٔ شروع"}</Badge>
            <p className="mt-4 text-xs font-bold text-muted-foreground">{exam.subject} · {toPersianNumber(exam.settings.durationMinutes)} دقیقه · {toPersianNumber(exam.questionCount)} سؤال</p>
            <h2 className="mt-1 text-xl font-black">{exam.title}</h2>
            {exam.description && <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{exam.description}</p>}
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold">
              {resuming && exam.remainingSeconds !== null && exam.remainingSeconds !== undefined && <span className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300"><Clock3 className="h-3.5 w-3.5"/> {formatTime(exam.remainingSeconds)} باقی‌مانده</span>}
              <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-muted-foreground"><ClipboardList className="h-3.5 w-3.5"/>تلاش {toPersianNumber((exam.attemptsUsed ?? 0) + (resuming ? 1 : 0))} از {toPersianNumber(exam.settings.attemptLimit ?? 1)}</span>
              {!resuming && windowLeft > 0 && <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-muted-foreground"><Timer className="h-3.5 w-3.5"/>{humanRemaining(windowLeft)} برای شروع</span>}
              {exam.settings.totalMarks > 0 && <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5"/>{toPersianNumber(exam.settings.totalMarks)} نمره</span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <Button asChild size="lg">{<Link href={`/student/exam/${exam.id}`}>{resuming ? "ادامهٔ آزمون" : "مشاهده و شروع"} <ArrowLeft className="h-4 w-4"/></Link>}</Button>
            {!resuming && attemptsLeft === 0 && <p className="text-[11px] font-bold text-destructive">تعداد تلاش‌های مجاز به پایان رسیده است.</p>}
            {!resuming && attemptsLeft > 0 && <p className="text-[11px] font-bold text-muted-foreground">{toPersianNumber(attemptsLeft)} تلاش مجاز باقی مانده است.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
