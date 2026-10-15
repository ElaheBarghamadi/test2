import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The teacher's own data exits and entries: a file of the paper, a sheet of marks, and a file read back.
 *
 * The privacy line is the one worth pinning: the export the panel advertises as "no student answers" has to
 * be the endpoint that returns no student answers, and a file that is not a backup has to be refused before
 * anything is created.
 */
const api = vi.hoisted(() => ({ exportExam: vi.fn(), importExam: vi.fn(), exportCsv: vi.fn() }));
const downloads = vi.hoisted(() => ({ file: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/exams", () => ({ examsApi: api }));
vi.mock("@/lib/api/results", () => ({ resultsApi: { exportCsv: (...args: unknown[]) => api.exportCsv(...args) } }));
vi.mock("@/lib/utils/download", () => ({ downloadFile: (...args: unknown[]) => downloads.file(...args), stamp: () => "2026-09-13" }));
vi.mock("@/lib/state/toast-store", () => ({ useToastStore: (selector: (state: { push: typeof toast }) => unknown) => selector({ push: toast }) }));

import { ExamDataPanel } from "@/components/teacher/exam-data-panel";

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  downloads.file.mockReset();
  toast.mockReset();
  api.exportExam.mockResolvedValue({
    kind: "examora.exam.v1", exported_at: "2026-09-13T09:00:00Z",
    exam: {
      id: "exam-1", title: "آزمون فیزیک", subject: "فیزیک", grade: "دوازدهم", class_name: "تجربی ۱",
      teacher: "teacher-1", teacher_name: "دبیر فیزیک", status: "draft", duration_minutes: 40,
      total_marks: 4, start_at: null, end_at: null, settings: {}, question_count: 2, attempt_count: 0,
      participant_count: 0, created_at: "2026-09-13T09:00:00Z", updated_at: "2026-09-13T09:00:00Z",
      description: "", instructions: "پاسخ‌ها را با دقت بخوانید.", questions: [],
    },
    questions: [
      { id: "q1", exam: "exam-1", type: "multiple_choice", text: "جرم چیست؟", instructions: "یک گزینه را انتخاب کنید.", marks: 2, order: 1, options: [{ id: "o1", text: "مقدار ماده", order: 1, is_correct: true }, { id: "o2", text: "نیرو", order: 2, is_correct: false }] },
      { id: "q2", exam: "exam-1", type: "short_answer", text: "یکای نیرو؟", instructions: "", marks: 2, order: 2, options: [], configuration: { expected_answers: ["نیوتون"] } },
    ],
  });
  api.exportCsv.mockResolvedValue("دانش‌آموز,نمره\nسارا,2.00\n");
  api.importExam.mockResolvedValue({ id: "exam-new", imported: { questions: 2, settings_imported: true } });
});

afterEach(() => vi.restoreAllMocks());

describe("the export", () => {
  it("hands the teacher a file of the paper, and says what is in it", async () => {
    render(<ExamDataPanel examId="exam-1" examTitle="آزمون فیزیک" questionCount={12}/>);
    fireEvent.click(await screen.findByRole("button", { name: /دانلود فایل آزمون/ }));
    await waitFor(() => expect(downloads.file).toHaveBeenCalledWith("exam-2026-09-13.json", expect.stringContaining("examora.exam.v1")));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "فایل آزمون دانلود شد" }));
    expect((toast.mock.calls.at(-1)?.[0] as { description?: string }).description).toContain("پاسخ هیچ دانش‌آموزی");
  });

  it("opens a print-ready student paper without the separate answer-key pages", async () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, closed: false, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    render(<ExamDataPanel examId="exam-1" examTitle="آزمون فیزیک" questionCount={2}/>);

    fireEvent.click(screen.getByRole("button", { name: /چاپ \/ ذخیره/ }));
    fireEvent.click(screen.getByRole("button", { name: "آماده‌سازی برگه" }));
    await waitFor(() => expect(popupDocument.write).toHaveBeenCalledTimes(2));

    const html = popupDocument.write.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("برگهٔ دانش‌آموز");
    expect(html).toContain("جرم چیست؟");
    expect(html).toContain("نام و نام خانوادگی:");
    expect(html).not.toContain("کلید پاسخ دبیر");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "برگهٔ چاپ آماده است" }));
  });

  it("can include a teacher-only key on a separate printable page", async () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, closed: false, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    render(<ExamDataPanel examId="exam-1" examTitle="آزمون فیزیک" questionCount={2}/>);

    fireEvent.click(screen.getByRole("button", { name: /چاپ \/ ذخیره/ }));
    fireEvent.click(screen.getByRole("radio", { name: /نسخهٔ دبیر/ }));
    fireEvent.click(screen.getByRole("button", { name: "آماده‌سازی برگه" }));
    await waitFor(() => expect(popupDocument.write).toHaveBeenCalledTimes(2));

    const html = popupDocument.write.mock.calls.at(-1)?.[0] as string;
    expect(html).toContain("کلید پاسخ دبیر");
    expect(html).toContain("page-break-before: always");
    expect(html).toContain("نیوتون");
  });

  it("sends the marks as a csv the school can open", async () => {
    render(<ExamDataPanel examId="exam-1" examTitle="آزمون فیزیک" questionCount={12}/>);
    fireEvent.click(await screen.findByRole("button", { name: /دانلود جدول نمره‌ها/ }));
    await waitFor(() => expect(downloads.file).toHaveBeenCalledWith("results-2026-09-13.csv", expect.stringContaining("سارا"), "text/csv"));
  });
});

describe("the import", () => {
  it("posts the parsed file and reports the draft it made", async () => {
    render(<ExamDataPanel examId="exam-1" examTitle="آزمون فیزیک" questionCount={12}/>);
    const input = await screen.findByLabelText(/فایل آزمون برای بارگذاری/);
    const file = new File([JSON.stringify({ kind: "examora.exam.v1", exam: { title: "بازگشت" }, questions: [{ text: "سؤال" }] })], "exam.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.importExam).toHaveBeenCalledWith(expect.objectContaining({ kind: "examora.exam.v1" })));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "آزمون از فایل ساخته شد" }));
    expect((toast.mock.calls.at(-0)?.[0] as { description?: string }).description).toContain("پیش‌نویس");
  });

  it("refuses a file that is not json without asking the server", async () => {
    render(<ExamDataPanel examId="exam-1" examTitle="آزمون فیزیک" questionCount={12}/>);
    const input = await screen.findByLabelText(/فایل آزمون برای بارگذاری/);
    fireEvent.change(input, { target: { files: [new File(["not json at all"], "notes.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "فایل پذیرفته نشد" })));
    expect((toast.mock.calls.at(-1)?.[0] as { description?: string }).description).toContain("JSON");
    expect(api.importExam).not.toHaveBeenCalled();
  });
});
