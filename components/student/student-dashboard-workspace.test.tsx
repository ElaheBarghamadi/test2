import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ApiAvailableExamDto } from "@/lib/api/dtos";
import type { Exam } from "@/lib/types/domain";
import { StudentDashboardWorkspace, subjectAverages } from "@/components/student/student-dashboard-workspace";
import { toStudentDashboardExam } from "@/lib/api/mappers";
import { useAuthStore } from "@/lib/state/auth-store";
import { humanRemaining } from "@/lib/utils";

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
  useAuthStore.setState({ user: null });
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
    const rail = screen.getByRole("group", { name: "فیلتر آزمون‌ها" });
    expect(rail.textContent).toContain("همه");
    expect((rail.textContent ?? "").replace(/\s/g, "")).toContain("۵");
    fireEvent.click(screen.getByRole("button", { name: /نتایج/ }));
    expect(await screen.findByText("آزمون تصحیح‌شده")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "آزمون آماده" })).toBeNull();
  });

  it("keeps the running attempt first and gives it one clear resume action", async () => {
    await renderDesk();
    const running = screen.getByRole("heading", { name: "آزمون در جریان" }).closest("div.rounded-2xl") as HTMLElement;
    expect(running).toBeTruthy();
    expect(running.textContent).toContain("در حال انجام");
    expect(running.textContent).toContain("۲۰:۰۰");
    const link = screen.getByRole("link", { name: /ادامهٔ آزمون/ });
    expect(link.getAttribute("href")).toBe("/student/exam/running");
  });

  it("keeps the start time and countdown on the upcoming exam's own card", async () => {
    await renderDesk();
    const upcoming = screen.getByRole("heading", { name: "آزمون هفتهٔ بعد" }).closest("div.rounded-2xl") as HTMLElement;
    expect(upcoming.textContent).toContain("پیش‌رو");
    expect(upcoming.textContent).toMatch(/۱ روز و ۲۳ ساعت|۲ روز/);
    expect(/\d/.test(upcoming.textContent ?? "")).toBe(false);
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
    expect(await screen.findByText("در انتظار تصحیح")).toBeTruthy();
  });

  it("keeps the filter rail to four categories and drops the filler copy", async () => {
    await renderDesk();
    const rail = screen.getByRole("group", { name: "فیلتر آزمون‌ها" });
    expect(rail.querySelectorAll("button")).toHaveLength(4);
    // Marketing sentences that describe the platform rather than this student's own record.
    expect(screen.queryByText("پاسخ‌ها خودکار ذخیره می‌شوند")).toBeNull();
    expect(screen.queryByText("دسترسی امن آزمون")).toBeNull();
  });

  it("anchors the two sections the sidebar links to", async () => {
    await renderDesk();
    // `roleNavigation.student` points at `/student/dashboard#exams` and `#results`; a link to a fragment
    // that does not exist is a link that does nothing, which is worse than no link.
    expect(document.getElementById("exams")).toBeTruthy();
    expect(document.getElementById("results")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "آزمون‌های من" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "نتایج و عملکرد" })).toBeTruthy();
  });

  it("greets an empty account with one useful next step", async () => {
    listAvailable.mockResolvedValue([]);
    render(<StudentDashboardWorkspace/>);
    expect(await screen.findByText("فعلاً آزمونی ندارید")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /تازه‌سازی/ })).toHaveLength(2);
    expect(screen.queryByRole("group", { name: "فیلتر آزمون‌ها" })).toBeNull();
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

/**
 * The dashboard as a whole, not just the list.
 *
 * These are the parts that were missing: a student who had sat six exams had no way to see an average, and
 * a half-finished attempt was one card among many rather than the thing the page leads with. Every figure
 * asserted here is derived from the same `GET /student/exams/` payload the cards render, so a mismatch
 * between the summary and the list is a bug these tests would catch.
 */
