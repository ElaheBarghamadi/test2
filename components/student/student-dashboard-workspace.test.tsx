import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ApiAvailableExamDto } from "@/lib/api/dtos";
import { StudentDashboardWorkspace, humanRemaining } from "@/components/student/student-dashboard-workspace";

const listAvailable = vi.fn();

vi.mock("@/lib/api/attempts", () => ({ attemptsApi: { listAvailable: () => listAvailable() } }));

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function examDto(overrides: Partial<ApiAvailableExamDto> & { id: string; title: string; availability: ApiAvailableExamDto["availability"] }): ApiAvailableExamDto {
  return {
    description: "فصل اول و دوم", subject: "ریاضی", grade: "دهم", class_name: "۱۰۲",
    duration_minutes: 45, total_marks: 20, start_at: iso(-HOUR), end_at: iso(4 * HOUR),
    question_count: 10, max_attempts: 2, attempts_used: 1, passing_percentage: 50,
    result_visibility: "pending", teacher_name: "مریم رضایی", allow_unanswered: true,
    allow_previous_questions: true, question_layout: "paged", attempt: null,
    ...overrides,
  };
}

const fixtures: ApiAvailableExamDto[] = [
  examDto({
    id: "running", title: "آزمون در جریان", availability: "in_progress",
    attempt: { id: "at-1", status: "in_progress", started_at: iso(-HOUR), submitted_at: null, attempt_number: 1, remaining_seconds: 1200, result: null },
  }),
  examDto({ id: "ready", title: "آزمون آماده", availability: "available" }),
  examDto({ id: "later", title: "آزمون هفتهٔ بعد", availability: "upcoming", start_at: iso(2 * 24 * HOUR), end_at: iso(3 * 24 * HOUR) }),
  examDto({
    id: "graded", title: "آزمون تصحیح‌شده", availability: "completed",
    attempt: { id: "at-2", status: "submitted", started_at: iso(-48 * HOUR), submitted_at: iso(-47 * HOUR), attempt_number: 1, remaining_seconds: null, result: { score: 16, percentage: 80, maximum_score: 20, passing_percentage: 50, passed: true, is_final: true } },
  }),
  examDto({
    id: "waiting", title: "آزمون در انتظار نمره", availability: "completed",
    attempt: { id: "at-3", status: "submitted", started_at: iso(-60 * HOUR), submitted_at: iso(-59 * HOUR), attempt_number: 2, remaining_seconds: null, result: null },
  }),
];

beforeEach(() => {
  listAvailable.mockReset().mockResolvedValue(fixtures);
});

async function renderDesk() {
  render(<StudentDashboardWorkspace/>);
  // The title also appears in the calendar below, so wait on the hero's heading instead.
  await screen.findByRole("heading", { name: "آزمون در جریان" });
}

describe("humanRemaining", () => {
  it("says what is left in words a student can act on", () => {
    expect(humanRemaining(40_000)).toBe("کمتر از یک دقیقه");
    expect(humanRemaining(12 * 60_000)).toBe("۱۲ دقیقه");
    expect(humanRemaining(3 * HOUR)).toBe("۳ ساعت");
    expect(humanRemaining(3 * HOUR + 35 * 60_000)).toBe("۳ ساعت و نیم");
    expect(humanRemaining(2 * 24 * HOUR)).toBe("۲ روز");
    expect(humanRemaining(2 * 24 * HOUR + 15 * HOUR)).toBe("۲ روز و ۱۵ ساعت");
  });
});

