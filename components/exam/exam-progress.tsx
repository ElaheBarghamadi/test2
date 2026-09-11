import { Progress } from "@/components/ui/progress";
import { toPersianNumber } from "@/lib/utils";

/**
 * The header's two numbers: where the student is, and how much of the sheet is filled in.
 *
 * `showPosition` is off for the one-page layout — every question is on screen at once, so "سؤال ۳ از ۱۰"
 * would describe a position that does not exist and the completion figure is the only honest one left.
 */
export function ExamProgress({ current, total, answered, showPosition = true }: { current: number; total: number; answered: number; showPosition?: boolean }) {
  const value = total ? (answered / total) * 100 : 0;
  return <div className="w-full max-w-sm">
    <div className="mb-2 flex items-center justify-between text-xs font-bold">
      <span>{showPosition ? `سؤال ${toPersianNumber(current)} از ${toPersianNumber(total)}` : `پاسخ‌داده‌شده ${toPersianNumber(answered)} از ${toPersianNumber(total)}`}</span>
      <span className="text-muted-foreground">{toPersianNumber(Math.round(value))}٪ تکمیل</span>
    </div>
    <Progress value={value} aria-label={`${Math.round(value)} درصد تکمیل شده`}/>
  </div>;
}
