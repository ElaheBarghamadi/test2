import { CheckCircle2, CloudOff, CloudUpload, LoaderCircle, TriangleAlert } from "lucide-react";
import type { SaveStatus } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

const statusCopy: Record<SaveStatus, { label: string; icon: typeof CheckCircle2; style: string }> = {
  idle: { label: "آماده برای ذخیره", icon: CloudUpload, style: "text-muted-foreground" },
  saving: { label: "در حال ذخیره…", icon: LoaderCircle, style: "text-primary" },
  saved: { label: "ذخیره شد", icon: CheckCircle2, style: "text-emerald-600 dark:text-emerald-400" },
  saved_locally: { label: "محلی ذخیره شد", icon: CloudOff, style: "text-amber-700 dark:text-amber-400" },
  error: { label: "ذخیره انجام نشد", icon: TriangleAlert, style: "text-destructive" },
};
export function AutosaveIndicator({ status, className }: { status: SaveStatus; className?: string }) { const copy = statusCopy[status]; const Icon = copy.icon; return <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold", copy.style, className)}><Icon className={cn("h-3.5 w-3.5", status === "saving" && "animate-spin")}/>{copy.label}</span>; }
