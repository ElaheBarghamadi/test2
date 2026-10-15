import { describe, expect, it } from "vitest";
import { createPrintableExamHtml } from "@/lib/exam/printable-paper";
import type { ApiExamBundleDto } from "@/lib/api/dtos";

const bundle = {
  kind: "examora.exam",
  exported_at: "2026-10-14T10:00:00Z",
  exam: {
    id: "exam-1", title: "آزمون علوم", subject: "علوم", grade: "پایه ششم", class_name: "الف",
    teacher: "teacher-1", teacher_name: "دبیر علوم", status: "draft", duration_minutes: 45,
    total_marks: 4, start_at: null, end_at: null,
    settings: {}, question_count: 2, attempt_count: 0, participant_count: 0,
    created_at: "2026-10-14T10:00:00Z", updated_at: "2026-10-14T10:00:00Z",
    description: "", instructions: "پاسخ‌ها را با دقت بخوانید.", questions: [],
  },
  questions: [
    {
      id: "q-1", exam: "exam-1", type: "multiple_choice", text: "۲ + ۲ چند می‌شود؟", instructions: "یک گزینه را انتخاب کنید.",
      marks: 2, order: 1,
      options: [
        { id: "o-1", text: "۳", order: 1, is_correct: false },
        { id: "o-2", text: "۴", order: 2, is_correct: true },
      ],
    },
    {
      id: "q-2", exam: "exam-1", type: "short_answer", text: "پایتخت ایران؟", instructions: "", marks: 2, order: 2,
      options: [], configuration: { expected_answers: ["تهران", "طهران"] },
    },
  ],
} as unknown as ApiExamBundleDto;

describe("createPrintableExamHtml", () => {
  it("builds a Persian student handout without exposing correct answers", () => {
    const html = createPrintableExamHtml(bundle);

    expect(html).toContain("برگهٔ دانش‌آموز");
    expect(html).toContain("۲ + ۲ چند می‌شود؟");
    expect(html).toContain("نام و نام خانوادگی:");
    expect(html).toContain("پاسخ‌ها را با دقت بخوانید.");
    expect(html).not.toContain("کلید پاسخ دبیر");
    expect(html).not.toContain("تهران");
    expect(html).not.toContain('<section class="answer-key">');
  });

  it("places an optional answer key on a separate page", () => {
    const html = createPrintableExamHtml(bundle, true);

    expect(html).toContain("page-break-before: always");
    expect(html).toContain("کلید پاسخ دبیر");
    expect(html).toContain("این بخش را پیش از توزیع نسخهٔ دانش‌آموز جدا کنید.");
    expect(html).toContain("تهران، طهران");
    expect(html).toContain("پاسخ:</strong> ۴");
  });

  it("escapes question content before inserting it into the standalone document", () => {
    const hostile = structuredClone(bundle);
    hostile.questions[0].text = '<script>alert("x")</script>';
    const html = createPrintableExamHtml(hostile);

    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });
});
