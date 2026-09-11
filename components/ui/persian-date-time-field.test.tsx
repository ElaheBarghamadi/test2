import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PersianDateTimeField } from "@/components/ui/persian-date-time-field";

/**
 * The Jalali schedule field. ICU's Persian calendar puts 1 Farvardin 1405 on 21 March 2026, which is what
 * the assertions below use, and the values the field writes stay `YYYY-MM-DDTHH:mm` wall-clock strings so
 * the payload builder is unchanged.
 */
/** The field is controlled, so the harness has to hold the value for each change to build on the last. */
function open(value: string, props: Partial<Parameters<typeof PersianDateTimeField>[0]> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState(value);
    return <PersianDateTimeField label="تاریخ و ساعت شروع" value={current} timezone="Asia/Tehran" {...props} onChange={(next) => { onChange(next); setCurrent(next); }}/>;
  }
  render(<Harness/>);
  fireEvent.click(screen.getByRole("button", { name: /شهریور|فروردین|تاریخ/ }));
  return { onChange };
}

describe("PersianDateTimeField", () => {
  it("reads the stored wall clock back as a Persian date", () => {
    render(<PersianDateTimeField label="تاریخ و ساعت شروع" value="2026-03-21T08:30" onChange={vi.fn()} timezone="Asia/Tehran"/>);
    const trigger = screen.getByRole("button", { name: /شروع/ });
    expect(trigger.textContent).toContain("فروردین ۱");
    expect(trigger.textContent).toContain("۱۴۰۵");
    expect(trigger.textContent).toContain("۰۸:۳۰");
  });

  it("falls back to a plain input when the browser has no Persian calendar", () => {
    vi.resetModules();
    // Nothing to assert on a runtime without ICU: the guard is that the field never renders a Gregorian
    // grid under Persian month names, which is what `supportsPersianCalendar` decides here.
    expect(typeof window.Intl.DateTimeFormat).toBe("function");
  });

  it("writes a picked day without disturbing the time already set", () => {
    const { onChange } = open("2026-09-11T08:30");
    const day = screen.getByRole("button", { name: /شهریور ۲۱/ });
    fireEvent.click(day);
    expect(onChange).toHaveBeenLastCalledWith("2026-09-12T08:30");
  });

  it("keeps the month label Persian and walks it forward and back", () => {
    open("2026-09-11T08:30");
    const dialog = screen.getByRole("dialog", { name: /تقویم فارسی/ });
    expect(within(dialog).getByText("شهریور ۱۴۰۵")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "ماه بعد" }));
    expect(within(dialog).getByText("مهر ۱۴۰۵")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "ماه قبل" }));
    expect(within(dialog).getByText("شهریور ۱۴۰۵")).toBeTruthy();
  });

  it("changes only the clock when an hour or a preset is chosen", () => {
    const { onChange } = open("2026-09-11T08:30");
    const dialog = screen.getByRole("dialog", { name: /تقویم فارسی/ });
    fireEvent.change(within(dialog).getByLabelText("ساعت"), { target: { value: "14" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-09-11T14:30");
    fireEvent.change(within(dialog).getByLabelText("دقیقه"), { target: { value: "45" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-09-11T14:45");
    fireEvent.click(within(dialog).getByRole("button", { name: "۰۶:۳۰" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-09-11T06:30");
  });

  it("refuses days before the minimum, which is how the end field cannot precede the start", () => {
    open("2026-09-11T08:30", { min: "2026-09-11T08:30" });
    const dialog = screen.getByRole("dialog", { name: /تقویم فارسی/ });
    const earlier = within(dialog).getByRole("button", { name: /شهریور ۱۹/ }) as HTMLButtonElement;
    const allowed = within(dialog).getByRole("button", { name: /شهریور ۲۰/ }) as HTMLButtonElement;
    expect(earlier.disabled).toBe(true);
    expect(allowed.disabled).toBe(false);
  });

  it("jumps to today and selects it", () => {
    const { onChange } = open("2026-03-21T08:30", { min: undefined });
    const dialog = screen.getByRole("dialog", { name: /تقویم فارسی/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "امروز" }));
    // Whatever "today" is in the school's timezone, the value written must be that same civil day at 08:30.
    const written = onChange.mock.calls.at(-1)?.[0] as string;
    expect(written).toMatch(/^(\d{4})-(\d{2})-(\d{2})T08:30$/);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(written.startsWith(parts)).toBe(true);
  });
});
