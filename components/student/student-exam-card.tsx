"use client";

import Link from "next/link";
import { ArrowLeft, Award, BookOpenCheck, CalendarDays, Clock3, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatDateTime, formatTime, humanRemaining, toPersianNumber } from "@/lib/utils";
import type { Exam } from "@/lib/types/domain";

/**
 * One row of the student's exam list.
 *
 * The card answers three things in reading order and stops: what state is this in, when does it matter, and
 * what do I press. Everything else the server knows (integrity policy, layout, passing mark) belongs on the
 * start screen, where it is stated before the clock begins — repeating it here is what made the old
 * dashboard feel like a wall of small print.
 *
 * The colour rail is the one deliberate decoration: a student scanning twelve rows finds the amber one
 * without reading a single label.
 */

const AVAILABILITY: Record<string, {
  label: string;
  variant: "success" | "warning" | "default" | "neutral";
  rail: string;
  tile: string;
  icon: typeof Timer;
}> = {
  in_progress: {
    label: "در حال انجام", variant: "warning", rail: "bg-warning",
    tile: "from-amber-500/20 to-amber-500/[.04] text-amber-700 dark:text-amber-300", icon: Timer,
  },
  available: {
    label: "آمادهٔ شروع", variant: "success", rail: "bg-primary",
    tile: "from-indigo-500/20 to-indigo-500/[.04] text-indigo-700 dark:text-indigo-300", icon: BookOpenCheck,
  },
  upcoming: {
    label: "پیش‌رو", variant: "default", rail: "bg-teal-500/70",
    tile: "from-teal-500/20 to-teal-500/[.04] text-teal-700 dark:text-teal-300", icon: CalendarDays,
  },
  completed: {
    label: "پایان یافته", variant: "neutral", rail: "bg-violet-500/50",
    tile: "from-violet-500/20 to-violet-500/[.04] text-violet-700 dark:text-violet-300", icon: Award,
  },
};

export function StudentExamCard({ exam, now }: { exam: Exam; now: number }) {
  const tone = AVAILABILITY[exam.availability ?? exam.status] ?? {
    label: exam.status, variant: "neutral" as const, rail: "bg-border",
    tile: "from-muted to-muted text-muted-foreground", icon: BookOpenCheck,
  };
  const Icon = tone.icon;
  const result = exam.resultSummary;
  const attemptsUsed = exam.attemptsUsed ?? exam.attemptNumber ?? 0;
  const attemptLimit = exam.settings.attemptLimit ?? 1;
  const attemptsLeft = Math.max(0, attemptLimit - attemptsUsed);
  const href = exam.availability === "completed" && exam.attemptId
    ? `/student/results/${exam.attemptId}`
    : `/student/exam/${exam.id}`;
  const action = exam.availability === "in_progress" ? "ادامهٔ آزمون"
    : exam.availability === "available" ? (attemptsLeft > 0 ? "شروع آزمون" : "جزئیات آزمون")
      : exam.availability === "upcoming" ? "جزئیات آزمون"
        : result ? "مشاهدهٔ نتیجه" : "وضعیت نتیجه";
  const urgent = exam.availability === "available" || exam.availability === "in_progress";
  const windowLeft = exam.availability === "available" ? new Date(exam.endAt).getTime() - now : 0;
  const startsIn = exam.availability === "upcoming" ? new Date(exam.startAt).getTime() - now : 0;

  return (
    <Card className={cn(
      "group relative isolate overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift",
      urgent ? "hover:border-primary/35" : "hover:border-border",
    )}>
      <span aria-hidden="true" className={cn("absolute inset-y-0 right-0 w-1 transition-all duration-200 group-hover:w-1.5", tone.rail)}/>
      <CardContent className="flex flex-wrap items-center gap-3.5 p-4 pr-5 sm:p-5 sm:pr-6">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/60 bg-gradient-to-br shadow-sm dark:border-white/5", tone.tile)}>
          <Icon className="h-5 w-5" aria-hidden="true"/>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone.variant}>{tone.label}</Badge>
            <span className="text-[11px] text-muted-foreground">{exam.subject}{exam.teacherName ? ` · ${exam.teacherName}` : ""}</span>
            {exam.availability === "in_progress" && exam.remainingSeconds !== null && exam.remainingSeconds !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-black text-warning">
                <Clock3 className="h-3 w-3" aria-hidden="true"/>{formatTime(exam.remainingSeconds)} باقی
              </span>
            )}
            {exam.availability === "upcoming" && (
              <span className="text-[10px] text-muted-foreground">شروع {formatDateTime(exam.startAt, exam.schedule?.timezone)} · {humanRemaining(startsIn)}</span>
            )}
          </div>

          <h2 className="mt-1.5 truncate text-sm font-black tracking-tight">{exam.title}</h2>
          {exam.description && <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{exam.description}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <Meta>{toPersianNumber(exam.questionCount)} سؤال</Meta>
            <Meta>{toPersianNumber(exam.settings.durationMinutes)} دقیقه</Meta>
            {exam.settings.totalMarks > 0 && <Meta>{toPersianNumber(exam.settings.totalMarks)} نمره</Meta>}
            <Meta>تلاش {toPersianNumber(attemptsUsed)}/{toPersianNumber(attemptLimit)}</Meta>
            {exam.availability === "available" && windowLeft > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-black text-primary">مهلت: {humanRemaining(windowLeft)}</span>
            )}
            {exam.availability === "available" && attemptsLeft === 0 && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-black text-destructive">تلاش مجاز تمام شده</span>
            )}
          </div>
        </div>

        {result && <ResultRing result={result}/>}
        {exam.availability === "completed" && !result && (
          <span className="rounded-xl border border-dashed px-3 py-2 text-[11px] font-bold text-muted-foreground">در انتظار تصحیح</span>
        )}
        <Button asChild size="sm" variant={urgent ? "default" : "outline"} className="shrink-0">
          <Link href={href}>{action}<ArrowLeft className="h-4 w-4"/></Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted/70 px-2 py-0.5 font-semibold">{children}</span>;
}

/**
 * The percentage and the raw score stay together.
 *
 * A ring on its own says «۸۰٪» and leaves the student wondering out of what; a score on its own says «۱۶»
 * and leaves them wondering whether that is good. Both, plus the verdict, and the row needs no drill-down.
 */
export function ResultRing({ result }: { result: NonNullable<Exam["resultSummary"]> }) {
  const percent = result.percentage === null ? null : Math.max(0, Math.min(100, Math.round(result.percentage)));
  const tone = percent === null ? "text-muted-foreground" : result.passed === false ? "text-warning" : "text-success";
  const circumference = 2 * Math.PI * 22;
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl bg-muted/45 px-2.5 py-1.5">
      <span className="relative grid h-11 w-11 shrink-0 place-items-center">
        <svg viewBox="0 0 52 52" className="h-11 w-11 -rotate-90" aria-hidden="true">
          <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted"/>
          <circle
            cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (percent ?? 0) / 100)}
            className={cn(tone, "transition-[stroke-dashoffset] duration-700 ease-out")}
          />
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
