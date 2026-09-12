import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ApiError } from "@/lib/api/client";
import type { ApiStudentResultAnswerDto, ApiStudentResultDto } from "@/lib/api/dtos";
import { StudentResultWorkspace } from "./student-result-workspace";

const detail = vi.fn();
const result = vi.fn();
vi.mock("@/lib/api/attempts", () => ({ attemptsApi: { detail: (...args: unknown[]) => detail(...args), result: (...args: unknown[]) => result(...args) } }));

const attemptDto = {
  id: "at-1", attempt_number: 1, attempt_limit: 1, answer_revision: 1, status: "submitted",
  started_at: "2026-04-02T06:00:00Z", submitted_at: "2026-04-02T06:20:00Z", last_activity_at: "2026-04-02T06:20:00Z",
  server_time: "2026-04-02T06:21:00Z", expires_at: null, remaining_seconds: null,
    exam: {
      id: "ex-1",
      title: "آزمون فیزیک",
      description: "",
      subject: "",
      grade: "",
      class_name: "",
      instructions: "",
      duration_minutes: 45,
      total_marks: 2,
      result_visibility: "pending",
      passing_percentage: 0,
      // The student attempt serializer nests the conduct rules under `navigation` and never repeats the key.
      navigation: {
        allow_previous_questions: true,
        question_layout: "paged",
        randomize_questions: false,
        allow_unanswered: true,
      },
    },
  questions: [], answers: [],
};

function published(overrides: Partial<ApiStudentResultDto>) {
  return {
    id: "re-1", status: "published", score: "1.00", percentage: "50.00", maximum_score: 2, correct_count: 1, incorrect_count: 0,
    unanswered_count: 0, pending_manual_grading_count: 0, passing_percentage: 0, passed: null, attempt_number: 1,
    submitted_at: "2026-04-02T06:20:00Z", is_final: true, feedback: "", published_at: "2026-04-02T07:00:00Z", revised_at: null,
    manual_grading_count: 0, ...overrides,
  } as ApiStudentResultDto;
}

const row: ApiStudentResultAnswerDto = {
  question_id: "q1", question_order: 1, question_text: "کدام یکای توان است؟", question_type: "multiple_choice", marks: "2.00",
  your_answer: null, selected_option_texts: ["وات"],
};

beforeEach(() => {
  detail.mockReset().mockResolvedValue(attemptDto);
  result.mockReset().mockResolvedValue(published({ detail_level: "score_only", answers: [] }));
});

async function open() {
  render(<StudentResultWorkspace attemptId="at-1" />);
  await screen.findByText("آزمون فیزیک");
}

describe("StudentResultWorkspace", () => {
  it("shows only the number at the score-only rung", async () => {
    await open();
    // The score is split across the number and its unit by the design, so match the unit.
    expect(screen.getByText(/از ۲ نمره/)).toBeTruthy();
    expect(screen.getByText(/خلاصه پاسخ‌ها/)).toBeTruthy();
    // The smallest rung sends no rows at all, so the section is not rendered and not faked with placeholders.
    expect(screen.queryByText("پاسخ‌نامهٔ شما")).toBeNull();
  });

  it("shows the student their own sheet without any verdict at the second rung", async () => {
    result.mockResolvedValue(published({ detail_level: "own_answers", answers: [row] }));
    await open();
    expect(screen.getByText("پاسخ‌نامهٔ شما")).toBeTruthy();
    expect(screen.getByText(/کلید پاسخ برای این آزمون منتشر نشده است/)).toBeTruthy();
    const sheet = screen.getByText("پاسخ‌نامهٔ شما").closest("section") as HTMLElement;
    const answerRow = sheet.querySelector("[data-result-row]") as HTMLElement;
    expect(within(answerRow).getByText("کدام یکای توان است؟")).toBeTruthy();
    // Their own words are there, and nothing says whether they were right: the summary card above does that.
    expect(within(answerRow).getByText("وات")).toBeTruthy();
    expect(within(answerRow).queryByText("درست")).toBeNull();
    expect(within(answerRow).queryByText(/نمره$/)).toBeNull();
    expect(within(answerRow).queryByText(/پاسخ درست/)).toBeNull();
  });

  it("adds the teacher note at the note rung", async () => {
    result.mockResolvedValue(published({ detail_level: "own_answers_with_feedback", answers: [{ ...row, feedback: "کامل نوشتی." }] }));
    await open();
    const sheet = screen.getByText("پاسخ‌نامهٔ شما").closest("section") as HTMLElement;
    const answerRow = sheet.querySelector("[data-result-row]") as HTMLElement;
    expect(within(answerRow).getByText(/کامل نوشتی\./)).toBeTruthy();
    // A note is not a verdict: the key stays closed on this rung.
    expect(within(answerRow).queryByText(/پاسخ درست/)).toBeNull();
    expect(within(answerRow).queryByText(/درست|نادرست/)).toBeNull();
  });

  it("releases the marks, the key and the model answer only at the top rung", async () => {
    result.mockResolvedValue(
      published({
        detail_level: "full_key",
        answers: [{ ...row, feedback: "کامل نوشتی.", awarded_score: "2.00", verdict: "correct", correct_option_texts: ["وات"], expected_answers: [], explanation: "وات." }],
      }),
    );
    await open();
    const sheet = screen.getByText("پاسخ‌نامهٔ شما").closest("section") as HTMLElement;
    const answerRow = sheet.querySelector("[data-result-row]") as HTMLElement;
    expect(within(answerRow).getByText("درست")).toBeTruthy();
    expect(within(answerRow).getByText("۲ از ۲ نمره")).toBeTruthy();
    expect(within(answerRow).getByText(/پاسخ درست: وات/)).toBeTruthy();
    expect(within(answerRow).getByText(/پاسخ نمونه: وات/)).toBeTruthy();
    expect(within(answerRow).getByText(/نکتهٔ آموزگار/)).toBeTruthy();
  });

  it("stays neutral when the result is not published yet", async () => {
    result.mockRejectedValue(new ApiError(403, null, "not published"));
    await open();
    expect(screen.getByText("در انتظار انتشار نتیجه")).toBeTruthy();
  });
});