describe("dashboard summary", () => {
  it("leads with a running attempt and gives it a clock of its own", async () => {
    await renderDesk();
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("۲۰:۰۰");
    const resume = screen.getByRole("link", { name: /بازگشت به جلسهٔ آزمون/ });
    expect(resume.getAttribute("href")).toBe("/student/exam/running");
    // The banner states the exam's title but must not make it a heading: the card below owns the `<h2>`,
    // and two headings with one name makes the list unqueryable by title.
    expect(screen.getAllByRole("heading", { name: "آزمون در جریان" })).toHaveLength(1);
  });

  it("counts only what the student can still act on", async () => {
    await renderDesk();
    // one in_progress + one available
    expect(statCard("نیازمند اقدام").textContent).toContain("۲");
    expect(statCard("پیش‌رو").textContent).toContain("۱");
  });

  it("averages published results and never counts an ungraded paper as zero", async () => {
    await renderDesk();
    // Only "graded" (80%) has a published result; "waiting" is submitted but unmarked.
    expect(statCard("میانگین درصد").textContent).toContain("۸۰٪");
    expect(statCard("میانگین درصد").textContent).toContain("از ۱ نتیجهٔ منتشرشده");
    expect(statCard("قبولی").textContent).toContain("۱/۱");
    const panel = screen.getByRole("region", { name: /نتایج و عملکرد/ });
    // «منتظر نمره» is the panel's word for the same paper the list calls «در انتظار تصحیح».
    const pending = within(panel).getByText("منتظر نمره").closest("div.rounded-xl") as HTMLElement;
    expect(pending.textContent).toContain("۱");
  });

  it("shows a real average and pass rate across several results", async () => {
    listAvailable.mockResolvedValue([
      graded({ id: "a", title: "آزمون اول", percentage: 80, passed: true, submitted: "2026-03-01T08:00:00Z" }),
      graded({ id: "b", title: "آزمون دوم", percentage: 60, passed: false, submitted: "2026-03-08T08:00:00Z" }),
      graded({ id: "c", title: "آزمون سوم", percentage: 100, passed: true, submitted: "2026-03-15T08:00:00Z" }),
    ]);
    render(<StudentDashboardWorkspace/>);
    await screen.findByRole("heading", { name: "آزمون اول" });

    expect(statCard("میانگین درصد").textContent).toContain("۸۰٪"); // (80+60+100)/3
    expect(statCard("قبولی").textContent).toContain("۲/۳");
    expect(statCard("قبولی").textContent).toContain("نرخ قبولی ۶۷٪");

    const trend = screen.getByRole("list", { name: "روند درصد نمرات" });
    expect(trend.querySelectorAll("li")).toHaveLength(3);
    // Chronological by submission, not by the exam's scheduled window.
    expect(trend.textContent).toContain("آزمون اول: ۸۰ درصد");
  });

  it("explains an account with no published result instead of showing an empty chart", async () => {
    listAvailable.mockResolvedValue([examDto({ id: "later", title: "آزمون هفتهٔ بعد", availability: "upcoming" })]);
    render(<StudentDashboardWorkspace/>);
    expect(await screen.findByText("هنوز نتیجه‌ای منتشر نشده است")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "روند درصد نمرات" })).toBeNull();
    expect(statCard("میانگین درصد").textContent).toContain("—");
  });

  it("says which school and class the student belongs to when the profile carries them", async () => {
    useAuthStore.setState({ user: { id: "u1", fullName: "سارا احمدی", email: "s@x.test", role: "student", schoolName: "دبیرستان نمونه", grade: "پایه دوازدهم", className: "تجربی ۲" } });
    await renderDesk();
    expect(screen.getByText("دبیرستان نمونه")).toBeTruthy();
    expect(screen.getByText("پایه دوازدهم")).toBeTruthy();
    expect(screen.getByText("کلاس تجربی ۲")).toBeTruthy();
  });
});

/** Scoped to the stat strip: the filter rail uses «نیازمند اقدام» too, and the transcript card names its
 *  own average. An unscoped `getByText` would find two or three and tell us nothing. */
function statCard(label: string) {
  const strip = screen.getByRole("group", { name: "خلاصهٔ وضعیت" });
  return within(strip).getByText(label).closest("div.rounded-2xl") as HTMLElement;
}

function graded({ id, title, percentage, passed, submitted }: { id: string; title: string; percentage: number; passed: boolean; submitted: string }): ApiAvailableExamDto {
  return examDto({
    id, title, availability: "completed",
    attempt: {
      id: `at-${id}`, status: "submitted", started_at: submitted, submitted_at: submitted,
      attempt_number: 1, remaining_seconds: null,
      result: { score: Math.round(percentage / 5), percentage, maximum_score: 20, passing_percentage: 50, passed, is_final: true },
    },
  });
}

/**
 * The two additions to the front door: a hero that says what is next before the list does, and a per-subject
 * mean that answers "what do I revise" rather than "how am I doing".
 *
 * Both are derived from the same payload the cards render, which is the property worth pinning — a summary
 * from a second source is a summary that can contradict the list next to it.
 */
