"use client";

import { Check, Library, LoaderCircle, Plus, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { examsApi } from "@/lib/api/exams";
import { toTeacherQuestion } from "@/lib/api/mappers";
import { cloneQuestion, questionTypeLabel } from "@/components/teacher/question-builder";
import type { Question, QuestionType } from "@/lib/types/domain";
import { cn, toPersianNumber } from "@/lib/utils";

/**
 * Pick questions out of the bank without leaving the exam builder.
 *
 * The step this replaces told the teacher to save the draft first, then navigate to `/teacher/questions`,
 * search there, and copy across — three screens and a write, to add one question. `examsApi.bank()` lists
 * everything the teacher owns and needs no exam id, so the whole thing can happen in a dialog over the
 * wizard, straight into the local draft, and the next save persists it with everything else.
 *
 * Selections are copies (`cloneQuestion`), never references: a paper that shares a row with the bank would
 * let editing one silently rewrite a live exam.
 */
const TYPE_FILTERS: Array<{ value: "" | QuestionType; label: string }> = [
  { value: "", label: "همه" },
  ...(Object.keys(questionTypeLabel) as QuestionType[]).map((type) => ({ value: type, label: questionTypeLabel[type] })),
];

export function QuestionBankPicker({
  open,
  onClose,
  onPick,
  takenIds,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (questions: Question[]) => void;
  /** Bank ids the paper already holds, so a copy is not offered a second time. */
  takenIds: ReadonlySet<string>;
}) {
  const [rows, setRows] = useState<Question[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | QuestionType>("");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    if (rows) return;
    let cancelled = false;
    examsApi.bank()
      .then((bank) => { if (!cancelled) { setRows(bank.map(toTeacherQuestion)); setFailed(null); } })
      .catch(() => { if (!cancelled) setFailed("بانک سؤال دریافت نشد. اتصال را بررسی کنید و دوباره تلاش کنید."); });
    return () => { cancelled = true; };
  }, [open, rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter((question) => {
      if (type && question.type !== type) return false;
      if (!needle) return true;
      return question.stem.toLowerCase().includes(needle)
        || (question.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
    });
  }, [rows, query, type]);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function confirm() {
    const picked = (rows ?? [])
      .filter((question) => selected.includes(question.id))
      // Fresh ids under the draft, and `copiedFromId` kept so the paper can tell where each row came from.
      .map((question) => ({
        ...cloneQuestion(question, `question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
        copiedFromId: question.id,
      }));
    if (!picked.length) return;
    onPick(picked);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="انتخاب از بانک سؤال"
      description="سؤال‌ها کپی می‌شوند، نه منتقل؛ ویرایش این نسخه روی بانک اثر نمی‌گذارد."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[11px] font-bold text-muted-foreground">
            {selected.length ? `${toPersianNumber(selected.length)} سؤال انتخاب شده` : "هیچ سؤالی انتخاب نشده"}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>انصراف</Button>
            <Button type="button" onClick={confirm} disabled={!selected.length}>
              <Plus className="h-4 w-4"/>افزودن {toPersianNumber(selected.length)} سؤال
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true"/>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجو در متن سؤال یا برچسب‌ها…" className="pr-9" aria-label="جست‌وجو در بانک سؤال"/>
        </div>
      </div>

      {/* One scrolling row rather than a wrapped block of chips: the filter must not eat the list's height. */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="فیلتر نوع سؤال">
        {TYPE_FILTERS.map((item) => (
          <button
            key={item.value || "all"}
            type="button"
            onClick={() => setType(item.value)}
            aria-pressed={type === item.value}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors",
              type === item.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {failed ? (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/[.06] p-4 text-center">
            <p className="flex items-center justify-center gap-2 text-sm font-black text-destructive">
              <TriangleAlert className="h-4 w-4" aria-hidden="true"/>{failed}
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setRows(null)}>
              <LoaderCircle className="h-3.5 w-3.5"/>تلاش دوباره
            </Button>
          </div>
        ) : rows === null ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((index) => <li key={index} className="skeleton h-[68px] rounded-2xl"/>)}
          </ul>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-muted/25 p-8 text-center">
            <Library className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true"/>
            <p className="mt-3 text-sm font-black">{rows.length === 0 ? "بانک سؤال شما خالی است" : "سؤالی با این فیلتر پیدا نشد"}</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-6 text-muted-foreground">
              {rows.length === 0
                ? "سؤال‌هایی که در آزمون‌های قبلی ساخته‌اید و «به بانک افزودن» زده‌اید اینجا جمع می‌شوند. برای همین آزمون می‌توانید از «افزودن سؤال» در پایین همین صفحه استفاده کنید."
                : "جست‌وجو را کوتاه‌تر کنید یا فیلتر نوع را به «همه» برگردانید."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((question) => {
              const taken = takenIds.has(question.id);
              const checked = selected.includes(question.id);
              return (
                <li key={question.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors",
                      taken ? "cursor-not-allowed border-border/60 bg-muted/35 opacity-70"
                        : checked ? "border-primary/55 bg-primary/[.06]"
                          : "border-border/70 bg-card hover:border-primary/35 hover:bg-muted/35",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                      checked={checked}
                      disabled={taken}
                      onChange={() => toggle(question.id)}
                      aria-label={`انتخاب سؤال: ${question.stem || "بدون متن"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-black">{question.stem || "بدون متن سؤال"}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                        <Badge variant="neutral" className="px-1.5 py-0 text-[9px]">{questionTypeLabel[question.type]}</Badge>
                        <span>{toPersianNumber(question.points)} نمره</span>
                        {typeof question.usageCount === "number" && question.usageCount > 0 && (
                          <span>· در {toPersianNumber(question.usageCount)} آزمون دیگر</span>
                        )}
                        {(question.tags ?? []).slice(0, 2).map((tag) => <span key={tag}>· {tag}</span>)}
                      </span>
                    </span>
                    {taken && (
                      <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[10px] font-black text-muted-foreground">
                        <Check className="h-3 w-3" aria-hidden="true"/>اضافه شده
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
