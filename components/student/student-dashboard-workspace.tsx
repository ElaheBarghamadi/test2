"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Award, BookOpenCheck, CalendarDays, Gauge, GraduationCap, ListChecks, RefreshCw, School, Timer } from "lucide-react";
import { attemptsApi } from "@/lib/api/attempts";
import { apiErrorMessage } from "@/lib/api/client";
import { toStudentDashboardExam } from "@/lib/api/mappers";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { ExamCalendar } from "@/components/shared/exam-calendar";
import { StudentExamCard } from "@/components/student/student-exam-card";
import { StudentPerformancePanel } from "@/components/student/student-performance-panel";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/state/auth-store";
import { cn, formatTime, humanRemaining, toPersianNumber } from "@/lib/utils";
import type { Exam } from "@/lib/types/domain";

/**
 * The student's front door.
 *
 * Three questions, answered in this order and then the page stops: is anything running right now, where do I
 * stand overall, and what is next. The exam list is the middle of those, not the whole of it — a student who
 * has sat six exams should not have to read six cards to learn their average.
 *
 * Every number on this page comes from `GET /student/exams/`, the same payload the list is drawn from, so
 * the summary and the list cannot disagree. The server stays authoritative for availability, timing and
 * results; nothing here is inferred that the server did not already state.
 */
type FilterKey = "all" | "action" | "upcoming" | "results";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "همه" },
  { key: "action", label: "نیازمند اقدام" },
  { key: "upcoming", label: "پیش‌رو" },
  { key: "results", label: "نتایج" },
];

/** Coarse on purpose: the authoritative countdown lives on the exam page, driven by the server clock. */
const LIST_TICK_MS = 30_000;

