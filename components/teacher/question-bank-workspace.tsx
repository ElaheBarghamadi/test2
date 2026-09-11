"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, CopyPlus, Eye, PencilLine, Search, Shapes, Tag } from "lucide-react";
import { examsApi } from "@/lib/api/exams";
import { apiErrorMessage } from "@/lib/api/client";
import type { ApiQuestionTagDto, ApiQuestionType } from "@/lib/api/dtos";
import { toTeacherQuestion } from "@/lib/api/mappers";
import { QuestionRenderer } from "@/components/exam/question-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeacherExams } from "@/hooks/use-teacher-exams";
import { useToastStore } from "@/lib/state/toast-store";
import { cn, toPersianNumber } from "@/lib/utils";
import type { Question, QuestionDifficulty } from "@/lib/types/domain";

const typeLabels: Record<string, string> = {
  single_choice: "چندگزینه‌ای", multiple_choice: "چندپاسخی", true_false: "درست / نادرست", short_answer: "پاسخ کوتاه", essay: "تشریحی",
};
const difficultyLabels: Record<QuestionDifficulty, string> = { easy: "آسان", medium: "متوسط", hard: "سخت" };
const difficultyVariants: Record<QuestionDifficulty, "success" | "warning" | "destructive"> = { easy: "success", medium: "warning", hard: "destructive" };

/**
 * The question bank: search everything the teacher has ever written and put a copy of it into an exam.
 *
 * Reuse is copy-on-insert, never a shared row. A question that is shared between two exams would change a
 * live answer sheet the moment someone edits it for the other one, and would silently re-grade attempts
 * that were already submitted, so the API copies the question and records the source for usage counts.
 */
