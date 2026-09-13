import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiGradingBoardDto, ApiGradingQuestionPageDto, ApiTeacherAttemptDetailDto, ApiTeacherResultRowDto } from "@/lib/api/dtos";
import { ExamMarkingWorkspace } from "@/components/teacher/exam-marking-workspace";

const replace = vi.fn();
const gradingBoard = vi.fn();
const teacherExamRows = vi.fn();
const teacherAttempt = vi.fn();
const gradingQuestion = vi.fn();
const saveQuestionGrades = vi.fn();
const gradeAnswer = vi.fn();
const autoMarks = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/api/results", () => ({
  resultsApi: {
    gradingBoard: (...args: unknown[]) => gradingBoard(...args),
    teacherExamRows: (...args: unknown[]) => teacherExamRows(...args),
    teacherAttempt: (...args: unknown[]) => teacherAttempt(...args),
    gradingQuestion: (...args: unknown[]) => gradingQuestion(...args),
    saveQuestionGrades: (...args: unknown[]) => saveQuestionGrades(...args),
    gradeAnswer: (...args: unknown[]) => gradeAnswer(...args),
    updateFeedback: vi.fn().mockResolvedValue({}),
    autoMarks: (...args: unknown[]) => autoMarks(...args),
    exportCsv: vi.fn().mockResolvedValue("دانش‌آموز,نمره\n"),
  },
}));

const board: ApiGradingBoardDto = {
  exam: { id: "exam-1", title: "آزمون فیزیک", total_marks: "6" },
  attempt_count: 2,
  questions: [
    { id: "q-keyed", order: 1, text: "کدام‌یک واحد توان است؟", type: "multiple_choice", marks: "2", requires_manual_grading: false, attempt_count: 2, answered_count: 2, blank_count: 0, correct_count: 1, incorrect_count: 1, graded_count: 0, pending_count: 0, average_score: 1, is_complete: true },
    { id: "q-written", order: 2, text: "توان را تعریف کنید و واحدش را بنویسید.", type: "short_answer", marks: "4", requires_manual_grading: true, attempt_count: 2, answered_count: 2, blank_count: 0, correct_count: 0, incorrect_count: 0, graded_count: 0, pending_count: 2, average_score: null, is_complete: false },
  ],
  progress: { total: 4, graded: 2, percent: 50 },
};

const resultRows: ApiTeacherResultRowDto[] = [
  { id: "attempt-1", student_id: "s1", student_name: "سارا محمدی", student_email: "sara@example.ir", grade: "۱۲", class_name: "۱۲-ب", status: "submitted", submission_status: "needs_grading", started_at: null, submitted_at: "2026-04-02T06:00:00Z", last_activity_at: "2026-04-02T06:00:00Z", score: null, percentage: null, maximum_score: "6", pending_manual_grading_count: 2, manual_grading_count: 2, completion_minutes: 21, attempt_number: 1, result_status: null },
  { id: "attempt-2", student_id: "s2", student_name: "نیما اکبری", student_email: "nima@example.ir", grade: "۱۲", class_name: "۱۲-ب", status: "submitted", submission_status: "submitted", started_at: null, submitted_at: "2026-04-02T06:04:00Z", last_activity_at: "2026-04-02T06:04:00Z", score: "5", percentage: "83.33", maximum_score: "6", pending_manual_grading_count: 0, manual_grading_count: 2, completion_minutes: 25, attempt_number: 1, result_status: "published" },
];

