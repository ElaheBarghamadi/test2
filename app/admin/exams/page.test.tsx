import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api/client";

/**
 * The exam table the school administrator actually runs the school from.
 *
 * Everything on this page is lifecycle — publish, start, extend, complete, results, archive — because that
 * is the line the API draws for the role: a principal may move a teacher's paper through its schedule and
 * release its results, and may not read or write its questions. The actions offered per status are the
 * server's rules made visible, so the tests pin both halves: which buttons exist, and what a click sends.
 */
const api = vi.hoisted(() => ({
  exams: vi.fn(),
  publish: vi.fn(),
  start: vi.fn(),
  extend: vi.fn(),
  complete: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  publishResults: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: "school_admin" as string | undefined }));

vi.mock("@/lib/api/admin", () => ({ adminApi: { exams: () => api.exams() } }));
vi.mock("@/lib/api/exams", () => ({
  examsApi: {
    publish: (...args: unknown[]) => api.publish(...args),
    start: (...args: unknown[]) => api.start(...args),
    extend: (...args: unknown[]) => api.extend(...args),
    complete: (...args: unknown[]) => api.complete(...args),
    archive: (...args: unknown[]) => api.archive(...args),
    restore: (...args: unknown[]) => api.restore(...args),
  },
}));
vi.mock("@/lib/api/results", () => ({ resultsApi: { publishExamResults: (...args: unknown[]) => api.publishResults(...args) } }));
vi.mock("@/lib/state/auth-store", () => ({ useAuthStore: (selector: (state: { user: { role: string } | null }) => unknown) => selector({ user: session.role ? { role: session.role } : null }) }));

import AdminExamsPage from "@/app/admin/exams/page";
import type { ApiAdminExamDto } from "@/lib/api/dtos";

function exam(overrides: Partial<ApiAdminExamDto> & { id: string; status: ApiAdminExamDto["status"] }): ApiAdminExamDto {
  return {
    title: `آزمون ${overrides.id}`,
    subject: "فیزیک",
    grade: "۱۲",
    class_name: "۱",
    duration_minutes: 45,
    total_marks: "20.00",
    start_at: "2026-10-03T05:30:00Z",
    end_at: "2026-10-03T07:00:00Z",
    teacher_name: "مریم رضایی",
    teacher_email: "t@example.ir",
    school: { id: "s1", name: "North Academy", city: "Tehran" },
    question_count: 8,
    participant_count: 12,
    created_at: "2026-09-01T05:30:00Z",
    updated_at: "2026-09-02T05:30:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({ published_count: 3, pending_manual_grading_count: 1 }));
  session.role = "school_admin";
  api.exams.mockResolvedValue([
    exam({ id: "draft-1", status: "draft" }),
    exam({ id: "live-1", status: "active" }),
    exam({ id: "done-1", status: "completed" }),
    exam({ id: "arch-1", status: "archived" }),
  ]);
});

async function page() {
  render(<AdminExamsPage/>);
  await screen.findByText("آزمون draft-1");
}

function rowActions(title: string) {
  const row = screen.getByText(title).closest("tr") as HTMLElement;
  return Array.from(row.querySelectorAll("button")).map((button) => button.textContent?.trim());
}

describe("admin exam lifecycle", () => {
  it("offers only the moves a paper in that state can take", async () => {
    await page();
    expect(rowActions("آزمون draft-1")).toEqual(["زمان‌بندی و انتشار", "بایگانی"]);
    expect(rowActions("آزمون live-1")).toEqual(["تمدید ۱۵ دقیقه", "پایان آزمون", "انتشار نتایج"]);
    expect(rowActions("آزمون arch-1")).toEqual(["بازگردانی"]);
  });

  it("publishes through the exam endpoint and reloads the table", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: /زمان‌بندی و انتشار/ }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith("draft-1"));
    await waitFor(() => expect(api.exams).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/زمان‌بندی و انتشار انجام شد/)).toBeTruthy();
  });

  it("reports what publishing results actually released, including what is still pending", async () => {
    await page();
    const finished = screen.getByText("آزمون done-1").closest("tr") as HTMLElement;
    fireEvent.click(within(finished).getByRole("button", { name: /انتشار نتایج/ }));
    await waitFor(() => expect(api.publishResults).toHaveBeenCalledWith("done-1"));
    const notice = await screen.findByText(/نتیجه منتشر شد/);
    expect(notice.textContent).toContain("۳");
    expect(notice.textContent).toContain("۱ برگه هنوز در صف تصحیح است");
  });

  it("passes a refused action straight to the teacher instead of swallowing it", async () => {
    // The API's own error type, because `apiErrorMessage` reads the payload it carries.
    api.publish.mockRejectedValueOnce(new ApiError(400, { detail: "آزمون هنوز سؤال کاملی ندارد." }));
    await page();
    fireEvent.click(screen.getByRole("button", { name: /زمان‌بندی و انتشار/ }));
    expect(await screen.findByText("آزمون هنوز سؤال کاملی ندارد.")).toBeTruthy();
    expect(api.exams).toHaveBeenCalledTimes(1);
  });

  it("says plainly that answer sheets stay out of a principal's reach", async () => {
    await page();
    expect(await screen.findByText(/متن سؤال‌ها، گزینه‌ها و پاسخ دانش‌آموزان در اختیار مدیر مدرسه نیست/)).toBeTruthy();

    session.role = "admin";
    render(<AdminExamsPage/>);
    expect(await screen.findByText(/تغییر محتوای آزمون همچنان فقط از مسیر مالک آزمون/)).toBeTruthy();
  });

  it("titles itself for the school when a principal is looking", async () => {
    await page();
    expect(screen.getByRole("heading", { name: "آزمون‌های مدرسه" })).toBeTruthy();
    expect(screen.getAllByText("مدیریت مدرسه").length).toBeGreaterThan(0);
  });
});
