import { describe, expect, it } from "vitest";
import { parseQuestionText } from "@/lib/exam/question-text-import";

describe("parseQuestionText", () => {
  it("imports single-choice, multiple-answer, short-answer, and essay prompts", () => {
    const result = parseQuestionText(`سؤال: پایتخت آذربایجان کدام است؟
الف) باکو
ب) گنجه
ج) شکی
پاسخ: الف
نمره: ۲
---
سؤال: کدام‌ها عدد اول‌اند؟
الف) ۲
ب) ۴
ج) ۵
پاسخ: الف، ج
نمره: ۳
---
سؤال: پایتخت ایران چیست؟
پاسخ: تهران، طهران
---
سؤال: فتوسنتز را توضیح دهید.
راهنما: به نقش نور اشاره کنید.
نمره: ۴`);

    expect(result.questions).toHaveLength(4);
    expect(result.questions[0]).toMatchObject({ type: "single_choice", stem: "پایتخت آذربایجان کدام است؟", points: 2 });
    expect(result.questions[0].type === "single_choice" && result.questions[0].options.find((option) => option.isCorrect)?.label).toBe("باکو");
    expect(result.questions[1]).toMatchObject({ type: "multiple_choice", points: 3 });
    expect(result.questions[2]).toMatchObject({ type: "short_answer", expectedAnswers: ["تهران", "طهران"] });
    expect(result.questions[3]).toMatchObject({ type: "essay", helpText: "به نقش نور اشاره کنید.", points: 4 });
    expect(result.warnings).toEqual([]);
  });

  it("normalizes Persian numerals, keeps unanswered choices incomplete, and reports a missing key", () => {
    const result = parseQuestionText(`۱. یک سؤال نمونه؟
الف) گزینهٔ الف
ب) گزینهٔ ب
نمره: ۲٫۵`);

    expect(result.questions[0]).toMatchObject({ order: 1, type: "single_choice", points: 2.5, correctOptionId: "" });
    expect(result.warnings).toContain("سؤال 1: کلید پاسخ وارد نشده؛ پیش از انتشار آن را علامت بزنید.");
  });

  it("does not invent a correct option when the supplied key does not match", () => {
    const result = parseQuestionText(`سؤال: نمونه؟
الف) یک
ب) دو
پاسخ: ج`);

    expect(result.questions[0]?.type === "single_choice" && result.questions[0].correctOptionId).toBe("");
    expect(result.warnings[0]).toContain("پاسخ «ج» با برچسب یا متن گزینه‌ای جور درنیامد");
  });
});
