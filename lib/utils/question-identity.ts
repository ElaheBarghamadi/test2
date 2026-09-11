import type { Question } from "@/lib/types/domain";

/**
 * The client's mirror of the server's question fingerprint (`backend/apps/exams/content_identity.py`).
 *
 * The API refuses to store the same question twice inside one exam: a create whose content already exists
 * returns the existing row, and an edit that would turn one question into a twin of another is rejected.
 * The builder holds questions in a draft before any of them has an id, so it needs the same notion of
 * "identical" locally — otherwise a draft with two identical rows would be saved as one row on the server
 * and then re-diffed against a draft of two, which is the loop that produced the duplicates in the first
 * place. The builder therefore refuses to save a draft that repeats itself, and says which two are twins.
 *
 * Both sides agree on what counts: NFKC-normalised, trimmed, whitespace-collapsed, case-folded wording;
 * explanation; marks; the ordered options with their key; and the grading configuration. Position in the
 * paper, difficulty and tags are outside the identity, so reordering or re-tagging is never "a new
 * question".
 */
/**
 * Wording, made comparable: the Arabic and Persian forms of `yeh`/`keheh`, Arabic-Indic digits and the
 * zero-width joiner a keyboard inserts are all written the same way here, because a question retyped by a
 * second pair of hands is the same question and a fingerprint must not depend on which keyboard did it.
 */
const normalizeWord = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\u064a/g, "\u06cc")
    .replace(/\u0643/g, "\u06a9")
    .replace(/[\u0660-\u0669]/g, (digit) => String.fromCharCode(0x06f0 + (digit.charCodeAt(0) - 0x660)))
    .replace(/[\u200c\u200d]/g, "")
    .trim()
    .toLocaleLowerCase("fa")
    .replace(/\s+/g, " ");

const words = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => normalizeWord(value)).filter(Boolean);

/** A comparable shape of what a question *is*, per type, ignoring where it sits in the paper. */
export function questionIdentityParts(question: Question): Record<string, unknown> {
  const base = {
    type: question.type,
    text: normalizeWord(question.stem),
    instructions: normalizeWord(question.helpText),
    // Feedback is part of what the question is, exactly as it is on the server: two rows that differ only
    // there are two questions, and merging them would drop one teacher's wording.
    explanation: normalizeWord(question.explanation),
    marks: Number(question.points || 0).toFixed(2),
  };
  switch (question.type) {
    case "single_choice":
      return {
        ...base,
        options: question.options.map((option) => ({ text: normalizeWord(option.label), is_correct: option.id === question.correctOptionId })),
      };
    case "multiple_choice":
      return {
        ...base,
        options: question.options.map((option) => ({ text: normalizeWord(option.label), is_correct: (question.correctOptionIds ?? []).includes(option.id) })),
      };
    case "true_false":
      // The two controls are fixed wording, and the write path stores them in this order.
      return {
        ...base,
        options: [
          { text: "درست", is_correct: question.correctAnswer !== false },
          { text: "نادرست", is_correct: question.correctAnswer === false },
        ],
      };
    case "short_answer":
      return {
        ...base,
        configuration: {
          expected_answers: words(question.expectedAnswers).sort(),
          case_sensitive: question.caseSensitive === true,
          max_length: question.maxLength ?? null,
        },
      };
    case "essay":
      return { ...base, configuration: { max_length: question.maxLength ?? null } };
  }
}

/** A stable string for grouping a draft's questions by content. */
export function questionIdentity(question: Question): string {
  return JSON.stringify(questionIdentityParts(question));
}

/**
 * Which positions in a draft repeat an earlier question: `index -> index of the first copy`.
 * Only exact content repeats are reported; a question that merely looks similar stays untouched.
 */
export function duplicateQuestionIndexes(questions: readonly Question[]): Map<number, number> {
  const firstSeen = new Map<string, number>();
  const duplicates = new Map<number, number>();
  questions.forEach((question, index) => {
    const identity = questionIdentity(question);
    const original = firstSeen.get(identity);
    if (original === undefined) firstSeen.set(identity, index);
    else duplicates.set(index, original);
  });
  return duplicates;
}
