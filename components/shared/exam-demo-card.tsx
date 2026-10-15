import { BadgeCheck, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A short loop of a running exam, used wherever a signed-out visitor needs to see the product before they
 * have an account: the hero on the landing page and the showcase half of the sign-in panel.
 *
 * Everything that moves is CSS — three keyframe phases on one 15-second loop (see the `demo-*` rules in
 * `globals.css`). No timers, no state, no re-renders, and a single `prefers-reduced-motion` rule that holds
 * the first phase as a still frame instead of freezing mid-fade.
 *
 * The questions are real ones from `seed_demo`'s question banks, so what is shown here is what a demo
 * account actually meets after signing in.
 */
const PHASES = [
  {
    timer: "۴۲:۱۸", step: "سؤال ۳ از ۲۰",
    question: "کدام اندامک مسئول تولید بخش عمدهٔ انرژی سلول است؟",
    options: ["هسته", "میتوکندری", "ریبوزوم"], answer: 1,
  },
  {
    timer: "۴۱:۵۵", step: "سؤال ۷ از ۲۰",
    question: "نقش اصلی غشای پلاسمایی در سلول چیست؟",
    options: ["تنظیم ورود و خروج مواد", "تولید پروتئین", "ذخیرهٔ اطلاعات ژنتیکی"], answer: 0,
  },
  {
    timer: "۴۱:۳۱", step: "سؤال ۱۲ از ۲۰",
    question: "انتقال آب و مواد معدنی در گیاه بر عهدهٔ کدام بافت است؟",
    options: ["آبکش", "پوستک", "چوب"], answer: 2,
  },
];
const PHASE_CLASS = ["demo-phase-a", "demo-phase-b", "demo-phase-c"];
const LETTERS = ["الف", "ب", "ج"];

const TONE = {
  /** Sits on the landing page's own background, using the app's theme tokens. */
  solid: {
    root: "rounded-2xl border border-border/70 bg-card p-4 text-foreground shadow-soft sm:p-5",
    liveBadge: "bg-success/10 text-success",
    title: "text-foreground",
    step: "text-muted-foreground",
    timer: "rounded-xl bg-warning/10 px-2.5 py-1 text-warning",
    track: "bg-muted",
    fill: "bg-gradient-to-l from-primary to-teal-400",
    question: "rounded-2xl border border-border/70 bg-surface",
    stage: "h-[212px]",
    pad: "p-3.5 sm:p-4",
    option: "border-border/70 bg-card text-foreground",
    optionOn: "border-primary/60 bg-primary/[.07] text-primary",
    bullet: "border-border",
    bulletOn: "border-primary bg-primary text-primary-foreground",
    saved: "bg-muted/70 text-muted-foreground",
    savedIcon: "text-success",
  },
  /** Sits on the indigo showcase panel, where the app's own card colour would be a hole in the gradient. */
  glass: {
    root: "rounded-2xl border border-white/15 bg-white/[.09] p-4 text-white shadow-2xl backdrop-blur-sm",
    liveBadge: "bg-emerald-400/18 text-emerald-100",
    title: "text-white/95",
    step: "text-indigo-200",
    timer: "text-amber-200",
    track: "bg-white/15",
    fill: "bg-gradient-to-l from-teal-300 to-indigo-200",
    question: "",
    stage: "h-[182px]",
    pad: "",
    option: "border-white/12 bg-white/[.06] text-indigo-100",
    optionOn: "border-teal-300/70 bg-teal-300/18 text-white",
    bullet: "border-white/25",
    bulletOn: "border-teal-200 bg-teal-300 text-indigo-900",
    saved: "bg-white/10 text-white",
    savedIcon: "text-teal-200",
  },
} as const;

export function ExamDemoCard({ tone = "solid", className }: { tone?: keyof typeof TONE; className?: string }) {
  const skin = TONE[tone];
  return (
    <div className={cn(skin.root, className)}>
      <div className="flex items-center justify-between">
        <span className="flex gap-1.5" dir="ltr" aria-hidden="true">
          <i className="h-2 w-2 rounded-full bg-rose-400/85"/>
          <i className="h-2 w-2 rounded-full bg-amber-400/85"/>
          <i className="h-2 w-2 rounded-full bg-emerald-400/85"/>
        </span>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black", skin.liveBadge)}>
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70"/>
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current"/>
          </span>
          آزمون در حال برگزاری
        </span>
      </div>

      <div className="mt-3.5 flex items-baseline justify-between gap-3 text-[11px]">
        <span className={cn("truncate font-black", skin.title)}>آزمون جامع زیست‌شناسی</span>
        {/* Three stacked timers on one loop read as a clock that is actually running. */}
        <span className={cn("relative block h-4 w-14 shrink-0 text-left font-black tabular-nums", skin.timer)} aria-hidden="true">
          {PHASES.map((phase, index) => <b key={phase.timer} className={cn("absolute inset-0", PHASE_CLASS[index])}>{phase.timer}</b>)}
        </span>
      </div>
      <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", skin.track)}>
        <div className={cn("demo-progress-fill h-full rounded-full", skin.fill)}/>
      </div>

      {/*
        * A crossfading stack needs a fixed height, and the height has to fit the *longest* phase — the
        * stack is only as tall as its container, not its tallest child. Both figures are measured against
        * the real question text at the real panel widths, with room for Vazirmatn's taller line box.
        */}
      <div className={cn("relative mt-4", skin.stage, skin.question)}>
        {PHASES.map((phase, index) => (
          <div key={phase.step} className={cn("absolute inset-0", skin.pad, PHASE_CLASS[index])} aria-hidden={index !== 0}>
            <p className={cn("text-[10px] font-bold", skin.step)}>{phase.step}</p>
            <p className="mt-1 text-xs font-black leading-5">{phase.question}</p>
            <div className="mt-2.5 space-y-1.5">
              {phase.options.map((option, optionIndex) => {
                const chosen = optionIndex === phase.answer;
                return (
                  <div key={option} className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors", chosen ? skin.optionOn : skin.option)}>
                    <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px]", chosen ? skin.bulletOn : skin.bullet)}>
                      {chosen ? <Check className="h-2.5 w-2.5" aria-hidden="true"/> : LETTERS[optionIndex]}
                    </span>
                    <span className="truncate">{option}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={cn("demo-saved mt-3 flex items-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-black", skin.saved)}>
        <BadgeCheck className={cn("h-3.5 w-3.5 shrink-0", skin.savedIcon)} aria-hidden="true"/>
        پاسخ‌ها خودکار ذخیره شد
      </div>
    </div>
  );
}
