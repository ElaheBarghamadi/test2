/**
 * Persian (Solar Hijri) calendar arithmetic on *civil* dates.
 *
 * A civil date is a year, a month and a day with no instant attached, which is exactly what a schedule
 * field holds: «۱۴ مرداد · ۰۸:۳۰» in the school's own timezone. The existing `persian-calendar.ts` answers
 * "what day is it in Tehran right now"; a picker that writes a value for `Asia/Dubai` or that has to work
 * on any machine cannot use that, so these helpers stay timezone-free.
 *
 * The month names and month lengths come from the same `Intl` Persian calendar the rest of the app formats
 * dates with, so a day a teacher picks here is always the same day the site prints later. Day-number
 * arithmetic (Julian day numbers) is exact integer math; only the Persian↔Gregorian naming asks ICU.
 */

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

const WEEKDAY_INDEX: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

function gregorianFormatter() {
  return new Intl.DateTimeFormat("en-US-u-ca-persian", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
}

/** Days since the Julian epoch. Exact for the whole proleptic Gregorian range the app can produce. */
export function gregorianToJdn(date: CivilDate): number {
  const a = Math.floor((14 - date.month) / 12);
  const y = date.year + 4800 - a;
  const m = date.month + 12 * a - 3;
  return (
    date.day
    + Math.floor((153 * m + 2) / 5)
    + 365 * y
    + Math.floor(y / 4)
    - Math.floor(y / 100)
    + Math.floor(y / 400)
    - 32045
  );
}

export function jdnToGregorian(jdn: number): CivilDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    // The arithmetic runs on a March-based year, so January and February come out as months 13 and 14.
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/** Midnight UTC of a civil Gregorian day, i.e. the instant ICU uses to name that day. */
function civilToUtcMidnight(date: CivilDate): number {
  return Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0);
}

/** The Persian date a Gregorian civil day falls on. */
export function gregorianToPersian(date: CivilDate): CivilDate {
  const parts = gregorianFormatter().formatToParts(new Date(civilToUtcMidnight(date)));
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "1");
  return { year: read("year"), month: read("month"), day: read("day") };
}

export function jdnToPersian(jdn: number): CivilDate {
  return gregorianToPersian(jdnToGregorian(jdn));
}

/** A monotone day key: it never decreases as days advance, which is what makes the search below sound. */
function persianOrdinal(date: CivilDate): number {
  return date.year * 448 + (date.month - 1) * 32 + date.day;
}

/**
 * The Gregorian civil day a Persian date falls on, or null when that Persian day does not exist in that
 * year — Esfand 30 in a common year is the usual way to ask.
 */
export function persianToGregorian(date: CivilDate): CivilDate | null {
  const jdn = persianToJdn(date);
  return jdn === null ? null : jdnToGregorian(jdn);
}

export function persianToJdn(date: CivilDate): number | null {
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return null;
  // Nowruz is 20 or 21 March, so the answer is always within a couple of years of `year + 621`.
  let low = gregorianToJdn({ year: date.year + 620, month: 1, day: 1 });
  let high = gregorianToJdn({ year: date.year + 622, month: 12, day: 31 });
  const target = persianOrdinal(date);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (persianOrdinal(jdnToPersian(middle)) < target) low = middle + 1;
    else high = middle;
  }
  const found = jdnToPersian(low);
  return found.year === date.year && found.month === date.month && found.day === date.day ? low : null;
}

/** Esfand is 29 or 30 days depending on the year, so the year has to be asked, not assumed. */
export function persianMonthLength(year: number, month: number): number {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  return persianToJdn({ year, month: 12, day: 30 }) === null ? 29 : 30;
}

export function persianWeekday(jdn: number): number {
  const gregorian = jdnToGregorian(jdn);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(civilToUtcMidnight(gregorian)));
  return WEEKDAY_INDEX[name] ?? 0;
}

export interface PersianCalendarCell {
  jdn: number;
  gregorian: CivilDate;
  persian: CivilDate;
  weekday: number;
  inMonth: boolean;
  isToday: boolean;
}

