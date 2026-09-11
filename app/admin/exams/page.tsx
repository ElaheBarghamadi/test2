"use client";

import { CheckCircle2, ClipboardList, PauseCircle, PlayCircle, RefreshCw, RotateCcw, Search, ShieldAlert, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api/admin";
import { examsApi } from "@/lib/api/exams";
import { resultsApi } from "@/lib/api/results";
import { apiErrorMessage } from "@/lib/api/client";
import type { ApiAdminExamDto } from "@/lib/api/dtos";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/shared/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/lib/state/auth-store";
import { formatDate, toPersianNumber } from "@/lib/utils";

const labels = { active: "فعال", draft: "پیش‌نویس", scheduled: "زمان‌بندی‌شده", completed: "پایان‌یافته", archived: "بایگانی" } as const;

type Action = "publish" | "start" | "extend" | "complete" | "archive" | "restore" | "results";

const ACTION_COPY: Record<Action, string> = {
  publish: "زمان‌بندی و انتشار",
  start: "شروع اکنون",
  extend: "تمدید ۱۵ دقیقه",
  complete: "پایان آزمون",
  archive: "بایگانی",
  restore: "بازگردانی",
  results: "انتشار نتایج",
};

/** What may be done to a paper in this state, in the order the administrator reads them. */
function actionsFor(status: ApiAdminExamDto["status"]): Action[] {
  if (status === "draft") return ["publish", "archive"];
  if (status === "scheduled") return ["start", "complete", "archive"];
  if (status === "active") return ["extend", "complete", "results"];
  if (status === "completed") return ["results", "archive"];
  return ["restore"];
}

export default function AdminExamsPage() {
  const [exams, setExams] = useState<ApiAdminExamDto[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const viewerRole = useAuthStore((state) => state.user?.role);
  const principal = viewerRole === "school_admin";

  const load = useCallback(async () => {
    try {
      setError(null);
      setExams(await adminApi.exams());
    } catch (reason) {
      setError(apiErrorMessage(reason, "دریافت آزمون‌ها انجام نشد."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => exams.filter((exam) => `${exam.title} ${exam.subject} ${exam.teacher_name} ${exam.school?.name || ""}`.toLowerCase().includes(query.toLowerCase())), [exams, query]);

  async function run(exam: ApiAdminExamDto, action: Action) {
    setBusy(`${exam.id}:${action}`); setError(null); setNotice(null);
    try {
      if (action === "results") {
        const published = await resultsApi.publishExamResults(exam.id);
        setNotice(`«${exam.title}» — ${toPersianNumber(published.published_count)} نتیجه منتشر شد${published.pending_manual_grading_count ? ` و ${toPersianNumber(published.pending_manual_grading_count)} برگه هنوز در صف تصحیح است` : ""}.`);
      } else if (action === "extend") {
        await examsApi.extend(exam.id, 15);
        setNotice(`۱۵ دقیقه به «${exam.title}» افزوده شد؛ تلاش‌های در جریان هم از همین لحظه این زمان را می‌بینند.`);
      } else {
        await examsApi[action](exam.id);
        setNotice(`«${exam.title}» — ${ACTION_COPY[action]} انجام شد.`);
      }
      await load();
    } catch (reason) {
      setError(apiErrorMessage(reason, "این اقدام انجام نشد."));
    } finally {
      setBusy(null);
    }
  }

  return <PageTransition><PageContainer>
    <PageHeader
      eyebrow={principal ? "مدیریت مدرسه" : "نظارت سازمانی"}
      title={principal ? "آزمون‌های مدرسه" : "آزمون‌های شبکه"}
      description={principal ? "زمان‌بندی، انتشار و پایان آزمون‌های آموزگاران همین مدرسه؛ محتوای هر آزمون در اختیار مالکش است." : "نمای واقعی همه آزمون‌ها همراه با آموزگار، مدرسه و آمار مشارکت."}
      breadcrumbs={[{ label: principal ? "مدیریت مدرسه" : "مدیر سامانه", href: "/admin/dashboard" }, { label: "آزمون‌ها" }]}
      action={<Button variant="outline" onClick={() => { setLoading(true); void load(); }} disabled={loading}><RefreshCw className="h-4 w-4"/>نوسازی</Button>}
    />
    {error && <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="relative mb-5 max-w-sm">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pr-9" placeholder="جست‌وجوی آزمون، آموزگار یا مدرسه..."/>
        </div>
        {loading ? <div className="h-60 animate-soft-pulse rounded-xl bg-muted"/> : !shown.length ? <p className="p-6 text-center text-sm text-muted-foreground">آزمونی پیدا نشد.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-right">
              <thead className="border-y bg-muted/50 text-[11px] text-muted-foreground">
                <tr><th className="p-3 font-bold">آزمون</th><th className="p-3 font-bold">آموزگار / مدرسه</th><th className="p-3 font-bold">زمان برگزاری</th><th className="p-3 font-bold">سؤال‌ها</th><th className="p-3 font-bold">مشارکت</th><th className="p-3 font-bold">وضعیت</th><th className="p-3 font-bold">اقدام</th></tr>
              </thead>
              <tbody>
                {shown.map((exam) => <tr className="border-b last:border-0" key={exam.id}>
                  <td className="p-3"><p className="text-sm font-bold">{exam.title}</p><p className="mt-1 text-xs text-muted-foreground">{exam.subject} · {exam.grade}{exam.class_name ? ` · ${exam.class_name}` : ""}</p></td>
                  <td className="p-3"><p className="text-xs font-bold">{exam.teacher_name}</p><p className="mt-1 text-[11px] text-muted-foreground">{exam.school?.name || "بدون مدرسه"}</p></td>
                  <td className="p-3 text-xs text-muted-foreground">{exam.start_at ? formatDate(exam.start_at) : "بدون زمان‌بندی"}</td>
                  <td className="p-3 text-xs font-bold">{toPersianNumber(exam.question_count)} سؤال</td>
                  <td className="p-3"><span className="inline-flex items-center gap-1 text-xs font-bold"><Users className="h-3.5 w-3.5 text-muted-foreground"/>{toPersianNumber(exam.participant_count)}</span></td>
                  <td className="p-3"><Badge variant={exam.status === "active" ? "success" : exam.status === "draft" ? "warning" : "neutral"}>{labels[exam.status]}</Badge></td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {actionsFor(exam.status).map((action) => (
                        <Button key={action} size="sm" variant={action === "publish" || action === "start" ? "default" : "outline"} disabled={busy !== null} onClick={() => void run(exam, action)}>
                          {busy === `${exam.id}:${action}` ? <RefreshCw className="h-3.5 w-3.5 animate-spin"/> : action === "publish" ? <CheckCircle2 className="h-3.5 w-3.5"/> : action === "start" ? <PlayCircle className="h-3.5 w-3.5"/> : action === "complete" ? <PauseCircle className="h-3.5 w-3.5"/> : action === "results" ? <ClipboardList className="h-3.5 w-3.5"/> : action === "restore" ? <RotateCcw className="h-3.5 w-3.5"/> : null}
                          {ACTION_COPY[action]}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-6 text-amber-800 dark:text-amber-300">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0"/>
      {principal
        ? "این‌جا وضعیت برگزاری و انتشار نتایج را مدیریت می‌کنید. متن سؤال‌ها، گزینه‌ها و پاسخ دانش‌آموزان در اختیار مدیر مدرسه نیست و ویرایش آزمون فقط از مسیر آموزگار مالک انجام می‌شود."
        : "این بخش برای نظارت سازمانی است. تغییر محتوای آزمون همچنان فقط از مسیر مالک آزمون و کنترل‌های API انجام می‌شود."}
    </div>
  </PageContainer></PageTransition>;
}
