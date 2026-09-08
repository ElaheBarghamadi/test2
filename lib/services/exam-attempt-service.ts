import { attemptsApi, type ApiAnswerInput } from "@/lib/api/attempts";
import { apiErrorMessage } from "@/lib/api/client";
import type { AnswerValue, Exam, ExamAttempt, Question } from "@/lib/types/domain";

export interface SaveAttemptRequest { attempt: ExamAttempt; exam: Exam; revision: number; signal?: AbortSignal; }
function toAnswerInput(question: Question, value: AnswerValue): ApiAnswerInput {
  if (question.type === "single_choice") return { selected_option_ids: typeof value === "string" ? [value] : [] };
  if (question.type === "multiple_choice") return { selected_option_ids: Array.isArray(value) ? value : [] };
  if (question.type === "true_false") {
    const option = value === true ? question.optionIds?.true : value === false ? question.optionIds?.false : "";
    return { selected_option_ids: option ? [option] : [] };
  }
  return { text: typeof value === "string" ? value : "" };
}

export const examAttemptService = {
  async saveAnswers({ attempt, exam, signal }: SaveAttemptRequest): Promise<void> {
    const questions = new Map(exam.questions.map((question) => [question.id, question]));
    const answerIds = attempt.pendingAnswerQuestionIds || [];
    const flagIds = attempt.pendingFlagQuestionIds || [];
    await Promise.all([
      ...answerIds.map((questionId) => {
        const question = questions.get(questionId); const answer = attempt.answers[questionId];
        if (!question || !answer) return Promise.resolve();
        return attemptsApi.saveAnswer(attempt.id, questionId, toAnswerInput(question, answer.value), signal);
      }),
      ...flagIds.map((questionId) => {
        const answer = attempt.answers[questionId];
        return answer ? attemptsApi.setFlag(attempt.id, questionId, answer.flagged, signal) : Promise.resolve();
      }),
    ]);
  },
  async submitAttempt(attempt: ExamAttempt) {
    if (attempt.connectionStatus === "offline") throw new Error("برای ارسال نهایی، اتصال اینترنت را بررسی و دوباره تلاش کنید.");
    if (!attempt.id || attempt.id.startsWith("local-")) throw new Error("نشست آزمون معتبر نیست. لطفاً دوباره تلاش کنید.");
    try { return await attemptsApi.submit(attempt.id); }
    catch (error) { throw new Error(apiErrorMessage(error, "ارسال آزمون انجام نشد. لطفاً دوباره تلاش کنید.")); }
  },
};