export function QuestionBankWorkspace() {
  const { exams, loading, initialized, hydrate } = useTeacherExams();
  const toast = useToastStore((state) => state.push);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tags, setTags] = useState<ApiQuestionTagDto[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"" | ApiQuestionType>("");
  const [difficulty, setDifficulty] = useState<"" | QuestionDifficulty>("");
  const [tag, setTag] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Question | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertTarget, setInsertTarget] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListLoading(true); setError(null);
    try {
      const rows = await examsApi.bank({ search: search.trim() || undefined, type: type || undefined, difficulty: difficulty || undefined, tag: tag || undefined, archived: showArchived || undefined });
      setQuestions(rows.map(toTeacherQuestion));
      setTags(await examsApi.bankTags());
    } catch (reason) {
      setError(apiErrorMessage(reason, "دریافت بانک سؤال انجام نشد."));
    } finally {
      setListLoading(false);
    }
  }, [difficulty, search, showArchived, tag, type]);

  useEffect(() => { void hydrate(); }, [hydrate]);
  // Debounced search: typing a phrase should not fire one request per character.
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => { if (!insertTarget && exams[0]) setInsertTarget(exams.find((exam) => exam.status !== "archived")?.id ?? exams[0].id); }, [exams, insertTarget]);

  const selectedQuestions = useMemo(() => questions.filter((question) => selected.includes(question.id)), [questions, selected]);
  const allSelected = questions.length > 0 && selected.length === questions.length;

  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleAll() { setSelected(allSelected ? [] : questions.map((question) => question.id)); }

  async function insert() {
    if (!insertTarget || !selected.length) return;
    setBusyId("insert");
    try {
      const created = await examsApi.importQuestions(insertTarget, selected);
      const target = exams.find((exam) => exam.id === insertTarget);
      setSelected([]); setInsertOpen(false);
      await Promise.all([examsApi.bank({ archived: showArchived || undefined }).then((rows) => setQuestions(rows.map(toTeacherQuestion))), hydrate()]);
      toast({ title: `${toPersianNumber(created.length)} سؤال به آزمون افزوده شد`, description: `کپی‌ها در «${target?.title ?? "آزمون انتخابی"}» ساخته شدند؛ سؤال اصلی تغییر نکرد.`, variant: "success" });
    } catch (reason) {
      toast({ title: "افزودن سؤال‌ها انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function archive(question: Question) {
    setBusyId(question.id);
    try {
      await examsApi.archiveQuestion(question.id, question.isArchived ? "restore" : "archive");
      setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, isArchived: !item.isArchived } : item));
      toast({ title: question.isArchived ? "سؤال به بانک بازگشت" : "سؤال از بانک بایگانی شد", description: "متن آزمون‌هایی که از این سؤال استفاده کرده‌اند دست‌نخورده است.", variant: "success" });
    } catch (reason) {
      toast({ title: "عملیات انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !initialized && listLoading) return <Card className="h-72 animate-soft-pulse bg-muted"/>;

  return <>
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><CardTitle>بانک سؤال</CardTitle><CardDescription>{toPersianNumber(questions.length)} سؤال نمایش داده می‌شود؛ با انتخاب، چندتا را یک‌جا به یک آزمون کپی کنید.</CardDescription></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="جست‌وجو در متن سؤال و درس"/>
          </div>
          <select value={type} onChange={(event) => setType(event.target.value as "" | ApiQuestionType)} aria-label="فیلتر نوع سؤال" className="h-11 rounded-xl border bg-background px-2 text-sm font-bold">
            <option value="">همهٔ نوع‌ها</option>
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value === "single_choice" ? "multiple_choice" : value === "multiple_choice" ? "multiple_answer" : value === "essay" ? "written" : value}>{label}</option>)}
          </select>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as "" | QuestionDifficulty)} aria-label="فیلتر سطح سختی" className="h-11 rounded-xl border bg-background px-2 text-sm font-bold">
            <option value="">همهٔ سطح‌ها</option>
            <option value="easy">آسان</option><option value="medium">متوسط</option><option value="hard">سخت</option>
          </select>
          <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="فیلتر برچسب" className="h-11 rounded-xl border bg-background px-2 text-sm font-bold">
            <option value="">همهٔ برچسب‌ها</option>
            {tags.map((item) => <option key={item.id} value={item.name}>{item.name}{item.count !== undefined ? ` (${toPersianNumber(item.count)})` : ""}</option>)}
          </select>
          <Button type="button" size="sm" variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived(!showArchived)}><Archive className="h-3.5 w-3.5"/>بایگانی‌شده‌ها</Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <EmptyState title="بانک سؤال در دسترس نیست" description={error} action={{ label: "تلاش دوباره", onClick: () => void load() }}/> : listLoading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20"/>)}
          </div> : !questions.length ? <EmptyState title={search || type || difficulty || tag || showArchived ? "سؤالی با این فیلترها پیدا نشد" : "بانک سؤال هنوز خالی است"} description={search || type || difficulty || tag || showArchived ? "فیلترها را تغییر دهید یا برچسب دیگری انتخاب کنید." : "با ساخت اولین آزمون، سؤال‌ها اینجا قابل جست‌وجو و مصرف مجدد می‌شوند."} icon={Shapes}/> : <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-2 font-bold text-muted-foreground"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border"/>انتخاب همه ({toPersianNumber(selected.length)})</label>
            <Button size="sm" disabled={!selected.length} onClick={() => setInsertOpen(true)}><CopyPlus className="h-4 w-4"/>افزودن {toPersianNumber(selected.length)} سؤال به آزمون</Button>
          </div>
          <div className="space-y-2">{questions.map((question) => <QuestionRow key={question.id} question={question} selected={selected.includes(question.id)} busy={busyId === question.id} onToggle={() => toggle(question.id)} onPreview={() => setPreview(question)} onArchive={() => void archive(question)}/>)}</div>
        </>}
      </CardContent>
    </Card>

    <Dialog open={insertOpen} onClose={() => busyId !== "insert" && setInsertOpen(false)} title="افزودن به کدام آزمون؟" description={`${toPersianNumber(selected.length)} سؤال به‌صورت کپی در انتهای آزمون انتخابی قرار می‌گیرد.`} size="sm">
      <label className="block text-xs font-bold text-muted-foreground">آزمون مقصد
        <select value={insertTarget} onChange={(event) => setInsertTarget(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold">
          {exams.filter((exam) => exam.status !== "archived").map((exam) => <option key={exam.id} value={exam.id}>{exam.title} · {typeLabels[exam.status] ?? exam.status}</option>)}
        </select>
      </label>
      <p className="mt-3 rounded-xl bg-muted/60 p-3 text-[11px] leading-5 text-muted-foreground">کپی ساختن عمداً به‌جای اشتراک‌گذاری است: ویرایش بعدی این آزمون، پاسخ‌های ثبت‌شدهٔ آزمون دیگر را تغییر نمی‌دهد.</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => setInsertOpen(false)} disabled={busyId === "insert"}>انصراف</Button>
        <Button data-autofocus onClick={() => void insert()} disabled={busyId === "insert" || !insertTarget}>{busyId === "insert" ? "در حال افزودن…" : "افزودن کپی‌ها"}</Button>
      </div>
    </Dialog>

    <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} title="پیش‌نمایش سؤال" description={preview ? `${typeLabels[preview.type]} · ${toPersianNumber(preview.points)} نمره` : undefined} size="md">
      {preview && <div className="rounded-2xl border bg-surface p-4"><QuestionRenderer question={preview} value={null} onChange={() => undefined} disabled/></div>}
      <div className="mt-4 flex flex-wrap gap-2">{(preview?.tags ?? []).map((item) => <Badge key={item} variant="default"><Tag className="ml-1 h-3 w-3"/>{item}</Badge>)}{preview && <Badge variant={difficultyVariants[preview.difficulty ?? "medium"]}>{difficultyLabels[preview.difficulty ?? "medium"]}</Badge>}</div>
      <div className="mt-4 text-[11px] leading-5 text-muted-foreground">{preview && <p>این سؤال در {toPersianNumber(preview.answeredCount ?? 0)} پاسخ ثبت‌شده و {toPersianNumber(preview.usageCount ?? 0)} کپی استفاده شده است. برای ویرایش، آن را از آزمون مالکش باز کنید.</p>}</div>
      <div className="mt-5 flex justify-end"><Button onClick={() => setPreview(null)}>بستن</Button></div>
    </Dialog>
  </>;
}

