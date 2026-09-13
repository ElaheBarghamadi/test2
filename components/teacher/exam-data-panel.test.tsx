import { beforeEach, describe, expect, it, vi } from "vitest";
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
  api.exportExam.mockResolvedValue({ kind: "examora.exam.v1", exported_at: "2026-09-13T09:00:00Z", exam: { id: "exam-1" }, questions: [{ id: "q1" }, { id: "q2" }] });
  api.exportCsv.mockResolvedValue("دانش‌آموز,نمره\nسارا,2.00\n");
  api.importExam.mockResolvedValue({ id: "exam-new", imported: { questions: 2, settings_imported: true } });
});

describe("the export", () => {
  it("hands the teacher a file of the paper, and says what is in it", async () => {
    render(<ExamDataPanel examId="exam-1" examTitle="آزمون فیزیک" questionCount={12}/>);
    fireEvent.click(await screen.findByRole("button", { name: /دانلود فایل آزمون/ }));
    await waitFor(() => expect(downloads.file).toHaveBeenCalledWith("exam-2026-09-13.json", expect.stringContaining("examora.exam.v1")));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "فایل آزمون دانلود شد" }));
    expect((toast.mock.calls.at(-1)?.[0] as { description?: string }).description).toContain("پاسخ هیچ دانش‌آموزی");
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
