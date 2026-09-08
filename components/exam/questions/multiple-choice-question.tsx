import { Check } from "lucide-react";
import type { QuestionInputProps } from "@/components/exam/questions/types";
import type { MultipleChoiceQuestion as MultipleChoiceQuestionModel } from "@/lib/types/domain";
import { cn, toPersianNumber } from "@/lib/utils";

export function MultipleChoiceQuestion({ question, value, onChange, disabled = false }: QuestionInputProps<MultipleChoiceQuestionModel>) {
  return <fieldset className="grid gap-3"><legend className="sr-only">گزینه‌های پاسخ</legend>{question.options?.map((option, index) => {
    const selected = value === option.value;
    const inputId = `${question.id}-${option.id}`;
    return <label key={option.id} htmlFor={inputId} className={cn("group flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 text-right transition-all", selected ? "border-primary bg-primary/[.06] text-primary shadow-sm" : "hover:border-primary/35 hover:bg-muted/40", disabled && "cursor-not-allowed opacity-60")}>
      <input id={inputId} type="radio" name={question.id} value={option.value} checked={selected} onChange={() => onChange(option.value)} disabled={disabled} className="sr-only"/>
      <span aria-hidden="true" className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-black transition-colors", selected && "border-primary bg-primary text-primary-foreground")}>{selected ? <Check className="h-4 w-4"/> : toPersianNumber(index + 1)}</span>
      <span className="text-sm font-bold">{option.label}</span>
    </label>;
  })}</fieldset>;
}
