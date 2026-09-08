import type { AnswerValue, Question } from "@/lib/types/domain";

export interface QuestionInputProps<TQuestion extends Question = Question> {
  question: TQuestion;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  disabled?: boolean;
}
