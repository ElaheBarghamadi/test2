import { Progress } from "@/components/ui/progress";
import { toPersianNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * The header's two numbers: where the student is, and how much of the sheet is filled in.
 *
 * `showPosition` is off for the one-page layout — every question is on screen at once, so "سؤال ۳ از ۱۰"
 * would describe a position that does not exist and the completion figure is the only honest one left.
 *
 * `compact` is the same information in one line, for the phone bar. On a small screen the two-row version
 * stacked a second strip under the header, which is how the exam page ended up with three bars of chrome
 * around one question; the bar keeps position, percentage and the meter, in 20px of height.
 */
export function ExamProgress({ current, total, answered, showPosition = true, compact = false, className }: { current: number; total: number; answered: number; showPosition?: boolean; compact?: boolean; className?: string }) {
  const value = total ? (answered / total) * 100 : 0;
  const label = showPosition ? `سؤال ${toPersianNumber(current)} از ${toPersianNumber(total)}` : `پاسخ‌داده‌شده ${toPersianNumber(answered)} از ${toPersianNumber(total)}`;

  if (compact) {
    return (
      <div className={cn("min-w-0 flex-1", className)}>
        <p className="truncate text-[11px] font-black leading-4">
          {label}
          <span className="mr-1.5 font-bold text-muted-foreground">{toPersianNumber(Math.round(value))}٪</span>
        </p>
        <Progress value={value} className="mt-1 h-1" aria-label={`${Math.round(value)} درصد تکمیل شده`}/>
      </div>
    );
  }

  return <div className={cn("w-full max-w-sm", className)}>
    <div className="mb-2 flex items-center justify-between text-xs font-bold">
      <span>{label}</span>
      <span className="text-muted-foreground">{toPersianNumber(Math.round(value))}٪ تکمیل</span>
    </div>
    <Progress value={value} aria-label={`${Math.round(value)} درصد تکمیل شده`}/>
  </div>;
}
