"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildMonthGrid, persianMonthLabel, PERSIAN_WEEKDAYS, supportsPersianCalendar, tehranDayKey, toPersianDigits, shiftMonth } from "@/lib/utils/persian-calendar";
import { formatDate, formatDateTime, cn } from "@/lib/utils";
import type { Exam } from "@/lib/types/domain";

const STATUS_DOT: Record<Exam["status"], string> = {
  active: "bg-emerald-500",
  scheduled: "bg-primary",
  completed: "bg-violet-500",
  draft: "bg-amber-500",
  archived: "bg-muted-foreground",
};

const MAX_SPAN_DAYS = 62;

/**
 * The exam calendar: a real month grid on the school's own calendar.
 *
 * Days are keyed by their Tehran calendar date, so a student opening the app from another timezone still
 * sees the day the school sits the exam on. When ICU has no Persian calendar, the component says so and
 * hands control back to the surrounding dashboard instead of drawing a Gregorian grid under Persian
 * labels, which would be quietly wrong.
 */
export function ExamCalendar({ exams, role, onSelect }: { exams: Exam[]; role: "student" | "teacher"; onSelect?: (exam: Exam) => void }) {
  const supported = useMemo(() => supportsPersianCalendar(), []);
  const today = useMemo(() => new Date(), []);
  const [anchor, setAnchor] = useState<Date>(() => today);
  const grid = useMemo(() => (supported ? buildMonthGrid(anchor, today) : null), [anchor, supported, today]);
  const cellsRef = useRef<Array<HTMLButtonElement | null>>([]);
  // One tab stop for the whole grid; the first day of the displayed month starts as the active cell.
  const [focusIndex, setFocusIndex] = useState<number>(0);

  const byDay = useMemo(() => {
    const map = new Map<string, Exam[]>();
    if (!supported) return map;
    for (const exam of exams) {
      // An exam occupies its whole window: a two-day window shows on both days, capped so a mistyped
      // far-future end_at cannot generate thousands of entries.
      const start = new Date(`${tehranDayKey(exam.startAt)}T00:00:00.000Z`).getTime();
      const endRaw = exam.endAt ? new Date(`${tehranDayKey(exam.endAt)}T00:00:00.000Z`).getTime() : start;
      const days = Math.min(MAX_SPAN_DAYS, Math.max(0, Math.round((endRaw - start) / 86_400_000)));
      for (let offset = 0; offset <= days; offset += 1) {
        const key = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
        map.set(key, [...(map.get(key) ?? []), exam]);
      }
    }
    return map;
  }, [exams, supported]);

  const moveFocus = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(41, index));
    setFocusIndex(clamped);
    cellsRef.current[clamped]?.focus();
  }, []);

  // Changing months resets the tab stop to the 1st, which is also the cell a month view should open on.
  useEffect(() => { setFocusIndex(0); }, [anchor]);

  if (!supported) {
    return <Card><CardHeader><CardTitle>تقویم آزمون‌ها</CardTitle><CardDescription>مرورگر این دستگاه نام‌های تقویم فارسی را ندارد؛ فهرست آزمون‌ها همان اطلاعات را نشان می‌دهد.</CardDescription></CardHeader></Card>;
  }
  if (!grid) return null;

  const flat = grid.weeks.flat();
  const upcomingCount = flat.filter((day) => day.inMonth && (byDay.get(day.dayKey)?.length ?? 0) > 0).length;

  return <Card>
    <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><CardTitle>تقویم آزمون‌ها</CardTitle><CardDescription>{persianMonthLabel(grid.firstOfMonth, grid.month, grid.year)} · {toPersianDigits(upcomingCount)} روز دارای آزمون</CardDescription></div>
      <div className="flex items-center gap-1">
        <Button type="button" size="icon-sm" variant="outline" onClick={() => setAnchor(shiftMonth(grid.firstOfMonth, -1))} aria-label="ماه قبل"><ChevronRight className="h-4 w-4"/></Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAnchor(today)}>امروز</Button>
        <Button type="button" size="icon-sm" variant="outline" onClick={() => setAnchor(shiftMonth(grid.firstOfMonth, 1))} aria-label="ماه بعد"><ChevronLeft className="h-4 w-4"/></Button>
      </div>
    </CardHeader>
    <CardContent>
      <div
        role="grid"
        aria-label={`تقویم ${persianMonthLabel(grid.firstOfMonth, grid.month, grid.year)}`}
        onKeyDown={(event) => {
          // Roving focus, RTL-aware: the visual order is Saturday→Friday right-to-left, so ArrowLeft
          // advances a cell. Arrow keys move the whole grid's focus instead of leaving the tab order.
          const step: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 };
          const delta = step[event.key];
          if (delta === undefined || focusIndex === null) return;
          event.preventDefault();
          moveFocus(focusIndex + delta);
        }}
      >
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted-foreground">
          {PERSIAN_WEEKDAYS.map((label) => <div key={label} role="columnheader" aria-label={label}>{label.slice(0, 3)}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {flat.map((day, index) => {
            const dayExams = byDay.get(day.dayKey) ?? [];
            const label = `${formatDate(day.date.toISOString())}${dayExams.length ? ` · ${toPersianDigits(dayExams.length)} آزمون` : ""}`;
            return (
              <button
                key={day.dayKey}
                type="button"
                ref={(node) => { cellsRef.current[index] = node; }}
                role="gridcell"
                aria-label={label}
                aria-current={day.isToday ? "date" : undefined}
                tabIndex={focusIndex === index ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onClick={() => { if (dayExams[0]) onSelect ? onSelect(dayExams[0]) : openExam(dayExams[0], role); }}
                className={cn(
                  "relative flex min-h-16 flex-col rounded-xl border p-1.5 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  day.inMonth ? "bg-card" : "bg-muted/35 text-muted-foreground/60",
                  day.isToday && "border-primary ring-1 ring-primary/35",
                  dayExams.length ? "cursor-pointer hover:border-primary/40" : "cursor-default",
                )}
              >
                <span className={cn("text-[11px] font-black", day.isToday ? "text-primary" : "")}>{toPersianDigits(day.persianDay)}</span>
                <span className="mt-auto flex flex-wrap gap-1">
                  {dayExams.slice(0, 3).map((exam) => <span key={exam.id} className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[exam.status])} title={exam.title}/>)}
                  {dayExams.length > 3 && <span className="text-[9px] font-bold text-muted-foreground">+{toPersianDigits(dayExams.length - 3)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-muted-foreground">
        {([["active", "در حال برگزاری"], ["scheduled", "زمان‌بندی‌شده"], ["completed", "پایان‌یافته"], ["draft", "پیش‌نویس"]] as const).map(([status, label]) => <span key={status} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])}/>{label}</span>)}
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-primary"/>امروز</span>
      </div>
      {flat.some((day) => day.inMonth && byDay.get(day.dayKey)?.length) && <ul className="mt-4 space-y-1.5 border-t pt-3">
        {flat.filter((day) => day.inMonth && (byDay.get(day.dayKey)?.length ?? 0) > 0).slice(0, 6).map((day) => {
          const items = byDay.get(day.dayKey) ?? [];
          return <li key={day.dayKey} className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-black text-primary">{toPersianDigits(day.persianDay)}</span>
            {items.map((exam) => <button key={exam.id} type="button" onClick={() => (onSelect ? onSelect(exam) : openExam(exam, role))} className="rounded-lg px-1.5 py-0.5 font-bold text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline">{exam.title}</button>)}
            <span className="text-muted-foreground">{formatDateTime(items[0].startAt)}</span>
          </li>;
        })}
      </ul>}
    </CardContent>
  </Card>;
}

function openExam(exam: Exam, role: "student" | "teacher") {
  window.location.assign(role === "student" ? (exam.status === "active" ? `/student/exam/${exam.id}` : "/student/dashboard") : `/teacher/exams/${exam.id}`);
}
