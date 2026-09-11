"use client";

import { Check, ChevronDown, ChevronUp, CircleCheck, Copy, Eye, GripVertical, ListPlus, Plus, Save, Trash2, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Question, QuestionOption, QuestionType } from "@/lib/types/domain";
import { QuestionRenderer } from "@/components/exam/question-renderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, toPersianNumber } from "@/lib/utils";

const questionTypes: Array<{ type: QuestionType; label: string; description: string }> = [
  { type: "single_choice", label: "چندگزینه‌ای", description: "یک پاسخ درست" },
  { type: "multiple_choice", label: "چندپاسخی", description: "چند پاسخ درست" },
  { type: "true_false", label: "درست / نادرست", description: "یک انتخاب دوگانه" },
  { type: "short_answer", label: "پاسخ کوتاه", description: "پاسخ متنی کوتاه" },
  { type: "essay", label: "تشریحی", description: "پاسخ نوشتاری" },
];
const questionTypeLabel = Object.fromEntries(questionTypes.map((item) => [item.type, item.label])) as Record<QuestionType, string>;

/** Server-side publish gate mirrored here so the teacher sees the problem before saving. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

const newOptionId = () => `option-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const optionIds = (options: QuestionOption[], correctIds: string[]) => options.map((option) => ({ ...option, isCorrect: correctIds.includes(option.id) }));

function cloneQuestion(question: Question, id = question.id): Question {
  if (question.type === "single_choice") return { ...question, id, options: question.options.map((option, index) => ({ ...option, id: `${id}-option-${index}`, value: `${id}-option-${index}` })), correctOptionId: question.options[0] ? `${id}-option-0` : undefined };
  if (question.type === "multiple_choice") return { ...question, id, options: question.options.map((option, index) => ({ ...option, id: `${id}-option-${index}`, value: `${id}-option-${index}` })), correctOptionIds: question.options.map((_, index) => `${id}-option-${index}`).slice(0, 1) };
  return { ...question, id };
}

export function blankQuestion(type: QuestionType, order: number): Question {
  const base = { id: `question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, order, stem: "", points: 1, required: true, difficulty: "medium" as const, tags: [] as string[] };
  if (type === "single_choice") return { ...base, type, options: createOptions(), correctOptionId: "" };
  if (type === "multiple_choice") return { ...base, type, options: createOptions(), correctOptionIds: [] };
  if (type === "true_false") return { ...base, type, correctAnswer: true };
  if (type === "short_answer") return { ...base, type, expectedAnswers: [], caseSensitive: false, placeholder: "پاسخ کوتاه خود را بنویسید...", maxLength: 150 };
  return { ...base, type, placeholder: "پاسخ تشریحی خود را بنویسید...", maxLength: 1200, gradingNote: "" };
}
function createOptions(): QuestionOption[] { return [{ id: "option-1", label: "", value: "option-1" }, { id: "option-2", label: "", value: "option-2" }]; }

/** Difficulty and tags are bank metadata: they make a question findable, never gradable. */
function BankFields({ question, onChange }: { question: Question; onChange: (question: Question) => void }) {
  const [draftTag, setDraftTag] = useState("");
  const tags = question.tags ?? [];
  function addTag(value: string) {
    const name = value.trim().replace(/,$/, "").trim();
    if (!name) return;
    if (tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) { setDraftTag(""); return; }
    onChange({ ...question, tags: [...tags, name.slice(0, 60)] });
    setDraftTag("");
  }
  function removeTag(name: string) { onChange({ ...question, tags: tags.filter((tag) => tag !== name) }); }
  return <section className="mt-5 rounded-2xl border bg-muted/35 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-black">برچسب و سطح سؤال</h3>
        <p className="mt-1 text-xs text-muted-foreground">فقط برای بانک سؤال است؛ بر نمرهٔ دانش‌آموز تأثیری ندارد.</p>
      </div>
      <label className="text-xs font-bold text-muted-foreground">سطح
        <select value={question.difficulty ?? "medium"} onChange={(event) => onChange({ ...question, difficulty: event.target.value as Question["difficulty"] })} className="mr-2 h-9 rounded-xl border bg-background px-2 text-sm font-bold text-foreground">
          <option value="easy">آسان</option><option value="medium">متوسط</option><option value="hard">سخت</option>
        </select>
      </label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {tags.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
        {tag}
        <button type="button" onClick={() => removeTag(tag)} aria-label={`حذف برچسب ${tag}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/20"><X className="h-2.5 w-2.5"/></button>
      </span>)}
      <input value={draftTag} onChange={(event) => setDraftTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTag(draftTag); } }} onBlur={() => addTag(draftTag)} placeholder="برچسب جدید و Enter" aria-label="افزودن برچسب" className="h-9 min-w-40 flex-1 rounded-xl border bg-background px-3 text-sm"/>
    </div>
    {typeof question.usageCount === "number" && question.usageCount > 0 && <p className="mt-2 text-[11px] font-bold text-muted-foreground">از این سؤال در {toPersianNumber(question.usageCount)} آزمون دیگر کپی شده است.</p>}
  </section>;
}

/** Everything Django's publish gate refuses, phrased for the teacher. One source for list + editor. */
export function questionIssues(question: Question): string[] {
  const issues: string[] = [];
  if (!question.stem.trim()) issues.push("متن سؤال را وارد کنید.");
  if (question.points <= 0) issues.push("نمرهٔ سؤال باید بزرگ‌تر از صفر باشد.");
  const labelled = (options: QuestionOption[]) => options.filter((option) => option.label.trim()).length;
  if (question.type === "single_choice") {
    if (question.options.length < MIN_OPTIONS) issues.push(`حداقل ${toPersianNumber(MIN_OPTIONS)} گزینه لازم است.`);
    if (labelled(question.options) !== question.options.length) issues.push("متن همهٔ گزینه‌ها را کامل کنید.");
    if (question.options.length >= MIN_OPTIONS && labelled(question.options) === question.options.length && !question.correctOptionId) issues.push("پاسخ درست را علامت بزنید.");
  }
  if (question.type === "multiple_choice") {
    if (question.options.length < MIN_OPTIONS) issues.push(`حداقل ${toPersianNumber(MIN_OPTIONS)} گزینه لازم است.`);
    if (labelled(question.options) !== question.options.length) issues.push("متن همهٔ گزینه‌ها را کامل کنید.");
    if (question.options.length >= MIN_OPTIONS && labelled(question.options) === question.options.length && !question.correctOptionIds?.length) issues.push("حداقل یک پاسخ درست را علامت بزنید.");
  }
  if (question.type === "short_answer" && (question.expectedAnswers?.length ?? 0) > 0) {
    if (question.expectedAnswers?.some((answer) => !answer.trim())) issues.push("پاسخ‌های قابل‌قبول را خالی نگذارید.");
    if ((question.maxLength ?? 0) < 1) issues.push("حداکثر کاراکتر پاسخ کوتاه باید حداقل ۱ باشد.");
  }
  return issues;
}
export function questionIsComplete(question: Question) { return questionIssues(question).length === 0; }

export function TeacherQuestionBuilder({ questions, onChange, className }: { questions: Question[]; onChange: (questions: Question[]) => void; className?: string }) {
  const [selectedId, setSelectedId] = useState(questions[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = useMemo(() => questions.find((question) => question.id === selectedId) ?? questions[0], [questions, selectedId]);
  const ordered = questions.map((question, index) => ({ ...question, order: index + 1 }));
  const incomplete = useMemo(() => questions.filter((question) => !questionIsComplete(question)).length, [questions]);
  const replace = (next: Question[]) => onChange(next.map((question, index) => ({ ...question, order: index + 1 })));
  function updateSelected(next: Question) { if (!selected) return; replace(questions.map((question) => question.id === selected.id ? next : question)); }
  function addQuestion(type: QuestionType) { const next = blankQuestion(type, questions.length + 1); replace([...questions, next]); setSelectedId(next.id); setAdding(false); }
  function duplicateSelected() { if (!selected) return; const copy = cloneQuestion(selected, `question-${Date.now().toString(36)}`); const titledCopy = { ...copy, stem: selected.stem ? `${selected.stem} (کپی)` : "" } as Question; replace([...questions, titledCopy]); setSelectedId(titledCopy.id); }
  function deleteSelected() { if (!selected) return; const remaining = questions.filter((question) => question.id !== selected.id); replace(remaining); setSelectedId(remaining[0]?.id ?? ""); setDeleteOpen(false); }
  function moveSelected(delta: -1 | 1) { if (!selected) return; const index = questions.findIndex((question) => question.id === selected.id); const target = index + delta; if (target < 0 || target >= questions.length) return; const next = [...questions]; [next[index], next[target]] = [next[target], next[index]]; replace(next); }

  return <div className={cn("grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]", className)}>
    <Card className="overflow-hidden xl:max-h-[720px]">
      <CardHeader className="flex-row items-center justify-between gap-3"><div><CardTitle>سؤال‌های آزمون</CardTitle><CardDescription>{toPersianNumber(questions.length)} سؤال · {toPersianNumber(questions.reduce((sum, question) => sum + question.points, 0))} نمره{incomplete ? ` · ${toPersianNumber(incomplete)} سؤال نیازمند تکمیل` : ""}</CardDescription></div><Button type="button" size="icon-sm" onClick={() => setAdding(!adding)} aria-label="افزودن سؤال"><Plus className="h-4 w-4"/></Button></CardHeader>
      <CardContent className="relative"><div className="space-y-2 overflow-y-auto xl:max-h-[560px]">{adding && <QuestionTypePicker onPick={addQuestion}/>} {questions.length === 0 ? <div className="rounded-2xl border border-dashed bg-muted/30 p-6 text-center"><ListPlus className="mx-auto h-6 w-6 text-primary"/><p className="mt-3 text-sm font-black">اولین سؤال را اضافه کنید</p><p className="mt-1 text-xs leading-5 text-muted-foreground">از دکمهٔ بالا نوع سؤال را انتخاب کنید.</p></div> : ordered.map((question) => <button type="button" onClick={() => setSelectedId(question.id)} key={question.id} className={cn("flex w-full items-center gap-2.5 rounded-xl border p-3 text-right transition-all", selected?.id === question.id ? "border-primary bg-primary/[.06] shadow-sm" : "border-transparent bg-muted/55 hover:border-border hover:bg-card")}><GripVertical className="h-4 w-4 shrink-0 text-muted-foreground"/><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black", selected?.id === question.id ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}>{toPersianNumber(question.order)}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-extrabold">{question.stem || "بدون متن سؤال"}</span><span className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">{questionTypeLabel[question.type]} · {toPersianNumber(question.points)} نمره</span></span>{questionIsComplete(question) ? <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="آماده"/> : <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/10 px-1.5 py-1 text-[9px] font-black text-amber-700 dark:text-amber-400">{toPersianNumber(questionIssues(question).length)} مورد</span>}</button>)}</div></CardContent>
    </Card>
    {selected ? <QuestionEditor question={selected} onChange={updateSelected} onPreview={() => setPreviewOpen(true)} onDuplicate={duplicateSelected} onDelete={() => setDeleteOpen(true)} onMove={moveSelected} first={questions[0]?.id === selected.id} last={questions[questions.length - 1]?.id === selected.id}/> : <QuestionEmpty onAdd={() => setAdding(true)}/>}
    <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title="پیش‌نمایش دانش‌آموز" description="این بخش نحوهٔ نمایش سؤال در آزمون را نشان می‌دهد." size="md"><div className="rounded-2xl border bg-surface p-4"><QuestionRenderer question={selected ?? blankQuestion("single_choice", 1)} value={null} onChange={() => undefined} disabled/></div><div className="mt-5 flex justify-end"><Button onClick={() => setPreviewOpen(false)}>بستن پیش‌نمایش</Button></div></Dialog>
    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="حذف سؤال؟" description={selected ? `«${selected.stem || "بدون عنوان"}» از این آزمون حذف می‌شود.` : undefined} size="sm"><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setDeleteOpen(false)}>انصراف</Button><Button variant="destructive" data-autofocus onClick={deleteSelected}><Trash2 className="h-4 w-4"/>حذف سؤال</Button></div></Dialog>
  </div>;
}

function QuestionTypePicker({ onPick }: { onPick: (type: QuestionType) => void }) { return <div className="rounded-2xl border border-primary/20 bg-primary/[.04] p-3"><p className="mb-2 text-[11px] font-black text-primary">انتخاب نوع سؤال</p><div className="grid gap-1">{questionTypes.map((item) => <button type="button" key={item.type} onClick={() => onPick(item.type)} className="rounded-xl px-2 py-2 text-right hover:bg-card"><span className="text-xs font-bold">{item.label}</span><span className="mr-1 text-[10px] text-muted-foreground">{item.description}</span></button>)}</div></div>; }
function QuestionEmpty({ onAdd }: { onAdd: () => void }) { return <Card className="grid min-h-80 place-items-center border-dashed bg-muted/20"><div className="p-6 text-center"><ListPlus className="mx-auto h-8 w-8 text-primary"/><h3 className="mt-4 font-black">هنوز سؤالی انتخاب نشده</h3><p className="mt-2 text-sm text-muted-foreground">یک سؤال جدید بسازید تا ویرایش آن را شروع کنید.</p><Button className="mt-5" onClick={onAdd}>افزودن سؤال</Button></div></Card>; }

function QuestionEditor({ question, onChange, onPreview, onDuplicate, onDelete, onMove, first, last }: { question: Question; onChange: (question: Question) => void; onPreview: () => void; onDuplicate: () => void; onDelete: () => void; onMove: (direction: -1 | 1) => void; first: boolean; last: boolean }) {
  const issues = questionIssues(question);
  function changeType(type: QuestionType) { if (type === question.type) return; const fresh = blankQuestion(type, question.order); onChange({ ...fresh, id: question.id, stem: question.stem, points: question.points, helpText: question.helpText, explanation: question.explanation }); }
  return <Card className="overflow-hidden">
    <CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="section-label">ویرایش سؤال {toPersianNumber(question.order)}</p><CardTitle className="mt-1">{questionTypeLabel[question.type]}</CardTitle></div><div className="flex gap-1"><Button type="button" variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={first} aria-label="انتقال سؤال به بالا"><ChevronUp className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={last} aria-label="انتقال سؤال به پایین"><ChevronDown className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" onClick={onPreview} aria-label="پیش‌نمایش سؤال"><Eye className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label="تکثیر سؤال"><Copy className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" className="text-destructive" onClick={onDelete} aria-label="حذف سؤال"><Trash2 className="h-4 w-4"/></Button></div></div></CardHeader>
    <CardContent className="p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-[1fr_130px]"><label className="block text-sm font-bold">نوع سؤال<select value={question.type} onChange={(event) => changeType(event.target.value as QuestionType)} className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm">{questionTypes.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label><label className="block text-sm font-bold">نمره<Input className="mt-2" type="number" min="0" max="100" step="0.25" value={question.points} onChange={(event) => onChange({ ...question, points: Math.max(0, Number(event.target.value)) })}/></label></div>
      <label className="mt-5 block text-sm font-bold">متن سؤال<Textarea className="mt-2 min-h-28" value={question.stem} onChange={(event) => onChange({ ...question, stem: event.target.value })} placeholder="متن روشن و کامل سؤال را وارد کنید..." maxLength={1000}/><span className="mt-1 block text-left text-[10px] font-bold text-muted-foreground">{toPersianNumber(question.stem.length)} / ۱۰۰۰</span></label>
      <label className="mt-4 block text-sm font-bold">راهنمای همین سؤال (اختیاری)<Input className="mt-2" value={question.helpText ?? ""} onChange={(event) => onChange({ ...question, helpText: event.target.value })} placeholder="مثلاً از واحد میلی‌متر استفاده کنید."/></label>
      {question.type === "single_choice" && <SingleChoiceEditor question={question} onChange={onChange}/>}
      {question.type === "multiple_choice" && <MultipleAnswerEditor question={question} onChange={onChange}/>}
      {question.type === "true_false" && <TrueFalseEditor question={question} onChange={onChange}/>}
      {question.type === "short_answer" && <ShortAnswerEditor question={question} onChange={onChange}/>}
      {question.type === "essay" && <WrittenEditor question={question} onChange={onChange}/>}
      <BankFields question={question} onChange={onChange}/>
      <label className="mt-5 block text-sm font-bold">توضیح یا بازخورد (اختیاری)<Textarea className="mt-2 min-h-20" value={question.explanation ?? ""} onChange={(event) => onChange({ ...question, explanation: event.target.value })} placeholder="توضیحی که بعداً می‌تواند به دانش‌آموز نمایش داده شود..."/></label>
      <div className="mt-5 flex items-center justify-between border-t pt-5"><span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">{issues.length === 0 ? <><CircleCheck className="h-4 w-4 text-emerald-600"/>آماده برای انتشار</> : <><TriangleAlert className="h-4 w-4 text-amber-600"/>نیازمند تکمیل</>}</span><Badge variant="neutral">به‌صورت خودکار ذخیره می‌شود</Badge></div>
      {issues.length > 0 && <ul className="mt-3 space-y-1 rounded-2xl border border-amber-500/25 bg-amber-500/[.07] p-3 text-xs leading-6 text-amber-900 dark:text-amber-300">{issues.map((issue) => <li key={issue} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"/>{issue}</li>)}</ul>}
    </CardContent>
  </Card>;
}

/** Full option CRUD: reorder, duplicate, remove, and mark the key — all mirrored onto the write payload. */
function OptionsEditor({ options, correctIds, multiple, onChange, locked }: { options: QuestionOption[]; correctIds: string[]; multiple: boolean; onChange: (options: QuestionOption[], correctIds: string[]) => void; locked?: boolean }) {
  const updateLabel = (index: number, label: string) => onChange(options.map((option, optionIndex) => optionIndex === index ? { ...option, label } : option), correctIds);
  const setCorrect = (id: string) => { const nextIds = multiple ? (correctIds.includes(id) ? correctIds.filter((item) => item !== id) : [...correctIds, id]) : [id]; onChange(optionIds(options, nextIds), nextIds); };
  const addOption = () => { if (options.length >= MAX_OPTIONS) return; const id = newOptionId(); onChange([...options, { id, label: "", value: id }], correctIds); };
  // A copy is an empty, unmarked row: inheriting `isCorrect` would put two keys on one question.
  const duplicateOption = (index: number) => { if (options.length >= MAX_OPTIONS) return; const id = newOptionId(); const next = [...options]; next.splice(index + 1, 0, { ...options[index], id, label: "", value: id, isCorrect: false }); onChange(next, correctIds); };
  const deleteOption = (id: string) => { if (options.length <= MIN_OPTIONS) return; onChange(options.filter((option) => option.id !== id), correctIds.filter((item) => item !== id)); };
  const moveOption = (index: number, delta: -1 | 1) => { const target = index + delta; if (target < 0 || target >= options.length) return; const next = [...options]; [next[index], next[target]] = [next[target], next[index]]; onChange(next, correctIds); };
  const empty = options.filter((option) => !option.label.trim()).length;

  return <section className="mt-5">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-black">گزینه‌ها</h3><p className="mt-1 text-xs text-muted-foreground">{multiple ? "یک یا چند پاسخ درست را علامت بزنید." : "یک پاسخ درست را انتخاب کنید."}{locked ? " گزینه‌های این سؤال ثابت‌اند." : ""}</p></div><Button type="button" variant="outline" size="sm" onClick={addOption} disabled={locked || options.length >= MAX_OPTIONS}><Plus className="h-3.5 w-3.5"/>گزینه</Button></div>
    <div className="mt-3 space-y-2">{options.map((option, index) => { const checked = correctIds.includes(option.id); return <div className={cn("flex items-center gap-1.5 rounded-xl border p-2 transition-colors", checked && "border-emerald-500/35 bg-emerald-500/[.04]", !option.label.trim() && !checked && "border-amber-500/30")} key={option.id}>
      {!locked && <button type="button" role={multiple ? "checkbox" : "radio"} aria-checked={checked} onClick={() => setCorrect(option.id)} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-xs", checked ? "border-emerald-600 bg-emerald-600 text-white" : "bg-card text-muted-foreground")} aria-label={`علامت‌گذاری گزینه ${index + 1} به‌عنوان پاسخ درست`}>{checked ? <Check className="h-4 w-4"/> : toPersianNumber(index + 1)}</button>}
      {locked && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-black text-muted-foreground">{toPersianNumber(index + 1)}</span>}
      <Input value={option.label} onChange={(event) => updateLabel(index, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOption(); } }} placeholder={`گزینهٔ ${toPersianNumber(index + 1)}`} aria-label={`متن گزینه ${index + 1}`}/>
      {locked ? null : <div className="flex shrink-0 items-center">
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveOption(index, -1)} disabled={index === 0} aria-label={`انتقال گزینه ${index + 1} به بالا`}><ChevronUp className="h-4 w-4"/></Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveOption(index, 1)} disabled={index === options.length - 1} aria-label={`انتقال گزینه ${index + 1} به پایین`}><ChevronDown className="h-4 w-4"/></Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => duplicateOption(index)} disabled={options.length >= MAX_OPTIONS} aria-label={`تکثیر گزینه ${index + 1}`}><Copy className="h-4 w-4"/></Button>
        <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => deleteOption(option.id)} disabled={options.length <= MIN_OPTIONS} aria-label={`حذف گزینه ${index + 1}`}><Trash2 className="h-4 w-4"/></Button>
      </div>}
    </div>; })}</div>
    <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-muted-foreground"><span>برای گزینهٔ بعدی Enter بزنید.</span><span>{toPersianNumber(options.length)} از {toPersianNumber(MAX_OPTIONS)}{empty ? ` · ${toPersianNumber(empty)} گزینهٔ خالی` : ""}</span></div>
  </section>;
}

function SingleChoiceEditor({ question, onChange }: { question: Extract<Question, { type: "single_choice" }>; onChange: (question: Question) => void }) { return <OptionsEditor options={question.options} correctIds={question.correctOptionId ? [question.correctOptionId] : []} multiple={false} onChange={(options, correctIds) => onChange({ ...question, options: optionIds(options, correctIds), correctOptionId: correctIds[0] ?? "" })}/>; }
function MultipleAnswerEditor({ question, onChange }: { question: Extract<Question, { type: "multiple_choice" }>; onChange: (question: Question) => void }) { return <OptionsEditor options={question.options} correctIds={question.correctOptionIds ?? []} multiple onChange={(options, correctIds) => onChange({ ...question, options: optionIds(options, correctIds), correctOptionIds: correctIds })}/>; }
function TrueFalseEditor({ question, onChange }: { question: Extract<Question, { type: "true_false" }>; onChange: (question: Question) => void }) { return <section className="mt-5"><h3 className="text-sm font-black">پاسخ درست</h3><p className="mt-1 text-xs text-muted-foreground">برای درست/نادرست فقط یکی از دو گزینه درست است و قابل تغییر نیست.</p><div className="mt-3 grid grid-cols-2 gap-3">{[{ label: "درست", value: true }, { label: "نادرست", value: false }].map((item) => <button key={item.label} type="button" onClick={() => onChange({ ...question, correctAnswer: item.value })} className={cn("rounded-xl border p-3 text-sm font-bold", question.correctAnswer === item.value ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "hover:bg-muted")}>{question.correctAnswer === item.value && <Check className="ml-1 inline h-4 w-4"/>}{item.label}</button>)}</div></section>; }

/** Accepted answers are a real list on the server (`configuration.expected_answers`), matched exactly. */
function ShortAnswerEditor({ question, onChange }: { question: Extract<Question, { type: "short_answer" }>; onChange: (question: Question) => void }) {
  const answers = question.expectedAnswers ?? [];
  const setAnswers = (next: string[]) => onChange({ ...question, expectedAnswers: next });
  const addAnswer = () => setAnswers([...answers, ""]);
  return <section className="mt-5 rounded-2xl border bg-muted/30 p-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-black">پاسخ‌های قابل‌قبول</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">هر پاسخی که دقیقاً با یکی از این موارد برابر باشد نمرهٔ کامل می‌گیرد. اگر چیزی وارد نکنید، تصحیح این سؤال دستی انجام می‌شود.</p></div><Button type="button" variant="outline" size="sm" onClick={addAnswer}><Plus className="h-3.5 w-3.5"/>پاسخ</Button></div>
    <div className="mt-3 space-y-2">{answers.length === 0 ? <p className="rounded-xl border border-dashed bg-card p-3 text-xs text-muted-foreground">هنوز پاسخی تعریف نشده؛ تصحیح به‌صورت دستی انجام می‌شود.</p> : answers.map((answer, index) => <div className="flex items-center gap-1.5" key={`${answer}-${index}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-xs font-black text-muted-foreground">{toPersianNumber(index + 1)}</span><Input value={answer} onChange={(event) => setAnswers(answers.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addAnswer(); } }} placeholder="مثلاً میتوکندری" aria-label={`پاسخ قابل‌قبول ${index + 1}`} autoFocus={!answer && index === answers.length - 1}/><Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => setAnswers(answers.filter((_, itemIndex) => itemIndex !== index))} aria-label={`حذف پاسخ ${index + 1}`}><Trash2 className="h-4 w-4"/></Button></div>)}</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
      <label className="block text-sm font-bold">حداکثر کاراکتر<Input className="mt-2" type="number" min="1" max="2000" value={question.maxLength ?? 150} onChange={(event) => onChange({ ...question, maxLength: Math.max(1, Number(event.target.value)) })}/></label>
      <button type="button" role="switch" aria-checked={Boolean(question.caseSensitive)} disabled={!answers.length} onClick={() => onChange({ ...question, caseSensitive: !question.caseSensitive })} className={cn("mt-1 flex items-center justify-between gap-3 rounded-xl border bg-card p-3 text-right text-xs font-bold transition-colors", !answers.length && "opacity-60")}><span>حساس به حروف بزرگ/کوچک{!answers.length ? " (ابتدا یک پاسخ تعریف کنید)" : ""}</span><span className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", question.caseSensitive ? "bg-primary" : "bg-muted")}><span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all", question.caseSensitive ? "right-6" : "right-1")}/></span></button>
    </div>
  </section>;
}
function WrittenEditor({ question, onChange }: { question: Extract<Question, { type: "essay" }>; onChange: (question: Question) => void }) { return <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_150px]"><label className="block text-sm font-bold">راهنمای تصحیح برای خودتان<Textarea className="mt-2 min-h-20" value={question.gradingNote ?? ""} onChange={(event) => onChange({ ...question, gradingNote: event.target.value })} placeholder="ملاک‌های امتیازدهی را بنویسید..."/></label><label className="block text-sm font-bold">حداکثر کاراکتر<Input className="mt-2" type="number" min="1" max="8000" value={question.maxLength ?? 1200} onChange={(event) => onChange({ ...question, maxLength: Math.max(1, Number(event.target.value)) })}/></label></div>; }
