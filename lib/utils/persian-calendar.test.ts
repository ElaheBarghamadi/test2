import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  persianMonthLength,
  shiftMonth,
  supportsPersianCalendar,
  tehranDayKey,
  toPersianDate,
  toPersianDigits,
  weekdayIndex,
} from "@/lib/utils/persian-calendar";

const hasPersianIcu = supportsPersianCalendar();

describe("persian calendar helpers", () => {
  it("keys a day by its Tehran date, not the browser's", () => {
    // 2026-03-21T01:30Z is 05:00 in Tehran (+03:30) — the same calendar day either way.
    expect(tehranDayKey("2026-03-21T01:30:00.000Z")).toBe("2026-03-21");
    // 2026-03-20T22:00Z is already 21st in Tehran.
    expect(tehranDayKey("2026-03-20T22:00:00.000Z")).toBe("2026-03-21");
  });

  it("reports the Persian day for a known date", () => {
    expect(toPersianDate(tehranDayKey("2026-03-20T22:00:00.000Z"))).toBeTruthy();
  });

  it("uses the 31/30 month structure", () => {
    expect([1, 2, 3, 4, 5, 6].map(persianMonthLength)).toEqual([31, 31, 31, 31, 31, 31]);
    expect([7, 8, 9, 10, 11, 12].map(persianMonthLength)).toEqual([30, 30, 30, 30, 30, 30]);
  });

  it("formats digits in Persian script", () => {
    expect(toPersianDigits(2026)).toBe("۲۰۲۶");
    expect(toPersianDigits("month 12")).toBe("month ۱۲");
  });

  it("the Iranian week starts on Saturday", () => {
    // 2026-03-21 is a Saturday.
    expect(weekdayIndex(new Date("2026-03-21T00:00:00Z"))).toBe(0);
    expect(weekdayIndex(new Date("2026-03-22T00:00:00Z"))).toBe(1);
    expect(weekdayIndex(new Date("2026-03-27T00:00:00Z"))).toBe(6);
  });
});

(hasPersianIcu ? describe : describe.skip)("persian month grid", () => {
  it("lays out six Saturday-first weeks and marks exactly one today", () => {
    const anchor = new Date("2026-08-12T12:00:00Z");
    const grid = buildMonthGrid(anchor, anchor);
    const anchorPersian = toPersianDate(anchor);
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
    expect(grid.month).toBe(anchorPersian.month);
    expect(grid.year).toBe(anchorPersian.year);
    expect(grid.monthLength).toBe(persianMonthLength(anchorPersian.month));
    // The grid always starts on a Saturday, so leading cells belong to the previous month.
    expect(weekdayIndex(grid.weeks[0][0].date)).toBe(0);
    expect(grid.weeks.flat().filter((day) => day.isToday).map((day) => day.dayKey)).toEqual([tehranDayKey(anchor)]);
    expect(grid.weeks.flat().filter((day) => day.inMonth && day.persianDay === 1)).toHaveLength(1);
    expect(grid.leadingDays).toBe(weekdayIndex(grid.firstOfMonth));
  });

  it("advances by whole months and is exact over a full year", () => {
    const grid = buildMonthGrid(new Date("2026-08-12T12:00:00Z"), new Date());
    const firstDay = grid.weeks.flat().find((day) => day.inMonth && day.persianDay === 1);
    expect(firstDay?.dayKey).toBe(tehranDayKey(grid.firstOfMonth));

    const next = buildMonthGrid(shiftMonth(grid.firstOfMonth, 1), new Date());
    expect(next.month).toBe(grid.month === 12 ? 1 : grid.month + 1);
    const previous = buildMonthGrid(shiftMonth(grid.firstOfMonth, -1), new Date());
    expect(previous.month).toBe(grid.month === 1 ? 12 : grid.month - 1);

    // Twelve forward steps must land on the same month number, one year on.
    let cursor = grid.firstOfMonth;
    for (let index = 0; index < 12; index += 1) cursor = shiftMonth(cursor, 1);
    const wrapped = toPersianDate(cursor);
    expect(wrapped.month).toBe(grid.month);
    expect(wrapped.year).toBe(grid.year + 1);
  });
});
