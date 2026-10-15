"use client";

import { AlignRight, ArrowRight, Check, ChevronDown, ChevronUp, CircleCheck, CircleDot, Copy, Eye, FileText, GripVertical, Headphones, ImagePlus, Link2, ListChecks, ListPlus, Plus, SlidersHorizontal, TextCursorInput, ToggleLeft, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MatchingQuestion, Question, QuestionOption, QuestionType } from "@/lib/types/domain";
import { QuestionRenderer } from "@/components/exam/question-renderer";
import { PrivateMedia } from "@/components/shared/private-media";
import type { QuestionMediaAsset } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, toPersianNumber } from "@/lib/utils";
import { parseQuestionText } from "@/lib/exam/question-text-import";

const questionTypes: Array<{ type: QuestionType; label: string; description: string }> = [
  { type: "single_choice", label: "چهارگزینه‌ای", description: "یک پاسخ درست" },
  { type: "multiple_choice", label: "چندپاسخی", description: "چند پاسخ درست" },
  { type: "true_false", label: "درست / نادرست", description: "یک انتخاب دوگانه" },
  { type: "matching", label: "وصل‌کردنی", description: "هر پرسش را به پاسخ درست وصل کنید" },
  { type: "short_answer", label: "پاسخ کوتاه", description: "پاسخ متنی کوتاه" },
  { type: "essay", label: "تشریحی", description: "پاسخ نوشتاری" },
];
export const questionTypeLabel = Object.fromEntries(questionTypes.map((item) => [item.type, item.label])) as Record<QuestionType, string>;

/**
 * What each type actually asks the teacher for.
 *
 * The type is chosen *first* and alone, on its own screen, so this is where the picker earns its space: a
 * name is not enough to choose between «چهارگزینه‌ای» and «چندپاسخی» at a glance, and the line that settles
 * it is which fields are about to appear.
 */
const questionTypeMeta: Record<QuestionType, { label: string; icon: typeof CircleDot; summary: string; fields: string }> = {
  single_choice: { label: "چهارگزینه‌ای", icon: CircleDot, summary: "چند گزینه، فقط یکی درست است. نمره همه یا هیچ.", fields: "متن سؤال · گزینه‌ها · علامت پاسخ درست" },
  multiple_choice: { label: "چندگزینه‌ای چندپاسخی", icon: ListChecks, summary: "چند گزینه و چند پاسخ درست. دانش‌آموز باید همه را علامت بزند.", fields: "متن سؤال · گزینه‌ها · چند پاسخ درست" },
  true_false: { label: "درست / نادرست", icon: ToggleLeft, summary: "دو گزینهٔ ثابت؛ فقط درست یا نادرست را مشخص می‌کنید.", fields: "متن سؤال · پاسخ درست" },
  matching: { label: "وصل‌کردنی", icon: Link2, summary: "دو ستون پرسش و پاسخ؛ سمت پاسخ‌ها برای دانش‌آموز به‌هم‌ریخته می‌شود.", fields: "متن سؤال · جفت‌های پرسش/پاسخ" },
  short_answer: { label: "پاسخ کوتاه", icon: TextCursorInput, summary: "یک کلمه یا عبارت کوتاه. با فهرست پاسخ‌های قابل‌قبول خودکار تصحیح می‌شود.", fields: "متن سؤال · پاسخ‌های قابل‌قبول · سقف کاراکتر" },
  essay: { label: "پاسخ تشریحی", icon: AlignRight, summary: "پاسخ نوشتاری بلند؛ تصحیح دستی توسط آموزگار.", fields: "متن سؤال · راهنمای تصحیح · سقف کاراکتر" },
};

/** Server-side publish gate mirrored here so the teacher sees the problem before saving. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

const newOptionId = () => `option-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const optionIds = (options: QuestionOption[], correctIds: string[]) => options.map((option) => ({ ...option, isCorrect: correctIds.includes(option.id) }));

/**
 * A copy of a question under a fresh id, with its answer key carried across.
 *
 * Option ids are namespaced under the new question id, so the *index* of the correct option is what has to
 * travel — and this used to hard-code index 0 for single-choice and `[option-0]` for multi-answer. Since
 * `toApiQuestionPayload` writes `is_correct` from `correctOptionId`, every duplicated question was quietly
 * re-keyed to «گزینهٔ الف»: a teacher who copied a question to reword it got a paper whose key no longer
 * matched the answer they had set, with nothing on screen to suggest it.
 */
export function cloneQuestion(question: Question, id = question.id): Question {
  // Option ids are namespaced under the question id, so the copy cannot collide with the original.
  const renameOptions = (options: QuestionOption[]) =>
    options.map((option, index) => ({ ...option, id: `${id}-option-${index}`, value: `${id}-option-${index}` }));
  // What travels is the *index* of each correct option, re-expressed against the new ids.
  const keepIndices = (options: QuestionOption[], correct: string[]) =>
    correct
      .map((correctId) => options.findIndex((option) => option.id === correctId))
      .filter((index) => index >= 0)
      .map((index) => `${id}-option-${index}`);

  if (question.type === "single_choice") {
    const options = renameOptions(question.options);
    // An unanswered question stays unanswered: defaulting to the first option here would invent a key.
    const kept = keepIndices(question.options, question.correctOptionId ? [question.correctOptionId] : []);
    return { ...question, id, options: optionIds(options, kept), correctOptionId: kept[0] ?? "" };
  }
  if (question.type === "multiple_choice") {
    const options = renameOptions(question.options);
    const kept = keepIndices(question.options, question.correctOptionIds ?? []);
    return { ...question, id, options: optionIds(options, kept), correctOptionIds: kept };
  }
  if (question.type === "matching") return {
    ...question,
    id,
    pairs: question.pairs.map((pair, index) => ({ ...pair, id: `${id}-pair-${index}`, optionId: `${id}-option-${index}` })),
    options: [],
  };
  return { ...question, id, media: question.media?.map((media) => ({ ...media })) };
}