/** One sheet, both kinds of question: the keyed one carries a mark but no pen. */
const sheet: ApiTeacherAttemptDetailDto = {
  id: "attempt-1",
  exam: { id: "exam-1", title: "آزمون فیزیک", total_marks: "6" },
  student: { id: "s1", full_name: "سارا محمدی", email: "sara@example.ir", grade: "۱۲", class_name: "۱۲-ب" },
  status: "submitted", started_at: null, submitted_at: "2026-04-02T06:00:00Z", attempt_number: 1,
  server_time: "2026-04-02T06:05:00Z", remaining_seconds: null, session_switch_count: 0,
  session_signals: [{ id: "sig-1", kind: "tab_hidden", created_at: "2026-04-02T05:41:00Z", detail: {} }],
  answers: [
    { id: "a1", question_id: "q-keyed", question_text: "کدام‌یک واحد توان است؟", question_type: "multiple_choice", question_order: 1, maximum_score: "2", selected_option_ids: ["o2"], selected_option_texts: ["وات"], text: null, manual_grading_required: false, is_flagged: false, manual_score: null, feedback: "", updated_at: "2026-04-02T05:50:00Z", awarded_score: "2", verdict: "correct" },
    { id: "a2", question_id: "q-written", question_text: "توان را تعریف کنید و واحدش را بنویسید.", question_type: "short_answer", question_order: 2, maximum_score: "4", selected_option_ids: [], selected_option_texts: [], text: "نرخ انجام کار.", manual_grading_required: true, is_flagged: true, manual_score: null, feedback: "", updated_at: "2026-04-02T05:58:00Z", awarded_score: "0", verdict: "pending" },
  ],
  result: { id: "r1", attempt: "attempt-1", student_name: "سارا محمدی", exam_title: "آزمون فیزیک", status: "pending", score: null, percentage: null, correct_count: 1, incorrect_count: 0, unanswered_count: 0, pending_manual_grading_count: 2, manual_grading_count: 2, feedback: "کوتاه نوشتی.", computed_at: null, published_at: null, revised_at: null },
};

const writtenPage: ApiGradingQuestionPageDto = {
  exam: { id: "exam-1", title: "آزمون فیزیک", total_marks: "6" },
  question: { id: "q-written", order: 2, text: "توان را تعریف کنید و واحدش را بنویسید.", type: "short_answer", marks: "4", instructions: "کامل بنویسید.", requires_manual_grading: true, correct_option_ids: [], expected_answers: ["نرخ انجام کار", "وات"], explanation: "", difficulty: "medium", grading_notes: "اگر واحد نیامده یک نمره کم کنید." },
  progress: { index: 2, total: 2, questions: board.questions },
  stats: board.questions[1]!,
  rows: [
    { attempt_id: "attempt-1", attempt_number: 1, student_id: "s1", student_name: "سارا محمدی", grade: "۱۲", class_name: "۱۲-ب", submitted_at: "2026-04-02T06:00:00Z", answer_id: "a2", selected_option_ids: [], selected_option_texts: [], text: "نرخ انجام کار.", is_flagged: true, awarded_score: "0", verdict: "pending", manual_score: null, feedback: "", editable: true },
    { attempt_id: "attempt-2", attempt_number: 1, student_id: "s2", student_name: "نیما اکبری", grade: "۱۲", class_name: "۱۲-ب", submitted_at: "2026-04-02T06:04:00Z", answer_id: "a4", selected_option_ids: [], selected_option_texts: [], text: "انرژی مصرفی در واحد زمان؛ واحدش وات است.", is_flagged: false, awarded_score: "0", verdict: "pending", manual_score: null, feedback: "", editable: true },
  ],
};

/** The keyed question's cohort page: readable, never editable. */
const keyedPage: ApiGradingQuestionPageDto = {
  ...writtenPage,
  question: { ...writtenPage.question, id: "q-keyed", order: 1, text: "کدام‌یک واحد توان است؟", type: "multiple_choice", marks: "2", requires_manual_grading: false, correct_option_ids: ["o2"], expected_answers: [], grading_notes: "" },
  progress: { index: 1, total: 2, questions: board.questions },
  stats: board.questions[0]!,
  rows: [
    { ...writtenPage.rows[0]!, answer_id: "a1", text: null, selected_option_ids: ["o2"], selected_option_texts: ["وات"], verdict: "correct", awarded_score: "2", is_flagged: false, editable: false },
    { ...writtenPage.rows[1]!, answer_id: "a3", text: null, selected_option_ids: ["o1"], selected_option_texts: ["ژول"], verdict: "incorrect", awarded_score: "0", editable: false },
  ],
};

