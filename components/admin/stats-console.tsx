"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Archive, Database, LockOpen, RefreshCw, Save, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import { apiErrorMessage } from "@/lib/api/client";
import type { ApiAdminDatabaseDto, ApiAdminLiveAttemptDto, ApiAdminSeriesPointDto, ApiAdminStatsDto } from "@/lib/api/dtos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToastStore } from "@/lib/state/toast-store";
import { cn, formatDateTime, toPersianNumber } from "@/lib/utils";

/**
 * The console's operational screen: the site's numbers, who is writing right now, and the switches that only
 * a platform administrator may touch.
 *
 * `canControl` is the whole access story on this page. Reading is what a school administrator is for, so
 * every card is rendered for them too — but repair, closing a sitting and releasing a device lock override
 * somebody else's data, and those buttons are not drawn at all rather than drawn and refused. The API enforces
 * the same rule; a UI that hid nothing would still be safe, and a UI that hid *and* the API did not would be a
 * lie. Both are true here, which is the point.
 */

const ISSUE_LABELS: Record<string, string> = {
  finalized_without_result: "پاسخ‌برگ نهایی‌شده بدون نتیجه",
  exams_past_their_end: "آزمون فعال از زمانش گذشته",
  choice_questions_without_options: "سؤال چندگزینه‌ای بدون گزینه",
  bank_drafts: "پیش‌نویس بانک سؤال",
  stale_open_attempts: "پاسخ‌برگ بازِ مهلت‌گذشته",
};

const SERIES_LABELS: Record<string, string> = {
  submissions: "ارسال‌ها",
  starts: "شروع‌ها",
  exams_created: "آزمون‌های ساخته‌شده",
  signups: "ثب‌ت‌نام‌ها",
  signals: "رویدادهای نشست",
};

