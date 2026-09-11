"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supportsPersianCalendar } from "@/lib/utils/persian-calendar";
import {
  buildPersianMonthGrid, civilKey, formatPersianDate, formatPersianWallClock, gregorianToPersian, persianMonthLength,
  persianToGregorian, persianToday, shiftPersianMonth, wallClockValue, PERSIAN_MONTHS, type CivilDate,
} from "@/lib/utils/persian-civil";
import { Input } from "@/components/ui/input";

/**
 * A Jalali date-and-time field for scheduling, because a school on the Persian calendar should not have to
 * read its own exam dates off a Gregorian grid.
 *
 * The value is the same `YYYY-MM-DDTHH:mm` wall-clock string the schedule form already stores — that is
 * what `apiDate` turns into an instant for the selected timezone — so nothing downstream changes. What the
 * teacher sees and picks is the school's calendar: a month built by `persian-civil` (the same `Intl`
 * calendar the rest of the site prints dates with), Persian month names, Persian digits, Saturday first.
 *
 * There is no date library in the bundle for this. If a browser's ICU has no Persian calendar, the field
 * says so and hands back a native input rather than drawing Gregorian numbers under Persian names.
 */
const TIME_PRESETS = ["06:30", "08:00", "10:00", "14:00", "18:00"];
const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

interface PersianDateTimeFieldProps {
  label: string;
  /** `YYYY-MM-DDTHH:mm`, read and written as a wall clock — no timezone math in the value itself. */
  value: string;
  onChange: (value: string) => void;
  timezone?: string;
  min?: string;
  max?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  id?: string;
}