beforeEach(() => {
  replace.mockReset();
  gradingBoard.mockReset().mockResolvedValue(board);
  teacherExamRows.mockReset().mockResolvedValue(resultRows);
  teacherAttempt.mockReset().mockResolvedValue(sheet);
  gradingQuestion.mockReset().mockResolvedValue(writtenPage);
  saveQuestionGrades.mockReset().mockResolvedValue({ saved: 2, results: [], questions: board.questions, progress: { total: 4, graded: 4, percent: 100 }, rows: writtenPage.rows.map((row) => ({ ...row, manual_score: "3", verdict: "manual" })) });
  gradeAnswer.mockReset().mockResolvedValue({});
  autoMarks.mockReset().mockResolvedValue({ confirmed: 2, zeroed: 1, left_for_a_human: 1, attempts: 2, results: 2, progress: { total: 4, graded: 4, percent: 100 }, questions: [] });
});

async function openDesk(mode: "sheet" | "question" = "sheet") {
  render(<ExamMarkingWorkspace examId="exam-1" initialMode={mode}/>);
  // Each mode has its own rail, and nothing else renders until the board and the cohort arrive.
  await screen.findByText(mode === "sheet" ? "دانش‌آموزان" : "سؤال‌ها");
  if (mode === "question") {
    await waitFor(() => expect(gradingQuestion).toHaveBeenCalledWith("exam-1", "q-written"));
    // The stem appears twice on this screen — once in the rail, once as the question being marked.
    await screen.findAllByText("توان را تعریف کنید و واحدش را بنویسید.");
  }
}

