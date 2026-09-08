"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import type { ExamAttempt } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";

export function ExamSessionBanner({ attempt, onRestoreConnection }: { attempt: ExamAttempt; onRestoreConnection: () => void }) {
  const wasOffline = useRef(attempt.connectionStatus === "offline");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (attempt.connectionStatus === "offline") { wasOffline.current = true; setRestored(false); return; }
    if (wasOffline.current) {
      wasOffline.current = false;
      setRestored(true);
      const timeout = window.setTimeout(() => setRestored(false), 4200);
      return () => window.clearTimeout(timeout);
    }
  }, [attempt.connectionStatus]);
  if (attempt.status === "expired") return <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-6 text-amber-900 dark:text-amber-200"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"/><div><b>زمان آزمون به پایان رسیده است.</b><br/>پاسخ‌های شما محفوظ‌اند؛ برای ارسال نهایی، صفحهٔ مرور را باز کنید.</div></div>;
  if (attempt.connectionStatus === "offline") return <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-6 text-amber-900 dark:text-amber-200"><CloudOff className="h-4 w-4 shrink-0 text-amber-600"/><p className="flex-1"><b>اتصال اینترنت در دسترس نیست.</b> پاسخ‌های جدید در این دستگاه محفوظ می‌مانند و با بازگشت اتصال همگام می‌شوند.</p><Button variant="outline" size="sm" onClick={onRestoreConnection}><RefreshCw className="h-3.5 w-3.5"/>تلاش مجدد</Button></div>;
  if (attempt.saveStatus === "error") return <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs leading-6 text-rose-900 dark:text-rose-200"><TriangleAlert className="h-4 w-4 shrink-0 text-rose-600"/><p className="flex-1"><b>ذخیره‌سازی پاسخ با مشکل روبه‌رو شد.</b> تا رفع مشکل، پاسخ‌ها در همین صفحه محفوظ هستند.</p><Button variant="outline" size="sm" onClick={onRestoreConnection}><RefreshCw className="h-3.5 w-3.5"/>تلاش مجدد</Button></div>;
  if (restored) return <div role="status" className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4 text-emerald-600"/>اتصال دوباره برقرار شد؛ تغییرات محلی در حال همگام‌سازی هستند.</div>;
  if (attempt.saveStatus === "saved" && attempt.lastSavedAt) return <div className="mb-4 hidden items-center gap-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 sm:flex"><CheckCircle2 className="h-3.5 w-3.5"/>همهٔ تغییرات با موفقیت ذخیره شده‌اند.</div>;
  return null;
}
