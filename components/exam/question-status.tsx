import type { AnswerValue, ExamAnswer } from "@/lib/types/domain";
export function hasAnswer(answer?: ExamAnswer) { const value: AnswerValue | undefined = answer?.value; return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== ""; }
export type QuestionStatus = "current" | "answered" | "flagged" | "unanswered";
export function getQuestionStatus(answer: ExamAnswer | undefined, current: boolean): QuestionStatus { if (current) return "current"; if (answer?.flagged) return "flagged"; return hasAnswer(answer) ? "answered" : "unanswered"; }
