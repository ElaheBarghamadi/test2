import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Exam } from "@/lib/types/domain";

/**
 * Adding a question from inside the bank.
 *
 * The bank used to be a read-only shelf: to write anything new you had to open an exam, walk to its
 * questions step and build it there — which also meant a question you only wanted to keep for later had to
 * be attached to a paper first. These tests cover the composer itself and the one rule the server enforces
 * beside it: an exact copy of what the destination already holds is not stored twice.
 */
const api = vi.hoisted(() => ({
  bank: vi.fn(),
  bankTags: vi.fn(),
  importQuestions: vi.fn(),
  createQuestion: vi.fn(),
  archiveQuestion: vi.fn(),
}));
const hook = vi.hoisted(() => ({ exams: [] as Exam[], loading: false, initialized: true, hydrate: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/exams", () => ({ examsApi: api }));
vi.mock("@/hooks/use-teacher-exams", () => ({ useTeacherExams: () => hook }));
vi.mock("@/lib/state/toast-store", () => ({ useToastStore: (selector: (state: { push: typeof toast }) => unknown) => selector({ push: toast }) }));

import { QuestionBankWorkspace } from "@/components/teacher/question-bank-workspace";

const exam = {
  id: "exam-draft",
  title: "آزمون آینده",
  subject: "فیزیک",
  grade: "۱۲",
  className: "۱",
  description: "",
  status: "draft",
  startAt: "2026-10-03T05:30:00Z",
  endAt: "2026-10-03T07:00:00Z",
  schedule: { startAt: "2026-10-03T09:00", endAt: "2026-10-03T10:30", timezone: "Asia/Tehran" },
  questionCount: 0,
  participantCount: 0,
  settings: {
    durationMinutes: 45, totalMarks: 0, allowBackNavigation: true, questionLayout: "paged", randomizeQuestions: false,
    randomizeOptions: false, allowUnanswered: true, showResultImmediately: false, resultVisibility: "pending",
    showCorrectAnswers: false, attemptLimit: 1, passingPercentage: 50,
  },
  questions: [],
  teacherName: "مریم رضایی",
  accent: "indigo",
  createdAt: "2026-09-01T05:30:00Z",
  updatedAt: "2026-09-02T05:30:00Z",
} as Exam;

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.bank.mockResolvedValue([]);
  api.bankTags.mockResolvedValue([]);
  api.createQuestion.mockResolvedValue({ id: "q-new" });
  hook.exams = [exam];
  hook.hydrate.mockReset();
  toast.mockReset();
});

async function openComposer() {
  render(<QuestionBankWorkspace/>);
  fireEvent.click(await screen.findByRole("button", { name: /سؤال تازه در بانک/ }));
}

async function fillACompleteQuestion() {
  fireEvent.change(screen.getByRole("textbox", { name: /متن سؤال/ }), { target: { value: "کدام یک واحد نیرو است؟" } });
  const options = screen.getAllByRole("textbox", { name: /متن گزینه/ });
  fireEvent.change(options[0]!, { target: { value: "نیوتن" } });
  fireEvent.change(options[1]!, { target: { value: "ژول" } });
  fireEvent.click(screen.getByRole("radio", { name: /علامت‌گذاری گزینه ۱/ }));
}

describe("question bank composer", () => {
  it("opens the full question form without leaving the bank", async () => {
    await openComposer();
    expect(await screen.findByText("آزمون مقصد")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /متن سؤال/ })).toBeTruthy();
    expect(screen.getByText(/اگر همین سؤال با همین گزینه‌ها/)).toBeTruthy();
  });

  it("refuses an incomplete question before it reaches the API", async () => {
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: /افزودن به بانک/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "سؤال هنوز کامل نیست" })));
    expect(api.createQuestion).not.toHaveBeenCalled();
  });

  it("writes the question into the chosen exam through the same payload the builder uses", async () => {
    await openComposer();
    await fillACompleteQuestion();
    fireEvent.click(screen.getByRole("button", { name: /افزودن به بانک/ }));

    await waitFor(() => expect(api.createQuestion).toHaveBeenCalledTimes(1));
    const [examId, payload] = api.createQuestion.mock.calls[0] as [string, Record<string, unknown>];
    expect(examId).toBe("exam-draft");
    expect(payload).toMatchObject({
      type: "multiple_choice",
      text: "کدام یک واحد نیرو است؟",
      marks: 1,
      options: [
        { text: "نیوتن", is_correct: true },
        { text: "ژول", is_correct: false },
      ],
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "سؤال به بانک افزوده شد" }));
  });

  it("keeps the list in step by reloading the bank after a write", async () => {
    await openComposer();
    await fillACompleteQuestion();
    fireEvent.click(screen.getByRole("button", { name: /افزودن به بانک/ }));
    await waitFor(() => expect(api.createQuestion).toHaveBeenCalled());
    await waitFor(() => expect(api.bank).toHaveBeenCalledTimes(2));
    expect(hook.hydrate).toHaveBeenCalled();
  });

  it("says when the copy was not made because the exam already holds it", async () => {
    api.createQuestion.mockResolvedValue({ id: "q-existing", deduplicated: true });
    await openComposer();
    await fillACompleteQuestion();
    fireEvent.click(screen.getByRole("button", { name: /افزودن به بانک/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "این سؤال عیناً در همان آزمون بود" })));
    expect((toast.mock.calls.at(-1)?.[0] as { description?: string }).description).toContain("نسخهٔ دوم ساخته نشد");
  });

  it("stays open for the next question when the teacher asks for it", async () => {
    await openComposer();
    await fillACompleteQuestion();
    fireEvent.click(screen.getByRole("button", { name: /افزودن و ادامه دادن/ }));
    // The form is cleared only after the bank list and the exam cache have been refreshed, so the assertion
    // waits for the state the teacher would actually see next, not for the request.
    await waitFor(() => expect((screen.getByRole("textbox", { name: /متن سؤال/ }) as HTMLTextAreaElement).value).toBe(""));
    expect(screen.getByRole("button", { name: /افزودن به بانک/ })).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("آزمون آینده");
  });
});

