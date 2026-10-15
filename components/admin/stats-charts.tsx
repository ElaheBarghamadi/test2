"use client";

import { useState } from "react";
import type { ApiAdminSeriesPointDto } from "@/lib/api/dtos";
import { cn, toPersianNumber } from "@/lib/utils";

/**
 * Charts for the console, drawn by hand rather than pulled in as a dependency.
 *
 * The site runs with no internet access and every library is vendored, so "add a chart library" means adding
 * one to the offline bundle for four pictures. An SVG path and a few divs cover what an administrator
 * actually reads off a dashboard, and they inherit the theme's own colour tokens instead of shipping a
 * second palette that has to be told about dark mode.
 *
 * Both charts run **right to left**, oldest at the start edge: the console is an RTL page, the bar charts
 * next to these already lay their days out that way, and a trend that runs against every other timeline on
 * the screen reads as going backwards.
 */

const COLORS: Record<string, string> = {
  submissions: "hsl(var(--primary))",
  starts: "hsl(173 64% 40%)",
  exams_created: "hsl(265 70% 60%)",
  signups: "hsl(38 92% 50%)",
  signals: "hsl(343 72% 50%)",
};
const FALLBACK_COLOR = "hsl(var(--muted-foreground))";

const W = 600;
const H = 190;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

/**
 * One day's label, short enough for an axis.
 *
 * Parsed as a UTC noon and formatted in UTC on purpose: the server buckets by `TruncDate` in the site's own
 * timezone and sends a bare `YYYY-MM-DD`, so letting the browser interpret it as local midnight shifts every
 * label by a day for anyone east of Greenwich.
 */
export function dayLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(date);
  } catch {
    return iso.slice(5, 10);
  }
}

export interface TrendSeries { key: string; label: string; points: ApiAdminSeriesPointDto[] }

/**
 * Every series on one set of axes.
 *
 * Five separate bar charts answer "what did this one do"; only an overlay answers "did submissions follow
 * starts, and did either follow the exams being written". Series can be switched off, because «رویدادهای
 * نشست» runs an order of magnitude above «آزمون‌های ساخته‌شده» and would otherwise flatten the rest into
 * the axis.
 */
