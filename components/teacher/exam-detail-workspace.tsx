"use client";

import Link from "next/link";
import { AlertTriangle, Archive, CalendarDays, CheckCircle2, Clock3, Copy, Eye, ListChecks, PlusCircle, RotateCcw, Timer, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Exam } from "@/lib/types/domain";
import { INTEGRITY_POLICY_LABELS, rulesFromSettings } from "@/lib/exam/integrity";
import { RESULT_DETAIL_LABELS, resolveResultDetail } from "@/lib/exam/result-detail";
import { QuestionRenderer } from "@/components/exam/question-renderer";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { questionIssues } from "@/components/teacher/question-builder";
import { apiErrorMessage } from "@/lib/api/client";
import { useTeacherExams } from "@/hooks/use-teacher-exams";
import { useToastStore } from "@/lib/state/toast-store";
import { formatDateTime, toPersianNumber } from "@/lib/utils";

const statusMap: Record<Exam["status"], [string, "success" | "default" | "warning" | "neutral"]> = {
  active: ["در حال برگزاری", "success"],
  scheduled: ["زمان‌بندی شده", "default"],
  draft: ["پیش‌نویس", "warning"],
  completed: ["پایان یافته", "neutral"],
  archived: ["بایگانی", "neutral"],
};
const typeLabel: Record<string, string> = { single_choice: "چندگزینه‌ای", multiple_choice: "چندپاسخی", true_false: "درست/نادرست", short_answer: "کوتاه", essay: "تشریحی" };
const EXTENSIONS = [5, 10, 15, 30];

function attemptCountOf(exam: Exam) { return exam.attemptCount ?? 0; }

