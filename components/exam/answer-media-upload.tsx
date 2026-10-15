"use client";

import { useState } from "react";
import { FileAudio2, FileImage, LoaderCircle, Trash2 } from "lucide-react";
import { attemptsApi, type AttemptWriteGuards } from "@/lib/api/attempts";
import { ApiError, apiErrorMessage } from "@/lib/api/client";
import { PrivateMedia } from "@/components/shared/private-media";
import { Button } from "@/components/ui/button";
import { toAnswerMedia } from "@/lib/api/mappers";
import type { StudentAnswerMedia } from "@/lib/types/domain";
import { cn, toPersianNumber } from "@/lib/utils";

const MAX_FILES = 5;

export function AnswerMediaUpload({
  attemptId,
  questionId,
  attachments,
  allowImage,
  allowAudio,
  disabled,
  guards,
  onChange,
}: {
  attemptId: string;
  questionId: string;
  attachments: StudentAnswerMedia[];
  allowImage: boolean;
  allowAudio: boolean;
  disabled: boolean;
  guards: AttemptWriteGuards;
  onChange: (attachments: StudentAnswerMedia[], revision: number) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!allowImage && !allowAudio) return null;

  async function withRevisionRetry<T>(write: (revision: number | undefined) => Promise<T>): Promise<T> {
    let revision = guards.examRevision;
    try {
      return await write(revision);
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.status !== 409 || reason.code !== "stale_revision") throw reason;
      const current = await attemptsApi.detail(attemptId, { examSession: guards.examSession });
      revision = current.answer_revision;
      return write(revision);
    }
  }

  async function upload(file: File, kind: "image" | "audio") {
    setError(null);
    if (attachments.length >= MAX_FILES) { setError(`حداکثر ${toPersianNumber(MAX_FILES)} فایل برای هر پاسخ مجاز است.`); return; }
    const limit = kind === "image" ? 5 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size <= 0 || file.size > limit) { setError(kind === "image" ? "حجم تصویر باید حداکثر ۵ مگابایت باشد." : "حجم صدا باید حداکثر ۱۵ مگابایت باشد."); return; }
    const requestId = `${kind}-${Date.now()}`;
    setBusyId(requestId);
    try {
      const response = await withRevisionRetry((revision) => attemptsApi.uploadAnswerAttachment(attemptId, questionId, file, kind, { ...guards, examRevision: revision }));
      onChange((response.answer.attachments ?? []).map(toAnswerMedia), response.answer_revision);
    } catch (reason) {
      setError(apiErrorMessage(reason, "بارگذاری فایل انجام نشد."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(attachment: StudentAnswerMedia) {
    setError(null);
    setBusyId(attachment.id);
    try {
      const response = await withRevisionRetry((revision) => attemptsApi.deleteAnswerAttachment(attemptId, questionId, attachment.id, { ...guards, examRevision: revision }));
      onChange((response.answer.attachments ?? []).map(toAnswerMedia), response.answer_revision);
    } catch (reason) {
      setError(apiErrorMessage(reason, "حذف فایل انجام نشد."));
    } finally {
      setBusyId(null);
    }
  }

  return <section className="mt-5 rounded-2xl border border-primary/15 bg-primary/[.025] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-black">پیوست پاسخ شما</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">فایل‌ها خصوصی هستند و فقط شما و آموزگار این آزمون می‌توانید آن‌ها را ببینید.</p></div>
      <span className="text-[10px] font-bold text-muted-foreground">{toPersianNumber(attachments.length)} / {toPersianNumber(MAX_FILES)} فایل</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {allowImage && <label className={cn("inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 text-xs font-bold transition-colors hover:border-primary/40 hover:bg-muted", (disabled || busyId || attachments.length >= MAX_FILES) && "pointer-events-none opacity-55")}>
        <FileImage className="h-4 w-4 text-primary"/>افزودن تصویر
        <input className="sr-only" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={disabled || Boolean(busyId) || attachments.length >= MAX_FILES} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file, "image"); event.currentTarget.value = ""; }}/>
      </label>}
      {allowAudio && <label className={cn("inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 text-xs font-bold transition-colors hover:border-primary/40 hover:bg-muted", (disabled || busyId || attachments.length >= MAX_FILES) && "pointer-events-none opacity-55")}>
        <FileAudio2 className="h-4 w-4 text-primary"/>افزودن صدا
        <input className="sr-only" type="file" accept=".mp3,.ogg,.wav,.webm,audio/*" capture="user" disabled={disabled || Boolean(busyId) || attachments.length >= MAX_FILES} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file, "audio"); event.currentTarget.value = ""; }}/>
      </label>}
      {busyId && <span role="status" className="inline-flex items-center gap-1.5 text-xs font-bold text-primary"><LoaderCircle className="h-4 w-4 animate-spin"/>در حال ذخیرهٔ امن فایل…</span>}
    </div>
    {attachments.length > 0 && <div className="mt-3 space-y-2">{attachments.map((attachment) => <div key={attachment.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="mb-2 truncate text-[11px] font-bold text-muted-foreground">{attachment.originalName || (attachment.kind === "image" ? "تصویر پاسخ" : "صدای پاسخ")}</p>
        <PrivateMedia url={attachment.url} kind={attachment.kind} alt={attachment.originalName || "پیوست پاسخ"} className={attachment.kind === "image" ? "max-h-48 w-auto" : ""}/>
      </div>
      <Button type="button" size="sm" variant="ghost" className="self-end text-destructive sm:self-center" disabled={disabled || Boolean(busyId)} onClick={() => void remove(attachment)} aria-label="حذف پیوست"><Trash2 className="h-4 w-4"/>حذف</Button>
    </div>)}</div>}
    {error && <p role="alert" className="mt-3 rounded-xl border border-destructive/20 bg-destructive/[.04] p-2.5 text-[11px] font-bold text-destructive">{error}</p>}
    <p className="mt-3 text-[10px] leading-5 text-muted-foreground">تصویر: JPEG، PNG یا WebP، حداکثر ۵ مگابایت. صدا: MP3، OGG، WAV یا WebM، حداکثر ۱۵ مگابایت. فایل با امضای واقعی و اندازهٔ مجاز در سرور بررسی می‌شود.</p>
  </section>;
}