describe("ExamMarkingWorkspace", () => {
  it("shows the whole sheet, with the keyed question carrying its awarded mark", async () => {
    await openDesk();
    // The student rail defaults to the sheet still waiting for a pen, and the desk loads it.
    expect(teacherExamRows).toHaveBeenCalledWith("exam-1", "submitted");
    const keyed = (await screen.findByText("کدام‌یک واحد توان است؟")).closest("[data-answer-id]") as HTMLElement;
    expect(teacherAttempt).toHaveBeenCalledWith("attempt-1");
    expect(keyed.getAttribute("data-answer-id")).toBe("q-keyed");
    expect(within(keyed).getByText("درست")).toBeTruthy();
    expect(within(keyed).getByText("خودکار · ۲ از ۲ نمره")).toBeTruthy();
    // The keyed row is scored, not sealed: the pen is here too, so a wrong key can be corrected in place.
    expect(within(keyed).getByLabelText("نمرهٔ شما")).toBeTruthy();
    // The box opens with the number the key awarded — readable, editable, and not a decision yet. The id is
    // the desk's own handle: it is what "jump to the next mark" focuses.
    // The pen is present and writable on a keyed row; what the box is seeded with is pinned in
    // "the desk's bulk actions" below, where the sheet is read after the desk has settled.
    const markBox = keyed.querySelector("#mark-q-keyed") as HTMLInputElement;
    expect(markBox.disabled).toBe(false);
    expect(markBox.readOnly).toBe(false);
    expect(within(keyed).getByText(/این عدد را کلید داده است/)).toBeTruthy();

    const written = (await screen.findByText("توان را تعریف کنید و واحدش را بنویسید.")).closest("[data-answer-id]") as HTMLElement;
    expect(within(written).getByText("نیازمند نمرهٔ شما")).toBeTruthy();
    expect(within(written).getByText("نشان‌دار برای مرور")).toBeTruthy();
    expect(screen.getAllByLabelText("نمرهٔ شما")).toHaveLength(2);
    expect(within(written).getByText("نرخ انجام کار.")).toBeTruthy();
  });

  it("overrides an auto-graded answer and hands it back to the key", async () => {
    await openDesk();
    const keyed = (await screen.findByText("کدام‌یک واحد توان است؟")).closest("[data-answer-id]") as HTMLElement;
    fireEvent.change(within(keyed).getByLabelText("نمرهٔ شما"), { target: { value: "1" } });
    fireEvent.change(within(keyed).getByLabelText("بازخورد این سؤال"), { target: { value: "گزینهٔ درست ناقص بود." } });
    fireEvent.click(within(keyed).getByRole("button", { name: "ذخیرهٔ نمره" }));
    await waitFor(() =>
      expect(gradeAnswer).toHaveBeenCalledWith("attempt-1", "q-keyed", { manual_score: 1, feedback: "گزینهٔ درست ناقص بود." }),
    );
  });

  it("writes a note on a keyed answer without touching its mark", async () => {
    await openDesk();
    const keyed = (await screen.findByText("کدام‌یک واحد توان است؟")).closest("[data-answer-id]") as HTMLElement;
    // The box is empty, so the primary button is a note save, and the server is told nothing about marks.
    expect(within(keyed).getByRole("button", { name: "ذخیرهٔ نکته" })).toBeTruthy();
    fireEvent.change(within(keyed).getByLabelText("بازخورد این سؤال"), { target: { value: "دقت کردی." } });
    fireEvent.click(within(keyed).getByRole("button", { name: "ذخیرهٔ نکته" }));
    await waitFor(() => expect(gradeAnswer).toHaveBeenCalledWith("attempt-1", "q-keyed", { feedback: "دقت کردی." }));
  });

  it("offers the undo only on a row the teacher has actually overridden", async () => {
    gradeAnswer.mockResolvedValue({
      answer: { ...sheet.answers[0]!, awarded_score: "1.00", auto_awarded_score: "2.00", is_overridden: true, manual_score: "1.00" },
      result: sheet.result,
    });
    teacherAttempt.mockResolvedValue({
      ...sheet,
      answers: [{ ...sheet.answers[0]!, awarded_score: "1.00", auto_awarded_score: "2.00", is_overridden: true, manual_score: "1.00" }, sheet.answers[1]!],
    });
    await openDesk();
    const keyed = (await screen.findByText("کدام‌یک واحد توان است؟")).closest("[data-answer-id]") as HTMLElement;
    expect(within(keyed).getByText("نمرهٔ معلم · ۱ از ۲ نمره · کلید ۲")).toBeTruthy();
    // The row is seeded with the teacher's number, and undoing it is one click that sends `manual_score: null`.
    // A number input normalises "1.00"; either spelling proves the row is seeded from the teacher's mark.
    expect((within(keyed).getByLabelText("نمرهٔ شما") as HTMLInputElement).value).toMatch(/^1(\.00)?$/);
    fireEvent.click(within(keyed).getByRole("button", { name: "بازگشت به نمرهٔ خودکار" }));
    await waitFor(() => expect(gradeAnswer).toHaveBeenCalledWith("attempt-1", "q-keyed", { manual_score: null, feedback: "" }));
  });

  it("grades the sheet one answer at a time, then reloads it", async () => {
    await openDesk();
    const written = (await screen.findByText("توان را تعریف کنید و واحدش را بنویسید.")).closest("[data-answer-id]") as HTMLElement;
    fireEvent.change(within(written).getByLabelText("نمرهٔ شما"), { target: { value: "3.5" } });
    fireEvent.click(within(written).getByRole("button", { name: "ذخیرهٔ نمره" }));
    await waitFor(() => expect(gradeAnswer).toHaveBeenCalledWith("attempt-1", "q-written", { manual_score: 3.5, feedback: "" }));
    await waitFor(() => expect(gradingBoard).toHaveBeenCalledTimes(2));
  });

  it("refuses a mark above the question's own weight before it reaches the server", async () => {
    await openDesk();
    const written = (await screen.findByText("توان را تعریف کنید و واحدش را بنویسید.")).closest("[data-answer-id]") as HTMLElement;
    fireEvent.change(within(written).getByLabelText("نمرهٔ شما"), { target: { value: "9" } });
    fireEvent.click(within(written).getByRole("button", { name: "ذخیرهٔ نمره" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gradeAnswer).not.toHaveBeenCalled();
  });

  it("marks the whole cohort on one screen and saves it as a single batch", async () => {
    await openDesk("question");
    // The rubric is on the screen while the marks are being given.
    expect(screen.getByText(/اگر واحد نیامده یک نمره کم کنید/)).toBeTruthy();
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0]!, { target: { value: "3" } });
    fireEvent.change(inputs[1]!, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /ذخیرهٔ نمره‌ها/ }));
    await waitFor(() => expect(saveQuestionGrades).toHaveBeenCalledTimes(1));
    const body = saveQuestionGrades.mock.calls[0]![2];
    expect(body.map((row: { attempt_id: string; mark: string }) => [row.attempt_id, row.mark])).toEqual([["attempt-1", "3"], ["attempt-2", "4"]]);
  });

  it("opens a keyed question for the pen in the cohort view as well", async () => {
    gradingQuestion.mockImplementation(async (_exam: string, questionId: string) => (questionId === "q-keyed" ? keyedPage : writtenPage));
    await openDesk("question");
    fireEvent.click(screen.getByRole("button", { name: /کدام‌یک واحد توان است؟/ }));
    await waitFor(() => expect(gradingQuestion).toHaveBeenCalledWith("exam-1", "q-keyed"));
    expect(await screen.findAllByText("وات")).toBeTruthy();
    // One box per student, all of them empty: the key's number is shown, not repeated as a draft mark.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
    expect(screen.getAllByRole("spinbutton").map((input) => (input as HTMLInputElement).value)).toEqual(["", ""]);
    // The verdict of each row is still stated, so the teacher sees what they are changing.
    expect(screen.getByText("درست")).toBeTruthy();
    expect(screen.getByText("نادرست")).toBeTruthy();
    // The zero-fill wand is a written-question tool: on a keyed screen it would silently erase the class.
    expect(screen.queryByRole("button", { name: /پُر کردن ۰/ })).toBeNull();

    // A note alone is a legitimate change on a keyed row, and it must not send a mark for the other one.
    fireEvent.change(screen.getByLabelText("نکتهٔ سارا محمدی"), { target: { value: "کلید را اصلاح کردم." } });
    fireEvent.click(screen.getByRole("button", { name: /ذخیرهٔ نمره‌ها/ }));
    await waitFor(() => expect(saveQuestionGrades).toHaveBeenCalledTimes(1));
    const body = saveQuestionGrades.mock.calls[0]![2];
    expect(body).toEqual([{ attempt_id: "attempt-1", feedback: "کلید را اصلاح کردم." }]);
  });

  it("fills the empty boxes with zero without saving them", async () => {
    await openDesk("question");
    fireEvent.click(screen.getByRole("button", { name: /پُر کردن ۰ در خانه‌های خالی/ }));
    expect(screen.getAllByRole("spinbutton").map((input) => (input as HTMLInputElement).value)).toEqual(["0", "0"]);
    expect(saveQuestionGrades).not.toHaveBeenCalled();
    expect(screen.getByText(/۲ نمرهٔ آمادهٔ ذخیره/)).toBeTruthy();
  });

  it("keeps the address in step with the desk so the screen can be reloaded", async () => {
    await openDesk();
    // Wait for the desk to have picked its own defaults; the URL is written from them.
    await screen.findByText("خودکار · ۲ از ۲ نمره");
    fireEvent.click(screen.getByRole("button", { name: "سؤال‌به‌سؤال" }));
    expect(replace).toHaveBeenCalledWith("/teacher/exams/exam-1/marking?mode=question&question=q-written", { scroll: false });
  });
});
describe("what the marking sheet says about monitoring", () => {
  /** The rules and the counts have to be read together, on the teacher's own screen. */
  it("names the policy beside what it counted", async () => {
    teacherAttempt.mockResolvedValue({
      ...sheet,
      integrity: {
        policy: "enforce", records: true, enforced: true, block_copy_paste: true, require_fullscreen: false,
        lock_to_one_device: true, max_tab_switches: 3, tab_switches: 2, tab_switches_remaining: 1, copy_events: 4,
      },
      session_signals: [
        ...sheet.session_signals,
        { id: "sig-2", kind: "paste", created_at: "2026-04-02T05:42:00Z", detail: { field: "textarea", length: 120 } },
      ],
    });
    await openDesk("sheet");

    const panel = await screen.findByText(/^مراقبت از تقلب:/);
    expect(panel.parentElement?.textContent).toContain("ثبت و محدودیت");
    expect(document.body.textContent).toContain("۲ بار بیرون‌رفتن از تب از ۳");
    expect(document.body.textContent).toContain("۴ کپی یا چسباندن");
    // The timeline reads as sentences, not as an API's snake_case.
    expect(await screen.findByText("متنی به پاسخ چسبانده شد")).toBeTruthy();
  });

  it("says plainly when nothing was being watched", async () => {
    teacherAttempt.mockResolvedValue({
      ...sheet,
      integrity: {
        policy: "off", records: false, enforced: false, block_copy_paste: false, require_fullscreen: false,
        lock_to_one_device: false, max_tab_switches: 0, tab_switches: 0, tab_switches_remaining: null, copy_events: 0,
      },
    });
    await openDesk("sheet");
    expect(await screen.findByText(/^مراقبت از تقلب:/));
    expect(document.body.textContent).toContain("خاموش است");
    expect(document.body.textContent).toContain("۰ بار بیرون‌رفتن از تب");
  });
});

