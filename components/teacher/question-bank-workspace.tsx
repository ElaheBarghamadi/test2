"use client";

import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { TeacherQuestionBuilder } from "@/components/teacher/question-builder";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTeacherExams } from "@/hooks/use-teacher-exams";
import { useToastStore } from "@/lib/state/toast-store";
import type { Exam, ExamDraft, Question } from "@/lib/types/domain";

const cloneQuestions = (questions: Question[]) => questions.map((question) => question.type === "single_choice" || question.type === "multiple_choice" ? { ...question, options: question.options.map((option) => ({ ...option })) } : { ...question });
function toDraft(exam: Exam, questions: Question[]): ExamDraft { return { id: exam.id, title: exam.title, subject: exam.subject, grade: exam.grade, className: exam.className, description: exam.description, instructions: exam.instructions || "", settings: { ...exam.settings }, schedule: { ...exam.schedule }, questions }; }

/** The API has no unscoped question entity: every reusable question is edited in its owning exam. */
export function QuestionBankWorkspace() {
  const { exams, initialized, detailLoadingId, loadExam, saveExam } = useTeacherExams(); const toast = useToastStore((state) => state.push);
  const [examId, setExamId] = useState(""); const [questions, setQuestions] = useState<Question[]>([]); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!examId && exams[0]) setExamId(exams[0].id); }, [examId, exams]);
  useEffect(() => { if (examId) void loadExam(examId); }, [examId, loadExam]);
  const exam = exams.find((item) => item.id === examId);
  useEffect(() => { if (exam && detailLoadingId !== exam.id) setQuestions(cloneQuestions(exam.questions)); }, [detailLoadingId, exam]);
  async function save() { if (!exam) return; setSaving(true); try { await saveExam(toDraft(exam, questions), "draft"); toast({ title: "سؤال‌ها ذخیره شدند", description: "تغییرات از طریق API آزمون ثبت شد.", variant: "success" }); } catch { /* Store displays the API message in the calling workspace. */ } finally { setSaving(false); } }
  if (!initialized) return <Card className="h-72 animate-soft-pulse bg-muted"/>;
  if (!exams.length) return <EmptyState title="آزمونی برای بانک سؤال ندارید" description="ابتدا یک آزمون بسازید؛ سؤال‌ها به‌صورت امن در همان آزمون مدیریت می‌شوند." action={{ label: "ساخت آزمون", onClick: () => window.location.assign("/teacher/exams/create") }}/>;
  return <div className="space-y-5"><Card><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>انتخاب آزمون</CardTitle><CardDescription>هر سؤال به آزمون مالک خود متصل است و از همان‌جا ذخیره می‌شود.</CardDescription></div><label className="text-xs font-bold text-muted-foreground">آزمون<select value={examId} onChange={(event) => setExamId(event.target.value)} className="mr-2 h-10 max-w-64 rounded-xl border bg-background px-3 text-sm font-bold text-foreground"><>{exams.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</></select></label></CardHeader><CardContent>{detailLoadingId === examId ? <div className="h-24 animate-soft-pulse rounded-xl bg-muted"/> : <div className="flex items-center justify-between rounded-xl bg-muted/60 p-4 text-sm"><span>{questions.length} سؤال در این آزمون</span><Button onClick={() => void save()} disabled={saving}>{saving ? "در حال ذخیره…" : "ذخیره تغییرات"}<Save className="h-4 w-4"/></Button></div>}</CardContent></Card>{exam && detailLoadingId !== examId && <TeacherQuestionBuilder questions={questions} onChange={setQuestions}/>}</div>;
}
