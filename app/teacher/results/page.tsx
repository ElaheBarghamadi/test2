"use client";

import { ArrowUpDown, CheckCircle2, Download, Search, Send, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { resultsApi } from "@/lib/api/results";
import { apiErrorMessage } from "@/lib/api/client";
import type { ApiGradingQueueRowDto, ApiTeacherAttemptDetailDto, ApiTeacherResultRowDto } from "@/lib/api/dtos";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { Avatar } from "@/components/shared/avatar";
import { DonutChart } from "@/components/charts/performance-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTeacherExams } from "@/hooks/use-teacher-exams";
import { useToastStore } from "@/lib/state/toast-store";
import { cn, toPersianNumber } from "@/lib/utils";

type SubmissionFilter = "all" | "submitted" | "in_progress" | "needs_grading";
const statusInfo = { submitted: ["ارسال شده", "success"], in_progress: ["در حال پاسخ‌گویی", "default"], needs_grading: ["نیازمند تصحیح", "warning"] } as const;
const numeric = (value: string | number | null | undefined) => Number(value || 0);

export default function TeacherResultsPage() {
  const { exams, loading, initialized } = useTeacherExams();
  const toast = useToastStore((state) => state.push);
  const available = exams.filter((exam) => ["active", "completed", "scheduled"].includes(exam.status));
  const [examId, setExamId] = useState(""); const [query, setQuery] = useState(""); const [filter, setFilter] = useState<SubmissionFilter>("all"); const [sort, setSort] = useState<"score" | "time">("score");
  const [rows, setRows] = useState<ApiTeacherResultRowDto[]>([]); const [rowsLoading, setRowsLoading] = useState(false); const [error, setError] = useState<string | null>(null); const [attempt, setAttempt] = useState<ApiTeacherAttemptDetailDto | null>(null);
  const [queue, setQueue] = useState<ApiGradingQueueRowDto[]>([]); const [queueLoading, setQueueLoading] = useState(false);
  useEffect(() => { if (!examId && available[0]) setExamId(available[0].id); }, [available, examId]);
  async function loadRows(id = examId) { if (!id) return; setRowsLoading(true); setError(null); setQueueLoading(true);
    try { setRows(await resultsApi.teacherExamRows(id)); } catch (reason) { setError(apiErrorMessage(reason, "دریافت نتایج آزمون انجام نشد.")); } finally { setRowsLoading(false); }
    // The queue is teacher-wide on purpose: "what still needs my pen" should not be scoped to the exam
    // that happens to be selected.
    try { setQueue((await resultsApi.gradingQueue()).queue); } catch { setQueue([]); } finally { setQueueLoading(false); }
  }
  useEffect(() => { void loadRows(); }, [examId]); // eslint-disable-line react-hooks/exhaustive-deps
  const exam = available.find((item) => item.id === examId) ?? available[0];
  const shown = useMemo(() => rows.filter((row) => `${row.student_name} ${row.student_email}`.toLowerCase().includes(query.trim().toLowerCase()) && (filter === "all" || row.submission_status === filter)).sort((a, b) => sort === "score" ? numeric(b.score) - numeric(a.score) : (a.completion_minutes ?? Number.MAX_SAFE_INTEGER) - (b.completion_minutes ?? Number.MAX_SAFE_INTEGER)), [filter, query, rows, sort]);
  const finalized = rows.filter((row) => row.submission_status !== "in_progress"); const average = finalized.length ? finalized.reduce((sum, row) => sum + numeric(row.score), 0) / finalized.length : 0; const needsGrading = rows.filter((row) => row.submission_status === "needs_grading").length; const passMark = numeric(exam?.settings.passingPercentage ?? 0); const graded = finalized.filter((row) => row.percentage !== null); const passedCount = passMark > 0 ? graded.filter((row) => numeric(row.percentage) >= passMark).length : 0; function verdict(row: ApiTeacherResultRowDto) { if (passMark <= 0 || row.percentage === null || row.submission_status === "in_progress") return null; return numeric(row.percentage) >= passMark ? "قبول" : "مردود"; }
  async function selectAttempt(attemptId: string) { try { setAttempt(await resultsApi.teacherAttempt(attemptId)); } catch (reason) { toast({ title: "دریافت پاسخ‌ها انجام نشد", description: apiErrorMessage(reason), variant: "error" }); } }
  async function publish() { if (!exam) return; try { const result = await resultsApi.publishExamResults(exam.id); await loadRows(); toast({ title: `${toPersianNumber(result.published_count)} نتیجه منتشر شد`, description: result.pending_manual_grading_count ? `${toPersianNumber(result.pending_manual_grading_count)} پاسخ هنوز نیازمند تصحیح است.` : "همهٔ نتایج آمادهٔ انتشار، برای دانش‌آموزان قابل مشاهده شدند.", variant: "success" }); } catch (reason) { toast({ title: "انتشار نتیجه انجام نشد", description: apiErrorMessage(reason), variant: "error" }); } }
  function downloadReport() { const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`; const statusLabels: Record<string, string> = { submitted: "ارسال‌شده", in_progress: "در حال پاسخ", needs_grading: "نیازمند تصحیح" };
    const csv = [["دانش‌آموز", "ایمیل", "کلاس", "آزمون", "شمارهٔ تلاش", "وضعیت", "نمره", "از", "درصد", "دقیقه", "تصحیح دستی", "زمان ارسال", "حکم"], ...rows.map((row) => [row.student_name, row.student_email, [row.grade, row.class_name].filter(Boolean).join(" / "), exam?.title ?? "", row.attempt_number, statusLabels[row.submission_status] ?? row.submission_status, row.score ?? "", row.maximum_score, row.percentage ?? "", row.completion_minutes ?? "", row.manual_grading_count ? `${row.manual_grading_count - row.pending_manual_grading_count}/${row.manual_grading_count}` : "", row.submitted_at ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(row.submitted_at)) : "", verdict(row) ?? ""])].map((line) => line.map(escape).join(",")).join("\n"); const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `results-${exam?.title || "exam"}.csv`; link.click(); URL.revokeObjectURL(url); }
  return <PageTransition><PageContainer><PageHeader eyebrow="تحلیل عملکرد" title="نتایج آزمون‌ها" description="تلاش‌های واقعی دانش‌آموزان را بررسی، پاسخ‌های متنی را تصحیح و نتیجه‌ها را منتشر کنید." breadcrumbs={[{ label: "آموزگار", href: "/teacher/dashboard" }, { label: "نتایج" }]} action={<Button variant="outline" onClick={downloadReport} disabled={!rows.length}><Download className="h-4 w-4"/>دریافت گزارش</Button>}/>{loading && !initialized ? <ResultsSkeleton/> : !available.length ? <EmptyState title="آزمون قابل گزارش ندارید" description="پس از انتشار یا شروع نخستین آزمون، تلاش‌های دانش‌آموزان اینجا نمایش داده می‌شوند."/> : <><Card><CardContent className="p-5 sm:p-6"><label className="block max-w-md text-xs font-bold text-muted-foreground">انتخاب آزمون<select value={exam?.id ?? ""} onChange={(event) => setExamId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-sm font-extrabold text-foreground">{available.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="flex items-center gap-4 rounded-2xl bg-muted/45 p-4"><DonutChart value={Math.round((average / Math.max(exam?.settings.totalMarks || 1, 1)) * 100)}/><div><p className="text-xs font-bold text-muted-foreground">میانگین تلاش‌های نهایی</p><p className="mt-1 text-lg font-black">{toPersianNumber(average.toFixed(1))} <span className="text-xs text-muted-foreground">از {toPersianNumber(exam?.settings.totalMarks ?? 0)}</span></p></div></div><ResultMetric label="نرخ تکمیل" value={`${toPersianNumber(Math.round((finalized.length / Math.max(rows.length, 1)) * 100))}٪`} detail={`${toPersianNumber(finalized.length)} تلاش نهایی از ${toPersianNumber(rows.length)}`} tone="text-primary"/><ResultMetric label="نیازمند تصحیح" value={toPersianNumber(needsGrading)} detail="پاسخ متنی در صف بررسی" tone="text-amber-600"/><ResultMetric label={passMark > 0 ? "نرخ قبولی" : "حدنصاب قبولی"} value={passMark > 0 ? `${toPersianNumber(Math.round((passedCount / Math.max(graded.length, 1)) * 100))}٪` : "تعیین‌نشده"} detail={passMark > 0 ? `${toPersianNumber(passedCount)} از ${toPersianNumber(graded.length)} تلاشِ نمره‌گرفته` : "برای محاسبهٔ حکم، در تنظیمات آزمون حداقل نمره بگذارید"} tone={passMark > 0 ? "text-emerald-600" : "text-muted-foreground"}/></div><div className="mt-5 flex justify-end"><Button onClick={() => void publish()} disabled={!rows.length}><Send className="h-4 w-4"/>انتشار نتایج آماده</Button></div></CardContent></Card>{queue.length > 0 && <Card className="mt-6"><CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>صف تصحیح</CardTitle><CardDescription>{toPersianNumber(queue.length)} تلاش با پاسخ‌های نمره‌نگرفته؛ کم‌پیشرفته‌ترین‌ها اول.</CardDescription></div>{queueLoading && <span className="text-[11px] text-muted-foreground">در حال بارگیری…</span>}</CardHeader><CardContent><div className="flex gap-2 overflow-x-auto pb-1">{queue.map((item) => { const done = item.graded_count; const total = item.manual_count; return <button key={item.attempt_id} type="button" onClick={() => { setExamId(item.exam_id); void selectAttempt(item.attempt_id); }} className="min-w-56 shrink-0 rounded-2xl border bg-card p-3 text-right transition-colors hover:border-primary/45"><p className="truncate text-xs font-black">{item.student_name}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.exam_title} · تلاش {toPersianNumber(item.attempt_number)}</p><p className="mt-2 text-[11px] font-bold">{toPersianNumber(done)} / {toPersianNumber(total)} تصحیح‌شده</p><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} aria-label={`پیشرفت تصحیح ${item.student_name}`}><div className="h-full rounded-full bg-amber-500" style={{ width: `${item.progress}%` }}/></div></button>; })}</div></CardContent></Card>}
        <Card className="mt-6"><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>عملکرد دانش‌آموزان</CardTitle><CardDescription>هر ردیف را برای مشاهده پاسخ‌ها و تصحیح متن انتخاب کنید.</CardDescription></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full pr-9 text-xs sm:w-52" placeholder="جست‌وجوی دانش‌آموز..."/></div><label className="flex h-9 items-center gap-1 rounded-xl border px-2 text-xs"><ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground"/><select value={sort} onChange={(event) => setSort(event.target.value as "score" | "time")} className="bg-transparent outline-none"><option value="score">نمره</option><option value="time">زمان تکمیل</option></select></label></div></CardHeader><CardContent><div className="mb-4 flex gap-1 overflow-x-auto">{([{ value: "all", label: "همه" }, { value: "submitted", label: "ارسال‌شده" }, { value: "needs_grading", label: "نیازمند تصحیح" }, { value: "in_progress", label: "در حال پاسخ" }] as Array<{ value: SubmissionFilter; label: string }>).map((item) => <Button key={item.value} type="button" size="sm" variant={filter === item.value ? "default" : "ghost"} onClick={() => setFilter(item.value)}>{item.label}</Button>)}</div>{error ? <EmptyState title="نتایج دریافت نشد" description={error} action={{ label: "تلاش دوباره", onClick: () => void loadRows() }}/> : rowsLoading ? <ResultsSkeleton/> : shown.length === 0 ? <EmptyState title="تلاشی با این فیلتر پیدا نشد" description="پس از شروع آزمون توسط دانش‌آموز، وضعیت او اینجا نمایش داده می‌شود."/> : <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-right"><thead className="border-y bg-muted/45 text-[11px] text-muted-foreground"><tr><th className="p-3 font-bold">دانش‌آموز</th><th className="p-3 font-bold">نمره</th>{passMark > 0 && <th className="p-3 font-bold">حکم</th>}<th className="p-3 font-bold">وضعیت</th><th className="p-3 font-bold">تلاش</th><th className="p-3 font-bold">تصحیح</th><th className="p-3 font-bold">زمان تکمیل</th><th className="p-3 font-bold">ارسال</th></tr></thead><tbody>{shown.map((row) => { const [label, variant] = statusInfo[row.submission_status]; return <tr key={row.id} onClick={() => void selectAttempt(row.id)} className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"><td className="p-3"><div className="flex items-center gap-2"><Avatar name={row.student_name} size="sm"/><span className="text-sm font-bold">{row.student_name}</span></div></td><td className="p-3 text-sm font-black">{row.score !== null ? <>{toPersianNumber(numeric(row.score))} <span className="text-[11px] font-normal text-muted-foreground">از {toPersianNumber(numeric(row.maximum_score))}</span></> : "—"}</td>{passMark > 0 && <td className="p-3">{verdict(row) ? <Badge variant={verdict(row) === "قبول" ? "success" : "destructive"}>{verdict(row)}</Badge> : <span className="text-[11px] text-muted-foreground">—</span>}</td>}<td className="p-3"><Badge variant={variant}>{label}</Badge></td><td className="p-3 text-xs font-bold">#{toPersianNumber(row.attempt_number)}</td><td className="p-3 text-xs font-bold">{row.manual_grading_count ? <span className={row.pending_manual_grading_count ? "text-amber-600" : "text-emerald-600"}>{toPersianNumber(row.manual_grading_count - row.pending_manual_grading_count)}/{toPersianNumber(row.manual_grading_count)}</span> : <span className="text-muted-foreground">—</span>}</td><td className="p-3 text-xs text-muted-foreground">{row.completion_minutes !== null ? `${toPersianNumber(row.completion_minutes)} دقیقه` : "—"}</td><td className="p-3 text-xs text-muted-foreground">{row.submitted_at ? new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date(row.submitted_at)) : "—"}</td></tr>; })}</tbody></table></div>}</CardContent></Card></>}</PageContainer><GradeDialog attempt={attempt} onClose={() => setAttempt(null)} onUpdated={setAttempt} afterSave={() => void loadRows()}/></PageTransition>;
}
function GradeDialog({ attempt, onClose, onUpdated, afterSave }: { attempt: ApiTeacherAttemptDetailDto | null; onClose: () => void; onUpdated: (attempt: ApiTeacherAttemptDetailDto) => void; afterSave: () => void }) {
  const toast = useToastStore((state) => state.push);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [overallFeedback, setOverallFeedback] = useState("");
  useEffect(() => {
    if (!attempt) return;
    setScores(Object.fromEntries(attempt.answers.map((answer) => [answer.question_id, answer.manual_score?.toString() ?? ""])));
    setFeedback(Object.fromEntries(attempt.answers.map((answer) => [answer.question_id, answer.feedback || ""])));
    setOverallFeedback(attempt.result?.feedback || "");
  }, [attempt]);
  async function refresh() { if (attempt) onUpdated(await resultsApi.teacherAttempt(attempt.id)); }
  /** Focus the next ungraded answer: the marking flow is list → grade → next, not hunt → scroll → find. */
  function jumpTo(questionId: string) {
    const node = document.getElementById(`grade-${questionId}`);
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.querySelector<HTMLInputElement>("input[type=number]")?.focus();
  }
  async function grade(questionId: string) {
    const value = Number(scores[questionId]);
    if (!Number.isFinite(value) || value < 0) { toast({ title: "نمره معتبر وارد کنید", variant: "error" }); return; }
    const target = attempt?.answers.find((answer) => answer.question_id === questionId);
    if (target && value > numeric(target.maximum_score)) { toast({ title: "نمره بیشتر از بارم سؤال است", description: `حداکثر ${toPersianNumber(numeric(target.maximum_score))} نمره برای این سؤال در نظر گرفته شده است.`, variant: "error" }); return; }
    setSavingId(questionId);
    try {
      await resultsApi.gradeAnswer(attempt!.id, questionId, { manual_score: value, feedback: feedback[questionId] || "" });
      await refresh(); afterSave(); toast({ title: "نمره ذخیره شد", variant: "success" });
    } catch (reason) { toast({ title: "ذخیره نمره انجام نشد", description: apiErrorMessage(reason), variant: "error" }); }
    finally { setSavingId(null); }
  }
  async function saveOverallFeedback() {
    if (!attempt) return; setSavingId("overall");
    try { await resultsApi.updateFeedback(attempt.id, overallFeedback); await refresh(); toast({ title: "بازخورد کلی ذخیره شد", variant: "success" }); }
    catch (reason) { toast({ title: "ذخیره بازخورد انجام نشد", description: apiErrorMessage(reason), variant: "error" }); }
    finally { setSavingId(null); }
  }
  const manual = attempt?.answers.filter((answer) => answer.manual_grading_required) || [];
  const gradedCount = manual.filter((answer) => answer.manual_score !== null).length;
  const nextOpen = manual.find((answer) => answer.manual_score === null);
  const signals = attempt?.session_signals ?? [];
  return <Dialog open={Boolean(attempt)} onClose={onClose} title={attempt ? `پاسخ‌های ${attempt.student.full_name}` : "پاسخ‌ها"} description={attempt ? `${attempt.exam.title} · ${attempt.student.grade} ${attempt.student.class_name}` : undefined} size="md">
    {manual.length > 0 && <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-muted/55 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-black">{toPersianNumber(gradedCount)} / {toPersianNumber(manual.length)} پاسخ تصحیح شده است</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background" role="progressbar" aria-valuemin={0} aria-valuemax={manual.length} aria-valuenow={gradedCount} aria-label="پیشرفت تصحیح دستی">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(gradedCount / Math.max(manual.length, 1)) * 100}%` }}/>
        </div>
      </div>
      {nextOpen && <Button size="sm" variant="outline" onClick={() => jumpTo(nextOpen.question_id)}>پرش به پاسخ بعدی</Button>}
    </div>}
    {manual.length ? <div className="max-h-[52vh] space-y-4 overflow-y-auto pl-1">{manual.map((answer) => <div className={cn("rounded-2xl border p-4", answer.manual_score === null && "border-amber-500/35")} key={answer.id} id={`grade-${answer.question_id}`} data-graded={answer.manual_score !== null}><div className="flex items-start justify-between gap-4"><p className="text-sm font-black">{toPersianNumber(answer.question_order)}. {answer.question_text}</p><Badge variant={answer.manual_score === null ? "warning" : "success"}>{toPersianNumber(numeric(answer.maximum_score))} نمره</Badge></div><p className="mt-3 rounded-xl bg-muted/60 p-3 text-sm leading-7 text-muted-foreground">{answer.text || "دانش‌آموز پاسخی ثبت نکرده است."}</p><div className="mt-3 grid gap-3 sm:grid-cols-[130px_1fr_auto]"><Input type="number" min="0" max={numeric(answer.maximum_score)} step="0.25" value={scores[answer.question_id] ?? ""} onChange={(event) => setScores((old) => ({ ...old, [answer.question_id]: event.target.value }))} placeholder={`از ${numeric(answer.maximum_score)}`} aria-label={`نمرهٔ سؤال ${answer.question_order} از ${numeric(answer.maximum_score)}`} inputMode="decimal"/><Textarea value={feedback[answer.question_id] ?? ""} onChange={(event) => setFeedback((old) => ({ ...old, [answer.question_id]: event.target.value }))} className="min-h-11" placeholder="بازخورد این پاسخ…"/><Button size="sm" onClick={() => void grade(answer.question_id)} disabled={savingId === answer.question_id}>{savingId === answer.question_id ? "ذخیره…" : "ثبت نمره"}<Star className="h-3.5 w-3.5"/></Button></div></div>)}</div> : <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">پاسخ متنی برای تصحیح دستی در این تلاش ثبت نشده است.</p>}
    {signals.length > 0 && <div className="mt-5 border-t pt-4">
      <p className="text-sm font-black">نشانه‌های نشست</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">این‌ها مشاهدهٔ سامانه‌اند، نه مدرک تقلب؛ هیچ نمره‌ای بر پایهٔ آن‌ها تغییر نمی‌کند. زمان‌ها از سرور ثبت شده‌اند.</p>
      <ul className="mt-2 space-y-1">{signals.map((signal) => <li key={signal.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-1.5 text-[11px]"><span className="font-bold">{signalLabel(signal.kind)}</span><span className="text-muted-foreground">{new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(signal.created_at))}</span></li>)}</ul>
    </div>}
    <div className="mt-5 border-t pt-4"><p className="text-sm font-black">بازخورد کلی دانش‌آموز</p><Textarea value={overallFeedback} onChange={(event) => setOverallFeedback(event.target.value)} className="mt-2 min-h-20" placeholder="این بازخورد همراه نتیجهٔ منتشرشده به دانش‌آموز نشان داده می‌شود…"/><div className="mt-2 flex justify-end"><Button size="sm" variant="outline" onClick={() => void saveOverallFeedback()} disabled={savingId === "overall"}>{savingId === "overall" ? "در حال ذخیره…" : "ذخیره بازخورد کلی"}</Button></div></div>
    <div className="mt-5 flex justify-end"><Button variant="outline" onClick={onClose}>بستن</Button></div>
  </Dialog>;
}
const SIGNAL_LABELS: Record<string, string> = {
  session_switch: "تغییر پنجرهٔ نشست",
  tab_hidden: "پنهان‌شدن صفحهٔ آزمون",
  tab_visible: "بازگشت به صفحهٔ آزمون",
  disconnected: "قطع اتصال",
  reconnected: "اتصال دوباره",
  auto_submitted: "ارسال خودکار در پایان زمان",
  exam_closed: "نهایی‌شدن با پایان آزمون توسط آموزگار",
  stale_write_rejected: "رد درخواست ذخیرهٔ کهنه",
};
function signalLabel(kind: string) { return SIGNAL_LABELS[kind] ?? kind; }

function ResultMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className="rounded-2xl border p-4"><p className={`text-2xl font-black ${tone}`}>{value}</p><p className="mt-1 text-xs font-bold">{label}</p><p className="mt-2 text-[11px] text-muted-foreground">{detail}</p></div>; }
function ResultsSkeleton() { return <Card className="p-6"><div className="h-8 w-48 animate-soft-pulse rounded bg-muted"/><div className="mt-6 h-64 animate-soft-pulse rounded bg-muted"/></Card>; }