function formatBytes(value: number | null) {
  if (!value) return "نامشخص";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${toPersianNumber(size.toFixed(index ? 1 : 0))} ${units[index]}`;
}

function dayLabel(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(date);
}

function Tile({ label, value, detail, tone = "muted" }: { label: string; value: string; detail?: string; tone?: "muted" | "warning" | "success" | "danger" }) {
  return (
    <div className={cn("rounded-2xl border p-3.5", tone === "warning" && "border-amber-400/40 bg-amber-500/[.07]", tone === "danger" && "border-destructive/40 bg-destructive/[.06]", tone === "success" && "border-emerald-500/30 bg-emerald-500/[.06]")}>
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black leading-7">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{detail}</p>}
    </div>
  );
}

/** A bar chart without a chart library: heights are the data's own ratio to its peak. */
function Series({ title, points }: { title: string; points: ApiAdminSeriesPointDto[] }) {
  const peak = Math.max(1, ...points.map((point) => point.count));
  const total = points.reduce((sum, point) => sum + point.count, 0);
  return (
    <div className="rounded-2xl border p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-black">{title}</p>
        <p className="text-[11px] text-muted-foreground">{toPersianNumber(total)} در {toPersianNumber(points.length)} روز</p>
      </div>
      <div className="mt-3 flex h-20 items-end gap-1" role="img" aria-label={`${title}، ${toPersianNumber(points.length)} روز اخیر`}>
        {points.map((point) => (
          <div
            key={point.date}
            title={`${dayLabel(point.date)} — ${toPersianNumber(point.count)}`}
            className={cn("flex-1 rounded-t-md", point.count ? "bg-primary/70" : "bg-muted")}
            style={{ height: `${point.count ? Math.max(8, Math.round((point.count / peak) * 100)) : 4}%` }}
          />
        ))}
      </div>
      <p className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{points.length ? dayLabel(points[0]!.date) : ""}</span>
        <span>{points.length ? dayLabel(points[points.length - 1]!.date) : ""}</span>
      </p>
    </div>
  );
}

export function AdminStatsConsole({ canControl }: { canControl: boolean }) {
  const toast = useToastStore((state) => state.push);
  const [stats, setStats] = useState<ApiAdminStatsDto | null>(null);
  const [database, setDatabase] = useState<ApiAdminDatabaseDto | null>(null);
  const [live, setLive] = useState<ApiAdminLiveAttemptDto[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [statsDto, databaseDto, liveDto] = await Promise.all([
        adminApi.stats(),
        adminApi.database(),
        adminApi.liveAttempts(search.trim() ? `search=${encodeURIComponent(search.trim())}` : ""),
      ]);
      setStats(statsDto);
      setDatabase(databaseDto);
      setLive(liveDto.attempts);
    } catch (reason) {
      setError(apiErrorMessage(reason, "درافت آمار انجام نشد."));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(label: string, action: () => Promise<unknown>, done: string) {
    setBusy(label);
    try {
      await action();
      await load();
      toast({ title: done, variant: "success" });
    } catch (reason) {
      toast({ title: "انجام نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !stats) {
    return (
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-40 rounded-2xl"/>
        ))}
      </div>
    );
  }
  if (error || !stats) {
    return (
      <Card className="mt-6">
        <CardContent className="flex flex-wrap items-center gap-3 p-5 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive"/>
          <span className="min-w-0 flex-1">{error ?? "آمار در دسترس نیست."}</span>
          <Button size="sm" onClick={() => void load()}>تلاش دوباره</Button>
        </CardContent>
      </Card>
    );
  }

  const series = [
    ["submissions", stats.activity.submissions],
    ["starts", stats.activity.starts],
    ["exams_created", stats.activity.exams_created],
    ["signups", stats.activity.signups],
    ["signals", stats.activity.signals],
  ] as const;
  const issues = Object.entries(database?.issues ?? {}).filter(([, count]) => count > 0);

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader className="flex-row items-end justify-between gap-3">
          <div>
            <CardTitle>آمار کامل سامانه</CardTitle>
            <CardDescription>
              {stats.scope.kind === "school" ? `داده‌های «${stats.scope.school?.name ?? "مدرسهٔ شما"}»` : "همهٔ شبکه، شمارش‌شده در سرور"} · آخرین محاسبه {formatDateTime(stats.generated_at)}
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy === "reload"}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>
            تازه‌سازی
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="کاربران" value={toPersianNumber(stats.totals.users)} detail={`${toPersianNumber(stats.totals.active_users)} فعال، ${toPersianNumber(stats.totals.inactive_users)} غیرفعال`}
            />
            <Tile label="آموزگار / دانش‌آموز / مدیر" value={`${toPersianNumber(stats.totals.users_by_role.teacher ?? 0)} / ${toPersianNumber(stats.totals.users_by_role.student ?? 0)} / ${toPersianNumber((stats.totals.users_by_role.admin ?? 0) + (stats.totals.users_by_role.school_admin ?? 0))}`}
              detail={stats.scope.kind === "platform" ? `${toPersianNumber(stats.totals.schools)} مدرسه` : "همین مدرسه"}/>
            <Tile label="آزمون‌ها" value={toPersianNumber(stats.totals.exams)} detail={`${toPersianNumber(stats.activity.live_now.exams_live)} فعال · ${toPersianNumber(stats.totals.exams_by_status.completed ?? 0)} پایان‌یافته · ${toPersianNumber(stats.totals.exams_by_status.archived ?? 0)} بایگانی`}/>
            <Tile label="سؤال‌ها" value={toPersianNumber(stats.totals.questions)} detail={`${toPersianNumber(stats.totals.bank_questions)} در بانک، بدون آزمون`}/>
            <Tile label="پاسخ‌برگ‌ها" value={toPersianNumber(stats.totals.attempts)} detail={`${toPersianNumber(stats.totals.answers)} پاسخ ثبت‌شده`}/>
            <Tile label="نتیجه‌های منتشرشده" value={toPersianNumber(stats.totals.results_published)} tone="success" detail={`${toPersianNumber(stats.totals.unread_notifications)} اخوانده‌نشده`}/>
            <Tile label="در انتظار تصحیح" value={toPersianNumber(stats.grading.exams_awaiting)} tone={stats.grading.exams_awaiting ? "warning" : "muted"} detail={`${toPersianNumber(stats.grading.written_ungraded)} پاسخ تشریحی بدون نمره · ${toPersianNumber(stats.grading.share_of_results)}٪ نتیجه‌ها`}/>
            <Tile label="میانگین و قبولی" value={`${toPersianNumber(stats.scores.average_percentage)}٪`} detail={`${toPersianNumber(stats.scores.pass_rate)}٪ قبولی از ${toPersianNumber(stats.scores.results_scored)} نتیجه نمره‌دار`}/>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {series.map(([key, points]) => (
              <Series key={key} title={SERIES_LABELS[key] ?? key} points={points}/>
            ))}
            <div className="rounded-2xl border p-3.5">
              <p className="text-[11px] font-black">همین حالا</p>
              <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                <li className="flex justify-between gap-2"><span>در حال نوشتن</span><b className="text-foreground">{toPersianNumber(stats.activity.live_now.attempts_in_progress)}</b></li>
                <li className="flex justify-between gap-2"><span>دانش‌آموز فعال</span><b className="text-foreground">{toPersianNumber(stats.activity.live_now.students_writing)}</b></li>
                <li className="flex justify-between gap-2"><span>آزمون فعال</span><b className="text-foreground">{toPersianNumber(stats.activity.live_now.exams_live)}</b></li>
                <li className="flex justify-between gap-2"><span>از زمانش گذشته</span><b className={cn(stats.activity.live_now.exams_overdue && "text-amber-700 dark:text-amber-400")}>{toPersianNumber(stats.activity.live_now.exams_overdue)}</b></li>
              </ul>
              <p className="mt-3 text-[10px] leading-5">معیار «همین حالا» نشستِ بازِ سرور است، نه کلیک مرورگر.</p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border p-3.5">
              <p className="text-[11px] font-black">پرسروارترین آموزگاران</p>
              <ul className="mt-2 divide-y">
                {stats.top.teachers.length ? stats.top.teachers.map((teacher) => (
                  <li className="flex items-center justify-between gap-3 py-2 text-xs" key={teacher.id}>
                    <span className="min-w-0 flex-1 truncate">{teacher.name}</span>
                    <span className="text-muted-foreground">{toPersianNumber(teacher.exams)} آزمون · {toPersianNumber(teacher.attempts)} پاسخ‌برگ</span>
                  </li>
                )) : <li className="py-2 text-xs text-muted-foreground">هنوز کسی آزمون نساخته است.</li>}
              </ul>
            </div>
            <div className="rounded-2xl border p-3.5">
              <p className="text-[11px] font-black">{stats.scope.kind === "platform" ? "مدارس بر پایهٔ آزمون" : "وضعیت پایگاه داده"}</p>
              {stats.scope.kind === "platform" ? (
                <ul className="mt-2 divide-y">
                  {stats.top.schools.map((school) => (
                    <li className="flex items-center justify-between gap-3 py-2 text-xs" key={school.id}>
                      <span className="min-w-0 flex-1 truncate">{school.name}</span>
                      <span className="text-muted-foreground">{toPersianNumber(school.users)} کاربر · {toPersianNumber(school.exams)} آزمون</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                  <p className="flex justify-between gap-2"><span>موتور</span><b className="text-foreground">{stats.health.database.engine}</b></p>
                  <p className="flex justify-between gap-2"><span>حجم</span><b className="text-foreground">{formatBytes(stats.health.database.size_bytes)}</b></p>
                  <p className="flex justify-between gap-2"><span>مهاجرت‌های باز</span><b className="text-foreground">—</b></p>
                  <p className="flex items-center gap-1.5 pt-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600"/>Django {stats.health.django}{stats.health.debug ? " · حالت توسعه" : ""}</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4"/>پایگاه داده</CardTitle>
            <CardDescription>تعداد رکوردها و ناهمخوانی‌هایی که یک نفر باید ببیند.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{formatBytes(database?.size_bytes ?? null)}</Badge>
            {canControl && (
              <Button size="sm" variant="outline" disabled={busy === "repair" || !(database && database.repairable > 0)} onClick={() => void run("repair", adminApi.repairDatabase, "مرمت انجام شد")}>
                <Save className="h-4 w-4"/>
                مرمت ({toPersianNumber(database?.repairable ?? 0)})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {(database?.tables ?? []).map((table) => (
              <div className="rounded-xl border bg-card/60 px-3 py-2" key={table.key}>
                <p className="text-[10px] font-bold text-muted-foreground">{table.label}</p>
                <p className="text-sm font-black">{toPersianNumber(table.rows)}</p>
              </div>
            ))}
          </div>
          {issues.length ? (
            <ul className="space-y-2">
              {issues.map(([key, count]) => (
                <li className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/[.07] px-3 py-2 text-xs font-bold" key={key}>
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400"/>
                  <span className="min-w-0 flex-1">{ISSUE_LABELS[key] ?? key}</span>
                  <span>{toPersianNumber(count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-500/[.07] px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5"/>ناهمخوانی‌ای باقی نمانده است.
            </p>
          )}
          {canControl && (
            <p className="text-[11px] leading-5 text-muted-foreground">
              «مرمت» چیزی را نمی‌سازد که وجود ندارد: نتیجه‌های جاافتاده را از همان پاسخ‌ها محاسبه می‌کند، جمع نمرهٔ آزمون‌ها را بازمی‌خواند و اثر انگشت سؤال‌های قدیمی را می‌سازد. نمره، برگه یا انتشار را تغییر نمی‌دهد و دوباره‌زدنش بی‌ضرر است.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4"/>نشست‌های در جریان</CardTitle>
            <CardDescription>پاسخ‌برگ‌هایی که همین حالا بازند؛ از زمان سرور شمرده می‌شود.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-48 text-xs" placeholder="نام یا ایمیل…" aria-label="جست‌وجو در نشست‌های باز"/>
            <Button size="sm" variant="ghost" onClick={() => void adminApi.liveAttempts().then((rows) => setLive(rows.attempts))}><RefreshCw className="h-4 w-4"/></Button>
          </div>
        </CardHeader>
        <CardContent>
          {live.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-[10px] uppercase text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-right font-bold">دانش‌آموز</th>
                    <th className="py-2 text-right font-bold">آزمون</th>
                    <th className="py-2 text-right font-bold">زمان باقی‌مانده</th>
                    <th className="py-2 text-right font-bold">آخرین فعالیت</th>
                    <th className="py-2 text-right font-bold">خروج از تب</th>
                    <th className="py-2 text-right font-bold">دستگاه</th>
                    {canControl && <th className="py-2 text-left font-bold">اقدام</th>}
                  </tr>
                </thead>
                <tbody>
                  {live.map((row) => (
                    <tr className="border-b last:border-0" key={row.id}>
                      <td className="py-2">
                        <p className="font-bold">{row.student.name}</p>
                        <p className="text-[10px] text-muted-foreground">{row.student.email}</p>
                      </td>
                      <td className="py-2"><p className="max-w-52 truncate">{row.exam.title}</p><p className="text-[10px] text-muted-foreground">تلاش {toPersianNumber(row.attempt_number)}</p></td>
                      <td className="py-2 font-bold">{row.remaining_seconds === null ? "—" : `${toPersianNumber(Math.max(0, Math.round(row.remaining_seconds / 60)))} دقیقه`}</td>
                      <td className="py-2 text-muted-foreground">{formatDateTime(row.last_activity_at)}</td>
                      <td className="py-2">{toPersianNumber(row.tab_switches)}</td>
                      <td className="py-2">{row.device_locked ? <Badge variant="warning">قفل</Badge> : <span className="text-muted-foreground">—</span>}</td>
                      {canControl && (
                        <td className="py-2">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => void run(row.id, () => adminApi.attemptAction(row.id, "finalize"), "پاسخ‌برگ بسته شد")} aria-label={`بستن پاسخ‌برگ ${row.student.name}`}>
                              <Archive className="h-3.5 w-3.5"/>بستن
                            </Button>
                            {row.device_locked && (
                              <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => void run(row.id, () => adminApi.attemptAction(row.id, "unlock-device"), "قفل دستگاه باز شد")} aria-label={`بازکردن قفل دستگاه ${row.student.name}`}>
                                <LockOpen className="h-3.5 w-3.5"/>بازکردن قفل
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-xl bg-muted/50 px-3 py-6 text-center text-xs text-muted-foreground">همین حالا کسی در حال نوشتن نیست.</p>
          )}
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            بستن پاسخ‌برگ، همان کاری است که «پایان آزمون» می‌کند: پاسخ‌های ذخیره‌شده نمره می‌گیرند و هیچ کاری حذف نمی‌شود. برای بازکردن قفل دستگاه هم رویدادِ ردشدن در کارنامهٔ معلم می‌ماند.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
