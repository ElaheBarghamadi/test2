import { Check } from "lucide-react";
import type { QuestionInputProps } from "@/components/exam/questions/types";
import type { MultipleAnswerQuestion as MultipleAnswerQuestionModel } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

export function MultipleAnswerQuestion({ question, value, onChange, disabled = false }: QuestionInputProps<MultipleAnswerQuestionModel>) {
  const selected = Array.isArray(value) ? value : [];
  return <fieldset className="grid gap-3"><legend className="mb-1 text-xs font-bold text-muted-foreground">همهٔ گزینه‌های درست را انتخاب کنید.</legend>{question.options?.map((option) => {
    const checked = selected.includes(option.value);
    const inputId = `${question.id}-${option.id}`;
    return <label key={option.id} htmlFor={inputId} className={cn("group flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border p-3 text-right transition-all", checked ? "border-primary bg-primary/[.06] text-primary shadow-sm" : "hover:border-primary/35 hover:bg-muted/40", disabled && "cursor-not-allowed opacity-60")}>
      <input id={inputId} type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((item) => item !== option.value) : [...selected, option.value])} disabled={disabled} className="sr-only"/>
      <span aria-hidden="true" className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg border transition-colors", checked && "border-primary bg-primary text-primary-foreground")}>{checked && <Check className="h-4 w-4"/>}</span>
      <span className="text-sm font-bold">{option.label}</span>
    </label>;
  })}</fieldset>;
}
