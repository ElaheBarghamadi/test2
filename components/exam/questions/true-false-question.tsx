import { Check, X } from "lucide-react";
import type { QuestionInputProps } from "@/components/exam/questions/types";
import type { TrueFalseQuestion as TrueFalseQuestionModel } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

export function TrueFalseQuestion({ question, value, onChange, disabled = false }: QuestionInputProps<TrueFalseQuestionModel>) {
  return <fieldset className="grid grid-cols-2 gap-3"><legend className="sr-only">انتخاب درست یا نادرست</legend><BinaryChoice questionId={question.id} value label="درست" icon={Check} checked={value === true} onChange={() => onChange(true)} disabled={disabled}/><BinaryChoice questionId={question.id} value label="نادرست" icon={X} checked={value === false} onChange={() => onChange(false)} disabled={disabled}/></fieldset>;
}
function BinaryChoice({ questionId, value, label, icon: Icon, checked, onChange, disabled }: { questionId: string; value: boolean; label: string; icon: typeof Check; checked: boolean; onChange: () => void; disabled: boolean }) { const id = `${questionId}-${value}`; return <label htmlFor={id} className={cn("flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border text-sm font-black transition-all", checked ? "border-primary bg-primary text-primary-foreground shadow-sm" : "hover:border-primary/35 hover:bg-muted/40", disabled && "cursor-not-allowed opacity-60")}><input id={id} type="radio" name={questionId} checked={checked} onChange={onChange} disabled={disabled} className="sr-only"/><Icon className="h-5 w-5"/>{label}</label>; }
