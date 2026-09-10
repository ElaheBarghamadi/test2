import { examsApi } from "@/lib/api/exams";
import { toExamWritePayload, toQuestionWritePayload, toTeacherExam } from "@/lib/api/mappers";
import type { Exam, ExamDraft } from "@/lib/types/domain";

async function synchronizeQuestions(examId: string, draft: ExamDraft, existing: Exam) {
  const currentIds = new Set(existing.questions.map((question) => question.id));
  const retainedIds = new Set<string>();
  const orderedIds: string[] = [];

  // The Django API deliberately keeps parent metadata and question mutations separate.
  // Reconcile through those explicit endpoints instead of sending a fake monolithic payload.
  for (const question of draft.questions) {
    const payload = toQuestionWritePayload(question);
    if (currentIds.has(question.id)) {
      await examsApi.updateQuestion(question.id, payload);
      retainedIds.add(question.id); orderedIds.push(question.id);
    } else {
      const created = await examsApi.createQuestion(examId, payload);
      orderedIds.push(created.id);
    }
  }
  await Promise.all(existing.questions.filter((question) => !retainedIds.has(question.id)).map((question) => examsApi.deleteQuestion(question.id)));
  if (orderedIds.length) await examsApi.reorderQuestions(examId, orderedIds);
}

export const teacherExamService = {
  async getExams(): Promise<Exam[]> { return (await examsApi.list()).map(toTeacherExam); },
  async getExam(examId: string): Promise<Exam> { return toTeacherExam(await examsApi.detail(examId)); },
  async createExam(draft: ExamDraft, publish: boolean): Promise<Exam> {
    const created = await examsApi.create(toExamWritePayload(draft));
    const shell = toTeacherExam(created);
    await synchronizeQuestions(created.id, draft, shell);
    if (publish) await examsApi.publish(created.id);
    return this.getExam(created.id);
  },
  async updateExam(examId: string, draft: ExamDraft, publish: boolean): Promise<Exam> {
    const current = await this.getExam(examId);
    await examsApi.update(examId, toExamWritePayload(draft));
    await synchronizeQuestions(examId, draft, current);
    if (publish && ["draft", "scheduled"].includes(current.status)) await examsApi.publish(examId);
    return this.getExam(examId);
  },
  async duplicateExam(examId: string): Promise<Exam> { return toTeacherExam(await examsApi.duplicate(examId)); },
  async startExam(examId: string): Promise<Exam> { return toTeacherExam(await examsApi.start(examId)); },
  async extendExam(examId: string, extraMinutes: number): Promise<Exam> { return toTeacherExam(await examsApi.extend(examId, extraMinutes)); },
  async completeExam(examId: string): Promise<Exam> { return toTeacherExam(await examsApi.complete(examId)); },
  async archiveExam(examId: string): Promise<Exam> { return toTeacherExam(await examsApi.archive(examId)); },
  async restoreExam(examId: string): Promise<Exam> { return toTeacherExam(await examsApi.restore(examId)); },
};