function QuestionRow({ question, selected, busy, onToggle, onPreview, onArchive }: { question: Question; selected: boolean; busy?: boolean; onToggle: () => void; onPreview: () => void; onArchive: () => void }) {
  const examState = question.isArchived ? "بایگانی‌شده" : undefined;
  return <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3 transition-colors", selected && "border-primary/45 bg-primary/[.04]")}>
    <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`انتخاب سؤال ${question.order}`} className="h-4 w-4 rounded border"/>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-bold">{question.stem || "بدون متن"}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>{typeLabels[question.type]}</span><span>·</span>
        <span>{toPersianNumber(question.points)} نمره</span><span>·</span>
        <span>{difficultyLabels[question.difficulty ?? "medium"]}</span>
        {(question.tags ?? []).slice(0, 3).map((item) => <span key={item} className="rounded-full bg-muted px-2 py-0.5 font-bold">{item}</span>)}
        {examState && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-bold text-amber-700 dark:text-amber-400">{examState}</span>}
      </p>
    </div>
    <div className="hidden min-w-40 text-[11px] font-bold text-muted-foreground sm:block">
      <p className="truncate">{question.examTitle || "آزمون نامشخص"}</p>
      <p className="mt-0.5 font-normal">{toPersianNumber(question.answeredCount ?? 0)} پاسخ · {toPersianNumber(question.usageCount ?? 0)} کپی</p>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" variant="ghost" size="icon-sm" onClick={onPreview} aria-label="پیش‌نمایش سؤال"><Eye className="h-4 w-4"/></Button>
      {question.examId && <Button asChild variant="ghost" size="icon-sm" aria-label="ویرایش سؤال در آزمون مالک"><Link href={`/teacher/exams/${question.examId}/edit`}><PencilLine className="h-4 w-4"/></Link></Button>}
      <Button type="button" variant="ghost" size="icon-sm" onClick={onArchive} disabled={busy} aria-label={question.isArchived ? "بازگردانی سؤال به بانک" : "بایگانی سؤال"}>{question.isArchived ? <ArchiveRestore className="h-4 w-4"/> : <Archive className="h-4 w-4"/>}</Button>
    </div>
  </div>;
}

