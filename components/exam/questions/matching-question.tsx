import type { QuestionInputProps } from "@/components/exam/questions/types";
import type { MatchingQuestion as MatchingQuestionModel } from "@/lib/types/domain";
import { cn, toPersianNumber } from "@/lib/utils";

export function MatchingQuestion({ question, value, onChange, disabled = false }: QuestionInputProps<MatchingQuestionModel>) {
  const matches = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const options = question.options ?? [];
  return <fieldset className="space-y-3">
    <legend className="mb-2 text-xs font-bold text-muted-foreground">برای هر مورد، یک پاسخ انتخاب کنید؛ هر پاسخ فقط یک‌بار قابل استفاده است.</legend>
    {question.pairs.map((pair, index) => {
      const usedElsewhere = new Set(Object.entries(matches).filter(([promptId]) => promptId !== pair.id).map(([, optionId]) => optionId));
      return <label key={pair.id} className="grid gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-xs font-black text-primary">{toPersianNumber(index + 1)}</span>
        <span className="text-sm font-bold leading-6">{pair.prompt}</span>
        <select
          value={matches[pair.id] ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const next = { ...matches };
            if (event.target.value) next[pair.id] = event.target.value;
            else delete next[pair.id];
            onChange(next);
          }}
          className={cn("h-11 min-w-0 rounded-xl border bg-background px-3 text-sm font-bold", disabled && "opacity-60")}
          aria-label={`پاسخ برای مورد ${index + 1}`}
        >
          <option value="">انتخاب پاسخ…</option>
          {options.map((option) => <option key={option.id} value={option.id} disabled={usedElsewhere.has(option.id)}>{option.label}</option>)}
        </select>
      </label>;
    })}
  </fieldset>;
}