export function StudentDashboardWorkspace() {
  const user = useAuthStore((state) => state.user);
  const [exams, setExams] = useState<Exam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [now, setNow] = useState(() => Date.now());
  /** When the current payload was fetched. A countdown derived from it is exact on the very first paint,
   *  which a baseline captured in an effect is not — and the difference is a visible «—» flash. */
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await attemptsApi.listAvailable();
      setExams(items.map(toStudentDashboardExam));
    } catch (reason) {
      setError(apiErrorMessage(reason, "بارگذاری آزمون‌ها انجام نشد. اتصال خود را بررسی کنید."));
    } finally {
      const stamp = Date.now();
      setLoading(false);
      setNow(stamp);
      setLoadedAt(stamp);
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
    const tick = window.setInterval(() => setNow(Date.now()), LIST_TICK_MS);
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

  const summary = useMemo(() => summarise(exams), [exams]);

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

  // The greeting follows the school's own clock, not the device's: a student travelling does not get
  // «صبح بخیر» at nine in the evening.
  const greeting = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
      const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "12");
      return hour < 12 ? "صبح بخیر" : hour < 17 ? "روز بخیر" : "عصر بخیر";
    } catch {
      return "سلام";
    }
  }, []);
  const name = user?.fullName.split(" ")[0] || "دانش‌آموز";
  const identity = [user?.schoolName, user?.grade, user?.className].filter((part): part is string => Boolean(part && part.trim()));
  const calendarExams = [...buckets.upcoming, ...buckets.available, ...buckets.inProgress];
  const nextUp = buckets.upcoming[0] ?? buckets.available[0];
  const hasAnything = exams.length > 0;

  return <PageTransition><PageContainer>
    <PageHeader
      eyebrow="فضای یادگیری"
      title={`${greeting}، ${name}`}
      description={hasAnything
        ? summary.actionable > 0
          ? `${toPersianNumber(summary.actionable)} آزمون نیازمند اقدام شماست. بقیه در فهرست پایین و در بخش نتایج آمده‌اند.`
          : "چیز فوری در انتظار شما نیست؛ برنامهٔ پیش‌رو و کارنامه‌تان پایین آمده است."
        : "آزمون‌ها و نتایج شما"}
      breadcrumbs={[{ label: "دانش‌آموز" }, { label: "نمای کلی" }]}
      action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>تازه‌سازی</Button>}
    />

    {identity.length > 0 && (
      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2 sm:-mt-5">
        {user?.schoolName && <IdentityChip icon={School}>{user.schoolName}</IdentityChip>}
        {user?.grade && <IdentityChip icon={GraduationCap}>{user.grade}</IdentityChip>}
        {user?.className && <IdentityChip icon={ListChecks}>کلاس {user.className}</IdentityChip>}
      </div>
    )}

    {error && <Card className="mb-6 border-destructive/30"><CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4"/><span className="flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>تلاش دوباره</Button></CardContent></Card>}

    {loading && !hasAnything && <DashboardSkeleton/>}

    {!loading && !hasAnything && (
      <Card><CardContent className="p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><BookOpenCheck className="h-6 w-6"/></span>
        <h2 className="mt-4 text-base font-black">فعلاً آزمونی ندارید</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
          آزمون‌های در دسترس همین‌جا نمایش داده می‌شوند. اگر منتظر آزمون خاصی هستید، کمی بعد دوباره سر بزنید.
        </p>
        <Button className="mt-5" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4"/>تازه‌سازی</Button>
      </CardContent></Card>
    )}

    {hasAnything && <>
      {buckets.inProgress[0] && <ResumeBanner exam={buckets.inProgress[0]} loadedAt={loadedAt}/>}

      <div role="group" aria-label="خلاصهٔ وضعیت" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ListChecks} label="نیازمند اقدام" value={toPersianNumber(summary.actionable)} tone="amber"
          detail={buckets.inProgress.length
            ? `${toPersianNumber(buckets.inProgress.length)} آزمون در حال انجام`
            : buckets.available.length
              ? `نزدیک‌ترین مهلت: ${humanRemaining(Math.max(0, new Date(buckets.available[0].endAt).getTime() - now))}`
              : "همه را تحویل داده‌اید"}
        />
        <StatCard
          icon={CalendarDays} label="پیش‌رو" value={toPersianNumber(buckets.upcoming.length)} tone="indigo"
          detail={buckets.upcoming.length
            ? `شروع تا ${humanRemaining(Math.max(0, new Date(buckets.upcoming[0].startAt).getTime() - now))}`
            : "برنامهٔ زمان‌بندی‌شده‌ای ندارید"}
        />
        <StatCard
          icon={Gauge} label="میانگین درصد" value={summary.average === null ? "—" : `${toPersianNumber(summary.average)}٪`} tone="teal"
          trend={summary.trend === null || Math.abs(summary.trend) < 1 ? undefined : summary.trend > 0 ? "up" : "down"}
          detail={summary.scoredCount
            ? `از ${toPersianNumber(summary.scoredCount)} نتیجهٔ منتشرشده`
            : summary.pendingCount
              ? `${toPersianNumber(summary.pendingCount)} آزمون منتظر نمرهٔ آموزگار`
              : "هنوز نتیجه‌ای منتشر نشده"}
        />
        <StatCard
          icon={Award} label="قبولی" value={summary.verdictCount ? `${toPersianNumber(summary.passedCount)}/${toPersianNumber(summary.verdictCount)}` : "—"} tone="violet"
          detail={summary.verdictCount
            ? `نرخ قبولی ${toPersianNumber(summary.passRate)}٪`
            : "حدنصاب قبولی ثبت نشده است"}
        />
      </div>
    </>}

    <section id="exams" aria-labelledby="student-exams-heading" className="mt-8 scroll-mt-24">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 id="student-exams-heading" className="text-lg font-black tracking-tight">آزمون‌های من</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasAnything
              ? `${toPersianNumber(exams.length)} آزمون · به ترتیب اولویت زمانی`
              : "هر آزمونی که آموزگار برای شما منتشر کند این‌جا ظاهر می‌شود."}
          </p>
        </div>
        {hasAnything && (
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label="فیلتر آزمون‌ها">
            {FILTERS.map((item) => {
              const active = filter === item.key;
              const count = counts[item.key];
              return <button key={item.key} type="button" aria-pressed={active} onClick={() => setFilter(item.key)} className={cn("inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors", active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card hover:border-primary/45", !active && count === 0 && "text-muted-foreground")}>
                <span>{item.label}</span><span className={cn("text-[10px]", active ? "text-primary-foreground/75" : "text-muted-foreground")}>{toPersianNumber(count)}</span>
              </button>;
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {hasAnything && shown.length === 0 && (
          <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
            در این دسته آزمونی نیست. «همه» را ببینید.
          </p>
        )}
        {shown.map((exam) => <StudentExamCard key={exam.id} exam={exam} now={now}/>)}
      </div>
    </section>

    {hasAnything && <>
      <section id="results" aria-labelledby="student-results-heading" className="mt-10 scroll-mt-24">
        <div className="mb-4">
          <h2 id="student-results-heading" className="text-lg font-black tracking-tight">نتایج و عملکرد</h2>
          <p className="mt-1 text-xs text-muted-foreground">کارنامه، روند نمرات و فهرست آزمون‌هایی که تحویل داده‌اید.</p>
        </div>
        <StudentPerformancePanel exams={exams}/>
      </section>

      <section aria-labelledby="student-calendar-heading" className="mt-6 scroll-mt-24">
        <h2 id="student-calendar-heading" className="sr-only">تقویم آزمون‌ها</h2>
        {calendarExams.length > 0
          ? <ExamCalendar exams={calendarExams} role="student"/>
          : <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">آزمون زمان‌بندی‌شده‌ای برای نمایش در تقویم نیست. {nextUp ? "" : "به محض انتشار، همین‌جا می‌آید."}</CardContent></Card>}
      </section>
    </>}
  </PageContainer></PageTransition>;
}

/**
 * Everything the stat strip and the header sentence need, derived once from the same list the cards render.
 */
export function summarise(exams: Exam[]) {
  const published = exams.filter((exam) => exam.resultSummary !== null && exam.resultSummary !== undefined);
  const scored = published
    .filter((exam) => exam.resultSummary?.percentage !== null && exam.resultSummary?.percentage !== undefined)
    .map((exam) => ({ percentage: exam.resultSummary!.percentage as number, when: exam.resultSummary!.submittedAt ?? exam.endAt }))
    .sort((a, b) => a.when.localeCompare(b.when));
  const verdicts = published.filter((exam) => exam.resultSummary?.passed !== null && exam.resultSummary?.passed !== undefined);
  const passedCount = verdicts.filter((exam) => exam.resultSummary?.passed === true).length;
  const average = scored.length ? scored.reduce((sum, item) => sum + item.percentage, 0) / scored.length : null;
  const pendingCount = exams.filter((exam) => exam.availability === "completed"
    && (exam.resultSummary === null || exam.resultSummary === undefined || !exam.resultSummary.isFinal)).length;
  const actionable = exams.filter((exam) => exam.availability === "in_progress" || exam.availability === "available").length;
  return {
    publishedCount: published.length,
    scoredCount: scored.length,
    verdictCount: verdicts.length,
    passedCount,
    pendingCount,
    actionable,
    average: average === null ? null : Math.max(0, Math.min(100, Math.round(average))),
    passRate: verdicts.length ? Math.round((passedCount / verdicts.length) * 100) : 0,
    trend: scored.length >= 2 ? scored[scored.length - 1].percentage - scored[scored.length - 2].percentage : null,
  };
}

function IdentityChip({ icon: Icon, children }: { icon: typeof School; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true"/>
      <span className="max-w-48 truncate">{children}</span>
    </span>
  );
}

/**
 * The one thing that must not be missed.
 *
 * A half-finished attempt is the only state on this page where doing nothing loses the student marks, so it
 * gets a full-width band above the stats with a clock that actually moves. Everything else can wait for the
 * list. The clock here ticks locally from the server's own `remaining_seconds`; the exam page re-reads the
 * deadline from the server, so this is a countdown and not an authority.
 */
function ResumeBanner({ exam, loadedAt }: { exam: Exam; loadedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = exam.remainingSeconds !== null && exam.remainingSeconds !== undefined;

  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking, loadedAt]);

  // The server's own figure, walked forward locally. This is a countdown and not an authority: the exam
  // page re-reads the deadline from the server, so a device clock that drifts cannot cost anyone marks.
  const left = exam.remainingSeconds === null || exam.remainingSeconds === undefined
    ? null
    : Math.max(0, exam.remainingSeconds - Math.floor((now - loadedAt) / 1000));
  const expiring = left !== null && left <= 300;

  return (
    <div className={cn(
      "relative isolate mt-6 overflow-hidden rounded-2xl border p-4 shadow-lift transition-colors sm:p-5",
      expiring ? "border-destructive/40 bg-destructive/[.06]" : "border-primary/30 bg-primary/[.055]",
    )}>
      <span aria-hidden="true" className="pointer-events-none absolute -left-12 -top-16 -z-10 h-48 w-48 rounded-full bg-primary/10 blur-3xl"/>
      <div className="flex flex-wrap items-center gap-4">
        <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-primary-foreground shadow-sm", expiring ? "bg-destructive" : "bg-primary")}>
          <Timer className="h-6 w-6" aria-hidden="true"/>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={expiring ? "destructive" : "warning"}>آزمون در جریان</Badge>
            {expiring && <span className="text-[10px] font-black text-destructive">کمتر از ۵ دقیقه باقی است</span>}
          </div>
          {/* Deliberately not a heading: the exam's own card below carries the `<h2>`, and two headings with
              the same name on one page makes the list impossible to query by title. */}
          <p className="mt-1.5 truncate text-sm font-black tracking-tight sm:text-base">{exam.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {exam.subject}{exam.teacherName ? ` · ${exam.teacherName}` : ""}
            {" · "}تلاش {toPersianNumber(exam.attemptNumber ?? exam.attemptsUsed ?? 1)} از {toPersianNumber(exam.settings.attemptLimit ?? 1)}
          </p>
        </div>

        <div className="shrink-0 text-center">
          <p className="text-[10px] font-bold text-muted-foreground">زمان باقی‌مانده</p>
          <p role="timer" className={cn("mt-0.5 text-2xl font-black tabular-nums tracking-tight sm:text-3xl", expiring ? "text-destructive" : "text-foreground")}>
            {left === null ? "—" : formatTime(left)}
          </p>
        </div>

        <Button asChild className="shrink-0" variant={expiring ? "destructive" : "default"}>
          <Link href={`/student/exam/${exam.id}`}>بازگشت به جلسهٔ آزمون<ArrowLeft className="h-4 w-4"/></Link>
        </Button>
      </div>
      <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
        پاسخ‌های شما تا این لحظه ذخیره شده‌اند. با بازگشت به جلسه، زمان از سرور خوانده می‌شود.
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card className="p-5" key={index}><Skeleton className="h-10 w-10"/><Skeleton className="mt-5 h-8 w-16"/><Skeleton className="mt-3 h-4 w-28"/></Card>
        ))}
      </div>
      <div className="space-y-3"><Skeleton className="h-28 rounded-2xl"/><Skeleton className="h-28 rounded-2xl"/></div>
    </div>
  );
}