describe("a bank opened from an exam", () => {
  it("stays pointed at the exam the teacher came from", async () => {
    hook.exams = [exam, { ...exam, id: "exam-other", title: "آزمون دیگر" } as Exam];
    render(<QuestionBankWorkspace initialExamId="exam-draft"/>);

    expect(await screen.findByRole("button", { name: /نمایش همهٔ سؤال‌ها/ })).toBeTruthy();
    // The list load is debounced, so the assertion waits for the request rather than for the chip.
    await waitFor(() => expect(api.bank).toHaveBeenCalledWith(expect.objectContaining({ exam: "exam-draft" })));

    // The composer's destination is already that exam, so nothing has to be picked twice.
    fireEvent.click(screen.getByRole("button", { name: /سؤال تازه در بانک/ }));
    const dialog = screen.getByRole("dialog", { name: /سؤال تازه در بانک/ });
    // The composer itself also holds a "نوع سؤال" select, so the destination is picked by name.
    expect((within(dialog).getByRole("combobox", { name: /آزمون مقصد/ }) as HTMLSelectElement).value).toBe("exam-draft");
    expect(within(dialog).getByRole("combobox", { name: /آزمون مقصد/ }).textContent).toContain("آزمون آینده");
  });
});

describe("question bank insertion", () => {
  it("names the duplicates it refused to copy a second time", async () => {
    api.bank.mockResolvedValue([{
      id: "q-1", exam: exam.id, type: "multiple_choice", text: "سؤال تکراری", instructions: "", marks: "1.00", order: 1,
      options: [{ id: "o-1", text: "a", order: 1, is_correct: true }],
    }]);
    api.importQuestions.mockResolvedValue({ created: [], skippedDuplicates: 1 });
    render(<QuestionBankWorkspace/>);

    const checkbox = await screen.findByRole("checkbox", { name: /انتخاب سؤال/ });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /افزودن ۱ سؤال به آزمون/ }));
    fireEvent.click(await screen.findByRole("button", { name: /افزودن کپی‌ها/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "۰ سؤال افزوده شد و ۱ مورد تکراری رد شد",
    })));
    expect((toast.mock.calls.at(-1)?.[0] as { description?: string }).description).toContain("دوباره کپی نشد");
  });
});
