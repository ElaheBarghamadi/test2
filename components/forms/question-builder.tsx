"use client";

import { useState } from "react";
import type { Question } from "@/lib/types/domain";
import { TeacherQuestionBuilder } from "@/components/teacher/question-builder";

/** Standalone question-bank surface; the exam builder injects the same reusable editor. */
export function QuestionBuilder({ initialQuestions }: { initialQuestions: Question[] }) {
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  return <TeacherQuestionBuilder questions={questions} onChange={setQuestions}/>;
}
