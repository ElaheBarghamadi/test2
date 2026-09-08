import type { QuestionInputProps } from "@/components/exam/questions/types";
import { MultipleChoiceQuestion } from "@/components/exam/questions/multiple-choice-question";
import { MultipleAnswerQuestion } from "@/components/exam/questions/multiple-answer-question";
import { ShortAnswerQuestion } from "@/components/exam/questions/short-answer-question";
import { TrueFalseQuestion } from "@/components/exam/questions/true-false-question";
import { WrittenQuestion } from "@/components/exam/questions/written-question";

export function QuestionRenderer({ question, value, onChange, disabled }: QuestionInputProps) {
  switch (question.type) {
    case "single_choice": return <MultipleChoiceQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>;
    case "multiple_choice": return <MultipleAnswerQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>;
    case "true_false": return <TrueFalseQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>;
    case "short_answer": return <ShortAnswerQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>;
    case "essay": return <WrittenQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>;
  }
}