describe("the desk's bulk actions", () => {
  /** The box opens with the number the exam already awarded, so a mark is edited rather than invented. */
  it("seeds a keyed row with the mark the key awarded", async () => {
    await openDesk("sheet");
    const keyed = (await screen.findByText("کدام‌یک واحد توان است؟")).closest("[data-answer-id]") as HTMLElement;
    // `mark-{question_id}` is the id the "jump to the next mark" control focuses, so it is the honest handle.
    const mark = keyed.querySelector("#mark-q-keyed") as HTMLInputElement;
    expect(mark.value).toBe("2");
    expect(mark.disabled).toBe(false);
    expect(mark.readOnly).toBe(false);
    // A keyed row the teacher has not touched is not a change, so no save-all is offered.
    expect(screen.queryByRole("button", { name: /ذخیرهٔ ۱ تغییر/ })).toBeNull();
  });

  it("applies the exam's own verdicts in one action and reloads the desk", async () => {
    await openDesk("sheet");
    fireEvent.click(await screen.findByRole("button", { name: /اعمال نمره‌های خودکار/ }));
    await waitFor(() => expect(autoMarks).toHaveBeenCalledWith("exam-1", { confirm_key: true, zero_unanswered: true }));
    await waitFor(() => expect(gradingBoard).toHaveBeenCalledTimes(2));
    // The panel the teacher is standing on has to re-read what the batch wrote, not only the rail beside it.
    await waitFor(() => expect(teacherAttempt).toHaveBeenCalledTimes(2));
  });

  it("counts only the rows the teacher actually changed, and saves exactly those", async () => {
    await openDesk("sheet");
    const keyed = (await screen.findByText("کدام‌یک واحد توان است؟")).closest("[data-answer-id]") as HTMLElement;
    expect(screen.queryByRole("button", { name: /ذخیرهٔ \d+ تغییر/ })).toBeNull();
    fireEvent.change(within(keyed).getByLabelText("نمرهٔ شما"), { target: { value: "1" } });
    const save = await screen.findByRole("button", { name: /ذخیرهٔ ۱ تغییر/ });
    fireEvent.click(save);
    await waitFor(() => expect(gradeAnswer).toHaveBeenCalledWith("attempt-1", "q-keyed", { manual_score: 1, feedback: "" }));
  });
});
