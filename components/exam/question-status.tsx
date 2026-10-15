import type { AnswerValue, ExamAnswer } from "@/lib/types/domain";
export function hasAnswer(answer?: ExamAnswer) {
  if (answer?.attachments?.length) return true;
  const value: AnswerValue | undefined = answer?.value;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "";
}
export type QuestionStatus = "current" | "answered" | "flagged" | "unanswered";
export function getQuestionStatus(answer: ExamAnswer | undefined, current: boolean): QuestionStatus { if (current) return "current"; if (answer?.flagged) return "flagged"; return hasAnswer(answer) ? "answered" : "unanswered"; }
