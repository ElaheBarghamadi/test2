"use client";

import Link from "next/link";
import { ArrowLeft, Award, ClipboardCheck, Gauge, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate, toPersianNumber } from "@/lib/utils";
import type { Exam } from "@/lib/types/domain";

/**
 * The student's own record, assembled from what the server already published.
 *
 * There is no student overview endpoint, and this does not invent one: every figure here is derived from
 * `GET /student/exams/`, which is the same payload the list above is drawn from. What that means in practice
 * is that the panel can only ever show results the teacher has actually released — a paper still sitting in
 * the grading queue appears as «منتظر نمرهٔ آموزگار», never as a zero.
 *
 * That distinction is the whole reason this panel exists separately from the exam list: a student who has
 * sat six exams wants to know where they stand, and reading six cards to work it out is not an answer.
 */

interface Scored { exam: Exam; percentage: number; passed: boolean | null; when: string; }

function collect(exams: Exam[]) {
  const published = exams.filter((exam) => exam.resultSummary !== null && exam.resultSummary !== undefined);
  const scored: Scored[] = published
    .filter((exam) => exam.resultSummary?.percentage !== null && exam.resultSummary?.percentage !== undefined)
    .map((exam) => ({
      exam,
      percentage: exam.resultSummary!.percentage as number,
      passed: exam.resultSummary!.passed,
      // Fall back to the exam window when an older payload has no submission stamp: the trend still has to
      // be chronological, and the window is the honest second-best ordering key.
      when: exam.resultSummary!.submittedAt ?? exam.endAt,
    }))
    .sort((a, b) => a.when.localeCompare(b.when));

  const verdicts = published.filter((exam) => exam.resultSummary?.passed !== null && exam.resultSummary?.passed !== undefined);
  const passed = verdicts.filter((exam) => exam.resultSummary?.passed === true);
  const average = scored.length ? scored.reduce((sum, item) => sum + item.percentage, 0) / scored.length : null;
  const best = scored.length ? scored.reduce((top, item) => (item.percentage > top.percentage ? item : top)) : null;
  const worst = scored.length ? scored.reduce((low, item) => (item.percentage < low.percentage ? item : low)) : null;
  // Submitted but not released yet: a published summary that the teacher has not marked final, or none at all.
  const pending = exams.filter((exam) => exam.availability === "completed"
    && (exam.resultSummary === null || exam.resultSummary === undefined || !exam.resultSummary.isFinal));

  return { published, scored, verdicts, passed, average, best, worst, pending };
}

