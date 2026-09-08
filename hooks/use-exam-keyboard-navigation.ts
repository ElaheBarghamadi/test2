"use client";

import { useEffect } from "react";
import type { AnswerValue, Question } from "@/lib/types/domain";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true'], button, a");
}

export function useExamKeyboardNavigation({
  question,
  currentValue,
  onPrevious,
  onNext,
  onAnswer,
  enabled = true,
}: {
  question: Question;
  currentValue: AnswerValue;
  onPrevious: () => void;
  onNext: () => void;
  onAnswer: (value: AnswerValue) => void;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); onNext(); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); onPrevious(); return; }
      if (question.type !== "single_choice" && question.type !== "multiple_choice") return;
      const choiceIndex = Number(event.key) - 1;
      if (choiceIndex < 0 || !Number.isInteger(choiceIndex) || !question.options[choiceIndex]) return;
      const choice = question.options[choiceIndex].value;
      if (question.type === "single_choice") { event.preventDefault(); onAnswer(choice); }
      if (question.type === "multiple_choice") {
        event.preventDefault();
        const selected = Array.isArray(currentValue) ? currentValue : [];
        onAnswer(selected.includes(choice) ? selected.filter((item) => item !== choice) : [...selected, choice]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [question, currentValue, onPrevious, onNext, onAnswer, enabled]);
}