export function blankQuestion(type: QuestionType, order: number): Question {
  const base = { id: `question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, order, stem: "", points: 1, required: true, difficulty: "medium" as const, tags: [] as string[] };
  if (type === "single_choice") return { ...base, type, options: createOptions(), correctOptionId: "" };
  if (type === "multiple_choice") return { ...base, type, options: createOptions(), correctOptionIds: [] };
  if (type === "true_false") return { ...base, type, correctAnswer: true };
  if (type === "matching") return {
    ...base,
    type,
    options: [],
    pairs: [
      { id: newOptionId(), prompt: "", answer: "", optionId: newOptionId() },
      { id: newOptionId(), prompt: "", answer: "", optionId: newOptionId() },
    ],
  };
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
  return <section className="rounded-2xl border bg-muted/35 p-4">
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
  const hasPromptImage = (question.media ?? []).some((media) => media.kind === "image");
  if (!question.stem.trim() && !(question.imageOnly && hasPromptImage)) issues.push("متن سؤال را وارد کنید یا یک تصویر به‌عنوان صورت کامل سؤال ثبت کنید.");
  if (question.imageOnly && !hasPromptImage) issues.push("برای صورت سؤال تصویری، دست‌کم یک تصویر اضافه کنید.");
  if (question.points <= 0) issues.push("نمرهٔ سؤال باید بزرگ‌تر از صفر باشد.");
  const labelled = (options: QuestionOption[]) => options.filter((option) => option.label.trim()).length;
  if (question.type === "single_choice") {
    if (question.options.length < MIN_OPTIONS) issues.push(`حداقل ${toPersianNumber(MIN_OPTIONS)} گزینه لازم است.`);
    if (question.options.length > MAX_OPTIONS) issues.push(`حداکثر ${toPersianNumber(MAX_OPTIONS)} گزینه مجاز است.`);
    if (labelled(question.options) !== question.options.length) issues.push("متن همهٔ گزینه‌ها را کامل کنید.");
    if (question.options.length >= MIN_OPTIONS && labelled(question.options) === question.options.length && !question.correctOptionId) issues.push("پاسخ درست را علامت بزنید.");
  }
  if (question.type === "multiple_choice") {
    if (question.options.length < MIN_OPTIONS) issues.push(`حداقل ${toPersianNumber(MIN_OPTIONS)} گزینه لازم است.`);
    if (question.options.length > MAX_OPTIONS) issues.push(`حداکثر ${toPersianNumber(MAX_OPTIONS)} گزینه مجاز است.`);
    if (labelled(question.options) !== question.options.length) issues.push("متن همهٔ گزینه‌ها را کامل کنید.");
    if (question.options.length >= MIN_OPTIONS && labelled(question.options) === question.options.length && !question.correctOptionIds?.length) issues.push("حداقل یک پاسخ درست را علامت بزنید.");
  }
  if (question.type === "matching") {
    if (question.pairs.length < 2) issues.push("برای وصل‌کردنی دست‌کم دو جفت بسازید.");
    if (question.pairs.some((pair) => !pair.prompt.trim())) issues.push("متن همهٔ پرسش‌های سمت راست را کامل کنید.");
    if (question.pairs.some((pair) => !pair.answer?.trim())) issues.push("متن همهٔ پاسخ‌های سمت چپ را کامل کنید.");
    const answers = question.pairs.map((pair) => pair.answer?.trim().toLocaleLowerCase("fa") ?? "").filter(Boolean);
    if (new Set(answers).size !== answers.length) issues.push("پاسخ‌های سمت چپ باید یکتا باشند.");
  }
  if (question.type === "short_answer" && (question.expectedAnswers?.length ?? 0) > 0) {
    if (question.expectedAnswers?.some((answer) => !answer.trim())) issues.push("پاسخ‌های قابل‌قبول را خالی نگذارید.");
    if ((question.maxLength ?? 0) < 1) issues.push("حداکثر کاراکتر پاسخ کوتاه باید حداقل ۱ باشد.");
  }
  return issues;
}
export function questionIsComplete(question: Question) { return questionIssues(question).length === 0; }
function questionCountText(questions: Question[]) {
  const incompleteCount = questions.filter((question) => !questionIsComplete(question)).length;
  return incompleteCount ? ` · ${toPersianNumber(incompleteCount)} سؤال نیازمند تکمیل` : " · همهٔ سؤال‌ها آماده‌اند";
}

/**
 * A disclosure for the parts of a question that are not the question.
 *
 * The form used to show nine sections at once, which reads as "fill all of this in" even though six of them
 * are optional metadata. Collapsing them behind their own heading says what it means: the stem and the answer
 * are the work, everything here is a refinement. `defaultOpen` is computed by the caller from whether the
 * section already holds something, so a question that *does* use answer media never hides that fact.
 */
function CollapsibleSection({ title, description, summary, defaultOpen = false, children }: { title: string; description?: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("mt-4 overflow-hidden rounded-2xl border transition-colors", open ? "bg-card" : "bg-muted/25 hover:bg-muted/40")}>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="flex w-full items-center gap-3 p-3.5 text-right">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black">{title}</span>
          {description && <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">{description}</span>}
        </span>
        {!open && summary && <Badge variant="neutral" className="hidden shrink-0 sm:inline-flex">{summary}</Badge>}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true"/>
      </button>
      {open && <div className="border-t p-3.5">{children}</div>}
    </section>
  );
}

/** Step one of adding a question: the type, alone, with enough text to choose between the two similar ones. */
export function QuestionTypeGrid({ onPick }: { onPick: (type: QuestionType) => void }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {(Object.keys(questionTypeMeta) as QuestionType[]).map((type) => {
        const meta = questionTypeMeta[type];
        const Icon = meta.icon;
        return (
          <button
            type="button"
            key={type}
            onClick={() => onPick(type)}
            data-autofocus={type === "single_choice" ? true : undefined}
            className="group flex min-h-[112px] flex-col items-start gap-2 rounded-2xl border bg-card p-3.5 text-right transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-soft"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground" aria-hidden="true">
              <Icon className="h-4 w-4"/>
            </span>
            <span className="block text-sm font-black">{meta.label}</span>
            <span className="block text-[11px] leading-5 text-muted-foreground">{meta.summary}</span>
            <span className="mt-auto flex items-center gap-1 pt-1 text-[10px] font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
              <SlidersHorizontal className="h-3 w-3" aria-hidden="true"/>{meta.fields}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Add a question in two steps: pick the type, then see only the fields that type has.
 *
 * The draft lives here, not in the parent list, so closing the dialog discards it — a half-typed question
 * never lands in the paper and never trips the publish gate on the way out.
 */
function QuestionComposerDialog({ open, nextOrder, onClose, onAdd }: { open: boolean; nextOrder: number; onClose: () => void; onAdd: (question: Question) => void }) {
  const [draft, setDraft] = useState<Question | null>(null);
  /**
   * What survives a trip back to the type picker.
   *
   * Choosing «چهارگزینه‌ای», typing a two-line stem, then realising it is a matching question is a normal
   * sequence. Starting the second attempt from an empty form would make the back button cost the teacher
   * their work, so the type-independent parts are carried across and only the answer section is rebuilt —
   * which is exactly what changing the type later in the editor does, too.
   */
  const [carried, setCarried] = useState<Partial<Question> | null>(null);
  useEffect(() => { if (open) { setDraft(null); setCarried(null); } }, [open]);

  function pick(type: QuestionType) {
    const fresh = blankQuestion(type, nextOrder);
    setDraft(carried ? ({ ...fresh, ...carried } as Question) : fresh);
  }
  function back() {
    if (draft) {
      setCarried({
        stem: draft.stem,
        points: draft.points,
        helpText: draft.helpText,
        explanation: draft.explanation,
        difficulty: draft.difficulty,
        tags: draft.tags,
        media: draft.media,
        imageOnly: draft.imageOnly,
        allowImageAnswer: draft.allowImageAnswer,
        allowAudioAnswer: draft.allowAudioAnswer,
      });
    }
    setDraft(null);
  }

  const issues = draft ? questionIssues(draft) : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={draft ? `سؤال ${questionTypeMeta[draft.type].label}` : "افزودن سؤال"}
      description={draft
        ? "فقط فیلدهای همین نوع سؤال نمایش داده می‌شود. بخش‌های اختیاری بسته‌اند و با یک کلیک باز می‌شوند."
        : "اول نوع سؤال را انتخاب کنید؛ فرم بر اساس همان نوع ساخته می‌شود."}
      // The action row is the dialog's own footer, not the end of its content: on a laptop the composer is
      // taller than the viewport, and a button you have to scroll past your own work to find is a button
      // people stop using.
      footer={draft ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={back}>
            <ArrowRight className="h-3.5 w-3.5"/>بازگشت به انتخاب نوع
          </Button>
          <div className="flex items-center gap-3">
            {issues.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-warning">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true"/>
                {toPersianNumber(issues.length)} مورد مانده
              </span>
            )}
            <Button type="button" onClick={() => { onAdd(draft); onClose(); }}>
              <Plus className="h-4 w-4"/>{issues.length ? "افزودن و تکمیل در فهرست" : "افزودن سؤال"}
            </Button>
          </div>
        </div>
      ) : undefined}
    >
      {/* Two steps, and the step you are on is always visible: a dialog that swaps its whole contents can
          otherwise feel like it navigated away from what you clicked. */}
      <ol className="mb-4 flex items-center gap-2 text-[11px] font-black" aria-label="گام‌های افزودن سؤال">
        <StepPill index={1} label="انتخاب نوع" current={!draft} done={Boolean(draft)}/>
        <span aria-hidden="true" className="h-px w-6 bg-border"/>
        <StepPill index={2} label="نوشتن سؤال" current={Boolean(draft)} done={false}/>
      </ol>

      {!draft ? (
        <>
          <QuestionTypeGrid onPick={pick}/>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            {carried
              ? "متن سؤال، نمره و رسانه‌ای که نوشته بودید حفظ شد؛ فقط بخش پاسخ از نو ساخته می‌شود."
              : "بعداً هم می‌توانید نوع را عوض کنید؛ متن سؤال، نمره، رسانه و برچسب‌ها حفظ می‌شوند و فقط بخش پاسخ از نو ساخته می‌شود."}
          </p>
        </>
      ) : (
        <QuestionFields question={draft} onChange={setDraft}/>
      )}
    </Dialog>
  );
}

function StepPill({ index, label, current, done }: { index: number; label: string; current: boolean; done: boolean }) {
  return (
    <li className={cn(
      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
      current ? "border-primary/50 bg-primary/10 text-primary" : done ? "border-success/35 text-success" : "border-border text-muted-foreground",
    )} aria-current={current ? "step" : undefined}>
      <span className={cn("grid h-4 w-4 place-items-center rounded-full text-[9px]", current ? "bg-primary text-primary-foreground" : done ? "bg-success text-success-foreground" : "bg-muted")}>
        {done ? <Check className="h-2.5 w-2.5" aria-hidden="true"/> : toPersianNumber(index)}
      </span>
      {label}
    </li>
  );
}

export function TeacherQuestionBuilder({ questions, onChange, className }: { questions: Question[]; onChange: (questions: Question[]) => void; className?: string }) {
  const [selectedId, setSelectedId] = useState(questions[0]?.id ?? "");
  const [composerOpen, setComposerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importedQuestions, setImportedQuestions] = useState<Question[] | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const selected = useMemo(() => questions.find((question) => question.id === selectedId) ?? questions[0], [questions, selectedId]);
  const ordered = questions.map((question, index) => ({ ...question, order: index + 1 }));
  const incomplete = useMemo(() => questions.filter((question) => !questionIsComplete(question)).length, [questions]);
  const replace = (next: Question[]) => onChange(next.map((question, index) => ({ ...question, order: index + 1 })));
  function updateSelected(next: Question) { if (!selected) return; replace(questions.map((question) => question.id === selected.id ? next : question)); }
  function addQuestion(question: Question) { replace([...questions, question]); setSelectedId(question.id); }
  function duplicateSelected() { if (!selected) return; const copy = cloneQuestion(selected, `question-${Date.now().toString(36)}`); const titledCopy = { ...copy, stem: selected.stem ? `${selected.stem} (کپی)` : "" } as Question; replace([...questions, titledCopy]); setSelectedId(titledCopy.id); }
  function deleteSelected() { if (!selected) return; const remaining = questions.filter((question) => question.id !== selected.id); replace(remaining); setSelectedId(remaining[0]?.id ?? ""); setDeleteOpen(false); }
  function moveSelected(delta: -1 | 1) { if (!selected) return; const index = questions.findIndex((question) => question.id === selected.id); const target = index + delta; if (target < 0 || target >= questions.length) return; const next = [...questions]; [next[index], next[target]] = [next[target], next[index]]; replace(next); }
  function previewImport() {
    const result = parseQuestionText(importText, questions.length + 1);
    setImportedQuestions(result.questions);
    setImportWarnings(result.warnings);
  }
  function addImportedQuestions() {
    if (!importedQuestions?.length) return;
    replace([...questions, ...importedQuestions]);
    setSelectedId(importedQuestions[0].id);
    setImportOpen(false);
    setImportText("");
    setImportedQuestions(null);
    setImportWarnings([]);
  }
  function closeImport() {
    setImportOpen(false);
    setImportedQuestions(null);
    setImportWarnings([]);
  }

  return <div className={cn("grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]", className)}>
    <Card className="overflow-hidden xl:max-h-[720px]">
      <CardHeader className="flex-row items-center justify-between gap-3"><div><CardTitle>سؤال‌های آزمون</CardTitle><CardDescription>{toPersianNumber(questions.length)} سؤال · {toPersianNumber(questions.reduce((sum, question) => sum + question.points, 0))} نمره{incomplete ? ` · ${toPersianNumber(incomplete)} سؤال نیازمند تکمیل` : ""}</CardDescription></div><div className="flex shrink-0 items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { setImportText(""); setImportedQuestions(null); setImportWarnings([]); setImportOpen(true); }}><FileText className="h-4 w-4"/>ورود از متن</Button><Button type="button" size="sm" onClick={() => setComposerOpen(true)}><Plus className="h-4 w-4"/>افزودن سؤال</Button></div></CardHeader>
      <CardContent className="relative"><div className="space-y-2 overflow-y-auto xl:max-h-[560px]">{questions.length === 0 ? <div className="rounded-2xl border border-dashed bg-muted/30 p-6 text-center"><ListPlus className="mx-auto h-6 w-6 text-primary"/><p className="mt-3 text-sm font-black">اولین سؤال را اضافه کنید</p><p className="mt-1 text-xs leading-5 text-muted-foreground">با «افزودن سؤال» اول نوع را انتخاب می‌کنید، بعد فقط فیلدهای همان نوع باز می‌شود.</p></div> : ordered.map((question) => <button type="button" onClick={() => setSelectedId(question.id)} key={question.id} className={cn("flex w-full items-center gap-2.5 rounded-xl border p-3 text-right transition-all", selected?.id === question.id ? "border-primary bg-primary/[.06] shadow-sm" : "border-transparent bg-muted/55 hover:border-border hover:bg-card")}><GripVertical className="h-4 w-4 shrink-0 text-muted-foreground"/><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black", selected?.id === question.id ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}>{toPersianNumber(question.order)}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-extrabold">{question.stem || "بدون متن سؤال"}</span><span className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">{questionTypeLabel[question.type]} · {toPersianNumber(question.points)} نمره</span></span>{questionIsComplete(question) ? <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="آماده"/> : <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/10 px-1.5 py-1 text-[9px] font-black text-amber-700 dark:text-amber-400">{toPersianNumber(questionIssues(question).length)} مورد</span>}</button>)}</div></CardContent>
    </Card>
    {selected ? <QuestionEditor question={selected} onChange={updateSelected} onPreview={() => setPreviewOpen(true)} onDuplicate={duplicateSelected} onDelete={() => setDeleteOpen(true)} onMove={moveSelected} first={questions[0]?.id === selected.id} last={questions[questions.length - 1]?.id === selected.id}/> : <QuestionEmpty onAdd={() => setComposerOpen(true)}/>}
    <QuestionComposerDialog open={composerOpen} nextOrder={questions.length + 1} onClose={() => setComposerOpen(false)} onAdd={addQuestion}/>
    <Dialog open={importOpen} onClose={closeImport} title="ورود چند سؤال از متن" description="قالب سؤال‌ها را بچسبانید، پیش‌نمایش را بررسی کنید و سپس به ویرایشگر اضافه کنید." size="lg">
      <div className="space-y-4">
        <div className="rounded-2xl bg-muted/55 p-3 text-xs leading-6 text-muted-foreground">
          سؤال‌های گزینه‌ای، پاسخ کوتاه و تشریحی پذیرفته می‌شوند. سؤال‌ها را با خط جداکنندهٔ <code dir="ltr" className="rounded bg-card px-1.5 py-0.5 font-mono">---</code> از هم جدا کنید. برای کلید گزینه‌ای، برچسب گزینه را بنویسید؛ با چند برچسب سؤال چندپاسخی ساخته می‌شود.
          <pre dir="rtl" className="mt-2 whitespace-pre-wrap rounded-xl border bg-card p-3 font-mono text-[11px] leading-6 text-foreground">{"سؤال: پایتخت آذربایجان کدام است؟\nالف) باکو\nب) گنجه\nپاسخ: الف\nنمره: ۲\n---\nسؤال: پایتخت ایران چیست؟\nپاسخ: تهران"}</pre>
          <p className="mt-2">بدون گزینه و با «پاسخ:» سؤال پاسخ‌کوتاه ساخته می‌شود؛ بدون کلید، سؤال تشریحی می‌شود. درست‌ونادرست را از سازندهٔ معمولی بسازید.</p>
        </div>
        <label className="block text-sm font-bold">متن سؤال‌ها<Textarea className="mt-2 min-h-48 font-mono text-xs leading-6" value={importText} onChange={(event) => { setImportText(event.target.value); setImportedQuestions(null); setImportWarnings([]); }} placeholder="متن سؤال‌ها را اینجا بچسبانید…" dir="auto"/></label>
        {importedQuestions === null ? <div className="flex justify-end"><Button onClick={previewImport} disabled={!importText.trim()}><Eye className="h-4 w-4"/>بررسی و پیش‌نمایش</Button></div> : <div className="space-y-3">
          <div role="status" className="rounded-xl border bg-muted/35 p-3 text-sm font-bold">{toPersianNumber(importedQuestions.length)} سؤال شناسایی شد{importedQuestions.length ? ` · ${toPersianNumber(importedQuestions.reduce((sum, question) => sum + question.points, 0))} نمره` : ""}{importedQuestions.length > 0 && questionCountText(importedQuestions)}</div>
          {importWarnings.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/[.06] p-3 text-xs leading-5"><p className="font-bold text-amber-800 dark:text-amber-300">نیاز به بازبینی</p><ul className="mt-1 list-inside list-disc text-muted-foreground">{importWarnings.slice(0, 4).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>{importWarnings.length > 4 && <p className="mt-1 text-muted-foreground">و {toPersianNumber(importWarnings.length - 4)} پیام دیگر.</p>}</div>}
          {importedQuestions.length > 0 && <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border p-3">{importedQuestions.slice(0, 8).map((question, index) => <div key={question.id} className="flex items-start gap-2 border-b pb-2 last:border-0 last:pb-0"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-muted text-[10px] font-black text-muted-foreground">{toPersianNumber(index + 1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{question.stem || "بدون متن"}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{questionTypeLabel[question.type]} · {toPersianNumber(question.points)} نمره{questionIsComplete(question) ? "" : " · نیازمند تکمیل"}</span></span></div>)}</div>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={closeImport}>انصراف</Button><Button onClick={addImportedQuestions} disabled={importedQuestions.length === 0}><Plus className="h-4 w-4"/>افزودن {toPersianNumber(importedQuestions.length)} سؤال به آزمون</Button></div>
        </div>}
      </div>
    </Dialog>
    <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title="پیش‌نمایش سؤال" description="همان چیزی که دانش‌آموز می‌بیند، بدون کلید پاسخ." size="lg"><div className="rounded-2xl border bg-surface p-4"><QuestionRenderer question={selected ?? blankQuestion("single_choice", 1)} value={null} onChange={() => undefined} disabled/></div><div className="mt-5 flex justify-end"><Button onClick={() => setPreviewOpen(false)}>بستن پیش‌نمایش</Button></div></Dialog>
    <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="حذف سؤال؟" description={selected ? `«${selected.stem || "بدون عنوان"}» از این آزمون حذف می‌شود.` : undefined} size="sm"><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setDeleteOpen(false)}>انصراف</Button><Button variant="destructive" data-autofocus onClick={deleteSelected}><Trash2 className="h-4 w-4"/>حذف سؤال</Button></div></Dialog>
  </div>;
}

function QuestionEmpty({ onAdd }: { onAdd: () => void }) { return <Card className="grid min-h-80 place-items-center border-dashed bg-muted/20"><div className="p-6 text-center"><ListPlus className="mx-auto h-8 w-8 text-primary"/><h3 className="mt-4 font-black">هنوز سؤالی انتخاب نشده</h3><p className="mt-2 text-sm text-muted-foreground">یک سؤال جدید بسازید تا ویرایش آن را شروع کنید.</p><Button className="mt-5" onClick={onAdd}><Plus className="h-4 w-4"/>افزودن سؤال</Button></div></Card>; }

function QuestionEditor({ question, onChange, onPreview, onDuplicate, onDelete, onMove, first, last }: { question: Question; onChange: (question: Question) => void; onPreview: () => void; onDuplicate: () => void; onDelete: () => void; onMove: (direction: -1 | 1) => void; first: boolean; last: boolean }) {
  return <Card className="overflow-hidden">
    <CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="section-label">ویرایش سؤال {toPersianNumber(question.order)}</p><CardTitle className="mt-1">{questionTypeLabel[question.type]}</CardTitle></div><div className="flex gap-1"><Button type="button" variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={first} aria-label="انتقال سؤال به بالا"><ChevronUp className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={last} aria-label="انتقال سؤال به پایین"><ChevronDown className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" onClick={onPreview} aria-label="پیش‌نمایش سؤال"><Eye className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label="تکثیر سؤال"><Copy className="h-4 w-4"/></Button><Button type="button" variant="ghost" size="icon-sm" className="text-destructive" onClick={onDelete} aria-label="حذف سؤال"><Trash2 className="h-4 w-4"/></Button></div></div></CardHeader>
    <CardContent className="p-5 sm:p-6"><QuestionFields question={question} onChange={onChange} autosaved/></CardContent>
  </Card>;
}

/**
 * The question form itself, shared by the exam builder, the add dialog, and the bank's own composer.
 *
 * Ordered by how often a teacher actually touches it: what the student reads, then the answer, then — behind
 * a heading they can leave shut — media, answer permissions and bank metadata. Opening everything at once is
 * what made this form feel like a tax form; the optional parts are still one click away and never hidden when
 * they already hold something.
 */
export function QuestionFields({ question, onChange, autosaved = false }: { question: Question; onChange: (question: Question) => void; autosaved?: boolean }) {
  const issues = questionIssues(question);
  function changeType(type: QuestionType) {
    if (type === question.type) return;
    const fresh = blankQuestion(type, question.order);
    onChange({
      ...fresh,
      id: question.id,
      stem: question.stem,
      points: question.points,
      helpText: question.helpText,
      explanation: question.explanation,
      difficulty: question.difficulty,
      tags: question.tags,
      media: question.media?.map((media) => ({ ...media })),
      imageOnly: question.imageOnly,
      allowImageAnswer: question.allowImageAnswer,
      allowAudioAnswer: question.allowAudioAnswer,
    });
  }
  const hasBankMetadata = Boolean((question.tags?.length ?? 0) || question.helpText?.trim() || question.explanation?.trim() || (question.difficulty && question.difficulty !== "medium"));
  const allowsAnswerMedia = question.allowImageAnswer === true || question.allowAudioAnswer === true;

  return <>
      <div className="grid gap-4 sm:grid-cols-[1fr_130px]"><label className="block text-sm font-bold">نوع سؤال<select value={question.type} onChange={(event) => changeType(event.target.value as QuestionType)} className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm">{questionTypes.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label><label className="block text-sm font-bold">نمره<Input className="mt-2" type="number" min="0" max="100" step="0.25" value={question.points} onChange={(event) => onChange({ ...question, points: Math.max(0, Number(event.target.value)) })}/></label></div>

      <div className="mt-5 rounded-2xl border bg-muted/25 p-4">
        <label className="flex cursor-pointer items-start gap-3 text-sm font-bold">
          <input type="checkbox" checked={question.imageOnly === true} onChange={(event) => onChange({ ...question, imageOnly: event.target.checked, ...(event.target.checked ? { stem: "" } : {}) })} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"/>
          <span><span className="block">صورت سؤال کاملاً تصویری است</span><span className="mt-1 block text-[11px] leading-5 font-normal text-muted-foreground">اگر فعال باشد، متن تایپی حذف می‌شود و باید تصویر سؤال را اضافه کنید.</span></span>
        </label>
        {!question.imageOnly && <label className="mt-4 block text-sm font-bold">متن سؤال<Textarea className="mt-2 min-h-28" value={question.stem} onChange={(event) => onChange({ ...question, stem: event.target.value })} placeholder="متن روشن و کامل سؤال را وارد کنید..." maxLength={1000}/><span className="mt-1 block text-left text-[10px] font-bold text-muted-foreground">{toPersianNumber(question.stem.length)} / ۱۰۰۰</span></label>}
        <PromptMediaEditor question={question} onChange={onChange}/>
      </div>

      {question.type === "single_choice" && <SingleChoiceEditor question={question} onChange={onChange}/>}
      {question.type === "multiple_choice" && <MultipleAnswerEditor question={question} onChange={onChange}/>}
      {question.type === "true_false" && <TrueFalseEditor question={question} onChange={onChange}/>}
      {question.type === "matching" && <MatchingEditor question={question} onChange={onChange}/>}
      {question.type === "short_answer" && <ShortAnswerEditor question={question} onChange={onChange}/>}
      {question.type === "essay" && <WrittenEditor question={question} onChange={onChange}/>}

      <CollapsibleSection
        title="پاسخ رسانه‌ای دانش‌آموز"
        description="اجازه دهید پاسخ را با عکس یا صدا بفرستند."
        summary={allowsAnswerMedia ? (question.allowImageAnswer && question.allowAudioAnswer ? "عکس و صدا" : question.allowImageAnswer ? "عکس" : "صدا") : undefined}
        defaultOpen={allowsAnswerMedia}
      >
        <AnswerMediaOptions question={question} onChange={onChange}/>
      </CollapsibleSection>

      <CollapsibleSection
        title="راهنما، برچسب و توضیح"
        description="راهنمای همین سؤال، سطح و برچسب بانک، و بازخورد پس از تصحیح."
        summary={hasBankMetadata ? "تکمیل شده" : undefined}
        defaultOpen={hasBankMetadata}
      >
        <div className="space-y-4">
          <label className="block text-sm font-bold">راهنمای همین سؤال (اختیاری)<Input className="mt-2" value={question.helpText ?? ""} onChange={(event) => onChange({ ...question, helpText: event.target.value })} placeholder="مثلاً از واحد میلی‌متر استفاده کنید."/></label>
          <BankFields question={question} onChange={onChange}/>
          <label className="block text-sm font-bold">توضیح یا بازخورد (اختیاری)<Textarea className="mt-2 min-h-20" value={question.explanation ?? ""} onChange={(event) => onChange({ ...question, explanation: event.target.value })} placeholder="توضیحی که بعداً می‌تواند به دانش‌آموز نمایش داده شود..."/></label>
        </div>
      </CollapsibleSection>

      <div className="mt-5 flex items-center justify-between border-t pt-5"><span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">{issues.length === 0 ? <><CircleCheck className="h-4 w-4 text-success"/>آماده برای انتشار</> : <><TriangleAlert className="h-4 w-4 text-warning"/>نیازمند تکمیل</>}</span>{autosaved ? <Badge variant="neutral">به‌صورت خودکار ذخیره می‌شود</Badge> : <Badge variant="neutral">با ذخیره به بانک افزوده می‌شود</Badge>}</div>
      {issues.length > 0 && <ul className="mt-3 space-y-1 rounded-2xl border border-amber-500/25 bg-amber-500/[.07] p-3 text-xs leading-6 text-amber-900 dark:text-amber-300">{issues.map((issue) => <li key={issue} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"/>{issue}</li>)}</ul>}
  </>;
}

function PromptMediaEditor({ question, onChange }: { question: Question; onChange: (question: Question) => void }) {
  const media = question.media ?? [];
  const [uploadIssue, setUploadIssue] = useState<string | null>(null);

  function addFiles(files: FileList | null, kind: "image" | "audio") {
    if (!files?.length) return;
    setUploadIssue(null);
    const available = Math.max(0, 8 - media.length);
    if (!available) { setUploadIssue("برای هر سؤال حداکثر ۸ رسانه مجاز است."); return; }
    const accepted: QuestionMediaAsset[] = [];
    for (const file of Array.from(files).slice(0, available)) {
      const limit = kind === "image" ? 5 * 1024 * 1024 : 15 * 1024 * 1024;
      if (file.size <= 0 || file.size > limit) {
        setUploadIssue(kind === "image" ? "هر تصویر باید حداکثر ۵ مگابایت باشد." : "هر فایل صوتی باید حداکثر ۱۵ مگابایت باشد.");
        continue;
      }
      accepted.push({ id: `pending-${newOptionId()}`, kind, file, order: media.length + accepted.length + 1, altText: "" });
    }
    if (accepted.length) onChange({ ...question, media: [...media, ...accepted] });
    if (files.length > available) setUploadIssue("بخشی از فایل‌ها اضافه نشد؛ سقف ۸ رسانه برای هر سؤال است.");
  }

  function updateAsset(id: string, patch: Partial<QuestionMediaAsset>) {
    onChange({ ...question, media: media.map((asset, index) => asset.id === id ? { ...asset, ...patch, order: index + 1 } : { ...asset, order: index + 1 }) });
  }

  function removeAsset(id: string) {
    onChange({ ...question, media: media.filter((asset) => asset.id !== id).map((asset, index) => ({ ...asset, order: index + 1 })) });
  }

  const images = media.filter((asset) => asset.kind === "image").length;
  const audios = media.length - images;

  return <section className="mt-4 rounded-2xl border border-primary/10 bg-background/80 p-3.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-xs font-black">رسانهٔ صورت سؤال</h3><p className="mt-1 text-[10px] leading-5 text-muted-foreground">JPEG، PNG یا WebP تا ۵ مگابایت؛ صوت MP3، OGG، WAV یا WebM تا ۱۵ مگابایت.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {media.length > 0 && <span className="text-[10px] font-bold text-muted-foreground">{toPersianNumber(images)} تصویر · {toPersianNumber(audios)} صدا</span>}
        <label className={cn("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-[11px] font-bold hover:bg-muted", media.length >= 8 && "pointer-events-none opacity-50")}>
          <ImagePlus className="h-3.5 w-3.5"/>تصویر
          <input className="sr-only" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple disabled={media.length >= 8} onChange={(event) => { addFiles(event.target.files, "image"); event.currentTarget.value = ""; }}/>
        </label>
        <label className={cn("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-[11px] font-bold hover:bg-muted", media.length >= 8 && "pointer-events-none opacity-50")}>
          <Headphones className="h-3.5 w-3.5"/>صدا
          <input className="sr-only" type="file" accept=".mp3,.ogg,.wav,.webm,audio/mpeg,audio/ogg,audio/wav,audio/webm" multiple disabled={media.length >= 8} onChange={(event) => { addFiles(event.target.files, "audio"); event.currentTarget.value = ""; }}/>
        </label>
      </div>
    </div>
    {media.length > 0 && <div className="mt-3 space-y-2.5">{media.map((asset) => <div key={asset.id} className="flex flex-col gap-2 rounded-xl border bg-card p-2.5 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold text-muted-foreground"><span>{asset.kind === "image" ? "تصویر" : "صدا"} · {asset.file?.name || asset.contentType || "رسانهٔ ذخیره‌شده"}</span><span>{asset.file ? `${(asset.file.size / (1024 * 1024)).toFixed(1)} مگابایت` : "ذخیره‌شده"}</span></div>
        <PrivateMedia kind={asset.kind} file={asset.file} url={asset.url} alt={asset.altText || "پیش‌نمایش صورت سؤال"} className={asset.kind === "image" ? "max-h-44 w-auto" : ""}/>
        {asset.kind === "image" && <Input className="mt-2 h-9 text-xs" maxLength={180} value={asset.altText ?? ""} onChange={(event) => updateAsset(asset.id, { altText: event.target.value })} placeholder="توضیح کوتاه تصویر برای دسترس‌پذیری" aria-label="توضیح تصویر"/>}
      </div>
      <Button type="button" variant="ghost" size="icon-sm" className="self-end text-destructive sm:self-start" onClick={() => removeAsset(asset.id)} aria-label="حذف رسانه"><Trash2 className="h-4 w-4"/></Button>
    </div>)}</div>}
    {uploadIssue && <p role="alert" className="mt-2 text-[11px] font-bold text-destructive">{uploadIssue}</p>}
    <p className="mt-2 text-[10px] leading-5 text-muted-foreground">فایل‌ها خصوصی می‌مانند و پس از ذخیرهٔ آزمون بارگذاری می‌شوند. اگر سؤال کاملاً تصویری است، گزینهٔ بالای این بخش را هم فعال کنید.</p>
  </section>;
}

function AnswerMediaOptions({ question, onChange }: { question: Question; onChange: (question: Question) => void }) {
  const enabled = question.allowImageAnswer === true || question.allowAudioAnswer === true;
  return <section>
    <p className="text-[11px] leading-5 text-muted-foreground">فایل‌ها تا ۵ مگابایت برای تصویر و ۱۵ مگابایت برای صدا پذیرفته می‌شوند. سرور امضای واقعی بایت‌ها را بررسی می‌کند، نه نام یا نوع اعلام‌شده از سوی مرورگر.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card p-3 text-xs font-bold"><input type="checkbox" checked={question.allowImageAnswer === true} onChange={(event) => onChange({ ...question, allowImageAnswer: event.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]"/><ImagePlus className="h-4 w-4 text-primary"/>اجازهٔ بارگذاری تصویر</label>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card p-3 text-xs font-bold"><input type="checkbox" checked={question.allowAudioAnswer === true} onChange={(event) => onChange({ ...question, allowAudioAnswer: event.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]"/><Headphones className="h-4 w-4 text-primary"/>اجازهٔ ضبط یا بارگذاری صدا</label>
    </div>
    {enabled && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[.06] p-3 text-[10px] leading-5 text-amber-900 dark:text-amber-200">پاسخ‌های فایلی بعداً در برگهٔ تصحیح معلم دیده می‌شوند و خودکار از روی تصویر/صدا نمره نمی‌گیرند؛ برای این سؤال تصحیح انسانی در نظر گرفته می‌شود.</p>}
    {/*
      Two rules that can contradict each other, said out loud before the exam rather than in front of the
      student: a microphone prompt is a browser chrome dialog, and in some browsers it drops the page out of
      fullscreen — which a "require fullscreen" exam records as a violation the student did nothing to earn.
    */}
    {question.allowAudioAnswer === true && <p className="mt-2 rounded-xl border bg-muted/40 p-3 text-[10px] leading-5 text-muted-foreground">اگر در تنظیمات آزمون «تمام‌صفحهٔ اجباری» را روشن کرده‌اید، درخواست دسترسی میکروفون در بعضی مرورگرها تمام‌صفحه را می‌شکند و به‌عنوان خروج ثبت می‌شود. دانش‌آموز همیشه می‌تواند به‌جای ضبط، فایل صوتی انتخاب کند.</p>}
  </section>;
}

function MatchingEditor({ question, onChange }: { question: MatchingQuestion; onChange: (question: Question) => void }) {
  const updatePair = (id: string, patch: { prompt?: string; answer?: string }) => onChange({ ...question, pairs: question.pairs.map((pair) => pair.id === id ? { ...pair, ...patch } : pair) });
  const addPair = () => {
    if (question.pairs.length >= 12) return;
    onChange({ ...question, pairs: [...question.pairs, { id: newOptionId(), prompt: "", answer: "", optionId: newOptionId() }] });
  };
  const removePair = (id: string) => {
    if (question.pairs.length <= 2) return;
    onChange({ ...question, pairs: question.pairs.filter((pair) => pair.id !== id) });
  };
  return <section className="mt-5 rounded-2xl border bg-muted/25 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black">جفت‌های وصل‌کردنی</h3><p className="mt-1 text-[11px] leading-5 text-muted-foreground">برای هر ردیف، یک پرسش و پاسخ درست بنویسید. سمت پاسخ‌ها برای دانش‌آموز به‌هم‌ریخته نمایش داده می‌شود.</p></div><Button type="button" variant="outline" size="sm" onClick={addPair} disabled={question.pairs.length >= 12}><Plus className="h-3.5 w-3.5"/>جفت</Button></div>
    <div className="mt-3 space-y-2">{question.pairs.map((pair, index) => <div key={pair.id} className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_40px] sm:items-center">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-xs font-black text-muted-foreground">{toPersianNumber(index + 1)}</span>
      <Input value={pair.prompt} onChange={(event) => updatePair(pair.id, { prompt: event.target.value })} placeholder={`پرسش ${toPersianNumber(index + 1)}`} aria-label={`پرسش وصل‌کردنی ${index + 1}`}/>
      <Input value={pair.answer ?? ""} onChange={(event) => updatePair(pair.id, { answer: event.target.value })} placeholder={`پاسخ درست ${toPersianNumber(index + 1)}`} aria-label={`پاسخ وصل‌کردنی ${index + 1}`}/>
      <Button type="button" variant="ghost" size="icon-sm" className="justify-self-end text-destructive" onClick={() => removePair(pair.id)} disabled={question.pairs.length <= 2} aria-label={`حذف جفت ${index + 1}`}><Trash2 className="h-4 w-4"/></Button>
    </div>)}</div>
    <p className="mt-2 text-[10px] text-muted-foreground">{toPersianNumber(question.pairs.length)} از ۱۲ جفت · نمره به تعداد اتصال‌های درست، متناسب تقسیم می‌شود.</p>
  </section>;
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
      {!locked && <button type="button" role={multiple ? "checkbox" : "radio"} aria-checked={checked} onClick={() => setCorrect(option.id)} className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-xs", checked ? "border-success bg-success text-success-foreground" : "bg-card text-muted-foreground")} aria-label={`علامت‌گذاری گزینه ${toPersianNumber(index + 1)} به‌عنوان پاسخ درست`}>{checked ? <Check className="h-4 w-4"/> : toPersianNumber(index + 1)}</button>}
      {locked && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-black text-muted-foreground">{toPersianNumber(index + 1)}</span>}
      <Input value={option.label} onChange={(event) => updateLabel(index, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOption(); } }} placeholder={`گزینهٔ ${toPersianNumber(index + 1)}`} aria-label={`متن گزینه ${toPersianNumber(index + 1)}`}/>
      {locked ? null : <div className="flex shrink-0 items-center">
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveOption(index, -1)} disabled={index === 0} aria-label={`انتقال گزینه ${toPersianNumber(index + 1)} به بالا`}><ChevronUp className="h-4 w-4"/></Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => moveOption(index, 1)} disabled={index === options.length - 1} aria-label={`انتقال گزینه ${toPersianNumber(index + 1)} به پایین`}><ChevronDown className="h-4 w-4"/></Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => duplicateOption(index)} disabled={options.length >= MAX_OPTIONS} aria-label={`تکثیر گزینه ${toPersianNumber(index + 1)}`}><Copy className="h-4 w-4"/></Button>
        <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => deleteOption(option.id)} disabled={options.length <= MIN_OPTIONS} aria-label={`حذف گزینه ${toPersianNumber(index + 1)}`}><Trash2 className="h-4 w-4"/></Button>
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
