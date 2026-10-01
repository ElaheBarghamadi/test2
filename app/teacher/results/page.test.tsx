import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ApiGradingQueueRowDto, ApiTeacherResultRowDto } from "@/lib/api/dtos";

/**
 * The results screen, as a teacher meets it on a phone.
 *
 * The page carries two renderings of the same rows - a thirteen-column table for a laptop and a card list for a
 * phone - because the columns that matter (the score, the marking button) are exactly the ones a horizontal
 * scroll hides first. These tests pin the phone rendering to the same facts as the table: one card per attempt,
 * the score out of the maximum, the manual-grading count, and a way into the marking desk.
 */
const state = vi.hoisted(() => ({
  rows: [] as ApiTeacherResultRowDto[],
  queue: [] as ApiGradingQueueRowDto[],
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/use-teacher-exams", () => ({
  useTeacherExams: () => ({
    exams: [{
      id: "exam-1",
      title: "آزمون فیزیک نوبت اول",
      status: "completed",
      grade: "۱۲",
      class_name: "۱",
      settings: { passingPercentage: 0, resultDetail: "score_only" },
    }],
    loading: false,
    initialized: true,
  }),
}));
vi.mock("@/lib/api/results", () => ({
  resultsApi: {
    teacherExamRows: () => Promise.resolve(state.rows),
    gradingQueue: () => Promise.resolve({ queue: state.queue }),
  },
}));
vi.mock("@/lib/state/toast-store", () => ({ useToastStore: (selector: (s: { push: typeof state.push }) => unknown) => selector({ push: state.push }) }));

import TeacherResultsPage from "@/app/teacher/results/page";

function row(overrides: Partial<ApiTeacherResultRowDto> = {}): ApiTeacherResultRowDto {
  return {
    id: "attempt-1",
    student_id: "student-1",
    student_name: "سارا محمدی",
    student_email: "sara@example.ir",
    grade: "۱۲",
    class_name: "۱",
    status: "submitted",
    submission_status: "needs_grading",
    started_at: "2026-10-03T05:00:00Z",
    submitted_at: "2026-10-03T05:42:00Z",
    last_activity_at: "2026-10-03T05:42:00Z",
    completion_minutes: 42,
    score: "14.50",
    percentage: "72.50",
    maximum_score: "20.00",
    pending_manual_grading_count: 2,
    manual_grading_count: 3,
    attempt_number: 1,
    result_status: "pending",
    ...overrides,
  };
}

beforeEach(() => {
  state.rows = [row(), row({ id: "attempt-2", student_id: "student-2", student_name: "امیر کاظمی", score: null, percentage: null, submission_status: "in_progress", manual_grading_count: 0, pending_manual_grading_count: 0, completion_minutes: null })];
  state.queue = [];
  state.push.mockReset();
});

describe("the teacher results screen on a phone", () => {
  it("renders a card per attempt, with the score and the marking count on it", async () => {
    render(<TeacherResultsPage/>);
    const cards = await screen.findByTestId("teacher-result-cards");
    await waitFor(() => expect(within(cards).getAllByText("سارا محمدی").length).toBe(1));

    // The card itself is the clickable wrapper the page renders per row.
    const card = within(cards).getAllByText("سارا محمدی")[0].closest("div[class~='cursor-pointer']") as HTMLElement;
    const text = card?.textContent ?? "";
    expect(text).toContain("۱۴.۵"); // the score, in Persian digits
    expect(text).toContain("از ۲۰");
    expect(text).toContain("تصحیح دستی: ۱/۳"); // one of three marked, two still waiting
  });

  it("keeps the table for wider screens and hides it below sm", async () => {
    render(<TeacherResultsPage/>);
    const table = await screen.findByTestId("teacher-result-table");
    expect(table.className).toContain("hidden");
    expect(table.className).toContain("sm:block");
    const cards = screen.getByTestId("teacher-result-cards");
    expect(cards.className).toContain("sm:hidden");
  });

  it("still offers the way into the marking desk from a card", async () => {
    render(<TeacherResultsPage/>);
    const cards = await screen.findByTestId("teacher-result-cards");
    await waitFor(() => expect(within(cards).getAllByRole("button", { name: /تصحیح/ }).length).toBeGreaterThan(0));
  });

  it("shows an attempt in progress without inventing a score", async () => {
    render(<TeacherResultsPage/>);
    const cards = await screen.findByTestId("teacher-result-cards");
    await waitFor(() => expect(within(cards).getAllByText("امیر کاظمی").length).toBe(1));
    expect(within(cards).getAllByText("—").length).toBeGreaterThan(0);
  });
});
