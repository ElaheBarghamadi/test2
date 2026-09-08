"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle, Send } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toPersianNumber } from "@/lib/utils";

export function ExamSubmissionDialog({ open, unanswered, flagged, loading, error, onClose, onConfirm }: { open: boolean; unanswered: number; flagged: number; loading: boolean; error?: string; onClose: () => void; onConfirm: () => void }) {
  const hasReviewItems = unanswered > 0 || flagged > 0;
  return <Dialog open={open} onClose={loading ? () => undefined : onClose} title={error ? "ارسال آزمون انجام نشد" : "ارسال نهایی آزمون"} description={error ? "پاسخ‌های شما محفوظ هستند. پس از برطرف کردن مشکل، دوباره تلاش کنید." : hasReviewItems ? "پیش از ارسال نهایی، یک‌بار این موارد را بررسی کنید." : "همهٔ سؤال‌ها پاسخ داده شده‌اند و آزمون برای ارسال آماده است."}>{error ? <div className="rounded-2xl bg-rose-500/10 p-4 text-sm leading-7 text-rose-800 dark:text-rose-300"><AlertTriangle className="ml-1 inline h-4 w-4 align-text-bottom"/>{error}</div> : <div className="grid grid-cols-3 divide-x divide-x-reverse rounded-2xl bg-muted/60 py-3 text-center"><Summary value={unanswered} label="بدون پاسخ" tone="text-amber-600"/><Summary value={flagged} label="نشان‌دار" tone="text-primary"/><Summary value={unanswered + flagged} label="نکته برای مرور" tone="text-muted-foreground"/></div>}<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={onClose} disabled={loading}>{error ? "بازگشت" : "بازگشت به مرور"}</Button><Button data-autofocus onClick={onConfirm} disabled={loading}>{loading ? <><LoaderCircle className="h-4 w-4 animate-spin"/>در حال ارسال…</> : error ? <><Send className="h-4 w-4"/>تلاش دوباره</> : <><CheckCircle2 className="h-4 w-4"/>تأیید و ارسال نهایی</>}</Button></div></Dialog>;
}
function Summary({ value, label, tone }: { value: number; label: string; tone: string }) { return <div className="px-2"><p className={`text-xl font-black ${tone}`}>{toPersianNumber(value)}</p><p className="mt-1 text-[10px] font-bold text-muted-foreground">{label}</p></div>; }
