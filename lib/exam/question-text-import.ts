import type { Question, QuestionOption } from "@/lib/types/domain";

export interface QuestionTextImportResult {
  questions: Question[];
  warnings: string[];
}

const OPTION_LABELS = new Set([
  "الف", "ب", "پ", "ت", "ث", "ج", "چ", "ح", "خ", "د", "ذ", "ر", "ز", "ژ", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ک", "گ", "ل", "م", "ن", "و", "ه", "ی",
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
]);

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = code >= 0x06f0 && code <= 0x06f9 ? 0x06f0 : 0x0660;
    return String(code - zero);
  }).replace(/٫/g, ".");
}

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase("fa-IR").replace(/[\s()（）.،,;؛]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");
}

function isQuestionHeader(line: string): boolean {
  return /^\s*(?:سؤال\s*[:：]|\d+\s*[.)、])/u.test(line);
}

function splitBlocks(input: string): string[][] {
  const lines = normalizeDigits(input).replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s*---+\s*$/u.test(line)) {
      if (current.some((item) => item.trim())) blocks.push(current);
      current = [];
      continue;
    }
    if (current.some((item) => item.trim()) && isQuestionHeader(line)) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.some((item) => item.trim())) blocks.push(current);
  return blocks;
}

function stripQuestionPrefix(line: string): string {
  return line
    .replace(/^\s*سؤال\s*[:：]\s*/u, "")
    .replace(/^\s*\d+\s*[.)、]\s*/u, "")
    .trim();
}

function createQuestionId(order: number): string {
  return `question-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${order}`;
}

function parseBlock(lines: string[], order: number, warnings: string[]): Question | null {
  const stem: string[] = [];
  const optionRows: Array<{ label: string; text: string }> = [];
  let instructions = "";
  let answerLine = "";
  let points = 1;
  let sawQuestionLine = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (stem.length && stem[stem.length - 1] !== "") stem.push("");
      continue;
    }

    const questionMatch = line.match(/^سؤال\s*[:：]\s*(.*)$/u);
    if (questionMatch) {
      sawQuestionLine = true;
      if (questionMatch[1].trim()) stem.push(questionMatch[1].trim());
      continue;
    }
    if (!sawQuestionLine && stem.length === 0 && /^\d+\s*[.)、]\s*/u.test(line)) {
      stem.push(stripQuestionPrefix(line));
      continue;
    }

    const markMatch = line.match(/^(?:نمره|بارم)\s*[:：]\s*([\d.]+)/u);
    if (markMatch) {
      const parsed = Number(markMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) points = parsed;
      else warnings.push(`سؤال ${order}: بارم نامعتبر بود و ۱ در نظر گرفته شد.`);
      continue;
    }

    const answerMatch = line.match(/^(?:پاسخ(?:\s+(?:درست|صحیح))?|کلید)\s*[:：]\s*(.*)$/u);
    if (answerMatch) {
      answerLine = answerMatch[1].trim();
      continue;
    }

    const instructionMatch = line.match(/^(?:راهنما|دستور)\s*[:：]\s*(.*)$/u);
    if (instructionMatch) {
      instructions = instructionMatch[1].trim();
      continue;
    }

    const optionMatch = line.match(/^([A-Za-z\u0600-\u06FF]+)\s*[).:：]\s*(.*)$/u);
    if (optionMatch && OPTION_LABELS.has(normalizeLabel(optionMatch[1]))) {
      optionRows.push({ label: optionMatch[1], text: optionMatch[2].trim() });
      continue;
    }

    stem.push(line);
  }

  const stemText = stem.join("\n").trim();
  if (!stemText && !optionRows.length && !answerLine) return null;

  const id = createQuestionId(order);
  const base = {
    id,
    order,
    stem: stemText,
    helpText: instructions || undefined,
    points,
    required: true,
    difficulty: "medium" as const,
    tags: [] as string[],
  };

  if (optionRows.length) {
    const options: QuestionOption[] = optionRows.map((option, index) => {
      const optionId = `${id}-option-${index + 1}`;
      return { id: optionId, value: optionId, label: option.text };
    });
    const answerTokens = answerLine.split(/\s*(?:[,،;؛]|\s+و\s+)\s*/u).map(normalizeLabel).filter(Boolean);
    const correctIndexes = options.flatMap((option, index) => {
      const labelMatches = answerTokens.includes(normalizeLabel(optionRows[index].label));
      const textMatches = answerTokens.includes(normalizeLabel(option.label));
      return labelMatches || textMatches ? [index] : [];
    });
    if (answerLine && correctIndexes.length !== answerTokens.length) warnings.push(`سؤال ${order}: پاسخ «${answerLine}» با برچسب یا متن گزینه‌ای جور درنیامد.`);
    if (!answerLine) warnings.push(`سؤال ${order}: کلید پاسخ وارد نشده؛ پیش از انتشار آن را علامت بزنید.`);
    if (correctIndexes.length > 1) {
      return { ...base, type: "multiple_choice", options: options.map((option, index) => ({ ...option, isCorrect: correctIndexes.includes(index) })), correctOptionIds: correctIndexes.map((index) => options[index].id) };
    }
    const correctOptionId = correctIndexes.length === 1 ? options[correctIndexes[0]].id : "";
    return { ...base, type: "single_choice", options: options.map((option, index) => ({ ...option, isCorrect: correctIndexes[0] === index })), correctOptionId };
  }

  if (answerLine) {
    const expectedAnswers = answerLine.split(/\s*(?:[,،;؛])\s*/u).map((answer) => answer.trim()).filter(Boolean);
    return { ...base, type: "short_answer", expectedAnswers, caseSensitive: false, placeholder: "پاسخ کوتاه خود را بنویسید...", maxLength: 150 };
  }
  return { ...base, type: "essay", placeholder: "پاسخ تشریحی خود را بنویسید...", maxLength: 1200, gradingNote: "" };
}

/**
 * Imports a deliberately small, reviewable text format. Separate questions with `---`; choice lines use
 * «الف) متن گزینه» and an answer line uses «پاسخ: ب». With no choices, an answer makes a short-answer
 * question; without an answer, it becomes an essay question that can be refined in the regular editor.
 */
export function parseQuestionText(input: string, orderStart = 1): QuestionTextImportResult {
  const warnings: string[] = [];
  const blocks = splitBlocks(input);
  const questions = blocks.flatMap((block, index) => {
    const question = parseBlock(block, orderStart + index, warnings);
    if (!question) warnings.push(`بخش ${index + 1}: متن سؤال پیدا نشد و این بخش نادیده گرفته شد.`);
    return question ? [question] : [];
  });
  if (!questions.length && input.trim()) warnings.push("از متن واردشده سؤالی ساخته نشد؛ قالب نمونه را بررسی کنید.");
  return { questions, warnings };
}
