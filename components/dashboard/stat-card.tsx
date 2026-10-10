import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  trend,
  tone = "indigo",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  trend?: "up" | "down";
  tone?: "indigo" | "teal" | "violet" | "amber";
}) {
  const tones = {
    indigo: "from-indigo-500/15 to-indigo-500/[.05] text-indigo-700 dark:text-indigo-300",
    teal: "from-teal-500/15 to-teal-500/[.05] text-teal-700 dark:text-teal-300",
    violet: "from-violet-500/15 to-violet-500/[.05] text-violet-700 dark:text-violet-300",
    amber: "from-amber-500/15 to-amber-500/[.05] text-amber-700 dark:text-amber-300",
  };
  const TrendIcon = trend === "down" ? TrendingDown : TrendingUp;

  return (
    <Card className="group relative isolate min-w-0 overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-lift sm:p-5">
      <span aria-hidden="true" className="pointer-events-none absolute -left-8 -top-10 -z-10 h-32 w-32 rounded-full bg-primary/[.04] blur-2xl transition-transform duration-500 group-hover:scale-125" />
      <div className="flex items-start justify-between gap-3">
        <div className={cn("rounded-2xl border border-white/60 bg-gradient-to-br p-2.5 shadow-sm dark:border-white/5", tones[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        {trend && (
          <span className={cn("flex max-w-[55%] items-center gap-1 rounded-full bg-muted/70 px-2 py-1 text-[10px] font-extrabold", trend === "up" ? "text-success" : "text-danger")}>
            <TrendIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{trend === "up" ? "رو به رشد" : "نیازمند توجه"}</span>
          </span>
        )}
      </div>
      <p className="mt-5 break-words text-2xl font-black leading-tight tracking-tight sm:text-[1.75rem]">{value}</p>
      <p className="mt-1.5 min-h-5 text-xs font-extrabold leading-5 text-foreground/80">{label}</p>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{detail}</p>
    </Card>
  );
}
