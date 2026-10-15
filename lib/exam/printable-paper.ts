import type { ApiExamBundleDto, ApiQuestionDto } from "@/lib/api/dtos";
import { toPersianNumber } from "@/lib/utils";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textBlock(value: unknown): string {
  return escapeHtml(value).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}

function numeric(value: number | string | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function questionTypeLabel(type: ApiQuestionDto["type"]): string {
  switch (type) {
    case "multiple_choice": return "چندگزینه‌ای";
    case "multiple_answer": return "چندپاسخی";
    case "true_false": return "درست / نادرست";
    case "matching": return "وصل‌کردنی";
    case "short_answer": return "پاسخ کوتاه";
    case "written": return "تشریحی";
  }
}

function questionOptions(question: ApiQuestionDto): string {
  const options = [...(question.options ?? [])].sort((left, right) => left.order - right.order);
  if (!options.length) return "";
  const title = question.type === "matching" ? "<p class=\"matching-options-title\">گزینه‌های پاسخ</p>" : "";
  return `${title}<ol class="options">${options.map((option, index) => `<li><span class="option-number">${toPersianNumber(index + 1)}.</span><span>${textBlock(option.text)}</span></li>`).join("")}</ol>`;
}

function responseSpace(question: ApiQuestionDto): string {
  if (question.type === "multiple_choice" || question.type === "multiple_answer" || question.type === "true_false") return "";
  const marks = Math.max(1, numeric(question.marks, 1));
  const lineCount = question.type === "short_answer" ? 2 : Math.min(12, Math.max(5, Math.ceil(marks * 1.5)));
  return `<div class="response-space" aria-label="فضای پاسخ">${Array.from({ length: lineCount }, () => '<div class="response-line"></div>').join("")}</div>`;
}

function expectedAnswers(question: ApiQuestionDto): string[] {
  const values = question.configuration?.expected_answers;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
}

function matchingPairs(question: ApiQuestionDto): Array<{ prompt: string; answer: string }> {
  const values = question.configuration?.matching_pairs;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const pair = value as Record<string, unknown>;
    if (typeof pair.prompt !== "string") return [];
    return [{ prompt: pair.prompt, answer: typeof pair.answer === "string" ? pair.answer : "" }];
  });
}

function matchingPromptsHtml(question: ApiQuestionDto): string {
  const pairs = matchingPairs(question).filter((pair) => pair.prompt.trim());
  if (!pairs.length) return "";
  return `<div class="matching-prompts"><p>برای هر مورد، شمارهٔ گزینهٔ متناظر را بنویسید.</p><ol>${pairs.map((pair) => `<li><span>${textBlock(pair.prompt)}</span><span class="matching-answer-line">شمارهٔ گزینه: ______</span></li>`).join("")}</ol></div>`;
}

function answerText(question: ApiQuestionDto): string {
  if (question.type === "multiple_choice" || question.type === "multiple_answer" || question.type === "true_false") {
    const options = [...(question.options ?? [])].sort((left, right) => left.order - right.order);
    const correct = options.filter((option) => option.is_correct).map((option) => option.text.trim()).filter(Boolean);
    return correct.length ? correct.map(textBlock).join("، ") : "پاسخ صحیح برای این سؤال ثبت نشده است.";
  }
  if (question.type === "short_answer") {
    const answers = expectedAnswers(question);
    return answers.length ? answers.map(textBlock).join("، ") : "تصحیح دستی";
  }
  if (question.type === "matching") {
    const pairs = matchingPairs(question).filter((pair) => pair.answer.trim());
    return pairs.length ? pairs.map((pair) => `${textBlock(pair.prompt)} ← ${textBlock(pair.answer)}`).join("؛ ") : "کلید وصل‌کردنی ثبت نشده است.";
  }
  const gradingNote = question.configuration?.grading_note;
  return typeof gradingNote === "string" && gradingNote.trim() ? textBlock(gradingNote) : "پاسخ تشریحی؛ بر اساس معیارهای دبیر تصحیح شود.";
}

