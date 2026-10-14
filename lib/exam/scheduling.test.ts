import { describe, expect, it } from "vitest";
import { createDefaultExamSchedule, createExamSchedulePreset } from "@/lib/exam/scheduling";
import { wallClockToIso, zonedWallClock } from "@/lib/utils/persian-civil";

const now = new Date("2026-10-13T12:07:31.000Z");
const minute = 60_000;

function instant(value: string, timeZone: string) {
  const result = wallClockToIso(value, timeZone);
  if (!result) throw new Error(`Invalid wall-clock value: ${value}`);
  return new Date(result).getTime();
}

describe("teacher exam scheduling defaults", () => {
  it("starts at a future quarter-hour and leaves a one-hour access window", () => {
    const schedule = createDefaultExamSchedule(now, "Asia/Tehran");
    const start = instant(schedule.startAt, schedule.timezone);
    const end = instant(schedule.endAt, schedule.timezone);

    expect(start - now.getTime()).toBeGreaterThanOrEqual(60 * minute);
    expect(start - now.getTime()).toBeLessThan(75 * minute);
    expect((end - start) / minute).toBe(60);
    expect(schedule.startAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/);
  });

  it("sets the tomorrow-morning shortcut to 08:30–09:30 in the selected timezone", () => {
    const schedule = createExamSchedulePreset("tomorrow-morning", now, "Asia/Dubai");
    const start = zonedWallClock(new Date(instant(schedule.startAt, schedule.timezone)).toISOString(), schedule.timezone);
    const end = zonedWallClock(new Date(instant(schedule.endAt, schedule.timezone)).toISOString(), schedule.timezone);

    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start?.hour).toBe(8);
    expect(start?.minute).toBe(30);
    expect(end?.hour).toBe(9);
    expect(end?.minute).toBe(30);
    expect(start?.date).toEqual(end?.date);
  });
});
