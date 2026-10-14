import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Exam } from "@/lib/types/domain";

const state = vi.hoisted(() => ({
  exams: [] as Exam[],
  loading: false,
  initialized: true,
  error: null as string | null,
  hydrate: vi.fn(),
  duplicateExam: vi.fn(),
  archiveExam: vi.fn(),
  restoreExam: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-teacher-exams", () => ({ useTeacherExams: () => state }));
vi.mock("@/lib/state/toast-store", () => ({ useToastStore: (selector: (value: { push: typeof toast }) => unknown) => selector({ push: toast }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}));

import { TeacherExamListWorkspace } from "@/components/teacher/exam-list-workspace";

const draftExam: Exam = {
  id: "draft-1",
  title: "پیش‌نویس آزمون فصل دوم",
  subject: "فیزیک",
  grade: "پایه نهم",
  className: "۹-الف",
  description: "",
  instructions: "",
  status: "draft",
  startAt: "2026-10-13T05:30:00Z",
  endAt: "2026-10-13T06:30:00Z",
  schedule: { startAt: "2026-10-13T09:00", endAt: "2026-10-13T10:00", timezone: "Asia/Tehran" },
  settings: {
    durationMinutes: 45,
    totalMarks: 0,
    allowBackNavigation: true,
    questionLayout: "paged",
    randomizeQuestions: false,
    randomizeOptions: false,
    allowUnanswered: true,
    showResultImmediately: false,
    resultVisibility: "pending",
    showCorrectAnswers: false,
    attemptLimit: 1,
    passingPercentage: 50,
  },
  questions: [],
  questionCount: 0,
  participantCount: 0,
  attemptCount: 0,
  teacherName: "مریم رضایی",
  accent: "teal",
  createdAt: "2026-10-12T05:30:00Z",
  updatedAt: "2026-10-13T05:30:00Z",
};

beforeEach(() => {
  state.exams = [draftExam];
  state.loading = false;
  state.initialized = true;
  state.error = null;
  state.hydrate.mockReset();
  state.duplicateExam.mockReset();
  state.archiveExam.mockReset();
  state.restoreExam.mockReset();
  toast.mockReset();
});

describe("draft exam navigation", () => {
  it("shows when the draft was last edited and gives a one-click resume action", () => {
    render(<TeacherExamListWorkspace/>);

    expect(screen.getByText(/آخرین ویرایش:/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /ادامهٔ ویرایش/ }).getAttribute("href")).toBe("/teacher/exams/draft-1/edit");
  });

  it("keeps the direct edit action in the table layout too", () => {
    render(<TeacherExamListWorkspace/>);
    fireEvent.click(screen.getByRole("button", { name: "نمای فهرست" }));

    const table = screen.getByRole("table");
    const resume = within(table).getByRole("link", { name: "ادامهٔ ویرایش پیش‌نویس" });
    expect(resume.getAttribute("href")).toBe("/teacher/exams/draft-1/edit");
    expect(within(table).getByText(/آخرین ویرایش:/)).toBeTruthy();
  });
});