describe("StudentDashboardWorkspace", () => {
  it("counts each category in the filter rail instead of stacking five sections", async () => {
    await renderDesk();
    const rail = screen.getByRole("group", { name: "نمایش آزمون‌ها" });
    expect(rail.textContent).toContain("همه");
    expect((rail.textContent ?? "").replace(/\s/g, "")).toContain("۵");
    fireEvent.click(screen.getByRole("button", { name: /نتایج/ }));
    expect(await screen.findByText("آزمون تصحیح‌شده")).toBeTruthy();
    // The month calendar keeps showing the whole month whatever the list filter says, so the check is on
    // the list's own card (a paragraph) rather than on any element with that title.
    expect(screen.queryByText("آزمون آماده", { selector: "p" })).toBeNull();
  });

  it("puts the attempt that is running in progress in front, with the server's countdown", async () => {
    await renderDesk();
    const hero = screen.getByRole("heading", { name: "آزمون در جریان" }).closest("div.rounded-2xl") as HTMLElement;
    expect(hero).toBeTruthy();
    expect(hero.textContent).toContain("آزمون در حال انجام");
    const link = screen.getByRole("link", { name: /ادامهٔ آزمون/ });
    expect(link.getAttribute("href")).toBe("/student/exam/running");
  });

  it("counts down to the next exam and prints its date in Persian calendar and digits", async () => {
    await renderDesk();
    const band = screen.getByText("تا شروع").closest("div.rounded-2xl") as HTMLElement;
    expect(band.textContent).toContain("آزمون هفتهٔ بعد");
    // Two days minus the milliseconds the test took to run: the wording is "۱ روز و ۲۳ ساعت", which is
    // what a coarse countdown should say rather than rounding up to a day that has not started.
    expect(band.textContent).toMatch(/۱ روز و ۲۳ ساعت|۲ روز/);
    // No Latin digit anywhere in the band means the date came out through the Persian formatter.
    expect(/\d/.test(band.textContent ?? "")).toBe(false);
  });

  it("shows a published result as a ring with the verdict next to it", async () => {
    await renderDesk();
    fireEvent.click(screen.getByRole("button", { name: /نتایج/ }));
    const graded = await screen.findByText("آزمون تصحیح‌شده");
    const card = graded.closest("div.rounded-2xl") as HTMLElement;
    expect(card.textContent).toContain("۸۰٪");
    expect(card.textContent).toContain("۱۶");
    expect(card.textContent).toContain("قبول");
  });

  it("keeps an ungraded paper separate from a published result", async () => {
    await renderDesk();
    fireEvent.click(screen.getByRole("button", { name: /نتایج/ }));
    expect(await screen.findByText("در انتظار بررسی آموزگار")).toBeTruthy();
  });

  it("summarises the report card in the sidebar", async () => {
    await renderDesk();
    const summary = await screen.findByText("کارنامهٔ شما");
    const card = summary.closest("div.rounded-2xl") as HTMLElement;
    expect(card.textContent).toContain("۸۰٪");
    expect(card.textContent).toContain("۱/۱");
  });

  it("explains the room rules the student will meet inside the exam", async () => {
    await renderDesk();
    expect(await screen.findByText("پاسخ‌ها خودکار ذخیره می‌شوند")).toBeTruthy();
    expect(screen.getByText("زمان در سرور شمرده می‌شود")).toBeTruthy();
  });

  it("greets an empty account with what happens next rather than a blank page", async () => {
    listAvailable.mockResolvedValue([]);
    render(<StudentDashboardWorkspace/>);
    expect(await screen.findByText("هنوز آزمون فعالی برای شما منتشر نشده است")).toBeTruthy();
    expect(screen.getByRole("button", { name: /همه/ }).textContent).toContain("۰");
  });

  it("keeps a failed load recoverable", async () => {
    listAvailable.mockRejectedValue(new Error("boom"));
    render(<StudentDashboardWorkspace/>);
    // The message is the error's own text: a plain Error still says something, and the retry stays wired.
    expect(await screen.findByText("boom")).toBeTruthy();
    listAvailable.mockResolvedValue(fixtures);
    fireEvent.click(screen.getByRole("button", { name: /تلاش دوباره/ }));
    expect(await screen.findByRole("heading", { name: "آزمون در جریان" })).toBeTruthy();
  });
});
