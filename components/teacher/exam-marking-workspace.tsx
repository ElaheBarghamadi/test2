"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardList, FileText, Gauge, Save, Sparkles, Wand2 } from "lucide-react";
import type { ApiGradingBoardDto, ApiGradingBoardQuestionDto, ApiGradingQuestionPageDto, ApiTeacherAttemptDetailDto, ApiTeacherResultRowDto } from "@/lib/api/dtos";
import { apiErrorMessage } from "@/lib/api/client";
import { resultsApi } from "@/lib/api/results";
import { Avatar } from "@/components/shared/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToastStore } from "@/lib/state/toast-store";
import { cn, formatDateTime, toPersianNumber } from "@/lib/utils";
import { describeIntegrity, INTEGRITY_POLICY_LABELS, signalLabel } from "@/lib/exam/integrity";
import { toIntegrityRules } from "@/lib/api/mappers";

/**
 * Marking, in the two orders a teacher actually works in.
 *
 * Sheet by sheet finishes one student's paper; question by question applies one rubric to the whole class,
 * which is the only way written answers get marked consistently. Both read the same numbers the grader
 * wrote, and both show the *whole* paper: a question the exam already scored on its own appears with its
 * mark and the key, read-only, instead of being hidden from the person responsible for the result.
 */
type MarkingMode = "sheet" | "question";

const numeric = (value: string | number | null | undefined) => Number(value || 0);

const VERDICT_LABELS: Record<string, { label: string; variant: "success" | "destructive" | "warning" | "neutral" | "teal" }> = {
  correct: { label: "درست", variant: "success" },
  incorrect: { label: "نادرست", variant: "destructive" },
  unanswered: { label: "بدون پاسخ", variant: "neutral" },
  pending: { label: "نیازمند نمرهٔ شما", variant: "warning" },
  manual: { label: "نمرهٔ دست شما", variant: "teal" },
};

