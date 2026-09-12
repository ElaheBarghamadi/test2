"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, CopyPlus, Eye, FolderInput, FolderPlus, Layers, PencilLine, Plus, Search, Shapes, Tag, Trash2 } from "lucide-react";
import { examsApi } from "@/lib/api/exams";
import { apiErrorMessage } from "@/lib/api/client";
import type { ApiQuestionCategoryDto, ApiQuestionDto, ApiQuestionFolderDto, ApiQuestionTagDto, ApiQuestionType } from "@/lib/api/dtos";
import { toQuestionWritePayload, toTeacherQuestion } from "@/lib/api/mappers";
import { blankQuestion, questionIssues, QuestionFields } from "@/components/teacher/question-builder";
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
export function QuestionBankWorkspace({ initialExamId }: { initialExamId?: string } = {}) {
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
  // A bank opened from an exam (`?exam=`) stays pointed at that exam until the teacher widens it.
  const [examFilter, setExamFilter] = useState(initialExamId ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Question | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertTarget, setInsertTarget] = useState("");
  // The bank used to be read-only: adding a question meant opening an exam and reaching its questions step.
  const [createOpen, setCreateOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState("");
  const [creating, setCreating] = useState(false);
  const [newQuestion, setNewQuestion] = useState<Question>(() => blankQuestion("single_choice", 1));
  const [busyId, setBusyId] = useState<string | null>(null);
  // Bank organisation: folders and categories are the teacher's own vocabulary, so neither is a fixed list.
  const [folders, setFolders] = useState<ApiQuestionFolderDto[]>([]);
  const [folder, setFolder] = useState("");
  const [categories, setCategories] = useState<ApiQuestionCategoryDto[]>([]);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"" | "draft" | "ready">("");
  /**
   * The bank columns the exam-facing `Question` view model does not carry. Kept beside the list rather than
   * folded into every question type, because filing a question has nothing to do with how it is answered.
   */
  const [meta, setMeta] = useState<Record<string, { folder: string | null; folderName: string; category: string; status: "draft" | "ready" }>>({});
  const [newFolderName, setNewFolderName] = useState("");
  const [folderEditor, setFolderEditor] = useState<{ id: string; name: string } | null>(null);
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);
  const [createCategory, setCreateCategory] = useState("");
  const [saveDraft, setSaveDraft] = useState(true);

  const load = useCallback(async () => {
    setListLoading(true); setError(null);
    try {
      const rows: ApiQuestionDto[] = await examsApi.bank({
        search: search.trim() || undefined, type: type || undefined, difficulty: difficulty || undefined, tag: tag || undefined,
        exam: examFilter || undefined, archived: showArchived || undefined,
        folder: folder || undefined, category: category || undefined, status: status || undefined,
      });
      setQuestions(rows.map(toTeacherQuestion));
      setMeta(Object.fromEntries(rows.map((row) => [row.id, {
        folder: row.folder ?? null, folderName: row.folder_name ?? "", category: row.category ?? "", status: row.status ?? "ready",
      }])));
      setQuestions(rows.map(toTeacherQuestion));
      const [tagRows, folderRows, categoryRows] = await Promise.all([examsApi.bankTags(), examsApi.folders(), examsApi.bankCategories()]);
      setTags(tagRows); setFolders(folderRows); setCategories(categoryRows);
    } catch (reason) {
      setError(apiErrorMessage(reason, "دریافت بانک سؤال انجام نشد."));
    } finally {
      setListLoading(false);
    }
  }, [category, difficulty, examFilter, folder, search, showArchived, status, tag, type]);

  useEffect(() => { void hydrate(); }, [hydrate]);
  // Debounced search: typing a phrase should not fire one request per character.
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    if (initialExamId) {
      if (insertTarget !== initialExamId) setInsertTarget(initialExamId);
      if (createTarget !== initialExamId) setCreateTarget(initialExamId);
      return;
    }
    if (!insertTarget && exams[0]) setInsertTarget(exams.find((exam) => exam.status !== "archived")?.id ?? exams[0].id);
    if (!createTarget && exams[0]) setCreateTarget(exams.find((exam) => exam.status === "draft" || exam.status === "scheduled")?.id ?? exams.find((exam) => exam.status !== "archived")?.id ?? exams[0].id);
  }, [createTarget, exams, initialExamId, insertTarget]);

  const selectedQuestions = useMemo(() => questions.filter((question) => selected.includes(question.id)), [questions, selected]);
  const allSelected = questions.length > 0 && selected.length === questions.length;

  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleAll() { setSelected(allSelected ? [] : questions.map((question) => question.id)); }

  async function insert() {
    if (!insertTarget || !selected.length) return;
    setBusyId("insert");
    try {
      const { created, skippedDuplicates } = await examsApi.importQuestions(insertTarget, selected);
      const target = exams.find((exam) => exam.id === insertTarget);
      setSelected([]); setInsertOpen(false);
      await Promise.all([examsApi.bank({ archived: showArchived || undefined }).then((rows) => setQuestions(rows.map(toTeacherQuestion))), hydrate()]);
      // An exact copy of something the destination already holds is reported, not inserted a second time:
      // two identical questions mean a student answers the same statement twice for double the marks.
      toast({
        title: skippedDuplicates
          ? `${toPersianNumber(created.length)} سؤال افزوده شد و ${toPersianNumber(skippedDuplicates)} مورد تکراری رد شد`
          : `${toPersianNumber(created.length)} سؤال به آزمون افزوده شد`,
        description: skippedDuplicates
          ? `آنچه عیناً در «${target?.title ?? "آزمون مقصد"}» بود دوباره کپی نشد.`
          : `کپی‌ها در «${target?.title ?? "آزمون انتخابی"}» ساخته شدند؛ سؤال اصلی تغییر نکرد.`,
        variant: "success",
      });
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

  async function addFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await examsApi.createFolder({ name });
      setNewFolderName("");
      await load();
      toast({ title: "پوشه ساخته شد", description: `«${name}» الان در بانک شماست.`, variant: "success" });
    } catch (reason) {
      toast({ title: "پوشه ساخته نشد", description: apiErrorMessage(reason), variant: "error" });
    }
  }

  async function renameFolder() {
    if (!folderEditor) return;
    try {
      await examsApi.updateFolder(folderEditor.id, { name: folderEditor.name.trim() });
      setFolderEditor(null);
      await load();
      toast({ title: "پوشه تغییر نام کرد", variant: "success" });
    } catch (reason) {
      toast({ title: "تغییر نام انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    }
  }

  async function removeFolder(id: string) {
    try {
      await examsApi.deleteFolder(id);
      if (folder === id) setFolder("");
      await load();
      // Deleting a shelf never deletes what was on it: the questions come back unfiled.
      toast({ title: "پوشه حذف شد", description: "سؤال‌های داخلش حذف نشدند؛ فقط بدون پوشه شدند.", variant: "success" });
    } catch (reason) {
      toast({ title: "حذف پوشه انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    }
  }

  async function file(questionId: string, nextFolder: string | null) {
    setBusyId(questionId);
    try {
      await examsApi.updateQuestionMeta(questionId, { folder: nextFolder });
      await load();
      const label = nextFolder === null ? "بدون پوشه" : folders.find((item) => item.id === nextFolder)?.name ?? "پوشه";
      toast({ title: "جابه‌جا شد", description: `سؤال به «${label}» افزوده شد.`, variant: "success" });
    } catch (reason) {
      toast({ title: "جابه‌جایی انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function markStatus(questionId: string, next: "draft" | "ready") {
    setBusyId(questionId);
    try {
      await examsApi.updateQuestionMeta(questionId, { status: next });
      await load();
      toast({ title: next === "ready" ? "سؤال آماده شد" : "سؤال به پیش‌نویس برگشت", variant: "success" });
    } catch (reason) {
      toast({ title: "ثبت تغییر انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusyId(null);
    }
  }

  /** A shelf row: no destination exam, because the bank is where it lives until it is marked ready. */
  async function saveToBank(keepOpen: boolean) {
    // A draft is allowed to be unfinished — that is the whole point of keeping it in the bank — so only its
    // statement is asked for here. Marking it ready is when the server applies the full rules.
    const issues = saveDraft ? (newQuestion.stem.trim() ? [] : ["متن سؤال را بنویسید."]) : questionIssues(newQuestion);
    if (issues.length) { toast({ title: "سؤال هنوز کامل نیست", description: issues[0], variant: "error" }); return; }
    setCreating(true);
    try {
      const created = await examsApi.createBankQuestion({
        ...toQuestionWritePayload(newQuestion),
        status: saveDraft ? "draft" : "ready",
        ...(createFolderId ? { folder: createFolderId } : {}),
        category: createCategory.trim(),
      });
      await Promise.all([load(), hydrate()]);
      toast({
        title: created.deduplicated ? "این سؤال عیناً در بانک بود" : saveDraft ? "پیش‌نویس ذخیره شد" : "سؤال در بانک ذخیره شد",
        description: created.deduplicated
          ? "نسخهٔ دوم ساخته نشد؛ همان ردیف می‌ماند و می‌توانید ویرایشش کنید."
          : saveDraft
            ? "تا آماده‌شدن، به هیچ آزمونی افزوده نمی‌شود."
            : "آماده است و می‌توانید کپی‌اش را به آزمون بیفزایید.",
        variant: "success",
      });
      setNewQuestion(blankQuestion(newQuestion.type, 1));
      if (!keepOpen) setCreateOpen(false);
    } catch (reason) {
      toast({ title: "ذخیره در بانک انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function create(keepOpen: boolean) {
    const target = exams.find((exam) => exam.id === createTarget);
    if (!target) { toast({ title: "آزمون مقصد را انتخاب کنید", description: "هر سؤال بانک به یک آزمون تعلق دارد؛ بانک از همان‌جا خوانده می‌شود.", variant: "error" }); return; }
    const issues = questionIssues(newQuestion);
    if (issues.length) { toast({ title: "سؤال هنوز کامل نیست", description: issues[0], variant: "error" }); return; }
    setCreating(true);
    try {
      const created = await examsApi.createQuestion(target.id, {
        ...toQuestionWritePayload(newQuestion),
        ...(createFolderId ? { folder: createFolderId } : {}),
        category: createCategory.trim(),
      });
      await Promise.all([load(), hydrate()]);
      toast({
        title: created.deduplicated ? "این سؤال عیناً در همان آزمون بود" : "سؤال به آزمون افزوده شد",
        description: created.deduplicated
          ? `نسخهٔ دوم ساخته نشد؛ همان ردیف در «${target.title}» می‌ماند و از بانک قابل استفاده است.`
          : `در «${target.title}» ذخیره شد و از این پس در بانک قابل جست‌وجو و کپی است.`,
        variant: created.deduplicated ? "success" : "success",
      });
      setNewQuestion(blankQuestion(newQuestion.type, 1));
      if (!keepOpen) setCreateOpen(false);
    } catch (reason) {
      toast({ title: "افزودن سؤال انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setCreating(false);
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
          <select value={status} onChange={(event) => setStatus(event.target.value as "" | "draft" | "ready")} aria-label="فیلتر وضعیت" className="h-11 rounded-xl border bg-background px-2 text-sm font-bold">
            <option value="">همهٔ وضعیت‌ها</option>
            <option value="draft">پیش‌نویس</option>
            <option value="ready">آمادهٔ استفاده</option>
          </select>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4"/>سؤال تازه در بانک</Button>
          <Button type="button" size="sm" variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived(!showArchived)}><Archive className="h-3.5 w-3.5"/>بایگانی‌شده‌ها</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border bg-muted/35 p-2">
          <span className="flex items-center gap-1.5 pl-1 text-[11px] font-black text-muted-foreground"><FolderInput className="h-3.5 w-3.5"/>پوشه‌ها</span>
          <FolderChip active={folder === ""} onClick={() => setFolder("")}>همهٔ سؤال‌ها</FolderChip>
          <FolderChip active={folder === "unfiled"} onClick={() => setFolder("unfiled")}>بدون پوشه</FolderChip>
          {folders.map((item) => (
            <FolderChip key={item.id} active={folder === item.id} count={item.question_count} onClick={() => setFolder(folder === item.id ? "" : item.id)}>
              {folderLabel(item, folders)}
            </FolderChip>
          ))}
          {folderEditor ? (
            <span className="flex items-center gap-1">
              <Input value={folderEditor.name} onChange={(event) => setFolderEditor({ ...folderEditor, name: event.target.value })} className="h-8 w-40 text-xs" placeholder="نام پوشه" aria-label="نام پوشه"/>
              <Button size="sm" variant="ghost" onClick={() => void renameFolder()}>ذخیره</Button>
              <Button size="sm" variant="ghost" onClick={() => setFolderEditor(null)}>انصراف</Button>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} className="h-8 w-40 text-xs" placeholder="پوشهٔ تازه…" aria-label="پوشهٔ تازه"/>
              <Button size="sm" variant="ghost" onClick={() => void addFolder()} disabled={!newFolderName.trim()}><FolderPlus className="h-3.5 w-3.5"/>ساخت</Button>
            </span>
          )}
          {folder && folder !== "unfiled" && (
            <span className="mr-auto flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setFolderEditor({ id: folder, name: folders.find((item) => item.id === folder)?.name ?? "" })}><PencilLine className="h-3.5 w-3.5"/>تغییر نام</Button>
              <Button size="sm" variant="outline" onClick={() => void removeFolder(folder)}><Trash2 className="h-3.5 w-3.5"/>حذف پوشه</Button>
            </span>
          )}
        </div>
        {categories.length ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-black text-muted-foreground">دسته‌بندی</span>
            {categories.map((item) => (
              <button key={item.category} type="button" onClick={() => setCategory(category === item.category ? "" : item.category)}
                className={cn("rounded-full border px-2.5 py-1 font-bold transition-colors", category === item.category ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                {item.category} · {toPersianNumber(item.count)}
              </button>
            ))}
          </div>
        ) : null}
        {examFilter && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[.05] p-2.5 text-[11px] font-bold">
            <span className="text-muted-foreground">در حال دیدن سؤال‌های</span>
            <span className="text-foreground">{exams.find((exam) => exam.id === examFilter)?.title ?? "این آزمون"}</span>
            <button type="button" onClick={() => setExamFilter("")} className="mr-auto rounded-lg border bg-card px-2 py-1 transition-colors hover:bg-muted">نمایش همهٔ سؤال‌ها</button>
          </div>
        )}
        {error ? <EmptyState title="بانک سؤال در دسترس نیست" description={error} action={{ label: "تلاش دوباره", onClick: () => void load() }}/> : listLoading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20"/>)}
          </div> : !questions.length ? <EmptyState title={category || difficulty || folder || search || showArchived || status || tag || type ? "سؤالی با این فیلترها پیدا نشد" : "بانک سؤال هنوز خالی است"} description={search || type || difficulty || tag || showArchived ? "فیلترها را تغییر دهید یا برچسب دیگری انتخاب کنید." : "با ساخت اولین آزمون، سؤال‌ها اینجا قابل جست‌وجو و مصرف مجدد می‌شوند."} icon={Shapes}/> : <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-2 font-bold text-muted-foreground"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border"/>انتخاب همه ({toPersianNumber(selected.length)})</label>
            <Button size="sm" disabled={!selected.length} onClick={() => setInsertOpen(true)}><CopyPlus className="h-4 w-4"/>افزودن {toPersianNumber(selected.length)} سؤال به آزمون</Button>
          </div>
          <div className="space-y-2">{questions.map((question) => <QuestionRow key={question.id} question={question} selected={selected.includes(question.id)} busy={busyId === question.id}
                bank={meta[question.id]} folders={folders} onFile={(next) => void file(question.id, next)} onStatus={(next) => void markStatus(question.id, next)} onToggle={() => toggle(question.id)} onPreview={() => setPreview(question)} onArchive={() => void archive(question)}/>)}</div>
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

    <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="سؤال تازه در بانک" description="می‌توانید سؤال را در خودِ بانک ذخیره کنید تا به هیچ آزمونی تعلق نگیرد دارد؛ از همان آزمون در فهرست بانک دیده می‌شود و بعداً قابل کپی است." size="lg">
      <label className="block text-xs font-bold text-muted-foreground">آزمون مقصد
        <select value={createTarget} onChange={(event) => setCreateTarget(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold">
          {exams.filter((exam) => exam.status !== "archived").map((exam) => <option key={exam.id} value={exam.id}>{exam.title} · {typeLabels[exam.status] ?? exam.status}</option>)}
        </select>
      </label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold text-muted-foreground">پوشه
          <select value={createFolderId ?? ""} onChange={(event) => setCreateFolderId(event.target.value || null)} className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold">
            <option value="">بدون پوشه</option>
            {folders.map((item) => <option key={item.id} value={item.id}>{folderLabel(item, folders)}</option>)}
          </select>
        </label>
        <label className="block text-xs font-bold text-muted-foreground">دسته‌بندی
          <Input value={createCategory} onChange={(event) => setCreateCategory(event.target.value)} className="mt-2 h-11 text-sm" placeholder="مثلاً «سینماتیک»" list="bank-categories"/>
        </label>
      </div>
      <datalist id="bank-categories">{categories.map((item) => <option key={item.category} value={item.category}/>)}</datalist>
      <label className="mt-3 flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <input type="checkbox" checked={saveDraft} onChange={(event) => setSaveDraft(event.target.checked)} className="h-4 w-4 rounded border"/>
        پیش‌نویس بماند تا آماده‌اش کنم
      </label>
      <p className="mt-2 flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-[11px] leading-5 text-muted-foreground"><Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"/>اگر همین سؤال با همین گزینه‌ها، همین کلید و همین نمره در آن آزمون وجود داشته باشد، نسخهٔ دوم ساخته نمی‌شود؛ بانک همان ردیف را نگه می‌دارد تا برگهٔ دانش‌آموز دو بار نمره نگیرد.</p>
      <div className="mt-4"><QuestionFields question={newQuestion} onChange={setNewQuestion}/></div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>بستن</Button>
        <Button variant="outline" onClick={() => void create(false)} disabled={creating}>افزودن به آزمون</Button>
        <Button variant="outline" onClick={() => void saveToBank(true)} disabled={creating}>ذخیره و ادامه دادن</Button>
        <Button data-autofocus onClick={() => void saveToBank(false)} disabled={creating}><Plus className="h-4 w-4"/>ذخیره در بانک</Button>
      </div>
    </Dialog>
  </>;
}

/** Folder names are a flat list with a `parent`, so a child is labelled "parent / child" without a tree walk. */
function folderLabel(folder: ApiQuestionFolderDto, all: ApiQuestionFolderDto[]): string {
  const parent = folder.parent ? all.find((item) => item.id === folder.parent) : undefined;
  return parent ? `${parent.name} / ${folder.name}` : folder.name;
}

function FolderChip({ active, count, onClick, children }: { active: boolean; count?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors", active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
      {children}
      {count !== undefined && <span className="pr-1 text-muted-foreground">{toPersianNumber(count)}</span>}
    </button>
  );
}

function QuestionRow({ question, selected, busy, bank, folders, onFile, onStatus, onToggle, onPreview, onArchive }: {
  question: Question; selected: boolean; busy?: boolean;
  bank?: { folder: string | null; folderName: string; category: string; status: "draft" | "ready" };
  folders: ApiQuestionFolderDto[];
  onFile: (nextFolder: string | null) => void; onStatus: (next: "draft" | "ready") => void;
  onToggle: () => void; onPreview: () => void; onArchive: () => void;
}) {
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
        {bank?.status === "draft" && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-bold text-sky-700 dark:text-sky-400">پیش‌نویس</span>}
        {bank?.category && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary">{bank.category}</span>}
        {bank?.folderName && <span className="rounded-full bg-muted px-2 py-0.5 font-bold">{bank.folderName}</span>}
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
      {bank && (
        <>
          <select value={bank.folder ?? ""} onChange={(event) => onFile(event.target.value || null)} disabled={busy} aria-label="انتقال به پوشه"
            className="h-8 max-w-32 rounded-lg border bg-background px-1.5 text-[11px] font-bold">
            <option value="">بدون پوشه</option>
            {folders.map((item) => <option key={item.id} value={item.id}>{folderLabel(item, folders)}</option>)}
          </select>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onStatus(bank.status === "draft" ? "ready" : "draft")}>
            {bank.status === "draft" ? "آماده‌سازی" : "پیش‌نویس کردن"}
          </Button>
        </>
      )}
      <Button type="button" variant="ghost" size="icon-sm" onClick={onArchive} disabled={busy} aria-label={question.isArchived ? "بازگردانی سؤال به بانک" : "بایگانی سؤال"}>{question.isArchived ? <ArchiveRestore className="h-4 w-4"/> : <Archive className="h-4 w-4"/>}</Button>
    </div>
  </div>;
}

