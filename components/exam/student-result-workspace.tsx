"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, CheckCircle2, CircleX, Clock3, FileText, MessageSquareText } from "lucide-react";
import { attemptsApi } from "@/lib/api/attempts";
import { ApiError, apiErrorMessage } from "@/lib/api/client";
import { toStudentAttempt, toStudentResult } from "@/lib/api/mappers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart } from "@/components/charts/performance-chart";
import { formatDate, toPersianNumber } from "@/lib/utils";
import type { Exam, ExamAttempt, ExamResult } from "@/lib/types/domain";

type ResultState = { exam: Exam; attempt: ExamAttempt; result: ExamResult | null; submittedAt: string | null };
export function StudentResultWorkspace({ attemptId }: { attemptId: string }) {
  const [state, setState] = useState<ResultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const detail = await attemptsApi.detail(attemptId);
        const mapped = toStudentAttempt(detail);
        let result: ExamResult | null = null;
        try { result = toStudentResult(await attemptsApi.result(attemptId), mapped.attempt, mapped.exam); }
        catch (requestError) {
          // Django deliberately returns 403 when a result is not published. Do not infer answer keys
          // or visibility policy from that protected response; show only a neutral pending state.
          if (!(requestError instanceof ApiError && requestError.status === 403)) throw requestError;
        }
        if (active) setState({ ...mapped, result, submittedAt: detail.submitted_at });
      } catch (requestError) { if (active) setError(apiErrorMessage(requestError, "دریافت وضعیت نتیجه انجام نشد.")); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [attemptId]);
  if (loading) return <Loading/>;
  if (error || !state) return <Failed message={error || "نتیجه پیدا نشد."}/>;
  const { exam, attempt, result, submittedAt } = state;
  const header = <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 pt-7 sm:px-6"><div><p className="section-label">وضعیت آزمون</p><h1 className="mt-2 text-2xl font-black">{exam.title}</h1><p className="mt-2 text-sm text-muted-foreground">{submittedAt ? `ارسال‌شده در ${formatDate(submittedAt)}` : "وضعیت ارسال آزمون"}</p></div><Button asChild variant="outline"><Link href="/student/dashboard">بازگشت به داشبورد <ArrowLeft className="h-4 w-4"/></Link></Button></div>;
  if (!result) return <div className="min-h-screen bg-surface"><div className="pb-7">{header}<main className="mx-auto max-w-7xl px-4 py-7 sm:px-6"><ResultPending examTitle={exam.title}/></main></div></div>;
  return <div className="min-h-screen bg-surface"><div className="pb-8">{header}<main className="mx-auto max-w-7xl px-4 py-7 sm:px-6"><div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><Card className="relative overflow-hidden border-primary/15"><div className="absolute -left-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl"/><CardContent className="relative flex flex-col items-center p-7 text-center sm:flex-row sm:text-right"><DonutChart value={result.percentage}/><div className="mt-5 sm:mr-7 sm:mt-0"><Badge variant="success">نتیجه منتشر شده</Badge><h2 className="mt-3 text-3xl font-black">{toPersianNumber(result.score)} <span className="text-base font-bold text-muted-foreground">از {toPersianNumber(result.maximumScore)} نمره</span></h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">این خلاصه بر اساس نتیجهٔ منتشرشدهٔ آزمون شماست.</p></div></CardContent></Card><Card><CardHeader><CardTitle>خلاصه پاسخ‌ها</CardTitle><CardDescription>نمایی امن و کلی از عملکرد شما در این آزمون</CardDescription></CardHeader><CardContent><div className="grid grid-cols-3 divide-x divide-x-reverse text-center"><Outcome icon={CheckCircle2} value={result.correct} label="درست" tone="text-emerald-600"/><Outcome icon={CircleX} value={result.incorrect} label="نادرست" tone="text-rose-600"/><Outcome icon={FileText} value={result.unanswered} label="بدون پاسخ" tone="text-amber-600"/></div></CardContent></Card></div><div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><Card><CardHeader><CardTitle>وضعیت تصحیح</CardTitle><CardDescription>اطلاعاتی که برای دانش‌آموز منتشر شده است</CardDescription></CardHeader><CardContent><div className="rounded-2xl bg-primary/5 p-4 text-sm leading-7 text-muted-foreground"><CheckCircle2 className="ml-2 inline h-4 w-4 text-emerald-600 align-text-bottom"/>پاسخ‌های شما ثبت شده‌اند. جزئیات کلید پاسخ و تنظیمات تصحیح تنها در صورت انتشار مجاز از سوی آموزگار نمایش داده می‌شوند.</div><p className="mt-4 text-xs text-muted-foreground">وضعیت تلاش: {attempt.status === "submitted" ? "ارسال‌شده" : "پایان‌یافته"}</p></CardContent></Card><Card><CardHeader className="flex-row items-center gap-3"><div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-600"><MessageSquareText className="h-5 w-5"/></div><div><CardTitle>بازخورد آموزگار</CardTitle><CardDescription>بازخورد منتشرشده برای شما</CardDescription></div></CardHeader><CardContent>{result.feedback ? <blockquote className="border-r-2 border-primary pr-3 text-sm leading-7 text-muted-foreground">«{result.feedback}»</blockquote> : <p className="text-sm leading-7 text-muted-foreground">هنوز بازخورد متنی برای این آزمون ثبت نشده است.</p>}<div className="mt-5 flex items-center gap-2 text-xs font-bold text-emerald-600"><Award className="h-4 w-4"/>نتیجه در حساب شما ثبت شده است.</div></CardContent></Card></div></main></div></div>;
}
function ResultPending({ examTitle }: { examTitle: string }) { return <Card className="mx-auto max-w-2xl overflow-hidden"><div className="h-1.5 bg-gradient-to-l from-amber-400 to-primary"/><CardContent className="p-7 text-center sm:p-10"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-500/10 text-amber-600"><Clock3 className="h-8 w-8"/></div><Badge variant="warning" className="mt-5">در انتظار انتشار نتیجه</Badge><h2 className="mt-3 text-2xl font-black">آزمون شما با موفقیت ثبت شد</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-muted-foreground">نتیجهٔ «{examTitle}» هنوز برای حساب شما منتشر نشده است. پس از انتشار، خلاصهٔ امن نتیجه در همین صفحه نمایش داده می‌شود.</p><div className="mx-auto mt-7 max-w-md rounded-2xl bg-muted/60 p-4 text-right text-xs leading-6 text-muted-foreground"><CheckCircle2 className="ml-2 inline h-4 w-4 text-emerald-600 align-text-bottom"/>پاسخ‌های شما ثبت شده‌اند و اقدامی از سمت شما لازم نیست.</div></CardContent></Card>; }
function Outcome({ icon: Icon, value, label, tone }: { icon: typeof CheckCircle2; value: number; label: string; tone: string }) { return <div className="px-2"><Icon className={`mx-auto h-5 w-5 ${tone}`}/><p className={`mt-2 text-xl font-black ${tone}`}>{toPersianNumber(value)}</p><p className="mt-1 text-[11px] font-bold text-muted-foreground">{label}</p></div>; }
function Loading() { return <div className="grid min-h-screen place-items-center bg-surface"><span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"/></div>; }
function Failed({ message }: { message: string }) { return <div className="grid min-h-screen place-items-center bg-surface p-4"><Card className="w-full max-w-md"><CardContent className="p-8 text-center"><h1 className="text-lg font-black">دریافت نتیجه ممکن نیست</h1><p className="mt-3 text-sm leading-7 text-muted-foreground">{message}</p><Button asChild className="mt-6"><Link href="/student/dashboard">بازگشت به داشبورد</Link></Button></CardContent></Card></div>; }
