/**
 * Persian (Solar Hijri) calendar helpers built on `Intl`, with no date library added to the bundle.
 *
 * Everything is anchored to `Asia/Tehran` because that is the timezone the platform schedules exams in:
 * a student in another timezone must see the same "exam day" the school sees. The functions are pure and
 * take an explicit `now` so they can be unit-tested without a clock mock.
 */

export const TEHRAN = "Asia/Tehran";

export interface PersianDate {
  year: number;
  month: number;
  day: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

function formatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US-u-ca-persian", { timeZone: TEHRAN, ...options });
}

/** The calendar supports the Persian calendar only when ICU ships it; callers must fall back otherwise. */
export function supportsPersianCalendar(): boolean {
  try {
    const parts = formatter({ year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
    return parts.some((part) => part.type === "year" && Number(part.value) > 1300 && Number(part.value) < 1600);
  } catch {
    return false;
  }
}

export function toPersianDate(value: Date | string): PersianDate {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = formatter({ year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "1");
  return { year: read("year"), month: read("month"), day: read("day") };
}

/** The first six Persian months are 31 days, the next five are 30, and the last is 29 or 30 (leap). */
export function persianMonthLength(month: number): 30 | 31 {
  return month >= 1 && month <= 6 ? 31 : 30;
}

/** The `YYYY-MM-DD` key a date occupies in Tehran — the identity of one calendar day. */
export function tehranDayKey(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TEHRAN, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Midnight UTC of the Tehran calendar day, so day arithmetic never drifts across a DST-free offset. */
export function tehranDayStart(value: Date | string): Date {
  const key = tehranDayKey(value);
  return new Date(`${key}T00:00:00.000Z`);
}

export function weekdayIndex(value: Date | string): number {
  const date = typeof value === "string" ? new Date(value) : value;
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TEHRAN, weekday: "short" }).format(date);
  return WEEKDAY_INDEX[name] ?? 0;
}

export interface CalendarDay {
  /** Midnight-UTC Date for the day. */
  date: Date;
  dayKey: string;
  persianDay: number;
  /** True when the cell belongs to the month being displayed. */
  inMonth: boolean;
  isToday: boolean;
}

export interface MonthGrid {
  /** Six rows of seven days, Saturday first, as the Iranian week expects. */
  weeks: CalendarDay[][];
  month: number;
  year: number;
  monthLength: number;
  /** Midnight-UTC of the 1st of the displayed month. */
  firstOfMonth: Date;
  /** Number of leading cells borrowed from the previous month. */
  leadingDays: number;
}

/**
 * Builds the 6x7 grid for the Persian month containing `anchor`, padded with the trailing/leading days of
 * the neighbouring months so the layout never jumps between months.
 */
export function buildMonthGrid(anchor: Date | string, now: Date = new Date()): MonthGrid {
  const anchorDate = typeof anchor === "string" ? new Date(anchor) : anchor;
  const parts = toPersianDate(anchorDate);
  const dayStart = tehranDayStart(anchorDate);
  const firstOfMonth = addDays(dayStart, -(parts.day - 1));
  const gridStart = addDays(firstOfMonth, -weekdayIndex(firstOfMonth));
  const todayKey = tehranDayKey(now);
  const length = persianMonthLength(parts.month);

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: CalendarDay[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(gridStart, week * 7 + offset);
      const dayKey = tehranDayKey(date);
      const persian = toPersianDate(date);
      row.push({
        date,
        dayKey,
        persianDay: persian.day,
        inMonth: persian.month === parts.month && persian.year === parts.year,
        isToday: dayKey === todayKey,
      });
    }
    weeks.push(row);
  }
  return { weeks, month: parts.month, year: parts.year, monthLength: length, firstOfMonth, leadingDays: weekdayIndex(firstOfMonth) };
}

/**
 * Shifts by whole Persian months, which is what a "next month" control must do.
 *
 * The anchor is normalised to the 1st of its month first, so adding one month is always "the 1st of the
 * next month" instead of "31 days later, somewhere in the month after".
 */
export function shiftMonth(anchor: Date | string, months: number): Date {
  const parts = toPersianDate(anchor);
  let cursor = addDays(tehranDayStart(anchor), -(parts.day - 1));
  for (let step = 0; step < Math.abs(months); step += 1) {
    // Going back needs the length of the month we are leaving, which is the previous one.
    const month = months > 0 ? toPersianDate(cursor).month : ((toPersianDate(cursor).month - 2 + 12) % 12) + 1;
    cursor = addDays(cursor, (months > 0 ? 1 : -1) * persianMonthLength(month));
  }
  return cursor;
}

export const PERSIAN_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

/** Long Persian month+year for a day inside that month, e.g. "مرداد ۱۴۰۵". */
export function persianMonthLabel(dayInMonth: Date | string, month: number, year: number): string {
  const date = typeof dayInMonth === "string" ? new Date(dayInMonth) : dayInMonth;
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: TEHRAN, month: "long", year: "numeric" }).format(date);
  } catch {
    // No Persian ICU: still legible, just not in Persian script.
    return `${month}/${year}`;
  }
}

export function toPersianDigits(value: string | number): string {
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return String(value).replace(/[0-9]/g, (digit) => digits[Number(digit)]);
}