/**
 * Six rows of seven days, Saturday first, padded with the neighbours so a month that starts on Friday or
 * ends on Saturday never shifts the grid.
 */
/** Today as the school's calendar names it, which is what a date picker has to underline. */
export function persianToday(timeZone = "Asia/Tehran"): CivilDate {
  const now = zonedWallClock(new Date().toISOString(), timeZone);
  // The wall clock is Gregorian; the grid wants the Persian name of that same civil day.
  return now ? gregorianToPersian(now.date) : { year: 1403, month: 1, day: 1 };
}

export function buildPersianMonthGrid(year: number, month: number, today: CivilDate = persianToday()): PersianCalendarCell[][] {
  const first = persianToJdn({ year, month, day: 1 });
  if (first === null) return [];
  const todayJdn = persianToJdn(today) ?? -1;
  const start = first - persianWeekday(first);
  const cells: PersianCalendarCell[] = [];
  for (let offset = 0; offset < 42; offset += 1) {
    const jdn = start + offset;
    const gregorian = jdnToGregorian(jdn);
    const persian = gregorianToPersian(gregorian);
    cells.push({ jdn, gregorian, persian, weekday: persianWeekday(jdn), inMonth: persian.month === month && persian.year === year, isToday: jdn === todayJdn });
  }
  const weeks: PersianCalendarCell[][] = [];
  for (let week = 0; week < 6; week += 1) weeks.push(cells.slice(week * 7, week * 7 + 7));
  return weeks;
}

export function shiftPersianMonth(date: CivilDate, months: number): CivilDate {
  let year = date.year;
  let month = date.month + months;
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  return { year, month, day: 1 };
}

export const PERSIAN_WEEKDAYS_LONG = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

/**
 * A full Persian date label, produced by the very formatter the rest of the site uses, so the day a teacher
 * picks in a calendar and the day a student reads on their dashboard cannot be worded differently.
 */
export function formatPersianDate(date: CivilDate): string {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "full", timeZone: "UTC" }).format(new Date(civilToUtcMidnight(date)));
  } catch {
    // No Persian ICU: still the right day, just assembled by hand instead of by the locale.
    const digits = (value: number) => String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
    const weekday = PERSIAN_WEEKDAYS_LONG[persianWeekday(gregorianToJdn(date))];
    return `${weekday} ${digits(date.day)} ${PERSIAN_MONTHS[date.month - 1]} ${digits(date.year)}`;
  }
}

/** `YYYY-MM-DD` of a civil date, zero padded, for comparing and for `datetime-local`-shaped values. */
export function civilKey(date: CivilDate): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** The wall clock a moment shows in a timezone, as the pieces a schedule field edits. */
export function zonedWallClock(value: string, timeZone = "Asia/Tehran"): { date: CivilDate; hour: number; minute: number } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    return { date: { year: read("year"), month: read("month"), day: read("day") }, hour: read("hour"), minute: read("minute") };
  } catch {
    return null;
  }
}

/**
 * A `datetime-local`-shaped value (`YYYY-MM-DDTHH:mm`) for the civil day and time given, i.e. "what the
 * clock on the school wall reads", with no timezone arithmetic in it.
 */
export function wallClockValue(date: CivilDate, hour: number, minute: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${civilKey(date)}T${pad(hour)}:${pad(minute)}`;
}

/**
 * The instant a wall-clock string stands for, in a given timezone. `apiDate` in the mappers does the same
 * job for the payload; the picker needs it to compare a draft against "now" and against a minimum.
 */
export function wallClockToIso(value: string, timeZone = "Asia/Tehran"): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const nominal = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nominal));
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"));
    return new Date(nominal - (asUtc - nominal)).toISOString();
  } catch {
    return new Date(nominal).toISOString();
  }
}

/** The Persian label for a wall-clock value, used wherever the app currently prints a raw ISO string. */
export function formatPersianWallClock(value: string, options: { withTime?: boolean } = {}): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return value;
  const digits = (input: string) => input.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
  const date: CivilDate = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const day = formatPersianDate(date);
  return options.withTime === false ? day : `${day} · ${digits(`${match[4] ?? "۰۰"}:${match[5] ?? "۰۰"}`)}`;
}
