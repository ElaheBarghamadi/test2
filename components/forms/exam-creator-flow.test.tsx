import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Exam, Question } from "@/lib/types/domain";

/**
 * The builder's own two promises: every step is one click away, and saving twice changes the same rows
 * instead of duplicating them. Both used to be false — the rail only let you walk backwards, and the draft
 * kept the client-side ids of questions the server had already stored, so the second save re-created every
 * question and deleted the answered originals.
 */
const state = vi.hoisted(() => ({
  exams: [] as Exam[],
  saveExam: vi.fn(),
  loadExam: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, AnimatePresence: ({ children }: { children?: React.ReactNode }) => children ?? null };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push, replace: state.replace, back: vi.fn() }) }));
vi.mock("@/hooks/use-teacher-exams", () => ({
  useTeacherExams: () => ({
    exams: state.exams, loading: false, detailLoadingId: null, initialized: true, error: null,
    clearError: vi.fn(), saveExam: state.saveExam, loadExam: state.loadExam,
  }),
}));
vi.mock("@/lib/state/toast-store", () => ({ useToastStore: (selector: (s: { push: typeof state.toast }) => unknown) => selector({ push: state.toast }) }));

import { ExamCreator } from "@/components/forms/exam-creator";

function choice(id: string, stem = "کدام واحد نیرو است؟"): Question {
  return {
    id,
    order: 1,
    type: "single_choice",
    stem,
    points: 2,
    required: true,
    difficulty: "medium",
    explanation: "",
    options: [
      { id: `${id}-a`, label: "نیوتن", value: `${id}-a` },
      { id: `${id}-b`, label: "ژول", value: `${id}-b` },
    ],
    correctOptionId: `${id}-a`,
  } as unknown as Question;
}

function exam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    title: "آزمون شیمی",
    subject: "شیمی",
    grade: "۱۲",
    className: "۱",
    description: "فصل ۲ و ۳",
    instructions: "",
    status: "draft",
    startAt: "2026-10-03T05:30:00Z",
    endAt: "2026-10-03T07:00:00Z",
    schedule: { startAt: "2026-10-03T09:00", endAt: "2026-10-03T10:30", timezone: "Asia/Tehran" },
    questionCount: 1,
    participantCount: 0,
    settings: {
      durationMinutes: 45, totalMarks: 2, allowBackNavigation: true, questionLayout: "paged", randomizeQuestions: false,
      randomizeOptions: false, allowUnanswered: true, showResultImmediately: false, resultVisibility: "pending",
      showCorrectAnswers: false, attemptLimit: 1, passingPercentage: 50,
    },
    questions: [choice("question-local")],
    teacherName: "مریم رضایی",
    accent: "indigo",
    createdAt: "2026-09-01T05:30:00Z",
    updatedAt: "2026-09-02T05:30:00Z",
    ...overrides,
  } as Exam;
}

beforeEach(() => {
  state.exams = [];
  state.saveExam.mockReset();
  state.toast.mockReset();
  state.push.mockReset();
  state.replace.mockReset();
});

describe("builder navigation", () => {
  it("opens any step in one click, without walking the wizard backwards first", () => {
    state.exams = [exam()];
    render(<ExamCreator examId="exam-1"/>);
    fireEvent.click(screen.getByRole("button", { name: /زمان‌بندی/ }));
    expect(screen.getByText("تاریخ و ساعت شروع")).toBeTruthy();
    expect(screen.getByText(/هر گام را مستقیم باز کنید/)).toBeTruthy();
  });

  it("marks the steps that are still incomplete, so a jump away does not hide the problem", () => {
    state.exams = [exam({ title: "", questions: [] })];
    render(<ExamCreator examId="exam-1"/>);
    const basic = screen.getByRole("button", { name: /اطلاعات پایه/ });
    expect(basic.getAttribute("aria-label")).toContain("باقی مانده");
    expect(basic.textContent).toContain("۱");
  });
});

describe("reaching the bank from the builder", () => {
  it("opens the bank pointed back at the exam being edited", async () => {
    state.exams = [exam()];
    render(<ExamCreator examId="exam-1"/>);
    fireEvent.click(screen.getByRole("button", { name: /سؤال‌ها/ }));
    const link = await screen.findByRole("link", { name: /افزودن از بانک/ });
    expect(link.getAttribute("href")).toBe("/teacher/questions?exam=exam-1");
  });

  it("asks for a save first while the exam has no id to bank into", async () => {
    state.saveExam.mockResolvedValue(exam());
    render(<ExamCreator/>);
    fireEvent.click(screen.getByRole("button", { name: /سؤال‌ها/ }));
    expect(await screen.findByText(/اول پیش‌نویس را ذخیره کنید/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ذخیرهٔ پیش‌نویس برای افزودن از بانک/ }));
    await waitFor(() => expect(state.saveExam).toHaveBeenCalled());
  });
});

describe("saving an exam twice", () => {
  it("adopts the ids the server returned, so the next save edits the same rows", async () => {
    state.exams = [exam()];
    const saved = exam({ questions: [choice("q-server")] });
    state.saveExam.mockResolvedValue(saved);
    render(<ExamCreator examId="exam-1"/>);

    fireEvent.click(screen.getByRole("button", { name: /ذخیرهٔ تغییرات/ }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "پیش‌نویس ذخیره شد" })));
    expect(state.saveExam).toHaveBeenLastCalledWith(expect.objectContaining({ questions: [expect.objectContaining({ id: "question-local" })] }), "draft");

    fireEvent.click(screen.getByRole("button", { name: /ذخیرهٔ تغییرات/ }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "پیش‌نویس ذخیره شد" })));
    expect(state.saveExam).toHaveBeenLastCalledWith(expect.objectContaining({ questions: [expect.objectContaining({ id: "q-server" })] }), "draft");
  });

  it("moves a saved draft onto its own edit route, so a refresh continues the same exam", async () => {
    state.saveExam.mockResolvedValue(exam());
    render(<ExamCreator/>);
    fireEvent.click(screen.getByRole("button", { name: /ذخیره پیش‌نویس/ }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "پیش‌نویس ذخیره شد" })));
    expect(state.replace).toHaveBeenCalledWith("/teacher/exams/exam-1/edit");
  });

  it("refuses to save a paper that repeats one of its own questions", async () => {
    state.exams = [exam({ questions: [choice("q-1"), choice("q-2")] })];
    state.saveExam.mockResolvedValue(exam());
    render(<ExamCreator examId="exam-1"/>);

    expect(screen.getByText(/۱ سؤال تکراری/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ذخیرهٔ تغییرات/ }));
    await waitFor(() => expect(state.toast).toHaveBeenCalled());
    expect(state.saveExam).not.toHaveBeenCalled();
    expect((state.toast.mock.calls[0]?.[0] as { description?: string }).description).toContain("عیناً یکی است");
  });
});
