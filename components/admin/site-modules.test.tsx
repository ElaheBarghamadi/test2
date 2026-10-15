import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ApiAdminStatsDto } from "@/lib/api/dtos";

const stats = vi.hoisted(() => ({ payload: null as ApiAdminStatsDto | null, fail: false }));
vi.mock("@/lib/api/admin", () => ({
  adminApi: { stats: () => (stats.fail ? Promise.reject(new Error("boom")) : Promise.resolve(stats.payload)) },
}));

import { SiteModules } from "@/components/admin/site-modules";

function payload(overrides: Partial<ApiAdminStatsDto> = {}): ApiAdminStatsDto {
  return {
    scope: { kind: "platform", school: null },
    generated_at: "2026-03-20T08:00:00Z",
    totals: {
      users: 17, users_by_role: { student: 12, teacher: 2, admin: 1, school_admin: 2 },
      active_users: 16, inactive_users: 1, schools: 2, exams: 6,
      exams_by_status: { active: 1, completed: 4, draft: 1 }, questions: 30, bank_questions: 4,
      attempts: 27, attempts_by_status: { in_progress: 1, submitted: 26 }, answers: 135,
      results_published: 16, results_awaiting_grading: 1, notifications: 8, unread_notifications: 3,
    },
    grading: { written_ungraded: 2, teacher_marked: 5, exams_awaiting: 0, share_of_results: 0 },
    scores: { results_scored: 16, average_percentage: 74.4, pass_rate: 81, marks_awarded: 250 },
    activity: {
      days: 14, submissions: [], starts: [], exams_created: [], signups: [], signals: [],
      live_now: { attempts_in_progress: 1, students_writing: 1, exams_live: 1, exams_overdue: 0 },
    },
    top: { teachers: [], schools: [] },
    health: { database: { engine: "sqlite", size_bytes: 4096 }, debug: false, django: "5.2.17", signals_by_kind: {} },
    ...overrides,
  } as ApiAdminStatsDto;
}

beforeEach(() => {
  stats.payload = payload();
  stats.fail = false;
});

describe("the modules panel", () => {
  it("gives every section its own count and a way in", async () => {
    render(<SiteModules canControl/>);
    await screen.findByRole("link", { name: /مدارس/ });

    for (const label of ["مدارس", "کاربران", "آزمون‌ها", "سؤال‌ها", "پاسخ‌برگ‌ها", "نتیجه‌ها", "نشست‌های زنده", "اعلان‌ها", "پایگاه داده"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) }), label).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: /کاربران/ }).textContent).toContain("۱۷");
    expect(screen.getByRole("link", { name: /آزمون‌ها/ }).getAttribute("href")).toBe("/admin/exams");
  });

  it("flags the sections that need somebody, and leaves the quiet ones alone", async () => {
    stats.payload = payload({ grading: { written_ungraded: 2, teacher_marked: 5, exams_awaiting: 3, share_of_results: 12 } });
    render(<SiteModules canControl/>);
    await screen.findByRole("link", { name: /نتیجه‌ها/ });

    expect(screen.getByRole("link", { name: /نتیجه‌ها/ }).textContent).toContain("۳ آزمون منتظر تصحیح");
    expect(screen.getByRole("link", { name: /نتیجه‌ها/ }).className).toContain("border-warning");
    // Nothing outstanding anywhere else, so nothing else shouts.
    expect(screen.getByRole("link", { name: /اعلان‌ها/ }).className).not.toContain("border-warning");
  });

  it("tells a school administrator what they may not do, rather than showing a control that refuses", async () => {
    render(<SiteModules canControl={false}/>);
    await screen.findByRole("link", { name: /مدارس/ });

    expect(screen.getByText(/فقط خواندنی؛ تغییرات با مدیر سامانه است/)).toBeTruthy();
    expect(screen.getByText(/دسترسی مدیر مدرسه/)).toBeTruthy();
  });

  it("reports a refused read instead of rendering nine zeros", async () => {
    stats.fail = true;
    render(<SiteModules canControl/>);

    await waitFor(() => expect(screen.getByText(/شمارش بخش‌ها دریافت نشد/)).toBeTruthy());
    expect(screen.queryByRole("link", { name: /پایگاه داده/ })).toBeNull();
  });
});
