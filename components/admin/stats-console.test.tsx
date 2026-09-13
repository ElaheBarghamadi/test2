import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiAdminDatabaseDto, ApiAdminLiveAttemptDto, ApiAdminStatsDto } from "@/lib/api/dtos";
import { toPersianNumber } from "@/lib/utils";

/**
 * The console an administrator runs the site from: figures, the state of the data, and the actions.
 *
 * The control half is the one under test most sharply — a button that appears for the wrong role is an
 * attempted privilege, and a bulk repair that is offered without saying what it touches is a trap.
 */
const api = vi.hoisted(() => ({
  stats: vi.fn(),
  database: vi.fn(),
  liveAttempts: vi.fn(),
  repairDatabase: vi.fn(),
  examAction: vi.fn(),
  attemptAction: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/admin", () => ({ adminApi: api }));
vi.mock("@/lib/state/toast-store", () => ({ useToastStore: (selector: (state: { push: typeof toast }) => unknown) => selector({ push: toast }) }));

import { AdminStatsConsole } from "@/components/admin/stats-console";

const series = (counts: number[]) => counts.map((count, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, count }));

const stats: ApiAdminStatsDto = {
  scope: { kind: "platform", school: null },
  generated_at: "2026-09-13T09:00:00Z",
  totals: {
    users: 312, users_by_role: { student: 280, teacher: 26, admin: 2, school_admin: 4 }, active_users: 300, inactive_users: 12,
    schools: 7, exams: 96, exams_by_status: { active: 3, draft: 12, scheduled: 2, completed: 70, archived: 9 },
    questions: 1440, bank_questions: 61, attempts: 4210, attempts_by_status: { in_progress: 5, submitted: 4100, expired: 105 },
    answers: 91000, results_published: 3800, results_awaiting_grading: 40, notifications: 900, unread_notifications: 32,
  },
  grading: { written_ungraded: 212, teacher_marked: 900, exams_awaiting: 40, share_of_results: 1.0 },
  scores: { results_scored: 4100, average_percentage: 68.4, pass_rate: 74.2, marks_awarded: 12000 },
  activity: {
    days: 14,
    submissions: series([0, 0, 3, 12, 40, 0, 0, 0, 5, 9, 0, 0, 0, 1]),
    starts: series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
    exams_created: series([0, 1, 0, 2, 0, 0, 1, 0, 0, 3, 0, 0, 0, 0]),
    signups: series([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
    signals: series([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
    live_now: { attempts_in_progress: 5, students_writing: 4, exams_live: 3, exams_overdue: 1 },
  },
  top: { teachers: [{ id: "t1", name: "مریم رضایی", exams: 14, attempts: 420 }], schools: [{ id: "s1", name: "البرز", users: 90, exams: 30 }] },
  health: { database: { engine: "postgresql", size_bytes: 3145728 }, debug: false, django: "5.2.17", signals_by_kind: { tab_hidden: 40, paste: 7 } },
};

const database: ApiAdminDatabaseDto = {
  scope: { kind: "platform", school: null },
  tables: [
    { key: "users", label: "کاربران", rows: 312 },
    { key: "exams", label: "آزمون‌ها", rows: 96 },
    { key: "answers", label: "پاسخ‌های ثبت‌شده", rows: 91000 },
  ],
  issues: { finalized_without_result: 3, exams_past_their_end: 1, choice_questions_without_options: 0, bank_drafts: 12, stale_open_attempts: 0 },
  repairable: 3,
  size_bytes: 3145728,
  engine: "postgresql",
};

const liveRow: ApiAdminLiveAttemptDto = {
  id: "attempt-1",
  exam: { id: "exam-1", title: "آزمون فیزیک" },
  student: { id: "s1", name: "سارا محمدی", email: "sara@example.ir" },
  attempt_number: 1,
  status: "in_progress",
  started_at: "2026-09-13T08:00:00Z",
  last_activity_at: "2026-09-13T08:20:00Z",
  remaining_seconds: 900,
  device_locked: true,
  session_switches: 0,
  tab_switches: 2,
  score: null,
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.stats.mockResolvedValue(stats);
  api.database.mockResolvedValue(database);
  api.liveAttempts.mockResolvedValue({ attempts: [liveRow], count: 1 });
  api.repairDatabase.mockResolvedValue({ repaired: { results: 3, totals: 0, content_hashes: 0 }, at: stats.generated_at });
  api.attemptAction.mockResolvedValue({ status: "expired" });
  toast.mockReset();
});

describe("the statistics", () => {
  it("says what the site is made of, in Persian figures", async () => {
    render(<AdminStatsConsole canControl/>);
    // The same figure shows up twice by design: once as a tile, once as the table's own row count.
    expect((await screen.findAllByText("۳۱۲")).length).toBeGreaterThan(1);
    // The formatting is the app's own helper, so the test asks it rather than hard-coding a separator.
    expect(document.body.textContent).toContain(toPersianNumber(stats.totals.questions));
    expect(document.body.textContent).toContain(toPersianNumber(stats.scores.average_percentage));
    // The live figures sit next to their labels in the "همین حالا" card.
    expect(screen.getByText("در حال نوشتن").parentElement?.textContent).toContain(toPersianNumber(stats.activity.live_now.attempts_in_progress));
    expect(screen.getByText("از زمانش گذشته").parentElement?.textContent).toContain(toPersianNumber(stats.activity.live_now.exams_overdue));
    // Every series is a chart with one bar per day, quiet days included.
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("مریم رضایی").textContent);
  });

  it("names the inconsistencies instead of leaving them to be discovered", async () => {
    render(<AdminStatsConsole canControl/>);
    expect(await screen.findByText("پاسخ‌برگ نهایی‌شده بدون نتیجه")).toBeTruthy();
    expect(screen.getByText("آزمون فعال از زمانش گذشته")).toBeTruthy();
    expect(document.body.textContent).not.toContain("سؤال چندگزینه‌ای بدون گزینه");
  });
});

describe("control", () => {
  it("offers repair only to the platform administrator, and says how much there is to do", async () => {
    const viewer = render(<AdminStatsConsole canControl={false}/>);
    await screen.findAllByText("۳۱۲");
    expect(screen.queryByRole("button", { name: /مرمت/ })).toBeNull();
    viewer.unmount();

    render(<AdminStatsConsole canControl/>);
    const repair = await screen.findByRole("button", { name: /مرمت/ });
    expect(repair.textContent).toContain("۳");
    fireEvent.click(repair);
    await waitFor(() => expect(api.repairDatabase).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "مرمت انجام شد" }));
  });

  it("closes an open sheet from the live list, and releases a device lock only where one is set", async () => {
    render(<AdminStatsConsole canControl/>);
    const close = await screen.findByRole("button", { name: /بستن پاسخ‌برگ سارا محمدی/ });
    fireEvent.click(close);
    await waitFor(() => expect(api.attemptAction).toHaveBeenCalledWith("attempt-1", "finalize"));

    const unlock = screen.getByRole("button", { name: /بازکردن قفل دستگاه سارا محمدی/ });
    fireEvent.click(unlock);
    await waitFor(() => expect(api.attemptAction).toHaveBeenCalledWith("attempt-1", "unlock-device"));
  });

  it("does not draw actions for a school administrator, and still shows them the numbers", async () => {
    render(<AdminStatsConsole canControl={false}/>);
    await screen.findAllByText("۳۱۲");
    expect(screen.queryByRole("button", { name: /بستن پاسخ‌برگ/ })).toBeNull();
    expect(screen.getAllByText("۹۶").length).toBeGreaterThan(0);
  });
});
