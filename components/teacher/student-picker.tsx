"use client";

import { Check, LoaderCircle, Search, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { StudentAudienceItem } from "@/lib/types/domain";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, toPersianNumber } from "@/lib/utils";

/**
 * One roster, one selection model, used by both the groups page and an exam's audience step.
 *
 * It is deliberately *not* responsible for fetching: the caller owns the roster because the same list is
 * needed elsewhere on the screen (a count, a class filter, a summary) and fetching it twice would produce
 * two rosters that can disagree. Everything here is a pure function of `students` and `selectedIds`.
 */
export function StudentPicker({
  students,
  selectedIds,
  onChange,
  loading = false,
  emptyHint,
  className,
  listClassName,
}: {
  students: StudentAudienceItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  emptyHint?: string;
  className?: string;
  listClassName?: string;
}) {
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const classes = useMemo(
    () => [...new Set(students.map((student) => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fa")),
    [students],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return students.filter((student) => {
      if (classFilter !== "all" && student.className !== classFilter) return false;
      if (!needle) return true;
      return `${student.fullName} ${student.email}`.toLowerCase().includes(needle);
    });
  }, [classFilter, query, students]);

  /** Grouped so a teacher can read "پایه دوازدهم · تجربی ۲" as a block instead of a flat 200-row list. */
  const grouped = useMemo(() => {
    const buckets = new Map<string, StudentAudienceItem[]>();
    for (const student of filtered) {
      const key = student.className?.trim() || "بدون کلاس";
      const bucket = buckets.get(key);
      if (bucket) bucket.push(student);
      else buckets.set(key, [student]);
    }
    return [...buckets.entries()];
  }, [filtered]);

  const filteredSelectedCount = filtered.filter((student) => selected.has(student.id)).length;
  const allFilteredSelected = filtered.length > 0 && filteredSelectedCount === filtered.length;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }
  function toggleAllFiltered() {
    const next = new Set(selected);
    if (allFilteredSelected) filtered.forEach((student) => next.delete(student.id));
    else filtered.forEach((student) => next.add(student.id));
    onChange([...next]);
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pr-9"
            placeholder="جست‌وجوی نام یا ایمیل…"
            aria-label="جست‌وجوی دانش‌آموز"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="پاک‌کردن جست‌وجو" className="absolute left-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {classes.length > 0 && (
          <label className="flex h-10 shrink-0 items-center gap-2 rounded-xl border bg-card px-3 text-xs font-bold">
            <UsersRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">فیلتر کلاس</span>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none">
              <option value="all">همهٔ کلاس‌ها</option>
              {classes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-muted-foreground" role="status">
          {loading ? "در حال دریافت فهرست…" : `${toPersianNumber(selectedIds.length)} دانش‌آموز انتخاب شده`}
          {!loading && filtered.length !== students.length && ` · ${toPersianNumber(filtered.length)} مورد در فهرست`}
        </p>
        <div className="flex gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={toggleAllFiltered} disabled={loading || filtered.length === 0}>
            {allFilteredSelected ? "لغو انتخاب این فهرست" : "انتخاب این فهرست"}
          </Button>
          {selectedIds.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onChange([])}>
              پاک‌کردن همه
            </Button>
          )}
        </div>
      </div>

      <div className={cn("mt-2 min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-muted/20 p-2", listClassName)}>
        {loading ? (
          <div className="grid h-40 place-items-center text-xs font-bold text-muted-foreground">
            <LoaderCircle className="ml-2 inline h-4 w-4 animate-spin text-primary" />در حال دریافت فهرست دانش‌آموزان…
          </div>
        ) : filtered.length === 0 ? (
          <p className="grid h-32 place-items-center px-4 text-center text-xs leading-6 text-muted-foreground">
            {emptyHint ?? (students.length === 0
              ? "دانش‌آموزی در فهرست مجاز شما نیست. مدیر سامانه باید دانش‌آموزان را به مدرسهٔ شما متصل کند."
              : "دانش‌آموزی با این مشخصات پیدا نشد.")}
          </p>
        ) : (
          grouped.map(([className, members]) => (
            <section key={className}>
              <h4 className="sticky top-0 z-10 -mx-2 mb-1 bg-muted/85 px-4 py-1.5 text-[10px] font-black text-muted-foreground backdrop-blur-sm">
                {className} · {toPersianNumber(members.length)} نفر
              </h4>
              <div className="grid gap-1 sm:grid-cols-2">
                {members.map((student) => {
                  const checked = selected.has(student.id);
                  return (
                    <button
                      type="button"
                      key={student.id}
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggle(student.id)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border p-2.5 text-right transition-colors",
                        checked ? "border-primary/40 bg-primary/[.07]" : "border-transparent bg-card hover:border-border",
                      )}
                    >
                      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors", checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")} aria-hidden="true">
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-extrabold">{student.fullName}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" dir="ltr">{student.email}</span>
                      </span>
                      {student.grade && <span className="shrink-0 rounded-lg bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{student.grade}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