export function PersianDateTimeField({ label, value, onChange, timezone, min, max, required, error, hint, id }: PersianDateTimeFieldProps) {
  const supported = useMemo(() => supportsPersianCalendar(), []);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const parsed = useMemo(() => parseWallClock(value), [value]);
  const selected = parsed?.persian ?? null;
  const today = useMemo(() => persianToday(timezone), [timezone]);
  const [anchor, setAnchor] = useState<CivilDate>(() => selected ?? today);
  // Moving between the two fields of a pair should not reopen last month's page.
  useEffect(() => { if (selected) setAnchor({ year: selected.year, month: selected.month, day: 1 }); }, [selected?.month, selected?.year]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!supported) {
    return (
      <FieldShell label={label} required={required} error={error} hint={`${label} — این مرورگر تقویم فارسی را ندارد؛ تاریخ میلادی وارد کنید.`}>
        <Input id={id} type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)}/>
      </FieldShell>
    );
  }

  const grid = buildPersianMonthGrid(anchor.year, anchor.month, today);
  const hour = parsed?.hour ?? 8;
  const minute = parsed?.minute ?? 0;
  const dayBounds = { minKey: min ? min.slice(0, 10) : "", maxKey: max ? max.slice(0, 10) : "" };

  function commit(next: { date?: CivilDate; hour?: number; minute?: number }) {
    const date = next.date ?? parsed?.gregorian;
    if (!date) return;
    onChange(wallClockValue(date, next.hour ?? hour, next.minute ?? minute));
  }

  function pickDay(cell: { gregorian: CivilDate; inMonth: boolean; persian: CivilDate }) {
    if (!cell.inMonth) setAnchor({ year: cell.persian.year, month: cell.persian.month, day: 1 });
    commit({ date: cell.gregorian });
  }

  return (
    <div ref={rootRef} className="relative">
      <FieldShell label={label} required={required} error={error} hint={hint}>
        <button
          id={id}
          type="button"
          ref={triggerRef}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-invalid={Boolean(error)}
          className={cn(
            "flex h-11 w-full items-center gap-2 rounded-xl border bg-background px-3 text-right text-sm font-bold transition-colors hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            error && "border-destructive",
            open && "border-primary ring-2 ring-primary/20",
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-primary"/>
          <span className={cn("truncate", !value && "font-normal text-muted-foreground")}>{value ? formatPersianWallClock(value) : "انتخاب روز و ساعت"}</span>
          {parsed && <span className="mr-auto shrink-0 text-[10px] font-bold text-muted-foreground">{civilKey(parsed.gregorian)}</span>}
        </button>
      </FieldShell>

      {open && (
        <div role="dialog" aria-label={`${label} — تقویم فارسی`} className="absolute z-40 mt-2 w-[min(94vw,340px)] rounded-2xl border bg-card p-3 shadow-lift">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setAnchor(shiftPersianMonth(anchor, -1))} aria-label="ماه قبل" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-muted"><ChevronRight className="h-4 w-4"/></button>
            <p className="text-xs font-black">{PERSIAN_MONTHS[anchor.month - 1]} {toPersianDigits(anchor.year)}</p>
            <button type="button" onClick={() => setAnchor(shiftPersianMonth(anchor, 1))} aria-label="ماه بعد" className="grid h-8 w-8 place-items-center rounded-lg border hover:bg-muted"><ChevronLeft className="h-4 w-4"/></button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted-foreground">
            {WEEKDAY_HEADERS.map((label2) => <span key={label2}>{label2}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {grid.flat().map((cell) => {
              const key = civilKey(cell.gregorian);
              const blocked = (dayBounds.minKey && key < dayBounds.minKey) || (dayBounds.maxKey && key > dayBounds.maxKey);
              const isSelected = Boolean(selected && cell.persian.year === selected.year && cell.persian.month === selected.month && cell.persian.day === selected.day);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={Boolean(blocked)}
                  onClick={() => pickDay(cell)}
                  aria-pressed={isSelected}
                  aria-label={`${formatPersianDate(cell.gregorian)}${cell.isToday ? " · امروز" : ""}`}
                  className={cn(
                    "grid h-8 place-items-center rounded-lg text-[11px] font-bold transition-colors",
                    !cell.inMonth && "text-muted-foreground/55",
                    isSelected ? "bg-primary text-white" : "hover:bg-muted",
                    cell.isToday && !isSelected && "ring-1 ring-primary/45",
                    blocked && "cursor-not-allowed opacity-35 hover:bg-transparent",
                  )}
                >
                  {toPersianDigits(cell.persian.day)}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11px]">
            <span className="font-bold text-muted-foreground">{toPersianDigits(persianMonthLength(anchor.year, anchor.month))} روز · {timezone ? timezoneLabel(timezone) : "زمان محلی مدرسه"}</span>
            <button type="button" className="rounded-lg px-2 py-1 font-black text-primary hover:bg-primary/10" onClick={() => {
                const gregorian = persianToGregorian(today);
                if (!gregorian) return;
                setAnchor({ year: today.year, month: today.month, day: 1 });
                commit({ date: gregorian });
              }}>امروز</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground"/>
            <label className="flex-1 text-[10px] font-bold text-muted-foreground">
              ساعت
              <select
                value={String(hour).padStart(2, "0")}
                onChange={(event) => commit({ hour: Number(event.target.value) })}
                className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-xs font-black text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {Array.from({ length: 24 }, (_, item) => <option key={item} value={String(item).padStart(2, "0")}>{toPersianDigits(String(item).padStart(2, "0"))}</option>)}
              </select>
            </label>
            <label className="flex-1 text-[10px] font-bold text-muted-foreground">
              دقیقه
              <select
                value={String(minute).padStart(2, "0")}
                onChange={(event) => commit({ minute: Number(event.target.value) })}
                className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-xs font-black text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {Array.from({ length: 60 }, (_, item) => <option key={item} value={String(item).padStart(2, "0")}>{toPersianDigits(String(item).padStart(2, "0"))}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {TIME_PRESETS.map((preset) => (
              <button key={preset} type="button" onClick={() => commit({ hour: Number(preset.slice(0, 2)), minute: Number(preset.slice(3, 5)) })} className={cn("rounded-lg border px-2 py-1 text-[10px] font-black transition-colors hover:bg-muted", hour === Number(preset.slice(0, 2)) && minute === Number(preset.slice(3, 5)) && "border-primary bg-primary/10 text-primary")}>
                {toPersianDigits(preset)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">تاریخ را به وقت مدرسه انتخاب کنید؛ سامانه آن را با منطقهٔ زمانی آزمون به لحظهٔ دقیق تبدیل می‌کند.</p>
        </div>
      )}
    </div>
  );
}

function FieldShell({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-bold">
      <span>{label}{required && <span className="mr-1 text-destructive">*</span>}</span>
      <div className="mt-2">{children}</div>
      {error && <span className="mt-1.5 block text-xs font-bold text-destructive">{error}</span>}
      {hint && !error && <span className="mt-1.5 block text-[11px] font-normal leading-5 text-muted-foreground">{hint}</span>}
    </label>
  );
}

const TIMEZONES: Record<string, string> = { "Asia/Tehran": "تهران", "Asia/Dubai": "دبی", "Europe/Istanbul": "استانبول" };
function timezoneLabel(timezone: string) {
  return TIMEZONES[timezone] ?? timezone;
}

function toPersianDigits(value: number | string) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

/** Splits a wall-clock value into the Gregorian day, the Persian day it lands on, and the clock. */
function parseWallClock(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const gregorian: CivilDate = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return { gregorian, persian: gregorianToPersian(gregorian), hour: Number(match[4]), minute: Number(match[5]) };
}