function questionHtml(question: ApiQuestionDto, index: number): string {
  const instructions = question.instructions.trim()
    ? `<p class="question-instructions">${textBlock(question.instructions)}</p>`
    : "";
  const matchingPrompts = question.type === "matching" ? matchingPromptsHtml(question) : "";
  return `<article class="question">
    <div class="question-heading"><span class="question-number">سؤال ${toPersianNumber(index + 1)} <small>(${escapeHtml(questionTypeLabel(question.type))})</small></span><span class="marks">${toPersianNumber(numeric(question.marks))} نمره</span></div>
    <div class="question-text">${textBlock(question.text)}</div>
    ${instructions}
    ${matchingPrompts}
    ${questionOptions(question)}
    ${responseSpace(question)}
  </article>`;
}

function answerKeyHtml(question: ApiQuestionDto, index: number): string {
  const explanation = question.explanation?.trim()
    ? `<p class="explanation"><strong>توضیح:</strong> ${textBlock(question.explanation)}</p>`
    : "";
  return `<article class="key-row"><div class="key-title"><strong>سؤال ${toPersianNumber(index + 1)}</strong><span>${toPersianNumber(numeric(question.marks))} نمره</span></div><div><strong>پاسخ:</strong> ${answerText(question)}</div>${explanation}</article>`;
}

/**
 * Produces a self-contained, Persian RTL print document. `includeAnswerKey` is opt-in so the default
 * student handout can never leak the teacher-only correctness fields into the paper.
 */
