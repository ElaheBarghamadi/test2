"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Clock3 } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";

export function ExamTimer({ seconds, className }: { seconds: number; className?: string }) {
  const reduced = useReducedMotion();
  const warning = seconds <= 300 && seconds > 60;
  const critical = seconds <= 60;
  return <div className={cn("inline-flex shrink-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2 shadow-soft", warning && "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300", critical && "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300", className)} aria-live={critical ? "assertive" : "polite"} aria-label={`زمان باقی مانده ${formatTime(seconds)}`}><motion.span animate={critical && !reduced ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={{ repeat: critical ? Infinity : 0, duration: 1.4 }} className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><Clock3 className="h-4 w-4"/></motion.span><div><p className="text-[10px] font-bold text-muted-foreground">زمان باقی‌مانده</p><p className="font-mono text-base font-black tracking-wide tabular-nums" dir="ltr">{formatTime(seconds)}</p></div></div>;
}
