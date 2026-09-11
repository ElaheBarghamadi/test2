"use client";

import { AlertTriangle, MonitorSmartphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ExamAttempt } from "@/lib/types/domain";

/**
 * One place where an attempt-level write problem becomes a decision the student can make.
 *
 * A second window is refused by the server rather than merged, because silently interleaving two writers
 * is how answers get lost. The student is told which window is live and can move the exam here on purpose.
 * A failed save is different: nothing was refused, so the only honest action is to retry the same queue.
 */
export function ExamSessionNotice({
  conflict,
  saveStatus,
  claiming,
  onClaim,
  onRetry,
}: {
  conflict?: ExamAttempt["sessionConflict"];
  saveStatus: ExamAttempt["saveStatus"];
  claiming?: boolean;
  onClaim?: () => void;
  onRetry?: () => void;
}) {
  if (conflict === "another_session") {
    return (
      <Card role="alert" className="mb-4 border-amber-500/40 bg-amber-500/[.08]">
        <div className="flex flex-wrap items-center gap-3 p-3.5">
          <MonitorSmartphone className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">این آزمون در پنجرهٔ دیگری باز است</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              برای اینکه پاسخ‌ها قاطی نشوند، فقط همان پنجره می‌تواند بنویسد. اگر آن پنجره را بسته‌اید، ادامهٔ آزمون را اینجا بگیرید.
            </p>
          </div>
          {onClaim && (
            <Button size="sm" onClick={onClaim} disabled={claiming}>
              <RefreshCw className={claiming ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              ادامه در این پنجره
            </Button>
          )}
        </div>
      </Card>
    );
  }

  if (conflict === "finalized") {
    return (
      <Card role="status" className="mb-4 border-primary/25 bg-primary/[.06]">
        <div className="flex flex-wrap items-center gap-3 p-3.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm leading-6">
            این نشست در جای دیگر نهایی شده است. پاسخ‌های ذخیره‌شده حفظ و نمره گرفته شده‌اند و این صفحه فقط خواندنی است.
          </p>
        </div>
      </Card>
    );
  }

  if (saveStatus === "error") {
    return (
      <Card role="alert" className="mb-4 border-destructive/35 bg-destructive/[.05]">
        <div className="flex flex-wrap items-center gap-3 p-3.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">آخرین ذخیره انجام نشد</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              پاسخ‌های شما هنوز روی این دستگاه نگه داشته شده‌اند و هیچ چیزی پاک نشده است. دوباره تلاش کنید یا اتصال را بررسی کنید.
            </p>
          </div>
          {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>تلاش دوبارهٔ ذخیره</Button>}
        </div>
      </Card>
    );
  }

  return null;
}
