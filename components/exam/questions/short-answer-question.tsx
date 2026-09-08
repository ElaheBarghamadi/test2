import type { QuestionInputProps } from "@/components/exam/questions/types";
import type { ShortAnswerQuestion as ShortAnswerQuestionModel } from "@/lib/types/domain";
import { Input } from "@/components/ui/input";
import { toPersianNumber } from "@/lib/utils";

export function ShortAnswerQuestion({ question, value, onChange, disabled = false }: QuestionInputProps<ShortAnswerQuestionModel>) {
  const text = typeof value === "string" ? value : ""; const maxLength = question.maxLength ?? 150;
  return <div><label htmlFor={`answer-${question.id}`} className="text-xs font-bold text-muted-foreground">پاسخ شما</label><Input id={`answer-${question.id}`} value={text} onChange={(event) => onChange(event.target.value)} disabled={disabled} maxLength={maxLength} placeholder={question.placeholder ?? "پاسخ خود را بنویسید..."} className="mt-2 h-12" autoComplete="off"/><p className="mt-2 text-left text-[11px] font-bold text-muted-foreground">{toPersianNumber(text.length)} / {toPersianNumber(maxLength)}</p></div>;
}
