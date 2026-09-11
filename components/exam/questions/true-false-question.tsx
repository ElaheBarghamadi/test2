import { Check, Eraser, X } from "lucide-react";
import type { QuestionInputProps } from "@/components/exam/questions/types";
import type { TrueFalseQuestion as TrueFalseQuestionModel } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

/**
 * The true/false control.
 *
 * Both choices used to be rendered with the same shorthand `value` prop, so both radios were given the id
 * `<question>-true`, and the «نادرست» label — pointing at that id — toggled the *other* control. A student
 * who believed a statement was false physically could not say so: the click selected «درست», and the answer
 * was graded as a wrong one. Two controls must therefore own two ids, always derived from the value they
 * stand for, and the pair is asserted in the test beside this file.
 *
 * Selection is styled the same for both sides on purpose. A green or red fill would read as feedback about
 * correctness, and in an exam the server is the only thing allowed to say whether an answer was right.
 */
const CHOICES = [
  { value: true, label: "درست", hint: "گفته صحیح است", icon: Check },
  { value: false, label: "نادرست", hint: "گفته غلط است", icon: X },
] as const;

export function TrueFalseQuestion({ question, value, onChange, disabled = false }: QuestionInputProps<TrueFalseQuestionModel>) {
  const answered = value === true || value === false;
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="sr-only">درست یا نادرست بودن گفته را انتخاب کنید</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {CHOICES.map((choice) => {
          const inputId = `${question.id}-tf-${choice.value}`;
          const checked = value === choice.value;
          const Icon = choice.icon;
          return (
            <label
              key={String(choice.value)}
              htmlFor={inputId}
              className={cn(
                "relative flex cursor-pointer items-center gap-3 rounded-2xl border p-4 text-right transition-all",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-card",
                checked ? "border-primary bg-primary/[.07] shadow-soft" : "hover:border-primary/40 hover:bg-muted/40",
                disabled && "cursor-not-allowed opacity-60 hover:border-inherit hover:bg-transparent",
              )}
            >
              <input id={inputId} type="radio" name={`${question.id}-true-false`} value={String(choice.value)} checked={checked} onChange={() => onChange(choice.value)} disabled={disabled} className="sr-only"/>
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors", checked ? "border-primary bg-primary text-white" : "border-muted-foreground/25 text-muted-foreground")}><Icon className="h-5 w-5"/></span>
              <span className="min-w-0">
                <span className="block text-sm font-black">{choice.label}</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">{choice.hint}</span>
              </span>
              {checked && <span className="absolute left-3 top-3 rounded-lg bg-primary/12 px-1.5 py-0.5 text-[9px] font-black text-primary">انتخاب شما</span>}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{answered ? "می‌توانید تا پیش از ارسال، انتخاب خود را عوض کنید." : "برای این سؤال یک گزینه را انتخاب کنید."}</span>
        {answered && !disabled && (
          <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-bold transition-colors hover:bg-muted">
            <Eraser className="h-3.5 w-3.5"/>پاک کردن انتخاب
          </button>
        )}
      </div>
    </fieldset>
  );
}
