"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity, Bell, ClipboardList, Database, FileText, Library, ListChecks, School, ShieldCheck,
  TriangleAlert, Users,
} from "lucide-react";
import { adminApi } from "@/lib/api/admin";
import type { ApiAdminStatsDto } from "@/lib/api/dtos";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, toPersianNumber } from "@/lib/utils";

/**
 * Every section of the site, its live count, and what the signed-in role may do there.
 *
 * The console has six destinations and a reader arrives knowing one number and one question: "how much of
 * this is there, and am I allowed to touch it?" Answering both on one card each means the administrator is
 * not opening five pages to find out which one has the problem. The counts come from the same
 * `/admin/stats/` call the statistics page makes — one server-side computation, so a figure here cannot
 * disagree with the figure there.
 *
 * The scope is the server's, not this component's: a school administrator gets their own school's numbers
 * back from the same endpoint, so the panel needs no branching to stay honest.
 */
export function SiteModules({ canControl }: { canControl: boolean }) {
  const [stats, setStats] = useState<ApiAdminStatsDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminApi.stats()
      .then((payload) => { if (!cancelled) { setStats(payload); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const modules = stats ? [
    {
      icon: School, href: "/admin/schools", label: "مدارس",
      value: stats.totals.schools,
      detail: canControl ? "ساخت، تغییر نام و فعال‌سازی" : "فقط خواندنی؛ تغییرات با مدیر سامانه است",
    },
    {
      icon: Users, href: "/admin/users", label: "کاربران",
      value: stats.totals.users,
      detail: `${toPersianNumber(stats.totals.active_users)} فعال · ${toPersianNumber(stats.totals.inactive_users)} غیرفعال · ${toPersianNumber(stats.totals.users_by_role.school_admin ?? 0)} مدیر مدرسه`,
    },
    {
      icon: ClipboardList, href: "/admin/exams", label: "آزمون‌ها",
      value: stats.totals.exams,
      detail: `${toPersianNumber(stats.activity.live_now.exams_live)} فعال · ${toPersianNumber(stats.totals.exams_by_status.draft ?? 0)} پیش‌نویس · ${toPersianNumber(stats.totals.exams_by_status.archived ?? 0)} بایگانی`,
    },
    {
      icon: Library, href: "/admin/exams", label: "سؤال‌ها",
      value: stats.totals.questions,
      detail: `${toPersianNumber(stats.totals.bank_questions)} سؤال در بانک، بدون آزمون`,
    },
    {
      icon: ListChecks, href: "/admin/stats", label: "پاسخ‌برگ‌ها",
      value: stats.totals.attempts,
      detail: `${toPersianNumber(stats.totals.answers)} پاسخ ثبت‌شده · ${toPersianNumber(stats.totals.attempts_by_status.in_progress ?? 0)} در جریان`,
    },
    {
      icon: FileText, href: "/admin/stats", label: "نتیجه‌ها",
      value: stats.totals.results_published,
      detail: stats.grading.exams_awaiting
        ? `${toPersianNumber(stats.grading.exams_awaiting)} آزمون منتظر تصحیح`
        : "همهٔ نتیجه‌های آماده منتشر شده‌اند",
      attention: stats.grading.exams_awaiting > 0,
    },
    {
      icon: Activity, href: "/admin/access", label: "نشست‌های زنده",
      value: stats.activity.live_now.attempts_in_progress,
      detail: `${toPersianNumber(stats.activity.live_now.students_writing)} دانش‌آموز در حال نوشتن · ${toPersianNumber(stats.activity.live_now.exams_overdue)} آزمون از زمانش گذشته`,
      attention: stats.activity.live_now.exams_overdue > 0,
    },
    {
      icon: Bell, href: "/admin/stats", label: "اعلان‌ها",
      value: stats.totals.notifications,
      detail: `${toPersianNumber(stats.totals.unread_notifications)} خوانده‌نشده`,
    },
    {
      icon: Database, href: "/admin/stats", label: "پایگاه داده",
      value: null,
      detail: `${stats.health.database.engine} · جانگو ${stats.health.django}`,
      attention: stats.health.debug,
    },
  ] : [];

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true"/>
              بخش‌های سامانه
            </CardTitle>
            <CardDescription>
              {stats
                ? stats.scope.kind === "school"
                  ? `شمارش‌های «${stats.scope.school?.name ?? "مدرسهٔ شما"}» — همان عددهایی که صفحهٔ آمار می‌بیند.`
                  : "شمارش‌های کل شبکه — همان عددهایی که صفحهٔ آمار می‌بیند."
                : "هر بخش، اندازه از سمت سرور شمارش می‌شود، نه از روی فهرست‌های این صفحه."}
            </CardDescription>
          </div>
          {!canControl && (
            <span className="rounded-xl bg-muted px-2.5 py-1.5 text-[10px] font-black leading-4 text-muted-foreground">
              دسترسی مدیر مدرسه: نظارت، نه ویرایش محتوا
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="flex items-center gap-2 rounded-2xl border border-destructive/25 bg-destructive/[.06] p-4 text-xs font-bold text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true"/>
            شمارش بخش‌ها دریافت نشد. صفحهٔ «آمار و داده‌ها» همان عدد‌ها را دارد.
          </p>
        ) : !stats ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-2xl"/>)}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {modules.map((module) => {
              const Icon = module.icon;
              return (
                <li key={module.label}>
                  <Link
                    href={module.href}
                    className={cn(
                      "group flex h-full items-start gap-3 rounded-2xl border p-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-soft",
                      module.attention ? "border-warning/35 bg-warning/[.05]" : "border-border/70 bg-card",
                    )}
                  >
                    <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", module.attention ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary")}>
                      <Icon className="h-4 w-4" aria-hidden="true"/>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-black">{module.label}</span>
                        {module.value !== null && (
                          <span className="shrink-0 text-base font-black tabular-nums">{toPersianNumber(module.value)}</span>
                        )}
                      </span>
                      <span className="mt-1 block text-[10px] leading-5 text-muted-foreground">{module.detail}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