export function TrendChart({ series, className }: { series: TrendSeries[]; className?: string }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const shown = series.filter((item) => !hidden.has(item.key) && item.points.length > 0);
  const days = Math.max(0, ...series.map((item) => item.points.length));
  const peak = Math.max(1, ...shown.flatMap((item) => item.points.map((point) => point.count)));
  const total = shown.reduce((sum, item) => sum + item.points.reduce((inner, point) => inner + point.count, 0), 0);

  // Oldest at the right edge, newest at the left, matching the bar charts beside it.
  const x = (index: number) => (days <= 1 ? W / 2 : W - (index * W) / (days - 1));
  const y = (value: number) => H - PAD_BOTTOM - (value / peak) * (H - PAD_TOP - PAD_BOTTOM);
  const line = (points: ApiAdminSeriesPointDto[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.count).toFixed(2)}`).join(" ");
  const area = (points: ApiAdminSeriesPointDto[]) =>
    `${line(points)} L${x(points.length - 1).toFixed(2)},${(H - PAD_BOTTOM).toFixed(2)} L${x(0).toFixed(2)},${(H - PAD_BOTTOM).toFixed(2)} Z`;

  function toggle(key: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (days === 0) return null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {series.map((item) => {
          const off = hidden.has(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item.key)}
              aria-pressed={!off}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors",
                off ? "border-border text-muted-foreground line-through opacity-70" : "border-border bg-card text-foreground hover:border-primary/40",
              )}
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: off ? "hsl(var(--muted-foreground))" : COLORS[item.key] ?? FALLBACK_COLOR }}/>
              {item.label}
            </button>
          );
        })}
        <span className="ms-auto text-[10px] font-bold text-muted-foreground">
          {toPersianNumber(total)} رویداد در {toPersianNumber(days)} روز
        </span>
      </div>

      <div className="relative mt-3" dir="rtl">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-48 w-full"
          role="img"
          aria-label={`روند ${shown.map((item) => item.label).join("، ")} در ${toPersianNumber(days)} روز اخیر`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const level = H - PAD_BOTTOM - ratio * (H - PAD_TOP - PAD_BOTTOM);
            return <line key={ratio} x1={0} x2={W} y1={level} y2={level} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray={ratio === 0 ? undefined : "3 5"} vectorEffect="non-scaling-stroke"/>;
          })}
          {shown.map((item) => {
            const color = COLORS[item.key] ?? FALLBACK_COLOR;
            return <path key={`${item.key}-area`} d={area(item.points)} fill={color} opacity={0.09}/>;
          })}
          {shown.map((item) => (
            <path
              key={item.key}
              d={line(item.points)}
              fill="none"
              stroke={COLORS[item.key] ?? FALLBACK_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Hover columns sit over the SVG as HTML: `preserveAspectRatio="none"` stretches the drawing to the
            container, so a pointer target computed inside it would not line up with what is on screen. */}
        <div className="absolute inset-0 flex" aria-hidden="true">
          {Array.from({ length: days }).map((_, index) => {
            const date = series[0]?.points[index]?.date ?? "";
            const parts = series
              .filter((item) => !hidden.has(item.key) && item.points[index])
              .map((item) => `${item.label}: ${toPersianNumber(item.points[index]!.count)}`);
            return (
              <div
                key={index}
                title={date ? `${dayLabel(date)} — ${parts.join(" · ") || "بدون رویداد"}` : undefined}
                className="h-full flex-1 cursor-crosshair hover:bg-foreground/[.04]"
              />
            );
          })}
        </div>
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" dir="rtl">
        <span>{series[0]?.points[0] ? dayLabel(series[0].points[0].date) : ""}</span>
        <span className="font-bold">اوج: {toPersianNumber(peak)}</span>
        <span>{series[0]?.points[days - 1] ? dayLabel(series[0].points[days - 1].date) : ""}</span>
      </div>
    </div>
  );
}

const SHARE_LABELS: Record<string, string> = {
  // Roles
  student: "دانش‌آموز", teacher: "آموزگار", admin: "مدیر سامانه", school_admin: "مدیر مدرسه",
  // Exam statuses
  draft: "پیش‌نویس", scheduled: "زمان‌بندی‌شده", active: "فعال", completed: "پایان‌یافته", archived: "بایگانی",
  /*
   * Attempt statuses. `in_progress` is deliberately *not* «در حال نوشتن»: the «همین حالا» tile beside these
   * bars uses those words for the same count, and one screen saying the same thing twice in the same words
   * with two different typefaces reads as two different numbers.
   */
  in_progress: "در جریان", submitted: "ارسال‌شده", expired: "منقضی", abandoned: "رهاشده",
};

/**
 * A composition as bars: who the users are, what state the papers are in, where the sheets ended up.
 *
 * The counts arrive as a dictionary keyed on the server's own enum values, so anything unrecognised is shown
 * under its raw key rather than dropped — a new status appearing here as gibberish is a prompt to name it,
 * while a silently missing bar would look like a zero.
 */
export function ShareBars({ title, counts, total, emptyHint }: { title: string; counts: Record<string, number>; total?: number; emptyHint?: string }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const whole = total ?? rows.reduce((sum, [, value]) => sum + value, 0);
  const peak = Math.max(1, ...rows.map(([, value]) => value));

  return (
    <div className="rounded-2xl border p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-black">{title}</p>
        <p className="text-[11px] text-muted-foreground">{toPersianNumber(whole)}</p>
      </div>
      {whole === 0 ? (
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{emptyHint ?? "موردی برای نمایش نیست."}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(([key, value]) => (
            <li key={key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[10px]">
                <span className="truncate font-bold">{SHARE_LABELS[key] ?? key}</span>
                <span className="shrink-0 font-bold text-muted-foreground tabular-nums">
                  {toPersianNumber(value)}
                  <span className="ms-1 text-[9px]">({toPersianNumber(Math.round((value / Math.max(1, whole)) * 100))}٪)</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={whole} aria-valuenow={value} aria-label={`${SHARE_LABELS[key] ?? key} از ${title}`}>
                <div className="h-full rounded-full bg-primary/75 transition-[width] duration-500" style={{ width: `${(value / peak) * 100}%` }}/>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