export function createPrintableExamHtml(bundle: ApiExamBundleDto, includeAnswerKey = false): string {
  const exam = bundle.exam;
  const questions = [...(bundle.questions ?? exam.questions ?? [])].sort((left, right) => left.order - right.order);
  const totalMarks = exam.total_marks == null
    ? questions.reduce((sum, question) => sum + numeric(question.marks), 0)
    : numeric(exam.total_marks);
  const instructions = exam.instructions?.trim()
    ? `<section class="instructions"><h2>دستورالعمل</h2><div>${textBlock(exam.instructions)}</div></section>`
    : "";
  const answerKey = includeAnswerKey
    ? `<section class="answer-key"><h2>کلید پاسخ دبیر</h2><p class="key-note">این بخش را پیش از توزیع نسخهٔ دانش‌آموز جدا کنید.</p>${questions.map(answerKeyHtml).join("")}</section>`
    : "";
  const mode = includeAnswerKey ? "برگهٔ آزمون و کلید پاسخ" : "برگهٔ دانش‌آموز";
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(exam.title)} — ${escapeHtml(mode)}</title>
<style>
  @page { size: A4; margin: 15mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172033; font-family: Tahoma, Arial, sans-serif; font-size: 12pt; line-height: 1.85; }
  .toolbar { display: flex; justify-content: center; padding: 12px; border-bottom: 1px solid #dbe1ea; }
  .print-button { border: 0; border-radius: 8px; background: #1d4ed8; color: white; cursor: pointer; font: inherit; font-size: 10pt; font-weight: 700; padding: 9px 18px; }
  .paper { max-width: 900px; margin: 0 auto; padding: 22px 30px; }
  .paper-header { border-bottom: 2px solid #172033; padding-bottom: 14px; }
  h1 { margin: 0 0 4px; font-size: 21pt; line-height: 1.45; }
  .subject { margin: 0; color: #536176; font-size: 11pt; }
  .exam-meta { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-top: 9px; color: #344054; font-size: 10pt; }
  .student-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin: 16px 0 4px; }
  .field { display: flex; align-items: end; gap: 8px; min-height: 30px; }
  .field-label { white-space: nowrap; font-size: 10pt; }
  .field-line { flex: 1; height: 20px; border-bottom: 1px dotted #64748b; }
  .instructions { margin: 16px 0; padding: 10px 13px; border: 1px solid #d9e0ea; border-radius: 7px; background: #f7f9fc; font-size: 10.5pt; }
  h2 { margin: 0 0 7px; font-size: 14pt; }
  .question { break-inside: avoid; page-break-inside: avoid; margin: 18px 0; }
  .question-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 1px solid #dbe1ea; padding-bottom: 4px; }
  .question-number { font-weight: 700; }
  .question-number small { color: #65748b; font-size: 8.5pt; font-weight: 400; }
  .marks { white-space: nowrap; color: #45546b; font-size: 9.5pt; }
  .question-text { margin-top: 8px; font-weight: 600; white-space: normal; }
  .question-instructions { margin: 5px 0 0; color: #5e6c80; font-size: 9.5pt; }
  .options { display: grid; gap: 5px; list-style: none; margin: 10px 0 0; padding: 0; }
  .options li { display: flex; align-items: baseline; gap: 8px; }
  .option-number { min-width: 25px; color: #516079; }
  .matching-prompts { margin-top: 9px; }
  .matching-prompts p, .matching-options-title { margin: 0; color: #536176; font-size: 9.5pt; }
  .matching-prompts ol { display: grid; gap: 5px; margin: 6px 0 0; padding-inline-start: 24px; }
  .matching-prompts li { display: flex; justify-content: space-between; gap: 14px; }
  .matching-answer-line { white-space: nowrap; color: #65748b; font-size: 9pt; }
  .response-space { margin: 12px 0 4px; }
  .response-line { height: 27px; border-bottom: 1px solid #c8d0dc; }
  .answer-key { break-before: page; page-break-before: always; margin-top: 0; }
  .key-note { margin: -2px 0 16px; color: #9f1239; font-size: 9.5pt; }
  .key-row { break-inside: avoid; page-break-inside: avoid; margin: 13px 0; padding: 9px 11px; border: 1px solid #dbe1ea; border-radius: 7px; }
  .key-title { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .key-title span { color: #66758b; font-size: 9pt; }
  .explanation { margin: 5px 0 0; color: #536176; font-size: 9.5pt; }
  .page-footer { margin-top: 24px; border-top: 1px solid #dbe1ea; padding-top: 7px; color: #718096; font-size: 8pt; text-align: center; }
  @media print {
    body { font-size: 11pt; }
    .toolbar { display: none !important; }
    .paper { max-width: none; padding: 0; }
    .instructions { background: white; }
  }
  @media screen { body { background: #edf1f6; } .paper { min-height: 100vh; margin: 18px auto; background: white; box-shadow: 0 6px 28px #0f172a18; } }
</style>
</head>
<body>
<div class="toolbar"><button class="print-button" type="button" onclick="window.print()">چاپ یا ذخیره به‌صورت PDF</button></div>
<main class="paper">
  <header class="paper-header">
    <h1>${escapeHtml(exam.title)}</h1>
    <p class="subject">${escapeHtml(exam.subject)}${exam.grade ? ` · ${escapeHtml(exam.grade)}` : ""}${exam.class_name ? ` · ${escapeHtml(exam.class_name)}` : ""}</p>
    <div class="exam-meta"><span>مدت: ${toPersianNumber(numeric(exam.duration_minutes))} دقیقه</span><span>بارم کل: ${toPersianNumber(totalMarks)} نمره</span><span>تعداد سؤال: ${toPersianNumber(questions.length)}</span></div>
  </header>
  <section class="student-fields" aria-label="مشخصات دانش‌آموز">
    <div class="field"><span class="field-label">نام و نام خانوادگی:</span><span class="field-line"></span></div>
    <div class="field"><span class="field-label">شمارهٔ دانش‌آموزی:</span><span class="field-line"></span></div>
    <div class="field"><span class="field-label">کلاس:</span><span class="field-line"></span></div>
    <div class="field"><span class="field-label">تاریخ:</span><span class="field-line"></span></div>
  </section>
  ${instructions}
  <section class="questions">${questions.length ? questions.map(questionHtml).join("") : "<p>برای این آزمون سؤالی ثبت نشده است.</p>"}</section>
  ${answerKey}
  <footer class="page-footer">${escapeHtml(exam.teacher_name || "")} · ${escapeHtml(mode)}</footer>
</main>
</body>
</html>`;
}
