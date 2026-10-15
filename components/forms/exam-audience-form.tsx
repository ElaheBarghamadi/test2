"use client";

import { Info, Layers, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usersApi } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/api/client";
import type { AudienceMode, StudentAudienceItem, StudentGroup } from "@/lib/types/domain";
import { StudentPicker } from "@/components/teacher/student-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, toPersianNumber } from "@/lib/utils";

/**
 * Who is allowed to sit this exam.
 *
 * Two modes, and the difference is a promise the server keeps:
 *
 *   * `profile` — anyone whose grade and class match the paper. This is what every exam created before
 *     audience selection existed still uses, so an old paper keeps behaving exactly as it did.
 *   * `selected` — an explicit roster of groups plus individual students. Groups expand to their *current*
 *     members when a student starts, so adding someone to the group later is enough; nobody has to reopen
 *     the exam.
 *
 * `selected` with an empty roster is refused, not published: a paper nobody can open is a silent failure the
 * teacher would only find out about from a student who could not start.
 */
export function ExamAudienceForm({
  audienceMode,
  studentGroupIds,
  studentIds,
  grade,
  examClassName,
  errors,
  onChange,
}: {
  audienceMode: AudienceMode;
  studentGroupIds: string[];
  studentIds: string[];
  grade: string;
  examClassName: string;
  errors: Array<{ field: string; message: string }>;
  onChange: (patch: { audienceMode?: AudienceMode; studentGroupIds?: string[]; studentIds?: string[] }) => void;
}) {
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [students, setStudents] = useState<StudentAudienceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(studentIds.length > 0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupRows, roster] = await Promise.all([usersApi.studentGroups(), usersApi.studentDirectory()]);
      setGroups(groupRows);
      setStudents(roster);
    } catch (reason) {
      setError(apiErrorMessage(reason, "دریافت گروه‌ها و فهرست دانش‌آموزان انجام نشد."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (audienceMode === "selected") void load(); }, [audienceMode]);

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  /** Union, not sum: a student who is both in a chosen group and picked by hand is one person. */
  const eligible = useMemo(() => {
    if (audienceMode !== "selected") return null;
    const ids = new Set(studentIds);
    for (const group of groups) if (studentGroupIds.includes(group.id)) group.studentIds.forEach((id) => ids.add(id));
    return ids;
  }, [audienceMode, groups, studentGroupIds, studentIds]);

  const groupError = errors.find((item) => item.field === "audience")?.message;

  function toggleGroup(id: string) {
    const next = new Set(studentGroupIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ studentGroupIds: [...next] });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={audienceMode === "profile"}
          icon={UsersRound}
          title="بر اساس پایه و کلاس"
          description="هر دانش‌آموزی که پایه و کلاسش با مشخصات این آزمون یکی باشد، آن را می‌بیند."
          hint={grade || examClassName ? `${grade || "—"} · ${examClassName || "—"}` : "پایه و کلاس در گام اول تعیین می‌شود."}
          onClick={() => onChange({ audienceMode: "profile" })}
        />
        <ModeCard
          active={audienceMode === "selected"}
          icon={Layers}
          title="گروه‌ها و دانش‌آموزان انتخابی"
          description="فقط کسانی که خودتان برمی‌دارید. برای آزمون‌های تکمیلی، المپیاد یا جبرانی."
          hint={eligible ? `${toPersianNumber(eligible.size)} نفر مجاز` : "نیازمند انتخاب دست‌کم یک گروه یا دانش‌آموز"}
          onClick={() => { onChange({ audienceMode: "selected" }); setShowRoster(true); }}
        />
      </div>

      {audienceMode === "profile" ? (
        <div className="flex items-start gap-3 rounded-2xl border bg-muted/35 p-4 text-xs leading-6 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            در این حالت فهرست جداگانه‌ای ذخیره نمی‌شود؛ هر دانش‌آموزی که پروفایلش با <b className="font-black text-foreground">{grade || "این پایه"}</b> و <b className="font-black text-foreground">{examClassName || "این کلاس"}</b> مطابقت داشته باشد آزمون را می‌بیند. اگر می‌خواهید فقط افراد مشخصی دسترسی داشته باشند، حالت گروه‌ها را انتخاب کنید.
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/25 bg-destructive/[.05] p-3 text-xs font-bold leading-6 text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />تلاش دوباره</Button>
            </div>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black">گروه‌ها</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  عضویت گروه در لحظهٔ شروع آزمون خوانده می‌شود؛ اگر بعداً کسی را به گروه اضافه کنید، بدون ویرایش آزمون به آن دسترسی پیدا می‌کند.
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <a href="/teacher/groups" target="_blank" rel="noreferrer"><UserPlus className="h-3.5 w-3.5" />مدیریت گروه‌ها</a>
              </Button>
            </div>
            {loading && groups.length === 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: 2 }).map((_, index) => <div key={index} className="h-16 animate-soft-pulse rounded-xl bg-muted" />)}
              </div>
            ) : groups.length === 0 ? (
              <p className="rounded-2xl border border-dashed bg-muted/25 p-4 text-xs leading-6 text-muted-foreground">
                هنوز گروهی نساخته‌اید. می‌توانید همین‌جا دانش‌آموزان را دستی انتخاب کنید، یا اول در صفحهٔ «گروه‌ها» یک گروه بسازید تا در آزمون‌های بعدی یک کلیک کار داشته باشید.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {groups.map((group) => {
                  const active = studentGroupIds.includes(group.id);
                  return (
                    <button
                      type="button"
                      key={group.id}
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => toggleGroup(group.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-3 text-right transition-colors",
                        active ? "border-primary/40 bg-primary/[.07]" : "bg-card hover:border-border",
                      )}
                    >
                      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", active ? "bg-primary text-primary-foreground" : "bg-muted text-primary")} aria-hidden="true">
                        <Layers className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-black">{group.name}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {toPersianNumber(group.studentCount)} عضو{group.description ? ` · ${group.description}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <button
              type="button"
              onClick={() => setShowRoster((current) => !current)}
              aria-expanded={showRoster}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-muted/35 p-3.5 text-right transition-colors hover:bg-muted/55"
            >
              <span>
                <span className="block text-sm font-black">انتخاب دانش‌آموزان به‌صورت تکی</span>
                <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
                  {studentIds.length > 0
                    ? `${toPersianNumber(studentIds.length)} نفر جدا از گروه‌ها اضافه شده‌اند.`
                    : "برای کسانی که در هیچ گروهی نیستند."}
                </span>
              </span>
              <Badge variant={studentIds.length ? "default" : "neutral"}>{showRoster ? "بستن" : "بازکردن"}</Badge>
            </button>
            {showRoster && (
              <div className="mt-3 rounded-2xl border bg-card p-3">
                <StudentPicker
                  students={students}
                  selectedIds={studentIds}
                  onChange={(ids) => onChange({ studentIds: ids })}
                  loading={loading}
                  listClassName="max-h-80"
                />
                {studentIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
                    {studentIds.slice(0, 8).map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">
                        {studentById.get(id)?.fullName ?? "…"}
                        <button type="button" aria-label="حذف از فهرست" onClick={() => onChange({ studentIds: studentIds.filter((item) => item !== id) })} className="grid h-3.5 w-3.5 place-items-center rounded-full hover:bg-background">
                          <span className="text-[9px] leading-none">×</span>
                        </button>
                      </span>
                    ))}
                    {studentIds.length > 8 && <span className="text-[10px] font-bold text-muted-foreground">+{toPersianNumber(studentIds.length - 8)} نفر</span>}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-4", eligible && eligible.size > 0 ? "border-success/25 bg-success/[.06]" : "border-warning/30 bg-warning/[.07]")}>
            {loading ? <LoaderCircle className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              : eligible && eligible.size > 0 ? <ShieldCheck className="h-5 w-5 text-success" aria-hidden="true" />
              : <TriangleAlert className="h-5 w-5 text-warning" aria-hidden="true" />}
            <span className="min-w-0 flex-1 text-xs font-bold leading-6">
              {eligible && eligible.size > 0
                ? <>این آزمون برای <b className="font-black">{toPersianNumber(eligible.size)} دانش‌آموز</b> قابل دسترسی خواهد بود. بقیه آن را در فهرست خود نمی‌بینند.</>
                : <>در حالت انتخابی باید دست‌کم یک گروه یا یک دانش‌آموز انتخاب کنید؛ وگرنه هیچ‌کس نمی‌تواند آزمون را باز کند.</>}
            </span>
          </div>
          {groupError && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[.05] p-3 text-xs font-bold leading-6 text-destructive">{groupError}</p>}
        </div>
      )}
    </div>
  );
}

function ModeCard({ active, icon: Icon, title, description, hint, onClick }: { active: boolean; icon: typeof Layers; title: string; description: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[124px] flex-col items-start gap-2 rounded-2xl border p-4 text-right transition-all",
        active ? "border-primary bg-primary/[.07] shadow-soft" : "bg-card hover:border-primary/35",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", active ? "bg-primary text-primary-foreground" : "bg-muted text-primary")} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        {active && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-black text-primary">فعال</span>}
      </span>
      <span className="block text-sm font-black">{title}</span>
      <span className="block text-[11px] leading-5 text-muted-foreground">{description}</span>
      <span className={cn("mt-auto block truncate text-[10px] font-bold", active ? "text-primary" : "text-muted-foreground")}>{hint}</span>
    </button>
  );
}