describe("subject averages", () => {
  /** The helper reads the mapped shape the page renders, not the raw DTO. */
  const mapped = (dtos: ApiAvailableExamDto[]) => dtos.map(toStudentDashboardExam) as Exam[];

  it("averages only published results, and counts every paper sat", () => {
    const rows = subjectAverages(mapped([
      graded({ id: "a", title: "یک", percentage: 80, passed: true, submitted: "2026-03-01T08:00:00Z" }),
      graded({ id: "b", title: "دو", percentage: 60, passed: false, submitted: "2026-03-08T08:00:00Z" }),
      examDto({ id: "c", title: "سه", availability: "completed", subject: "ریاضی", attempt: null }),
    ]));

    // The two graded fixtures are both «ریاضی»; the unmarked one joins the count but not the mean.
    const maths = rows.find((row) => row.subject === "ریاضی")!;
    expect(maths).toMatchObject({ sat: 3, graded: 2, average: 70 });
  });

  it("leaves a subject with nothing published at null rather than zero", () => {
    const rows = subjectAverages(mapped([examDto({ id: "c", title: "سه", availability: "upcoming", subject: "شیمی" })]));
    expect(rows[0]).toMatchObject({ subject: "شیمی", sat: 1, graded: 0, average: null });
  });

  it("splits by subject and puts the graded ones first", () => {
    const rows = subjectAverages(mapped([
      examDto({ id: "x", title: "x", availability: "upcoming", subject: "شیمی" }),
      graded({ id: "a", title: "یک", percentage: 90, passed: true, submitted: "2026-03-01T08:00:00Z" }),
    ]));

    expect(rows.map((row) => row.subject)).toEqual(["ریاضی", "شیمی"]);
  });
});

describe("the hero band", () => {
  it("names the next exam and how long there is, without taking the page's only timer", async () => {
    await renderDesk();
    const hero = screen.getByRole("region", { name: "وضعیت شما" });

    expect(hero.textContent).toContain("آزمون هفتهٔ بعد");
    expect(hero.textContent).toContain("نزدیک‌ترین آزمون پیش‌رو");
    // The resume banner owns `role="timer"`; a second one would make both unaddressable.
    expect(screen.getAllByRole("timer")).toHaveLength(1);
    // And the title stays a paragraph here: the card below owns the heading.
    expect(screen.getAllByRole("heading", { name: "آزمون هفتهٔ بعد" })).toHaveLength(1);
  });

  it("points an exam that can be started straight at its session", async () => {
    listAvailable.mockResolvedValue([examDto({ id: "ready", title: "آزمون آماده", availability: "available" })]);
    render(<StudentDashboardWorkspace/>);
    const hero = await screen.findByRole("region", { name: "وضعیت شما" });

    expect(within(hero).getByRole("link", { name: /رفتن به آزمون/ }).getAttribute("href")).toBe("/student/exam/ready");
  });

  it("says how many papers are waiting on the teacher", async () => {
    await renderDesk();
    const hero = screen.getByRole("region", { name: "وضعیت شما" });
    expect(hero.textContent).toContain("۱ آزمون منتظر نمرهٔ آموزگار است");
  });
});

describe("the per-subject breakdown", () => {
  it("stays out of the way when there is only one subject", async () => {
    await renderDesk();
    expect(screen.queryByRole("heading", { name: /میانگین به تفکیک درس/ })).toBeNull();
  });

  it("shows one bar per subject and flags the one worth revising", async () => {
    listAvailable.mockResolvedValue([
      { ...graded({ id: "a", title: "یک", percentage: 90, passed: true, submitted: "2026-03-01T08:00:00Z" }), subject: "ریاضی" },
      { ...graded({ id: "b", title: "دو", percentage: 40, passed: false, submitted: "2026-03-08T08:00:00Z" }), subject: "شیمی" },
    ]);
    render(<StudentDashboardWorkspace/>);
    await screen.findByRole("heading", { name: /میانگین به تفکیک درس/ });

    expect(screen.getByRole("progressbar", { name: "میانگین درس ریاضی" }).getAttribute("aria-valuenow")).toBe("90");
    expect(screen.getByRole("progressbar", { name: "میانگین درس شیمی" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("نیازمند مرور: شیمی")).toBeTruthy();
  });

  it("says a subject has no published result instead of drawing an empty bar as zero", async () => {
    listAvailable.mockResolvedValue([
      { ...examDto({ id: "a", title: "یک", availability: "completed", attempt: null }), subject: "ریاضی" },
      { ...graded({ id: "b", title: "دو", percentage: 70, passed: true, submitted: "2026-03-08T08:00:00Z" }), subject: "شیمی" },
    ]);
    render(<StudentDashboardWorkspace/>);
    await screen.findByRole("heading", { name: /میانگین به تفکیک درس/ });

    expect(screen.getByText("۱ آزمون · بدون نتیجهٔ منتشرشده")).toBeTruthy();
    expect(screen.queryByText("نیازمند مرور: ریاضی")).toBeNull();
  });
});