export function ExamMarkingWorkspace({ examId, initialMode = "sheet", initialAttemptId = "", initialQuestionId = "" }: { examId: string; initialMode?: MarkingMode; initialAttemptId?: string; initialQuestionId?: string }) {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const [mode, setMode] = useState<MarkingMode>(initialMode);
  const [board, setBoard] = useState<ApiGradingBoardDto | null>(null);
  /** Bumped by a bulk action: the panel has to re-read what the batch just wrote. */
  const [reloadKey, setReloadKey] = useState(0);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<ApiTeacherResultRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState(initialAttemptId);
  const [questionId, setQuestionId] = useState(initialQuestionId);
  const [sheet, setSheet] = useState<ApiTeacherAttemptDetailDto | null>(null);
  const [page, setPage] = useState<ApiGradingQuestionPageDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [boardData, rowData] = await Promise.all([resultsApi.gradingBoard(examId), resultsApi.teacherExamRows(examId, "submitted")]);
      setBoard(boardData);
      setRows(rowData);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [examId]);
  useEffect(() => { void load(); }, [load]);

  // Defaults are chosen for the teacher, not left empty: open the sheet that still needs a pen, and the
  // first question with something waiting in it.
  useEffect(() => {
    if (!board || !rows.length) return;
    if (!attemptId) {
      const first = [...rows].sort((a, b) => b.pending_manual_grading_count - a.pending_manual_grading_count)[0];
      if (first) setAttemptId(first.id);
    }
    if (!questionId) {
      const open = board.questions.find((item) => item.pending_count > 0) ?? board.questions[0];
      if (open) setQuestionId(open.id);
    }
  }, [attemptId, board, questionId, rows]);

  useEffect(() => {
    if (mode !== "sheet" || !attemptId) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await resultsApi.teacherAttempt(attemptId);
        if (!cancelled) setSheet(data);
      } catch (reason) {
        if (!cancelled) toast({ title: "برگه باز نشد", description: apiErrorMessage(reason), variant: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [attemptId, mode, reloadKey, toast]);

  useEffect(() => {
    if (mode !== "question" || !questionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await resultsApi.gradingQuestion(examId, questionId);
        if (!cancelled) setPage(data);
      } catch (reason) {
        if (!cancelled) toast({ title: "سؤال باز نشد", description: apiErrorMessage(reason), variant: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [examId, mode, questionId, reloadKey, toast]);

  /** Keep the address bar in step, so a reload or a shared link lands on the same screen. */
  function remember(next: { mode: MarkingMode; attempt?: string; question?: string }) {
    const params = new URLSearchParams();
    if (next.mode === "question") params.set("mode", "question");
    const attempt = next.attempt ?? attemptId;
    const question = next.question ?? questionId;
    if (next.mode === "sheet" && attempt) params.set("attempt", attempt);
    if (next.mode === "question" && question) params.set("question", question);
    const search = params.toString();
    router.replace(`/teacher/exams/${examId}/marking${search ? `?${search}` : ""}`, { scroll: false });
  }

  function switchMode(next: MarkingMode) {
    if (next === mode) return;
    setMode(next);
    remember({ mode: next });
  }


  /**
   * Fill the desk with the marks the exam already knows.
   *
   * Two things are deliberately NOT done here. A row the teacher has already marked is left alone — a bulk
   * action must never outvote a decision — and an essay with words in it is not zeroed by this button unless
   * `zero_unanswered` says so, because "finish marking" must not quietly mean "give zero to everything unread".
   */
  async function applyAutoMarks() {
    setApplying(true);
    try {
      const result = await resultsApi.autoMarks(examId, { confirm_key: true, zero_unanswered: true });
      setReloadKey((key) => key + 1);
      await load();
      toast({
        title: `نمره‌های خودکار اعمال شد`,
        description: `${toPersianNumber(result.confirmed)} ردیف از کلید تأیید شد، ${toPersianNumber(result.zeroed)} پاسخ خالی صفر گرفت${
          result.left_for_a_human ? ` و ${toPersianNumber(result.left_for_a_human)} پاسخ تشریحی برای قضاوت شما باقی ماند` : ""
        }. هر عددی را می‌توانید عوض کنید.`,
        variant: "success",
      });
    } catch (reason) {
      toast({ title: "اعمال نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setApplying(false);
    }
  }

  const openQuestions = useMemo(() => (board ? board.questions.filter((item) => item.pending_count > 0).length : 0), [board]);
  const pendingStudents = useMemo(() => rows.filter((row) => row.pending_manual_grading_count > 0).length, [rows]);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-1">
          <div className="inline-flex rounded-2xl border bg-muted/40 p-1" role="group" aria-label="نحوهٔ تصحیح">
            {([["sheet", "برگه‌به‌برگه", FileText], ["question", "سؤال‌به‌سؤال", ClipboardList]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => switchMode(value)} className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition-all", mode === value ? "bg-background shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="h-4 w-4"/>{label}
              </button>
            ))}
          </div>
          {board && <ProgressBar total={board.progress.total} graded={board.progress.graded} percent={board.progress.percent}/>}
          <div className="mr-auto flex items-center gap-2">
            {openQuestions > 0 && <Badge variant="warning">{toPersianNumber(openQuestions)} سؤال در انتظار نمره</Badge>}
            {pendingStudents > 0 && <Badge variant="neutral">{toPersianNumber(pendingStudents)} برگهٔ ناتمام</Badge>}
            {openQuestions === 0 && pendingStudents === 0 && !loading && <Badge variant="success"><Check className="ml-1 h-3.5 w-3.5"/>برگه‌ها کامل است</Badge>}
            <Button variant="outline" size="sm" onClick={() => void applyAutoMarks()} disabled={applying || loading} title="نمرهٔ کلید را روی ردیف‌ها بگذارید و پاسخ‌های خالی را صفر کنید">
              <Wand2 className="h-4 w-4"/>{applying ? "در حال اعمال…" : "اعمال نمره‌های خودکار"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()}>تازه‌سازی</Button>
          </div>
        </CardContent>
      </Card>

      {error && <Card><CardContent><EmptyState title="اطلاعات تصحیح دریافت نشد" description={error} action={{ label: "تلاش دوباره", onClick: () => void load() }}/></CardContent></Card>}
      {loading && !board && <MarkingSkeleton/>}

      {board && !loading && (
        <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
          <aside className="space-y-3">
            {mode === "sheet" ? (
              <StudentRail rows={rows} activeId={attemptId} onSelect={(id) => { setAttemptId(id); remember({ mode, attempt: id }); }}/>
            ) : (
              <QuestionRail questions={board.questions} activeId={questionId} onSelect={(id) => { setQuestionId(id); remember({ mode, question: id }); }}/>
            )}
          </aside>
          <div className="min-w-0">
            {mode === "sheet"
              ? <SheetPanel sheet={sheet} onSaved={() => { void load(); if (attemptId) void resultsApi.teacherAttempt(attemptId).then(setSheet); }} rows={rows} onSelectNext={(id) => { setAttemptId(id); remember({ mode, attempt: id }); }}/>
              : <QuestionPanel examId={examId} page={page} onSaved={(next) => { setPage(next.page); setBoard(next.board); }} onSelectQuestion={(id) => { setQuestionId(id); remember({ mode, question: id }); }}/>}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ total, graded, percent }: { total: number; graded: number; percent: number }) {
  return (
    <div className="min-w-[180px] flex-1">
      <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
        <span>{total === 0 ? "نمرهٔ دستی لازم نیست" : `${toPersianNumber(graded)} از ${toPersianNumber(total)} نمرهٔ دستی ثبت شده`}</span>
        <span>{toPersianNumber(percent)}٪</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="پیشرفت تصحیح">
        <div className={cn("h-full rounded-full transition-all", percent === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${percent}%` }}/>
      </div>
    </div>
  );
}

function StudentRail({ rows, activeId, onSelect }: { rows: ApiTeacherResultRowDto[]; activeId: string; onSelect: (id: string) => void }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.pending_manual_grading_count - a.pending_manual_grading_count || a.student_name.localeCompare(b.student_name, "fa")), [rows]);
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle className="text-sm">دانش‌آموزان</CardTitle><CardDescription>هر برگه را باز کنید؛ آن‌که نمرهٔ دستی می‌خواهد اول آمده است.</CardDescription></CardHeader>
      <CardContent className="max-h-[62vh] space-y-1.5 overflow-y-auto pl-1">
        {sorted.length === 0 ? <p className="rounded-xl bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">هنوز برگه‌ای ارسال نشده است.</p> : sorted.map((row) => {
          const open = row.pending_manual_grading_count;
          return (
            <button key={row.id} type="button" onClick={() => onSelect(row.id)} aria-current={activeId === row.id ? "true" : undefined} className={cn("flex w-full items-center gap-2 rounded-xl border p-2.5 text-right transition-all", activeId === row.id ? "border-primary bg-primary/[.06]" : "hover:border-primary/40")}>
              <Avatar name={row.student_name} size="sm"/>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-black">{row.student_name}</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">{[row.grade, row.class_name].filter(Boolean).join(" · ") || "بدون کلاس"}</span>
              </span>
              {open > 0 ? <span className="shrink-0 rounded-lg bg-amber-500/12 px-1.5 py-1 text-[10px] font-black text-amber-700 dark:text-amber-400">{toPersianNumber(open)}</span> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600"/>}
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function QuestionRail({ questions, activeId, onSelect }: { questions: ApiGradingBoardQuestionDto[]; activeId: string; onSelect: (id: string) => void }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle className="text-sm">سؤال‌ها</CardTitle><CardDescription>یک سؤال را برای همهٔ کلاس نمره بدهید، سپس به سراغ بعدی بروید.</CardDescription></CardHeader>
      <CardContent className="max-h-[62vh] space-y-1.5 overflow-y-auto pl-1">
        {questions.length === 0 ? <p className="rounded-xl bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">این آزمون سؤالی ندارد.</p> : questions.map((question) => {
          const done = question.is_complete;
          return (
            <button key={question.id} type="button" onClick={() => onSelect(question.id)} aria-current={activeId === question.id ? "true" : undefined} className={cn("flex w-full items-start gap-2 rounded-xl border p-2.5 text-right transition-all", activeId === question.id ? "border-primary bg-primary/[.06]" : "hover:border-primary/40")}>
              <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-black", done ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : question.requires_manual_grading ? "bg-amber-500/12 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>{toPersianNumber(question.order)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-bold leading-5">{question.text}</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {question.requires_manual_grading ? `${toPersianNumber(question.graded_count)}/${toPersianNumber(question.graded_count + question.pending_count)} نمره‌دستی` : `${toPersianNumber(question.correct_count)} درست · ${toPersianNumber(question.incorrect_count)} نادرست`}
                </span>
              </span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** The whole paper of one student: keyed rows carry their awarded mark and stay read-only. */
/**
 * What the box shows when the sheet opens.
 *
 * The teacher's own number wins, as always. After that the box is never left empty on a row the exam has
 * already decided — a keyed question shows the mark the key awarded, a skipped question shows zero — because
 * an empty box next to a score the system has computed invites a guess, and every one of them stays a plain
 * editable input.
 */
function seedMark(answer: ApiTeacherAttemptDetailDto["answers"][number]): [string, string] {
  if (answer.manual_score !== null && answer.manual_score !== undefined) return [answer.question_id, String(Number(answer.manual_score))];
  if (!answer.manual_grading_required) return [answer.question_id, String(Number(answer.awarded_score ?? 0))];
  if (answer.verdict === "unanswered") return [answer.question_id, "0"];
  return [answer.question_id, ""];
}

function SheetPanel({ sheet, onSaved, rows, onSelectNext }: { sheet: ApiTeacherAttemptDetailDto | null; onSaved: () => void; rows: ApiTeacherResultRowDto[]; onSelectNext: (id: string) => void }) {
  const toast = useToastStore((state) => state.push);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /** What the server had on record when the sheet opened, so "changed" means changed. */
  const [seeded, setSeeded] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!sheet) return;
    const seed = Object.fromEntries(sheet.answers.map(seedMark));
    setMarks(seed);
    setSeeded(seed);
    setFeedback(Object.fromEntries(sheet.answers.map((answer) => [answer.question_id, answer.feedback || ""])));
    setOverall(sheet.result?.feedback || "");
  }, [sheet]);

  const manual = useMemo(() => sheet?.answers.filter((answer) => answer.manual_grading_required) ?? [], [sheet]);
  /** Rows whose number differs from what the server holds — the only rows a save has to write. */
  const dirty = useMemo(
    () =>
      sheet
        ? sheet.answers
            .filter((answer) => (marks[answer.question_id] ?? "") !== (seeded[answer.question_id] ?? ""))
            .map((answer) => answer.question_id)
        : [],
    [marks, seeded, sheet],
  );
  const gradedCount = manual.filter((answer) => answer.manual_score !== null && answer.manual_score !== undefined).length;
  const nextOpen = manual.find((answer) => answer.manual_score === null || answer.manual_score === undefined);
  const autoScore = useMemo(() => (sheet ? sheet.answers.filter((answer) => !answer.manual_grading_required).reduce((sum, answer) => sum + numeric(answer.awarded_score), 0) : 0), [sheet]);

  /**
   * One decision on one answer. `mark` sends the teacher's number, `note` leaves the number alone, and
   * `clear` hands a keyed question back to the key. Three gestures because a teacher does three jobs at the
   * desk, and a blank box must never be read as "zero" on a question the system has already graded.
   */
  async function saveAnswer(questionId: string, action: "mark" | "note" | "clear" = "mark") {
    if (!sheet) return;
    const note = feedback[questionId] || "";
    let payload: { manual_score?: number | null; feedback?: string } = { feedback: note };
    if (action === "clear") {
      payload = { manual_score: null, feedback: note };
    } else if (action === "mark") {
      const value = Number(marks[questionId]);
      if (!Number.isFinite(value) || value < 0) { toast({ title: "نمره معتبر وارد کنید", variant: "error" }); return; }
      const target = sheet.answers.find((answer) => answer.question_id === questionId);
      if (target && value > numeric(target.maximum_score)) {
        toast({ title: "نمره بیشتر از بارم سؤال است", description: `حداکثر ${toPersianNumber(numeric(target.maximum_score))} نمره برای این سؤال در نظر گرفته شده است.`, variant: "error" });
        return;
      }
      payload = { manual_score: value, feedback: note };
    }
    setBusy(questionId);
    try {
      await resultsApi.gradeAnswer(sheet.id, questionId, payload);
      toast({ title: "نمره ذخیره شد", variant: "success" });
      onSaved();
    } catch (reason) {
      toast({ title: "ذخیره نمره انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Save every changed row at once.
   *
   * The desk writes per row because a mark is a per-row decision, but a teacher working a whole sheet should
   * not press "save" thirty times. This sends exactly the rows that differ from the server and reloads once.
   */
  async function saveAll() {
    if (!sheet || !dirty.length) return;
    setBusy("all");
    const failures: string[] = [];
    for (const questionId of dirty) {
      const value = Number(marks[questionId]);
      if (!Number.isFinite(value) || value < 0) {
        failures.push(questionId);
        continue;
      }
      try {
        await resultsApi.gradeAnswer(sheet.id, questionId, { manual_score: value, feedback: feedback[questionId] || "" });
      } catch {
        failures.push(questionId);
      }
    }
    setBusy(null);
    if (failures.length === dirty.length) {
      toast({ title: "ذخیرهٔ تغییرات انجام نشد", description: "هیچ ردیفی نوشته نشد؛ مقادیر را بررسی کنید.", variant: "error" });
      return;
    }
    onSaved();
    toast({
      title: failures.length ? `${toPersianNumber(dirty.length - failures.length)} ردیف ذخیره شد` : "تغییرات ذخیره شد",
      description: failures.length ? `${toPersianNumber(failures.length)} ردیف به‌دلیل مقدار نامعتبر نماند.` : undefined,
      variant: failures.length ? "error" : "success",
    });
  }

  async function saveOverall() {
    if (!sheet) return;
    setBusy("overall");
    try {
      await resultsApi.updateFeedback(sheet.id, overall);
      toast({ title: "بازخورد کلی ذخیره شد", variant: "success" });
      onSaved();
    } catch (reason) {
      toast({ title: "ذخیره بازخورد انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  if (!sheet) {
    return <Card><CardContent className="py-10"><EmptyState title="برگه‌ای انتخاب نشده" description="از فهرست دانش‌آموزان یک برگه را باز کنید تا همهٔ سؤال‌ها با نمرهٔ خودشان نمایش داده شود."/></CardContent></Card>;
  }

  const nextStudent = rows.find((row) => row.pending_manual_grading_count > 0 && row.id !== sheet.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-1">
          <Avatar name={sheet.student.full_name}/>
          <div className="min-w-0">
            <p className="truncate text-sm font-black">{sheet.student.full_name}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {[sheet.student.grade, sheet.student.class_name].filter(Boolean).join(" · ")} · تلاش {toPersianNumber(sheet.attempt_number)} · {sheet.submitted_at ? formatDateTime(sheet.submitted_at) : "در جریان"}
            </p>
          </div>
          <div className="mr-auto flex items-center gap-2">
            <Badge variant="neutral">نمرهٔ خودکار {toPersianNumber(numeric(autoScore.toFixed(2)))}</Badge>
            {manual.length > 0 && <Badge variant={gradedCount === manual.length ? "success" : "warning"}>{toPersianNumber(gradedCount)} از {toPersianNumber(manual.length)} دستی</Badge>}
            {nextOpen && <Button size="sm" variant="outline" onClick={() => document.getElementById(`mark-${nextOpen.question_id}`)?.focus()}>پرش به نمرهٔ بعدی</Button>}
            {dirty.length > 0 && (
              <Button size="sm" onClick={() => void saveAll()} disabled={busy === "all"}>
                <Save className="h-4 w-4"/>
                ذخیرهٔ {toPersianNumber(dirty.length)} تغییر
              </Button>
            )}
            {nextStudent && <Button size="sm" variant="ghost" onClick={() => onSelectNext(nextStudent.id)}>برگهٔ بعدی <ChevronLeft className="h-4 w-4"/></Button>}
          </div>
          {sheet.integrity && (() => {
          const rules = toIntegrityRules(sheet.integrity);
          if (!rules) return null;
          // The rules and the counts are shown together on purpose. "پنج بار بیرون رفتن از تب" is not evidence
          // of anything until the teacher's own limit is next to it — and if no limit was set, that has to be
          // visible too, so nobody reads a number as a violation.
          return (
            <div className="rounded-2xl border bg-card/70 p-3 text-xs">
              <p className="font-black">مراقبت از تقلب: {INTEGRITY_POLICY_LABELS[rules.policy]}</p>
              <p className="mt-1 leading-6 text-muted-foreground">{describeIntegrity(rules)}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={rules.tabSwitches > 0 ? "warning" : "neutral"}>{toPersianNumber(rules.tabSwitches)} بار بیرون‌رفتن از تب{rules.maxTabSwitches ? ` از ${toPersianNumber(rules.maxTabSwitches)}` : ""}</Badge>
                <Badge variant={rules.copyEvents > 0 ? "warning" : "neutral"}>{toPersianNumber(rules.copyEvents)} کپی یا چسباندن</Badge>
                {rules.lockToOneDevice && <Badge variant="neutral">قفل یک‌دستگاه فعال بود</Badge>}
              </p>
            </div>
          );
        })()}
        </CardContent>
      </Card>

      {sheet.session_signals.length > 0 && (
        <details className="rounded-2xl border bg-card/70 p-3 text-xs">
          <summary className="cursor-pointer font-black">نشانه‌های نشست ({toPersianNumber(sheet.session_signals.length)})</summary>
          <p className="mt-2 leading-6 text-muted-foreground">این‌ها مشاهدهٔ سامانه‌اند، نه مدرک تقلب؛ هیچ نمره‌ای بر پایهٔ آن‌ها تغییر نمی‌کند و زمان‌ها از سرور ثبت شده‌اند.</p>
          <ul className="mt-2 space-y-1">{sheet.session_signals.map((signal) => <li key={signal.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-1.5"><span className="font-bold">{signalLabel(signal.kind)}</span><span className="text-muted-foreground">{signal.created_at ? formatDateTime(signal.created_at) : ""}</span></li>)}</ul>
        </details>
      )}

      <div className="space-y-3">
        {sheet.answers.map((answer) => (
          <AnswerRow
            key={answer.id}
            answer={answer}
            mark={marks[answer.question_id] ?? ""}
            markChanged={(marks[answer.question_id] ?? "") !== (seeded[answer.question_id] ?? "")}
            feedback={feedback[answer.question_id] ?? ""}
            onMark={(value) => setMarks((current) => ({ ...current, [answer.question_id]: value }))}
            onFeedback={(value) => setFeedback((current) => ({ ...current, [answer.question_id]: value }))}
            onSave={(action) => void saveAnswer(answer.question_id, action)}
            saving={busy === answer.question_id}
          />
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">بازخورد کلی دانش‌آموز</CardTitle><CardDescription>همراه نتیجهٔ منتشرشده به دانش‌آموز نشان داده می‌شود.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={overall} onChange={(event) => setOverall(event.target.value)} className="min-h-20" placeholder="نکته‌ای که دانش‌آموز برای پیشرفت بعدی لازم دارد..."/>
          <div className="flex justify-end"><Button size="sm" onClick={() => void saveOverall()} disabled={busy === "overall"}><Save className="h-4 w-4"/>ذخیرهٔ بازخورد</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}

function AnswerRow({ answer, mark, markChanged, feedback, onMark, onFeedback, onSave, saving }: { answer: ApiTeacherAttemptDetailDto["answers"][number]; mark: string; markChanged: boolean; feedback: string; onMark: (value: string) => void; onFeedback: (value: string) => void; onSave: (action: "mark" | "note" | "clear") => void; saving: boolean }) {
  const verdict = VERDICT_LABELS[answer.verdict] ?? VERDICT_LABELS.unanswered!;
  const maximum = numeric(answer.maximum_score);
  // A keyed row is writable too. `needsDecision` is the amber "still open" signal - only a question that
  // needs a human counts as unfinished work - while `overridden` marks a row where the pen outvoted the key.
  const needsDecision = answer.manual_grading_required && (mark === "" || mark === undefined);
  const overridden = answer.is_overridden === true;
  const auto = numeric(answer.auto_awarded_score ?? answer.awarded_score);
  const editable = true;
  return (
    <Card data-answer-id={answer.question_id} className={cn("border", needsDecision ? "border-amber-500/35" : overridden || mark !== "" ? "border-emerald-500/25" : "border")}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-black text-primary">سؤال {toPersianNumber(answer.question_order)}</span>
          <Badge variant={verdict.variant}>{verdict.label}</Badge>
          {!answer.manual_grading_required && (
            <span className="text-[11px] font-bold text-muted-foreground">
              {overridden
                ? `نمرهٔ معلم · ${toPersianNumber(numeric(answer.awarded_score))} از ${toPersianNumber(maximum)} نمره · کلید ${toPersianNumber(auto)}`
                : `خودکار · ${toPersianNumber(auto)} از ${toPersianNumber(maximum)} نمره`}
            </span>
          )}
          {answer.is_flagged && <Badge variant="warning">نشان‌دار برای مرور</Badge>}
          {editable && <span className="mr-auto text-[11px] font-bold text-muted-foreground">بارم {toPersianNumber(maximum)}</span>}
        </div>
        <CardTitle className="text-sm font-black leading-7">{answer.question_text}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-2xl bg-muted/45 p-3 text-xs leading-6">
          {answer.text || (answer.selected_option_texts.length ? answer.selected_option_texts.join("، ") : "—")}
        </div>
        {!answer.manual_grading_required && !markChanged && (
          <p className="text-[11px] leading-6 text-muted-foreground">
            این عدد را کلید داده است. عوضش کنید اگر نظر خودتان جای آن را می‌گیرد؛ بی‌تغییر گذاشتنش همان نمرهٔ
            کلید را نگه می‌دارد و چیزی را به‌عنوان تصمیم شما ذخیره نمی‌کند.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[130px_1fr_auto] sm:items-start">
            <label className="block text-[11px] font-bold">
              <span className="mb-1 block text-muted-foreground">نمرهٔ شما</span>
              <Input
                id={`mark-${answer.question_id}`}
                type="number"
                min="0"
                max={maximum}
                step="0.25"
                value={mark}
                onChange={(event) => onMark(event.target.value)}
                onKeyDown={(event) => {
                  // Enter is the whole gesture: write this number and move on, without hunting for the button.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSave("mark");
                  }
                }} className="h-10"/>
            </label>
            <label className="block text-[11px] font-bold">
              <span className="mb-1 block text-muted-foreground">بازخورد این سؤال</span>
              <Input value={feedback} onChange={(event) => onFeedback(event.target.value)} className="h-10" placeholder="اختیاری"/>
            </label>
            <div className="flex items-end gap-1.5 pt-0 sm:pt-5">
              <Button type="button" variant="outline" size="sm" onClick={() => onMark("0")}>۰</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onMark(String(maximum))}>تمام بارم</Button>
              {/*
                The primary button follows what the teacher actually changed, not whether the box is empty. A
                keyed row now opens holding the key's own number, so "empty" no longer means "nothing decided" —
                and a note written next to an untouched number must still save as a note alone.
              */}
              {markChanged ? (
                <Button type="button" size="sm" onClick={() => onSave("mark")} disabled={saving}>
                  <Save className="h-4 w-4"/>
                  {saving ? "در حال ذخیره" : "ذخیرهٔ نمره"}
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => onSave("note")} disabled={saving}>
                  <Save className="h-4 w-4"/>
                  {saving ? "در حال ذخیره" : "ذخیرهٔ نکته"}
                </Button>
              )}
              {overridden && (
                <Button type="button" variant="ghost" size="sm" onClick={() => onSave("clear")}>بازگشت به نمرهٔ خودکار</Button>
              )}
            </div>
          </div>
      </CardContent>
    </Card>
  );
}

/** One question, every student. Marks are drafted on the screen and saved as a single batch. */
function QuestionPanel({ examId, page, onSaved, onSelectQuestion }: { examId: string; page: ApiGradingQuestionPageDto | null; onSaved: (next: { page: ApiGradingQuestionPageDto; board: ApiGradingBoardDto }) => void; onSelectQuestion: (id: string) => void }) {
  const toast = useToastStore((state) => state.push);
  const [drafts, setDrafts] = useState<Record<string, { mark: string; feedback: string }>>({});
  const [saving, setSaving] = useState(false);
  const firstInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!page) return;
    setDrafts(Object.fromEntries(page.rows.map((row) => [row.attempt_id, { mark: row.manual_score === null || row.manual_score === undefined ? "" : String(row.manual_score), feedback: row.feedback || "" }])));
    firstInput.current?.focus();
  }, [page]);

  const questions = page?.progress.questions ?? [];
  const index = page ? page.progress.index : 0;
  const previous = questions[index - 2];
  const next = questions[index];
  const maximum = numeric(page?.question.marks ?? 0);
  const dirty = Object.entries(drafts).filter(([attemptId, draft]) => {
    const original = page?.rows.find((row) => row.attempt_id === attemptId);
    if (!original) return false;
    const currentMark = original.manual_score === null || original.manual_score === undefined ? "" : String(original.manual_score);
    return draft.mark !== currentMark || (draft.feedback || "") !== (original.feedback || "");
  });

  const distribution = useMemo(() => {
    // Only choice questions have a distribution worth drawing; a written answer is one text per student.
    if (!page || !["multiple_choice", "multiple_answer", "true_false"].includes(page.question.type)) return [];
    const counts = new Map<string, number>();
    const optionLabels = new Map<string, string>();
    page.rows.forEach((row) => {
      row.selected_option_ids.forEach((optionId, position) => {
        counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
        const text = row.selected_option_texts[position];
        if (text && !optionLabels.has(optionId)) optionLabels.set(optionId, text);
      });
    });
    return page.question.correct_option_ids.length || counts.size
      ? [...counts.entries()].map(([optionId, count]) => ({ optionId, label: optionLabels.get(optionId) ?? optionId, count, correct: page.question.correct_option_ids.includes(optionId) }))
      : [];
  }, [page]);

  async function save() {
    if (!page) return;
    const grades = dirty.map(([attemptId, draft]) => {
      const original = page.rows.find((row) => row.attempt_id === attemptId);
      // An empty box means three different things, and telling them apart is the whole point of this rule:
      // undo a decision the teacher has taken back (`null`), keep the sheet's zero idiom for a written
      // question that never had a mark, or say nothing at all about a keyed answer nobody meant to touch.
      let mark: string | number | null | undefined = draft.mark;
      if (draft.mark === "") {
        if (original?.manual_score !== null && original?.manual_score !== undefined) mark = null;
        else if (page.question.requires_manual_grading) mark = "0";
        else mark = undefined;
      }
      return { attempt_id: attemptId, ...(mark === undefined ? {} : { mark }), feedback: draft.feedback };
    });
    if (grades.length === 0) { toast({ title: "چیزی برای ذخیره نیست", description: "نمره‌ای را تغییر دهید." }); return; }
    setSaving(true);
    try {
      const result = await resultsApi.saveQuestionGrades(examId, page.question.id, grades);
      const fresh = await resultsApi.gradingQuestion(examId, page.question.id);
      const board = await resultsApi.gradingBoard(examId);
      onSaved({ page: fresh, board });
      toast({ title: `${toPersianNumber(result.saved)} نمره ذخیره شد`, description: "برگهٔ دانش‌آموزان دوباره نمره گرفته شد.", variant: "success" });
    } catch (reason) {
      toast({ title: "ذخیرهٔ دسته‌ای انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  function fillRemainingWithZero() {
    if (!page) return;
    setDrafts((current) => {
      const nextDrafts = { ...current };
      page.rows.forEach((row) => {
        if (!page.question.requires_manual_grading) return;
        const empty = row.manual_score === null || row.manual_score === undefined || String(row.manual_score) === "";
        if (empty) nextDrafts[row.attempt_id] = { mark: "0", feedback: current[row.attempt_id]?.feedback ?? "" };
      });
      return nextDrafts;
    });
  }

  if (!page) return <Card><CardContent className="py-10"><EmptyState title="سؤالی انتخاب نشده" description="از فهرست سؤال‌ها یک سؤال را انتخاب کنید تا پاسخ همهٔ دانش‌آموزان یک‌جا نمایش داده شود."/></CardContent></Card>;

  return (
    <div className="space-y-4 pb-24">
      <Card className="border-primary/20 bg-primary/[.03]">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted-foreground">
            <span className="rounded-lg bg-primary px-2 py-1 text-[11px] font-black text-white">سؤال {toPersianNumber(page.question.order)} از {toPersianNumber(page.progress.total)}</span>
            <Badge variant="neutral">بارم {toPersianNumber(maximum)}</Badge>
            {page.question.requires_manual_grading ? <Badge variant="warning">نمره‌گذاری دست‌ی</Badge> : <Badge variant="teal">کلیددار · نمرهٔ خودکار</Badge>}
            {page.stats.answered_count !== undefined && <span>{toPersianNumber(page.stats.answered_count)} پاسخ از {toPersianNumber(page.stats.attempt_count)}</span>}
            {page.stats.average_score !== null && page.stats.average_score !== undefined && <span>میانگین {toPersianNumber(numeric(page.stats.average_score).toFixed(2))}</span>}
          </div>
          <CardTitle className="text-base font-black leading-8">{page.question.text}</CardTitle>
          {page.question.instructions && <p className="text-xs leading-6 text-muted-foreground">{page.question.instructions}</p>}
        </CardHeader>
        <CardContent className="space-y-3">
          {page.question.correct_option_ids.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              {distribution.map((item) => (
                <span key={item.optionId} className={cn("rounded-xl border px-2.5 py-1.5", item.correct ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted/50 text-muted-foreground")}>
                  {item.correct ? "کلید · " : ""}{item.label} · {toPersianNumber(item.count)} نفر
                </span>
              ))}
            </div>
          )}
          {page.question.expected_answers.length > 0 && (
            <div className="rounded-2xl border bg-card p-3 text-[11px] leading-6">
              <span className="font-black">پاسخ‌های مورد انتظار: </span>{page.question.expected_answers.join(" / ")}
            </div>
          )}
          {(page.question.explanation || page.question.grading_notes) && (
            <div className="rounded-2xl bg-muted/45 p-3 text-[11px] leading-6 text-muted-foreground">
              <Sparkles className="ml-1 inline h-3.5 w-3.5 text-primary"/>{page.question.grading_notes || page.question.explanation}
            </div>
          )}
        </CardContent>
      </Card>

      {page.rows.length === 0 ? <EmptyState title="برگه‌ای برای این سؤال نیست" description="هیچ دانش‌آموزی این آزمون را به پایان نرسانده است."/> : (
        <div className="space-y-2.5">
          {page.rows.map((row, rowIndex) => {
            const draft = drafts[row.attempt_id] ?? { mark: "", feedback: "" };
            const verdict = VERDICT_LABELS[row.verdict] ?? VERDICT_LABELS.unanswered!;
            return (
              <Card key={row.attempt_id} className={cn(page.question.requires_manual_grading && draft.mark === "" ? "border-amber-500/35" : row.is_overridden || draft.mark !== "" ? "border-emerald-500/25" : undefined)}>
                <CardContent className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Avatar name={row.student_name} size="sm"/>
                      <p className="text-xs font-black">{row.student_name}</p>
                      <span className="text-[10px] text-muted-foreground">{[row.grade, row.class_name].filter(Boolean).join(" · ")}</span>
                      <Badge variant={verdict.variant}>{verdict.label}</Badge>
                      {row.is_flagged && <Badge variant="warning">نشان‌دار</Badge>}
                      {!page.question.requires_manual_grading && (
                        <span className="text-[10px] font-bold text-muted-foreground">
                          {row.is_overridden
                            ? `نمرهٔ معلم ${toPersianNumber(numeric(row.awarded_score))} · کلید ${toPersianNumber(numeric(row.auto_score ?? row.awarded_score))}`
                            : `${toPersianNumber(numeric(row.awarded_score))} از ${toPersianNumber(maximum)}`}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/45 p-2.5 text-[11px] leading-6">{row.text || row.selected_option_texts.join("، ") || "—"}</p>
                      <Input value={draft.feedback} onChange={(event) => setDrafts((current) => ({ ...current, [row.attempt_id]: { ...draft, feedback: event.target.value } }))} aria-label={`نکتهٔ ${row.student_name}`}
                        className="mt-2 h-9 text-[11px]" placeholder="بازخورد کوتاه برای این دانش‌آموز (اختیاری)"/>
                  </div>
                  <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
                    <>
                        <Input
                          ref={rowIndex === 0 ? firstInput : undefined}
                          id={`cohort-mark-${rowIndex}`}
                          aria-label={`نمرهٔ ${row.student_name}`}
                          type="number" min="0" max={maximum} step="0.25" value={draft.mark}
                          onChange={(event) => setDrafts((current) => ({ ...current, [row.attempt_id]: { ...draft, mark: event.target.value } }))}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            (document.getElementById(`cohort-mark-${rowIndex + 1}`) as HTMLInputElement | null)?.focus();
                          }}
                          className="h-9 w-20 text-center text-xs font-black"
                        />
                        <Button type="button" variant="outline" size="sm" onClick={() => setDrafts((current) => ({ ...current, [row.attempt_id]: { ...draft, mark: "0" } }))}>۰</Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setDrafts((current) => ({ ...current, [row.attempt_id]: { ...draft, mark: String(maximum) } }))} title={`تمام بارم: ${maximum}`}>تمام</Button>
                        {row.is_overridden && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDrafts((current) => ({ ...current, [row.attempt_id]: { ...draft, mark: "" } }))}>
                            بازگشت به کلید
                          </Button>
                        )}
                    </>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-[1540px] flex-wrap items-center gap-2 rounded-2xl border bg-card/95 p-2.5 shadow-lift backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!previous} onClick={() => previous && onSelectQuestion(previous.id)}><ChevronRight className="h-4 w-4"/>سؤال قبل</Button>
          <Button variant="outline" size="sm" disabled={!next} onClick={() => next && onSelectQuestion(next.id)}>سؤال بعد<ChevronLeft className="h-4 w-4"/></Button>
        </div>
        {page.question.requires_manual_grading && <Button variant="ghost" size="sm" onClick={fillRemainingWithZero}><Wand2 className="h-4 w-4"/>پُر کردن ۰ در خانه‌های خالی</Button>}
        <p className="text-[11px] font-bold text-muted-foreground">{dirty.length === 0 ? "تغییری ثبت نشده است" : `${toPersianNumber(dirty.length)} نمرهٔ آمادهٔ ذخیره`} <span className="font-normal">(هنوز ذخیره نشده)</span></p>
        <div className="mr-auto flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground"/>
          <span className="text-[11px] font-bold">{toPersianNumber(page.stats.graded_count ?? 0)} از {toPersianNumber((page.stats.graded_count ?? 0) + (page.stats.pending_count ?? 0))} نمرهٔ دستی این سؤال</span>
          <Button size="sm" onClick={() => void save()} disabled={saving || dirty.length === 0}><Save className="h-4 w-4"/>{saving ? "در حال ذخیره" : "ذخیرهٔ نمره‌ها"}</Button>
        </div>
      </div>
    </div>
  );
}

function MarkingSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      <div className="h-72 animate-soft-pulse rounded-2xl bg-muted"/>
      <div className="space-y-3"><div className="h-28 animate-soft-pulse rounded-2xl bg-muted"/><div className="h-52 animate-soft-pulse rounded-2xl bg-muted"/><div className="h-52 animate-soft-pulse rounded-3xl bg-muted"/></div>
    </div>
  );
}
