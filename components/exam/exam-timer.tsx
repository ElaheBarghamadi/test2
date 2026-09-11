"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Clock3 } from "lucide-react";
import { cn, formatTime, toPersianNumber } from "@/lib/utils";

/** Announced once each, so a screen reader is not reading a countdown every second. */
const MILESTONES = [600, 300, 60, 30, 10];

export function ExamTimer({ seconds, className }: { seconds: number; className?: string }) {
  const reduced = useReducedMotion();
  const warning = seconds <= 300 && seconds > 60;
  const critical = seconds <= 60;
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<Set<number>>(new Set());

  useEffect(() => {
    for (const milestone of MILESTONES) {
      // Only crossings are announced, and only downwards, so a teacher extension does not re-announce.
      if (seconds <= milestone && seconds > 0 && !announced.current.has(milestone)) {
        announced.current.add(milestone);
        setAnnouncement(`${toPersianNumber(Math.ceil(milestone / 60))} دقیقه از زمان آزمون باقی مانده است`);
      }
    }
  }, [seconds]);

  return <div className={cn("inline-flex shrink-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2 shadow-soft", warning && "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300", critical && "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300", className)}>
    <motion.span animate={critical && !reduced ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={{ repeat: critical ? Infinity : 0, duration: 1.4 }} className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden>
      <Clock3 className="h-4 w-4"/>
    </motion.span>
    <div>
      <p className="text-[10px] font-bold text-muted-foreground">زمان باقی‌مانده</p>
      {/* The visible digits update every second; announcing them would be unreadable noise, so the
          accessible name is read on request and milestones arrive through the live region below. */}
      <p className="font-mono text-base font-black tracking-wide tabular-nums" dir="ltr" suppressHydrationWarning>{formatTime(seconds)}</p>
    </div>
    <span className="sr-only" role="timer" aria-live="off">{`زمان باقی‌ماندهٔ آزمون ${formatTime(seconds)}`}</span>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