export function TeacherExamDetailWorkspace({ examId }: { examId: string }) {
  const { exams, loading, detailLoadingId, initialized, duplicateExam, completeExam, archiveExam, restoreExam, startExam, extendExam, error, clearError, loadExam } = useTeacherExams();
  const toast = useToastStore((state) => state.push);
  const [previewOpen, setPreviewOpen] = useState(false); const [completeOpen, setCompleteOpen] = useState(false); const [archiveOpen, setArchiveOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false); const [extendOpen, setExtendOpen] = useState(false); const [previewIndex, setPreviewIndex] = useState(0);
  const [busy, setBusy] = useState<null | "start" | "extend" | "complete" | "archive">(null);
  useEffect(() => { void loadExam(examId); }, [examId, loadExam]);
  const exam = useMemo(() => exams.find((item) => item.id === examId), [exams, examId]);
  const blocking = useMemo(() => (exam ? exam.questions.map((question, index) => ({ index, issues: questionIssues(question) })).filter((item) => item.issues.length) : []), [exam]);
  if ((loading && !initialized) || !initialized || detailLoadingId === examId) return <DetailSkeleton/>;
  if (!exam) return <EmptyState title="آزمون پیدا نشد" description="ممکن است این آزمون در فضای دیگری ایجاد شده باشد یا دیگر در دسترس نباشد." action={{ label: "بازگشت به فهرست آزمون‌ها", onClick: () => undefined }}/>;

  const currentExam = exam;
  const [label, variant] = statusMap[currentExam.status];
  const live = currentExam.status === "active";
  const started = currentExam.attemptCount && currentExam.attemptCount > 0;

  async function run(action: "start" | "extend", minutes?: number) {
    setBusy(action); clearError();
    try {
      if (action === "start") { await startExam(currentExam.id); setStartOpen(false); toast({ title: "آزمون هم‌اکنون آغاز شد", description: "دانش‌آموزان می‌توانند وارد آزمون شوند.", variant: "success" }); }
      else { await extendExam(currentExam.id, minutes ?? 0); setExtendOpen(false); toast({ title: `زمان آزمون ${toPersianNumber(minutes ?? 0)} دقیقه تمدید شد`, description: "سؤال‌های در حال پاسخ‌گویی هم از زمان جدید استفاده می‌کنند.", variant: "success" }); }
    } finally { setBusy(null); }
  }
  async function duplicate() { const copy = await duplicateExam(currentExam.id); if (copy) toast({ title: "کپی آزمون ساخته شد", description: "نسخهٔ جدید به‌صورت پیش‌نویس آماده است.", variant: "success" }); }
  // Ending is now consequential for students mid-answer, so both actions surface the server's reason
  // instead of a silent success, and tell the teacher exactly what closes.
  async function complete() {
    setBusy("complete");
    const before = attemptCountOf(currentExam);
    try {
      await completeExam(currentExam.id);
      setCompleteOpen(false);
      toast({ title: "آزمون پایان یافت", description: before ? `${toPersianNumber(before)} تلاش ثبت‌شده محفوظ است و نشست‌های باز همین حالا نمره گرفتند.` : "دانش‌آموزان دیگر نمی‌توانند تلاش جدیدی شروع کنند.", variant: "success" });
    } catch (reason) {
      toast({ title: "پایان آزمون انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }
  async function archive() {
    setBusy("archive");
    try {
      await archiveExam(currentExam.id);
      setArchiveOpen(false);
      toast({ title: "آزمون بایگانی شد", description: "پاسخ‌ها و نتایج حفظ شده‌اند؛ برای بازیابی، فیلتر بایگانی‌شده را انتخاب کنید.", variant: "success" });
    } catch (reason) {
      toast({ title: "بایگانی آزمون انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }
  async function restore() { await restoreExam(currentExam.id); toast({ title: "آزمون بازیابی شد", variant: "success" }); }

  return <><div className="grid gap-6 xl:grid-cols-[1.24fr_.76fr]"><section className="space-y-6">
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>نمای کلی آزمون</CardTitle><CardDescription>{exam.subject} · {exam.grade} · {exam.className}</CardDescription></div><Badge variant={variant}>{label}</Badge></div></CardHeader>
      <CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
        { icon: UsersRound, label: "آموزگار", value: exam.teacherName || "—" },
        { icon: CalendarDays, label: "شروع", value: exam.schedule.startAt ? formatDateTime(exam.schedule.startAt) : "بدون زمان‌بندی" },
        { icon: Clock3, label: "مدت پاسخ‌گویی", value: `${toPersianNumber(exam.settings.durationMinutes)} دقیقه` },
        { icon: ListChecks, label: "سؤال‌ها", value: `${toPersianNumber(exam.questionCount)} سؤال · ${toPersianNumber(exam.settings.totalMarks)} نمره` },
        { icon: UsersRound, label: "مشارکت", value: `${toPersianNumber(exam.participantCount)} دانش‌آموز` },
        { icon: Timer, label: "تلاش‌ها", value: `${toPersianNumber(exam.attemptCount ?? 0)} تلاش` },
      ].map((item) => { const Icon = item.icon; return <div key={item.label} className="rounded-xl bg-muted/55 p-3"><Icon className="h-4 w-4 text-primary"/><p className="mt-4 text-[10px] font-bold text-muted-foreground">{item.label}</p><p className="mt-1 text-xs font-extrabold">{item.value}</p></div>; })}</div>
      <div className="mt-6 rounded-2xl border bg-surface p-4"><p className="text-xs font-bold text-muted-foreground">توضیح آزمون</p><p className="mt-2 text-sm leading-7">{exam.description}</p>{exam.instructions && <p className="mt-4 border-t pt-4 text-xs leading-6 text-muted-foreground"><b className="text-foreground">راهنمای دانش‌آموز: </b>{exam.instructions}</p>}</div>
    </CardContent></Card>

    {live && <Card className="border-amber-500/25 bg-amber-500/[.05]"><CardContent className="flex flex-wrap items-start gap-3 p-4 text-xs leading-6 text-amber-900 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"/>{started ? <span><b>این آزمون در حال برگزاری است و {toPersianNumber(exam.attemptCount ?? 0)} تلاش ثبت شده.</b> تغییر متن و نمرهٔ سؤال‌ها برای تلاش‌های تازه اعمال می‌شود و پاسخ‌های ثبت‌شده بازنویسی نمی‌شوند. گزینه‌ای که دانش‌آموزی آن را انتخاب کرده حذف نمی‌شود؛ برای ساختار تازه، از «ساخت یک کپی» استفاده کنید.</span> : <span><b>آزمون فعال است و دانش‌آموزان می‌توانند آن را شروع کنند.</b> پیش از ورود نفر بعدی، از تکمیل سؤال‌ها و زمان‌بندی مطمئن شوید.</span>}</CardContent></Card>}

    {blocking.length > 0 && <Card className="border-destructive/25"><CardHeader><CardTitle>پیش از انتشار این‌ها باید کامل شوند</CardTitle><CardDescription>همین قواعد در سمت سرور هم هنگام انتشار بررسی می‌شود.</CardDescription></CardHeader><CardContent><ul className="space-y-2 text-xs leading-6">{blocking.map((item) => <li key={item.index} className="flex gap-2 rounded-xl bg-muted/50 p-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-[10px] font-black text-primary">{toPersianNumber(item.index + 1)}</span><span>{item.issues.join(" · ")}</span></li>)}</ul></CardContent></Card>}

    <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>سؤال‌های آزمون</CardTitle><CardDescription>{toPersianNumber(exam.questions.length)} سؤال با مجموع {toPersianNumber(exam.settings.totalMarks)} نمره</CardDescription></div><Button asChild size="sm" variant="outline"><Link href={`/teacher/exams/${exam.id}/edit`}>ویرایش سؤال‌ها</Link></Button></CardHeader>
      <CardContent><div className="divide-y rounded-xl border px-4">{exam.questions.length ? exam.questions.map((question) => <div className="flex items-center gap-3 py-3" key={question.id}><span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-xs font-black text-primary">{toPersianNumber(question.order)}</span><p className="min-w-0 flex-1 truncate text-sm font-bold">{question.stem || "بدون متن سؤال"}</p><span className="text-[11px] font-bold text-muted-foreground">{typeLabel[question.type]}</span><span className="text-[11px] text-muted-foreground">{toPersianNumber(question.points)} نمره</span>{questionIssues(question).length > 0 && <Badge variant="warning">ناقص</Badge>}</div>) : <p className="py-6 text-center text-sm text-muted-foreground">هنوز سؤالی برای این آزمون ساخته نشده است.</p>}</div></CardContent></Card>
  </section>

  <aside className="space-y-5">
    <Card><CardHeader><CardTitle>اقدام‌ها</CardTitle></CardHeader><CardContent className="grid gap-2">
      <Button asChild><Link href={`/teacher/exams/${exam.id}/edit`}><CheckCircle2 className="h-4 w-4"/>ویرایش آزمون</Link></Button>
      <Button variant="secondary" onClick={() => { setPreviewIndex(0); setPreviewOpen(true); }}><Eye className="h-4 w-4"/>پیش‌نمایش سؤال‌ها</Button>
      {(exam.status === "draft" || exam.status === "scheduled") && <Button onClick={() => setStartOpen(true)} disabled={busy === "start"}><PlusCircle className="h-4 w-4"/>{busy === "start" ? "در حال آغاز…" : "آغاز هم‌اکنون"}</Button>}
      {live && <Button variant="outline" onClick={() => setExtendOpen(true)} disabled={busy === "extend"}><Timer className="h-4 w-4"/>{busy === "extend" ? "در حال تمدید…" : "تمدید زمان آزمون"}</Button>}
      <Button variant="secondary" onClick={() => void duplicate()}><Copy className="h-4 w-4"/>ساخت یک کپی</Button>
      {live && <Button variant="outline" onClick={() => setCompleteOpen(true)}><CheckCircle2 className="h-4 w-4"/>اتمام آزمون</Button>}
      {exam.status === "archived" ? <Button variant="outline" onClick={() => void restore()}><RotateCcw className="h-4 w-4"/>بازیابی آزمون</Button> : <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setArchiveOpen(true)}><Archive className="h-4 w-4"/>بایگانی آزمون</Button>}
      {["active", "completed"].includes(exam.status) && <Button asChild variant="outline"><Link href="/teacher/results"><UsersRound className="h-4 w-4"/>مشاهده نتایج</Link></Button>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>تنظیمات آزمون</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="grid gap-2 text-xs text-muted-foreground">{[
      { label: "چیدمان سؤال‌ها", value: exam.settings.questionLayout === "single_page" ? "همه سؤال‌ها در یک صفحه" : "صفحه‌به‌صفحه" },
      { label: "بازگشت به سؤال‌ها", value: exam.settings.questionLayout === "single_page" ? "بی‌اثر در چیدمان یک‌صفحه‌ای" : exam.settings.allowBackNavigation ? "مجاز" : "غیرفعال" },
      { label: "ترتیب سؤال‌ها", value: exam.settings.randomizeQuestions ? "تصادفی" : "ثابت" },
      { label: "نمایش نتیجه", value: exam.settings.resultVisibility === "immediate" ? "فوری" : exam.settings.resultVisibility === "pending" ? "پس از بررسی" : "انتشار دستی" },
      {
        // What the published result reveals, in the teacher's words. The legacy switch folds into the same
        // line, so an exam created before the ladder exists still reads truthfully here.
        label: "محتوای نتیجهٔ منتشرشده",
        value: RESULT_DETAIL_LABELS[resolveResultDetail(exam.settings)] ?? "فقط نمره",
      },
      {
        label: "مراقبت از تقلب",
        // The teacher set this on the exam, so the detail page repeats it in the same words the builder used
        // — including the case where rules are configured but monitoring is switched off.
        value: INTEGRITY_POLICY_LABELS[rulesFromSettings(exam.settings).policy],
      },
      { label: "تعداد تلاش", value: `${toPersianNumber(exam.settings.attemptLimit)} بار` },
      { label: "حدنصاب قبولی", value: exam.settings.passingPercentage > 0 ? `${toPersianNumber(exam.settings.passingPercentage)}٪` : "بدون حکم قبولی" },
    ].map((item) => <div key={item.label} className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"><span className="font-bold text-muted-foreground">{item.label}</span><span className="text-xs font-extrabold">{item.value}</span></div>)}</div></CardContent></Card>

    <Card><CardHeader><CardTitle>زمان‌بندی</CardTitle></CardHeader><CardContent><p className="text-xs font-bold text-muted-foreground">شروع</p><p className="mt-1 text-sm font-extrabold">{exam.schedule.startAt ? formatDateTime(exam.schedule.startAt) : "—"}</p><p className="mt-4 text-xs font-bold text-muted-foreground">پایان دسترسی</p><p className="mt-1 text-sm font-extrabold">{exam.schedule.endAt ? formatDateTime(exam.schedule.endAt) : "بدون محدودیت"}</p><p className="mt-3 rounded-lg bg-muted/60 p-2 text-[10px] text-muted-foreground">{exam.schedule.timezone}</p></CardContent></Card>
  </aside></div>

  {error && <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs leading-6 text-rose-800 dark:text-rose-300"><AlertTriangle className="h-4 w-4 shrink-0 text-rose-600"/><span className="flex-1">{error}</span><Button variant="outline" size="sm" onClick={clearError}>بستن</Button></div>}

  <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title="پیش‌نمایش آزمون" description={exam.questions.length ? `نمای دانش‌آموز · سؤال ${toPersianNumber(previewIndex + 1)} از ${toPersianNumber(exam.questions.length)}` : "هنوز سؤالی برای نمایش وجود ندارد."} size="md">
    {exam.questions[previewIndex] ? <div className="rounded-2xl border bg-surface p-5"><p className="mb-4 text-xs font-black text-muted-foreground">سؤال {toPersianNumber(exam.questions[previewIndex].order)} · {toPersianNumber(exam.questions[previewIndex].points)} نمره</p><QuestionRenderer question={exam.questions[previewIndex]} value={null} onChange={() => undefined} disabled/></div> : <p className="text-sm text-muted-foreground">هنوز سؤالی برای نمایش وجود ندارد.</p>}
    {exam.questions.length > 0 && <div className="mt-5 flex items-center justify-between gap-2"><Button variant="outline" size="sm" onClick={() => setPreviewIndex((index) => Math.max(0, index - 1))} disabled={previewIndex === 0}>سؤال قبل</Button><Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>بستن پیش‌نمایش</Button><Button variant="outline" size="sm" onClick={() => setPreviewIndex((index) => Math.min(exam.questions.length - 1, index + 1))} disabled={previewIndex >= exam.questions.length - 1}>سؤال بعد</Button></div>}
  </Dialog>

  <Dialog open={startOpen} onClose={() => busy === null && setStartOpen(false)} title="آغاز هم‌اکنون؟" description="اگر زمان شروع از امروز جلوتر باشد، همان لحظهٔ فعلی جایگزین می‌شود و دانش‌آموزان می‌توانند وارد آزمون شوند. کنترل‌های انتشار سرور همچنان بررسی می‌شوند." size="sm"><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setStartOpen(false)} disabled={busy === "start"}>انصراف</Button><Button onClick={() => void run("start")} disabled={busy === "start" || blocking.length > 0} data-autofocus>{busy === "start" ? "در حال آغاز…" : "آغاز آزمون"}</Button></div>{blocking.length > 0 && <p className="mt-3 text-[11px] leading-5 text-amber-700 dark:text-amber-400">ابتدا {toPersianNumber(blocking.length)} سؤال ناقص را کامل کنید؛ در غیر این صورت سرور آغاز آزمون را رد می‌کند.</p>}</Dialog>

  <Dialog open={extendOpen} onClose={() => busy === null && setExtendOpen(false)} title="تمدید زمان آزمون" description={`مدت فعلی ${toPersianNumber(exam.settings.durationMinutes)} دقیقه است. تمدید، پنجرهٔ پاسخ‌گویی تلاش‌های در جریان را هم باز می‌کند.`} size="sm"><div className="mt-4 grid grid-cols-4 gap-2">{EXTENSIONS.map((minutes) => <Button key={minutes} variant="outline" onClick={() => void run("extend", minutes)} disabled={busy === "extend"}>+{toPersianNumber(minutes)}</Button>)}</div><div className="mt-5 flex justify-end"><Button variant="ghost" onClick={() => setExtendOpen(false)}>بستن</Button></div></Dialog>

  <Dialog open={completeOpen} onClose={() => setCompleteOpen(false)} title="پایان آزمون؟" description={`دسترسی شروع آزمون بسته می‌شود${attemptCountOf(currentExam) ? ` و ${toPersianNumber(attemptCountOf(currentExam))} تلاش ثبت‌شده دست‌نخورده می‌ماند` : ""}. نشست‌های در جریان همین حالا بسته می‌شوند و پاسخ‌های ذخیره‌شدهٔ آن‌ها نمره می‌گیرد؛ برای ادامهٔ دانش‌آموزی که در حال نوشتن است، «تمدید زمان» گزینهٔ کم‌خطرتری است.`} size="sm"><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setCompleteOpen(false)}>انصراف</Button><Button data-autofocus onClick={() => void complete()} disabled={busy === "complete"}>{busy === "complete" ? "در حال پایان…" : "تأیید پایان آزمون"}<CheckCircle2 className="h-4 w-4"/></Button></div></Dialog>
  <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} title="بایگانی آزمون؟" description={`این آزمون از فهرست‌های فعال پنهان می‌شود؛ سؤال‌ها و نتایج حفظ می‌شوند.${currentExam.status === "active" ? " نشست‌های در جریان بسته و نمره می‌گیرند." : ""} ${toPersianNumber(attemptCountOf(currentExam))} تلاش ثبت‌شده در این آزمون وجود دارد.`} size="sm"><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setArchiveOpen(false)}>انصراف</Button><Button variant="destructive" data-autofocus onClick={() => void archive()} disabled={busy === "archive"}>{busy === "archive" ? "در حال بایگانی…" : "تأیید بایگانی"}<Archive className="h-4 w-4"/></Button></div></Dialog>
  </>;
}
function DetailSkeleton() { return <div className="grid gap-6 xl:grid-cols-[1.24fr_.76fr]"><Card className="p-6"><Skeleton className="h-7 w-1/3"/><Skeleton className="mt-8 h-32"/><Skeleton className="mt-4 h-24"/></Card><Card className="p-6"><Skeleton className="h-7 w-1/2"/><Skeleton className="mt-8 h-48"/></Card></div>; }
