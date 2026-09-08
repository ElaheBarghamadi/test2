"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Info } from "lucide-react";
import type { AnswerValue, ExamAnswer, Question } from "@/lib/types/domain";
import { FlagQuestionButton } from "@/components/exam/flag-question-button";
import { QuestionRenderer } from "@/components/exam/question-renderer";
import { toPersianNumber } from "@/lib/utils";

export function QuestionCard({ question, answer, flagged, onAnswer, onToggleFlag, disabled = false }: { question: Question; answer?: ExamAnswer; flagged: boolean; onAnswer: (value: AnswerValue) => void; onToggleFlag: () => void; disabled?: boolean }) {
  const reduced = useReducedMotion();
  return <AnimatePresence mode="wait"><motion.article key={question.id} initial={reduced ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: 10 }} transition={{ duration: .19, ease: "easeOut" }} className="rounded-3xl border bg-card p-5 shadow-soft sm:p-8"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-black text-primary">سؤال {toPersianNumber(question.order)}</span><span className="text-xs font-bold text-muted-foreground">{toPersianNumber(question.points)} نمره</span></div><FlagQuestionButton flagged={flagged} onClick={onToggleFlag} disabled={disabled}/></div><h1 className="mt-6 text-lg font-black leading-9 sm:text-xl">{question.stem}</h1>{question.helpText && <div className="mt-3 flex gap-2 rounded-xl bg-muted/65 px-3 py-2.5 text-xs leading-6 text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary"/>{question.helpText}</div>}<div className="mt-7"><QuestionRenderer question={question} value={answer?.value ?? null} onChange={onAnswer} disabled={disabled}/></div></motion.article></AnimatePresence>;
}
