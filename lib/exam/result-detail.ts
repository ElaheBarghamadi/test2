import type { ExamResult } from "@/lib/types/domain";

/**
 * The four rungs of what a published result reveals.
 *
 * The order is the contract: each option shows everything the one above it shows, plus more. The server owns
 * the same ladder (`ExamSettings.ResultDetail`) and is the authority on what a payload contains - this list
 * only names it in Persian, so a screen never promises a rung the API has not agreed to.
 */
export type ResultDetailChoice = NonNullable<ExamResult["detailLevel"]>;

export const RESULT_DETAIL_OPTIONS: Array<{ value: ResultDetailChoice; title: string; short: string; description: string }> = [
  { value: "score_only", title: "فقط نمره", short: "نمره", description: "نمره، درصد و حکم قبولی؛ همین." },
  {
    value: "own_answers",
    title: "نمره و پاسخ‌نامهٔ خودش",
    short: "نمره و پاسخ‌نامه",
    description: "متن و گزینه‌های خود دانش‌آموز، بدون درست و نادرست.",
  },
  {
    value: "own_answers_with_feedback",
    title: "پاسخ‌نامه و نکته‌های آموزگار",
    short: "پاسخ‌نامه و نکته‌ها",
    description: "به‌علاوهٔ بازخوردی که برای هر سؤال نوشته‌اید.",
  },
  {
    value: "full_key",
    title: "پاسخ‌نامه، نکته‌ها و کلید",
    short: "همه‌چیز با کلید",
    description: "نمرهٔ هر سؤال، پاسخ درست و پاسخ نمونه.",
  },
];

export const RESULT_DETAIL_LABELS: Record<ResultDetailChoice, string> = RESULT_DETAIL_OPTIONS.reduce(
  (labels, option) => ({ ...labels, [option.value]: option.short }),
  {} as Record<ResultDetailChoice, string>,
);

/**
 * Resolve the rung an exam publishes at the same way the server does: an explicit choice wins, and the legacy
 * `show_correct_answers` switch is what an old exam means. Display only - the payload stays the authority.
 */
export function resolveResultDetail(settings: { resultDetail?: ResultDetailChoice | null; showCorrectAnswers: boolean }): ResultDetailChoice {
  return settings.resultDetail ?? (settings.showCorrectAnswers ? "full_key" : "score_only");
}
