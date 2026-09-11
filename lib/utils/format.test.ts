import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/utils";

/**
 * Every date the site prints goes through these two functions, so the two things that matter for a school
 * on the Solar Hijri calendar are asserted here: the numbers are Persian, and the calendar is Persian too.
 */
describe("persian date formatting", () => {
  it("formats a day on the Persian calendar with Persian digits", () => {
    const label = formatDate("2026-03-21T05:30:00Z", "Asia/Tehran");
    expect(label).toContain("فروردین");
    expect(label).toMatch(/۱۴۰۵/);
    expect(/[0-9]/.test(label)).toBe(false);
  });

  it("shows the hour the school sees when a timezone is given", () => {
    const utc = formatDateTime("2026-09-11T05:00:00Z");
    const tehran = formatDateTime("2026-09-11T05:00:00Z", "Asia/Tehran");
    expect(tehran).toContain("۸:۳۰");
    expect(utc).not.toBe(tehran);
  });

  it("never leaves a Latin digit behind, whichever way the clock is read", () => {
    for (const value of ["2026-01-01T00:00:00Z", "2026-12-31T23:59:00Z", "2025-03-20T12:00:00Z"]) {
      expect(/[0-9]/.test(formatDateTime(value, "Asia/Tehran"))).toBe(false);
      expect(/[0-9]/.test(formatDate(value, "Asia/Tehran"))).toBe(false);
    }
  });
});
