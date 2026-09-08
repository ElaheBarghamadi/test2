"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, FileText, ShieldCheck } from "lucide-react";
import { attemptsApi } from "@/lib/api/attempts";
import { apiErrorMessage } from "@/lib/api/client";
import { toStudentDashboardExam } from "@/lib/api/mappers";
import { ExamListCard } from "@/components/dashboard/exam-list-card";
import { StatCard } from "@/components/dashboard/stat-card";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/state/auth-store";
import { formatDate, toPersianNumber } from "@/lib/utils";
import type { ApiAvailableExamDto } from "@/lib/api/dtos";

export function StudentDashboardWorkspace() {
  const user = useAuthStore((state) => state.user);
  const [items, setItems] = useState<ApiAvailableExamDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    void attemptsApi.listAvailable().then((data) => { if (mounted) setItems(data); }).catch((reason) => { if (mounted) setError(apiErrorMessage(reason, "بارگذاری آزمون‌ها انجام نشد.")); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const active = useMemo(() => items.find((item) => item.availability === "available" || item.availability === "in_progress"), [items]);
  const upcoming = useMemo(() => items.filter((item) => item.availability === "upcoming").map(toStudentDashboardExam), [items]);
  const completed = useMemo(() => items.filter((item) => item.availability === "completed" && item.attempt), [items]);
  const name = user?.fullName.split(" ")[0] || "دانش‌آموز";
  return <PageTransition><PageContainer><PageHeader eyebrow="فضای یادگیری شما" title={`سلام، ${name} 👋`} description="آزمون‌ها و وضعیت ثبت پاسخ‌های شما مستقیماً از سرویس آموزشی دریافت می‌شوند." breadcrumbs={[{ label: "دانش‌آموز" }, { label: "نمای کلی" }]}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={FileText} label="آزمون‌های در دسترس" value={toPersianNumber(items.length)} detail="بر اساس دسترسی حساب شما" tone="indigo"/><StatCard icon={CheckCircle2} label="تکمیل‌شده" value={toPersianNumber(completed.length)} detail="تلاش‌های نهایی‌شده" tone="teal"/><StatCard icon={Clock3} label="در حال برگزاری" value={toPersianNumber(items.filter((item) => item.availability === "available" || item.availability === "in_progress").length)} detail="آمادهٔ شروع یا ادامه" tone="violet"/><StatCard icon={CalendarDays} label="پیش‌رو" value={toPersianNumber(upcoming.length)} detail="طبق زمان‌بندی آزمون" tone="amber"/></div>
    {error && <Card className="mt-6 border-destructive/30"><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_.85fr]"><section>{loading ? <Card className="h-52 animate-soft-pulse bg-muted"/> : active ? <ActiveExam item={active}/> : <Card><CardContent className="p-7 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-primary"/><h2 className="mt-3 font-black">اکنون آزمون فعالی ندارید</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">زمان‌بندی آزمون‌های بعدی در همین صفحه نمایش داده می‌شود.</p></CardContent></Card>}<section id="exams" className="mt-6"><div className="mb-4"><h2 className="font-black">آزمون‌های پیش‌رو</h2><p className="mt-1 text-xs text-muted-foreground">برنامه‌ریزی کنید و با آمادگی وارد شوید.</p></div>{upcoming.length ? <div className="grid gap-3">{upcoming.map((exam) => <ExamListCard key={exam.id} exam={exam}/>)}</div> : <Card><CardContent className="p-5 text-sm text-muted-foreground">آزمون زمان‌بندی‌شده‌ای برای نمایش وجود ندارد.</CardContent></Card>}</section></section><aside className="space-y-6"><Card><CardHeader><CardTitle>دسترسی امن آزمون</CardTitle><CardDescription>اطلاعات هر آزمون تنها هنگام شروع و از سرور دریافت می‌شود.</CardDescription></CardHeader><CardContent><div className="rounded-2xl bg-primary/5 p-4 text-sm leading-7 text-muted-foreground"><ShieldCheck className="ml-2 inline h-4 w-4 text-emerald-600 align-text-bottom"/>پاسخ‌ها، زمان‌بندی و وضعیت نتیجه بر پایهٔ نشست شما در سامانه کنترل می‌شوند.</div></CardContent></Card><Card><CardHeader className="pb-3"><CardTitle>تقویم آزمون‌ها</CardTitle></CardHeader><CardContent>{upcoming.length ? <div className="space-y-3">{upcoming.slice(0, 3).map((exam) => <div key={exam.id} className="flex items-center gap-3"><div className="rounded-xl bg-violet-500/10 px-2 py-1.5 text-center text-xs font-black text-violet-700 dark:text-violet-300">{formatDate(exam.startAt)}</div><div><p className="text-xs font-extrabold">{exam.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{exam.settings.durationMinutes} دقیقه</p></div></div>)}</div> : <p className="text-sm text-muted-foreground">رویداد پیش‌رویی ثبت نشده است.</p>}</CardContent></Card></aside></div>
    <Card className="mt-6"><CardHeader><CardTitle>تلاش‌های تکمیل‌شده</CardTitle><CardDescription>برای مشاهدهٔ وضعیت نتیجه، یک آزمون نهایی‌شده را انتخاب کنید.</CardDescription></CardHeader><CardContent>{completed.length ? <div className="divide-y">{completed.map((item) => <div className="flex items-center justify-between gap-4 py-3 first:pt-0" key={item.id}><div><p className="text-sm font-extrabold">{item.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.attempt?.submitted_at ? formatDate(item.attempt.submitted_at) : "تلاش پایان یافته"}</p></div>{item.attempt && <Button asChild variant="outline" size="sm"><Link href={`/student/results/${item.attempt.id}`}>وضعیت نتیجه <ArrowLeft className="h-3.5 w-3.5"/></Link></Button>}</div>)}</div> : <p className="text-sm text-muted-foreground">هنوز تلاش نهایی‌شده‌ای ندارید.</p>}</CardContent></Card>
  </PageContainer></PageTransition>;
}
function ActiveExam({ item }: { item: ApiAvailableExamDto }) { const exam = toStudentDashboardExam(item); const continuing = item.availability === "in_progress"; return <Card className="relative overflow-hidden border-primary/15 bg-gradient-to-l from-primary/[.07] to-card"><div className="absolute -left-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl"/><CardContent className="relative p-5 sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><Badge variant="success">{continuing ? "آزمون در حال انجام" : "اکنون آمادهٔ شروع"}</Badge><p className="mt-4 text-xs font-bold text-muted-foreground">{item.subject} · {item.duration_minutes} دقیقه</p><h2 className="mt-1 text-xl font-black">{item.title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{item.description}</p></div><Button asChild size="lg" className="shrink-0"><Link href={`/student/exam/${item.id}`}>{continuing ? "ادامه آزمون" : "مشاهده و شروع"} <ArrowLeft className="h-4 w-4"/></Link></Button></div></CardContent></Card>; }
