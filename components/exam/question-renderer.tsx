import type { QuestionInputProps } from "@/components/exam/questions/types";
import { MultipleChoiceQuestion } from "@/components/exam/questions/multiple-choice-question";
import { MultipleAnswerQuestion } from "@/components/exam/questions/multiple-answer-question";
import { ShortAnswerQuestion } from "@/components/exam/questions/short-answer-question";
import { TrueFalseQuestion } from "@/components/exam/questions/true-false-question";
import { WrittenQuestion } from "@/components/exam/questions/written-question";
import { MatchingQuestion } from "@/components/exam/questions/matching-question";
import { PrivateMedia } from "@/components/shared/private-media";

export function QuestionRenderer({ question, value, onChange, disabled }: QuestionInputProps) {
  let input;
  switch (question.type) {
    case "single_choice": input = <MultipleChoiceQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>; break;
    case "multiple_choice": input = <MultipleAnswerQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>; break;
    case "true_false": input = <TrueFalseQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>; break;
    case "matching": input = <MatchingQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>; break;
    case "short_answer": input = <ShortAnswerQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>; break;
    case "essay": input = <WrittenQuestion question={question} value={value} onChange={onChange} disabled={disabled}/>; break;
  }
  return <div className="space-y-5">
    {question.media?.map((media) => <PrivateMedia key={media.id} url={media.url} file={media.file} kind={media.kind} alt={media.altText || "رسانهٔ صورت سؤال"} className={media.kind === "image" ? "mx-auto max-h-[520px]" : ""}/>)}
    {input}
  </div>;
}