export function StudentPerformancePanel({ exams }: { exams: Exam[] }) {
  const { published, scored, verdicts, passed, average, best, worst, pending } = collect(exams);

  if (!published.length) {
    return (
      <Card>
        <CardContent className="p-7 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Gauge className="h-5 w-5"/></span>
          <h3 className="mt-3 font-black">هنوز نتیجه‌ای منتشر نشده است</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
            {pending.length
              ? `${toPersianNumber(pending.length)} آزمون را تحویل داده‌اید و منتظر نمرهٔ آموزگار هستید. به محض انتشار، کارنامه و روند نمرات همین‌جا ساخته می‌شود.`
              : "پس از برگزاری نخستین آزمون و انتشار نمره توسط آموزگار، کارنامه و روند نمرات شما همین‌جا ساخته می‌شود."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const averagePercent = average === null ? null : Math.max(0, Math.min(100, Math.round(average)));
  const passRate = verdicts.length ? Math.round((passed.length / verdicts.length) * 100) : null;
  // Half-way through a term the arrow is noise; it only means something once there is something before it.
  const trend = scored.length >= 2 ? scored[scored.length - 1].percentage - scored[scored.length - 2].percentage : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Card className="relative isolate overflow-hidden">
          <span aria-hidden="true" className="pointer-events-none absolute -left-10 -top-12 -z-10 h-40 w-40 rounded-full bg-primary/[.06] blur-2xl"/>
          <CardHeader className="pb-3">
            <CardTitle>کارنامهٔ شما</CardTitle>
            <CardDescription className="text-xs">
              از {toPersianNumber(published.length)} نتیجهٔ منتشرشده
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <AverageRing percent={averagePercent}/>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-muted-foreground">میانگین شما</p>
                <p className="mt-0.5 text-2xl font-black leading-tight tracking-tight">
                  {averagePercent === null ? "—" : `${toPersianNumber(averagePercent)}٪`}
                </p>
                {trend !== null && Math.abs(trend) >= 1 && (
                  <p className={cn("mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black", trend > 0 ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                    {trend > 0 ? <TrendingUp className="h-3 w-3" aria-hidden="true"/> : <TrendingDown className="h-3 w-3" aria-hidden="true"/>}
                    {trend > 0 ? "رو به رشد" : "نیازمند توجه"} · {toPersianNumber(Math.abs(Math.round(trend)))}٪ نسبت به آزمون پیش
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between text-[11px] font-bold">
                <span className="text-muted-foreground">نرخ قبولی</span>
                <span>{passRate === null ? "حدنصابی ثبت نشده" : `${toPersianNumber(passRate)}٪`}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={passRate ?? 0} aria-label="نرخ قبولی در نتایج منتشرشده">
                <div className="h-full rounded-full bg-success transition-[width] duration-700 ease-out" style={{ width: `${passRate ?? 0}%` }}/>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {verdicts.length
                  ? `${toPersianNumber(passed.length)} قبول از ${toPersianNumber(verdicts.length)} آزمون دارای حدنصاب`
                  : "برای این آزمون‌ها حدنصاب قبولی تعیین نشده است."}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="بالاترین" value={best ? `${toPersianNumber(Math.round(best.percentage))}٪` : "—"} icon={Award}/>
              <MiniStat label="پایین‌ترین" value={worst ? `${toPersianNumber(Math.round(worst.percentage))}٪` : "—"} icon={Gauge}/>
              <MiniStat label="منتظر نمره" value={toPersianNumber(pending.length)} icon={ClipboardCheck}/>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>روند نمرات</CardTitle>
            <CardDescription className="text-xs">
              {scored.length
                ? `به ترتیب زمان تحویل، از ${formatDate(scored[0].when, "Asia/Tehran")} تا ${formatDate(scored[scored.length - 1].when, "Asia/Tehran")}`
                : "نتیجهٔ درصدی منتشر نشده است"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scored.length ? <ScoreTrend items={scored}/> : (
              <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                نمرهٔ خام منتشر شده است اما درصدی در کار نیست؛ روند با انتشار درصد ساخته می‌شود.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>فهرست نتایج</CardTitle>
          <CardDescription className="text-xs">همهٔ آزمون‌هایی که تحویل داده‌اید، تازه‌ترین اول</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          <ol className="divide-y divide-border/70">
            {[...published].sort((a, b) => (b.resultSummary?.submittedAt ?? b.endAt).localeCompare(a.resultSummary?.submittedAt ?? a.endAt)).map((exam) => {
              const summary = exam.resultSummary!;
              const percent = summary.percentage === null ? null : Math.round(summary.percentage);
              return (
                <li key={exam.id} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6">
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[10px] font-black",
                    summary.passed === null ? "bg-muted text-muted-foreground" : summary.passed ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                    {percent === null ? "—" : `${toPersianNumber(percent)}٪`}
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Title and subject share one text node on purpose: a transcript row that repeats the
                        bare exam title makes every list query on this page ambiguous. */}
                    <span className="block truncate text-xs font-black">{`${exam.title} · ${exam.subject}`}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {summary.submittedAt ? `تحویل ${formatDate(summary.submittedAt, "Asia/Tehran")}` : formatDate(exam.endAt, "Asia/Tehran")}
                      {` · ${toPersianNumber(summary.score)} از ${toPersianNumber(summary.maximumScore)} نمره`}
                    </span>
                  </span>
                  {summary.passed !== null && <Badge variant={summary.passed ? "success" : "destructive"}>{summary.passed ? "قبول" : "مردود"}</Badge>}
                  {summary.isFinal === false && <Badge variant="neutral">در انتظار بازبینی</Badge>}
                  {exam.attemptId && (
                    <Button asChild variant="ghost" size="sm" className="shrink-0">
                      <Link href={`/student/results/${exam.attemptId}`}>جزئیات<ArrowLeft className="h-3.5 w-3.5"/></Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <div className="rounded-xl bg-muted/55 p-2.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true"/>
      <p className="mt-1.5 text-base font-black leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-bold text-muted-foreground">{label}</p>
    </div>
  );
}

function AverageRing({ percent }: { percent: number | null }) {
  const circumference = 2 * Math.PI * 34;
  const tone = percent === null ? "text-muted-foreground" : percent >= 50 ? "text-success" : "text-warning";
  return (
    <span className="relative grid h-20 w-20 shrink-0 place-items-center">
      <svg viewBox="0 0 76 76" className="h-20 w-20 -rotate-90" aria-hidden="true">
        <circle cx="38" cy="38" r="34" fill="none" stroke="currentColor" strokeWidth="7" className="text-muted"/>
        <circle
          cx="38" cy="38" r="34" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (percent ?? 0) / 100)}
          className={cn(tone, "transition-[stroke-dashoffset] duration-700 ease-out")}
        />
      </svg>
      <span className="absolute flex flex-col items-center">
        <Sparkles className={cn("h-3.5 w-3.5", tone)} aria-hidden="true"/>
        <span className={cn("text-sm font-black leading-tight", tone)}>{percent === null ? "—" : `${toPersianNumber(percent)}٪`}</span>
      </span>
    </span>
  );
}

/**
 * Percentage bars, oldest to newest, reading right to left with the page.
 *
 * A `<ol>` rather than a decorative `<svg>`: a chart the screen reader cannot walk is a chart a blind
 * student cannot read, and each bar carries its own label so the list is meaningful without the visuals.
 */
function ScoreTrend({ items }: { items: Scored[] }) {
  const shown = items.slice(-12);
  return (
    <ol className="flex h-44 items-stretch gap-1.5 sm:gap-2.5" aria-label="روند درصد نمرات">
      {shown.map((item) => {
        const height = Math.max(4, Math.round(item.percentage));
        const tone = item.passed === null ? "bg-muted-foreground/45" : item.passed ? "bg-success/80" : "bg-warning/80";
        return (
          <li key={item.exam.id} className="group flex h-full min-w-0 flex-1 flex-col gap-1.5">
            {/*
             * The bar is grown by flex ratio rather than `height: N%`. A percentage needs a definite parent
             * height to resolve against, and inside a flex column whose own height comes from `flex-1` that
             * is exactly the case browsers disagree about — the bars would collapse to nothing. Two siblings
             * sharing the track in proportion `score : 100 - score` needs no resolution at all.
             */}
            <span className="flex min-h-0 flex-1 flex-col justify-end">
              <span
                className={cn("w-full shrink-0 rounded-t-lg transition-all duration-500 ease-out", tone)}
                style={{ flexGrow: height, flexBasis: 0 }}
                title={`${item.exam.title} — ${toPersianNumber(Math.round(item.percentage))}٪`}
              />
              <span className="w-full shrink-0" style={{ flexGrow: Math.max(0, 100 - height), flexBasis: 0 }} aria-hidden="true"/>
            </span>
            <span className="w-full truncate text-center text-[9px] text-muted-foreground">{item.exam.subject}</span>
            <span className="sr-only">{`${item.exam.title}: ${toPersianNumber(Math.round(item.percentage))} درصد`}</span>
          </li>
        );
      })}
    </ol>
  );
}
