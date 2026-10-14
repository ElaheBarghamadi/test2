import type { ExamSchedule } from "@/lib/types/domain";
import {
  gregorianToJdn,
  jdnToGregorian,
  wallClockValue,
  zonedWallClock,
} from "@/lib/utils/persian-civil";

const MINUTE_MS = 60_000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;
const ACCESS_WINDOW_MS = 60 * MINUTE_MS;
export const DEFAULT_EXAM_TIMEZONE = "Asia/Tehran";

function wallClockSchedule(start: Date, end: Date, timeZone: string): ExamSchedule {
  const startClock = zonedWallClock(start.toISOString(), timeZone);
  const endClock = zonedWallClock(end.toISOString(), timeZone);
  return {
    startAt: startClock ? wallClockValue(startClock.date, startClock.hour, startClock.minute) : "",
    endAt: endClock ? wallClockValue(endClock.date, endClock.hour, endClock.minute) : "",
    timezone: timeZone,
  };
}

/** Start at the next quarter-hour at least an hour from now; keep a one-hour access window. */
export function createDefaultExamSchedule(now = new Date(), timeZone = DEFAULT_EXAM_TIMEZONE): ExamSchedule {
  const earliestStart = now.getTime() + 60 * MINUTE_MS;
  const startMs = Math.ceil(earliestStart / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
  const start = new Date(startMs);
  return wallClockSchedule(start, new Date(startMs + ACCESS_WINDOW_MS), timeZone);
}

/** Presets keep the school's timezone and only change the schedule fields. */
export function createExamSchedulePreset(
  preset: "in-one-hour" | "tomorrow-morning",
  now = new Date(),
  timeZone = DEFAULT_EXAM_TIMEZONE,
): ExamSchedule {
  if (preset === "in-one-hour") return createDefaultExamSchedule(now, timeZone);

  const today = zonedWallClock(now.toISOString(), timeZone);
  if (!today) return createDefaultExamSchedule(now, timeZone);
  const tomorrow = jdnToGregorian(gregorianToJdn(today.date) + 1);
  return {
    startAt: wallClockValue(tomorrow, 8, 30),
    endAt: wallClockValue(tomorrow, 9, 30),
    timezone: timeZone,
  };
}
