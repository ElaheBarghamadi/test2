import type { QuestionInputProps } from "@/components/exam/questions/types";
import type { WrittenQuestion as WrittenQuestionModel } from "@/lib/types/domain";
import { Textarea } from "@/components/ui/textarea";
import { toPersianNumber } from "@/lib/utils";

export function WrittenQuestion({ question, value, onChange, disabled = false }: QuestionInputProps<WrittenQuestionModel>) {
  const text = typeof value === "string" ? value : ""; const maxLength = question.maxLength ?? 1200;
  return <div><label htmlFor={`answer-${question.id}`} className="text-xs font-bold text-muted-foreground">پاسخ تشریحی شما</label><Textarea id={`answer-${question.id}`} value={text} onChange={(event) => onChange(event.target.value)} disabled={disabled} maxLength={maxLength} placeholder={question.placeholder ?? "پاسخ خود را با ساختار روشن بنویسید..."} className="mt-2 min-h-52 resize-y p-4 leading-8"/><div className="mt-2 flex items-center justify-between text-[11px] font-bold text-muted-foreground"><span>پاسخ شما به‌صورت خودکار ذخیره می‌شود.</span><span>{toPersianNumber(text.length)} / {toPersianNumber(maxLength)}</span></div></div>;
}
