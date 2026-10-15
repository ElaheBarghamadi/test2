import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ShareBars, TrendChart, dayLabel } from "@/components/admin/stats-charts";
import type { ApiAdminSeriesPointDto } from "@/lib/api/dtos";

const days = (counts: number[], from = 1): ApiAdminSeriesPointDto[] =>
  counts.map((count, index) => ({ date: `2026-03-${String(from + index).padStart(2, "0")}`, count }));

describe("dayLabel", () => {
  it("reads a bare server date as the day it names, not the day before", () => {
    // The server buckets by local date and sends `YYYY-MM-DD`. Parsed as local midnight, every label shifts
    // back a day for anyone east of Greenwich — which is everybody this console is written for. The locale
    // renders the Persian calendar, so the assertion is on shape and on consecutive days differing by one,
    // not on a hard-coded Western month number.
    const first = dayLabel("2026-03-01");
    const second = dayLabel("2026-03-02");
    expect(first).toMatch(/^[\u06F0-\u06F9۰-۹][\u06F0-\u06F9۰-۹\/]*/);
    expect(first).not.toBe(second);
    expect(dayLabel("not-a-date")).toBe("");
  });
});

describe("TrendChart", () => {
  const series = [
    { key: "submissions", label: "ارسال‌ها", points: days([0, 4, 9]) },
    { key: "signals", label: "رویدادهای نشست", points: days([120, 40, 260]) },
  ];

  it("draws one axis for every series, and says what it is showing", () => {
    render(<TrendChart series={series}/>);
    const chart = screen.getByRole("img");

    expect(chart.getAttribute("aria-label")).toContain("ارسال‌ها");
    expect(chart.getAttribute("aria-label")).toContain("رویدادهای نشست");
    // One path per visible series, plus one filled area under each.
    expect(chart.querySelectorAll("path")).toHaveLength(4);
  });

  it("runs right to left, oldest at the start edge", () => {
    render(<TrendChart series={[series[0]!]}/>);
    const axis = screen.getByRole("img").parentElement!.nextElementSibling as HTMLElement;

    // `dir="rtl"` puts the first child at the right, which is where the oldest day belongs on this screen.
    expect(axis.getAttribute("dir")).toBe("rtl");
    expect(axis.textContent).toContain(dayLabel("2026-03-01"));
    expect(axis.textContent).toContain(dayLabel("2026-03-03"));
  });

  it("scales to the series that are switched on, not to the loudest one overall", () => {
    render(<TrendChart series={series}/>);
    // «رویدادهای نشست» peaks at 260 and would flatten three submissions into the axis.
    expect(screen.getByText(/اوج:/).textContent).toContain("۲۶۰");

    fireEvent.click(screen.getByRole("button", { name: /رویدادهای نشست/ }));
    expect(screen.getByText(/اوج:/).textContent).toContain("۹");
    // And the drawing follows: one series left means two paths, not four.
    expect(screen.getByRole("img").querySelectorAll("path")).toHaveLength(2);
  });

  it("brings a series back", () => {
    render(<TrendChart series={series}/>);
    const toggle = screen.getByRole("button", { name: /ارسال‌ها/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img").querySelectorAll("path")).toHaveLength(4);
  });

  it("gives every day a readout of all the series at once", () => {
    render(<TrendChart series={series}/>);
    const columns = screen.getByRole("img").parentElement!.querySelectorAll<HTMLElement>("[title]");

    expect(columns).toHaveLength(3);
    expect(columns[1]!.title).toContain(dayLabel("2026-03-02"));
    expect(columns[1]!.title).toContain("ارسال‌ها: ۴");
    expect(columns[1]!.title).toContain("رویدادهای نشست: ۴۰");
  });

  it("draws nothing when the server sent no days", () => {
    const { container } = render(<TrendChart series={[{ key: "submissions", label: "ارسال‌ها", points: [] }]}/>);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("ShareBars", () => {
  it("names the server's own enum values in Persian and shares them against the whole", () => {
    render(<ShareBars title="ترکیب کاربران" counts={{ student: 12, teacher: 2, admin: 1 }}/>);

    expect(screen.getByText("دانش‌آموز")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "دانش‌آموز از ترکیب کاربران" }).getAttribute("aria-valuenow")).toBe("12");
    expect(screen.getByText("۱۵")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "دانش‌آموز از ترکیب کاربران" }).parentElement!.textContent).toContain("۸۰٪");
  });

  it("shows a key it does not recognise rather than dropping it", () => {
    render(<ShareBars title="وضعیت آزمون‌ها" counts={{ published_someday: 3 }}/>);
    // A new server status arriving as gibberish is a prompt to name it; a silently missing bar reads as zero.
    expect(screen.getByText("published_someday")).toBeTruthy();
  });

  it("says there is nothing to show instead of drawing an empty axis", () => {
    render(<ShareBars title="وضعیت پاسخ‌برگ‌ها" counts={{ submitted: 0 }} emptyHint="هنوز کسی آزمون نداده است."/>);
    expect(screen.getByText("هنوز کسی آزمون نداده است.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("puts the largest share first", () => {
    render(<ShareBars title="وضعیت آزمون‌ها" counts={{ draft: 1, completed: 4, active: 2 }}/>);
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["4", "2", "1"]);
  });
});
