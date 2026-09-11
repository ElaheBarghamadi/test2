import { describe, expect, it } from "vitest";
import {
  buildPersianMonthGrid, civilKey, formatPersianDate, gregorianToJdn, gregorianToPersian, jdnToGregorian,
  persianMonthLength, persianToday, persianToGregorian, persianWeekday, shiftPersianMonth, wallClockToIso, wallClockValue, zonedWallClock,
} from "@/lib/utils/persian-civil";

describe("persian civil calendar", () => {
  it("round-trips every day of a four-year window, including leap Esfands", () => {
    const start = gregorianToJdn({ year: 2024, month: 3, day: 1 });
    for (let jdn = start; jdn < start + 1500; jdn += 1) {
      const gregorian = jdnToGregorian(jdn);
      const persian = gregorianToPersian(gregorian);
      expect(persianToGregorian(persian)).toEqual(gregorian);
    }
  });

  it("names the same day the site's own formatter prints", () => {
    const formatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "full", timeZone: "UTC" });
    for (const iso of ["2025-03-20", "2026-03-21", "2026-09-11", "2027-01-01", "2026-12-31"]) {
      const civil = { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) };
      const expected = formatter.format(new Date(`${iso}T12:00:00Z`));
      expect(formatPersianDate(civil)).toBe(expected);
    }
  });

  it("only gives Esfand thirty days in a leap year", () => {
    const leapYears: number[] = [];
    for (let year = 1400; year <= 1410; year += 1) {
      const length = persianMonthLength(year, 12);
      const exists = persianToGregorian({ year, month: 12, day: 30 }) !== null;
      expect(exists).toBe(length === 30);
      if (length === 30) leapYears.push(year);
      // 1 Farvardin must follow the last day of Esfand, in order and without a gap.
      const lastEsfand = persianToGregorian({ year, month: 12, day: length });
      const firstFarvardin = persianToGregorian({ year: year + 1, month: 1, day: 1 });
      expect(gregorianToJdn(firstFarvardin!) - gregorianToJdn(lastEsfand!)).toBe(1);
    }
    expect(leapYears.length).toBeGreaterThanOrEqual(2);
    expect(leapYears.length).toBeLessThanOrEqual(4);
  });

  it("refuses a Persian day that does not exist instead of silently shifting", () => {
    const nonLeap = [1400, 1401, 1402, 1408, 1409, 1410].find((year) => persianMonthLength(year, 12) === 29)!;
    expect(persianToGregorian({ year: nonLeap, month: 12, day: 30 })).toBeNull();
    expect(persianToGregorian({ year: 1405, month: 13, day: 1 })).toBeNull();
  });

  it("builds a six-row, Saturday-first grid whose in-month cells are exactly the month", () => {
    const today = persianToday();
    const grid = buildPersianMonthGrid(today.year, today.month, today);
    const flat = grid.flat();
    expect(grid).toHaveLength(6);
    expect(flat).toHaveLength(42);
    expect(flat[0]!.weekday).toBe(0);
    expect(flat.filter((cell) => cell.inMonth)).toHaveLength(persianMonthLength(today.year, today.month));
    expect(flat.filter((cell) => cell.isToday)).toHaveLength(1);
    // Days run consecutively, so the grid is a calendar and not a re-shuffled list.
    for (let index = 1; index < flat.length; index += 1) {
      expect(gregorianToJdn(flat[index]!.gregorian) - gregorianToJdn(flat[index - 1]!.gregorian)).toBe(1);
    }
  });

  it("walks months without drifting, forwards and back", () => {
    let cursor = shiftPersianMonth({ year: 1405, month: 12, day: 15 }, 1);
    expect(cursor).toEqual({ year: 1406, month: 1, day: 1 });
    expect(shiftPersianMonth({ year: 1406, month: 1, day: 1 }, -1)).toEqual({ year: 1405, month: 12, day: 1 });
    // Twelve months out is the same month of the next year, whatever the mix of 31/30/29-day months.
    for (const month of [1, 6, 9, 12]) {
      const jumped = shiftPersianMonth({ year: 1405, month, day: 1 }, 12);
      expect(jumped).toEqual({ year: 1406, month, day: 1 });
    }
  });

  it("keeps the weekday consistent with the day it belongs to", () => {
    const saturday = gregorianToJdn({ year: 2026, month: 9, day: 12 });
    expect(persianWeekday(saturday)).toBe(0);
    expect(persianWeekday(saturday + 6)).toBe(6);
  });
});

describe("wall clock values", () => {
  it("reads the clock a school sees, not the one the browser runs on", () => {
    expect(zonedWallClock("2026-09-11T05:00:00Z", "Asia/Tehran")).toEqual({ date: { year: 2026, month: 9, day: 11 }, hour: 8, minute: 30 });
    // Dubai is +04:00 with no daylight saving, so the same instant is nine o'clock flat.
    expect(zonedWallClock("2026-09-11T05:00:00Z", "Asia/Dubai")).toEqual({ date: { year: 2026, month: 9, day: 11 }, hour: 9, minute: 0 });
  });

  it("turns a picked day and time back into the instant it stands for", () => {
    expect(wallClockToIso("2026-09-11T08:30", "Asia/Tehran")).toBe("2026-09-11T05:00:00.000Z");
    expect(wallClockToIso("2026-09-11T08:30", "Asia/Dubai")).toBe("2026-09-11T04:30:00.000Z");
    expect(wallClockToIso("not a date", "Asia/Tehran")).toBeNull();
  });

  it("round-trips an instant through the field's own value shape", () => {
    const iso = "2026-03-21T05:00:00.000Z";
    const clock = zonedWallClock(iso, "Asia/Tehran")!;
    const value = wallClockValue(clock.date, clock.hour, clock.minute);
    expect(value).toBe("2026-03-21T08:30");
    expect(wallClockToIso(value, "Asia/Tehran")).toBe(iso);
  });

  it("pads the key a comparison is done on", () => {
    expect(civilKey({ year: 1405, month: 1, day: 3 })).toBe("1405-01-03");
    expect(gregorianToJdn({ year: 2026, month: 1, day: 3 })).toBe(gregorianToJdn({ year: 2025, month: 12, day: 27 }) + 7);
  });
});
