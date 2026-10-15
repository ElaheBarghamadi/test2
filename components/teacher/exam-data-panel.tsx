"use client";

import { Download, FileJson, Printer, ShieldCheck, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { examsApi } from "@/lib/api/exams";
import { resultsApi } from "@/lib/api/results";
import { apiErrorMessage } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { createPrintableExamHtml } from "@/lib/exam/printable-paper";
import { useToastStore } from "@/lib/state/toast-store";
import { downloadFile, stamp } from "@/lib/utils/download";
import { toPersianNumber } from "@/lib/utils";

/**
 * The paper's own data: a file the teacher can keep, the results as a spreadsheet, and the same file read
 * back as a new draft.
 *
 * Why this sits on the exam and not in a general "backup" screen: a paper is the unit a teacher reasons in,
 * and a download that is missing two questions is only noticeable when it is compared against *that* exam.
 * Two rules the server enforces and the panel repeats: the export never contains a student's answers, and
 * an import always arrives as an unscheduled draft owned by whoever imported it.
 */
/** Files are read through `File.text()` where it exists; `FileReader` is the fallback, not the plan. */
function readText(file: File) {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

export function ExamDataPanel({ examId, examTitle, questionCount }: { examId: string; examTitle: string; questionCount: number }) {
  const toast = useToastStore((state) => state.push);
  const [busy, setBusy] = useState<"export" | "csv" | "import" | "print" | null>(null);
  const [bundle, setBundle] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function exportPaper() {
    setBusy("export");
    try {
      const received = await examsApi.exportExam(examId);
      setBundle(JSON.stringify(received, null, 2));
      downloadFile(`exam-${stamp()}.json`, JSON.stringify(received, null, 2));
      toast({
        title: "فایل آزمون دانلود شد",
        description: `${toPersianNumber(received.questions.length)} سؤال با کلید و تنظیمات. پاسخ هیچ دانش‌آموزی در این فایل نیست.`,
        variant: "success",
      });
    } catch (reason) {
      toast({ title: "خروجی گرفته نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  /** Open the print window synchronously from the button click so popup blockers allow it. */
  async function printPaper() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ title: "پنجرهٔ چاپ باز نشد", description: "اجازهٔ بازشدن پنجرهٔ جدید را برای این سایت فعال کنید و دوباره بزنید.", variant: "error" });
      return;
    }
    setPrintOpen(false);
    setBusy("print");
    printWindow.document.open();
    printWindow.document.write("<!doctype html><html lang=\"fa\" dir=\"rtl\"><meta charset=\"utf-8\"><title>آماده‌سازی برگه</title><body style=\"font:16px Tahoma,Arial,sans-serif;padding:40px;text-align:center\">در حال آماده‌سازی برگهٔ آزمون…</body></html>");
    printWindow.document.close();
    try {
      const received = await examsApi.exportExam(examId);
      if (printWindow.closed) return;
      printWindow.document.open();
      printWindow.document.write(createPrintableExamHtml(received, includeAnswerKey));
      printWindow.document.close();
      window.setTimeout(() => {
        if (printWindow.closed) return;
        printWindow.focus();
        printWindow.print();
      }, 350);
      toast({
        title: "برگهٔ چاپ آماده است",
        description: includeAnswerKey ? "در پنجرهٔ چاپ، چاپگر یا «ذخیره به‌صورت PDF» را انتخاب کنید؛ کلید پاسخ در صفحهٔ جداگانه است." : "در پنجرهٔ چاپ، چاپگر یا «ذخیره به‌صورت PDF» را انتخاب کنید.",
        variant: "success",
      });
    } catch (reason) {
      if (!printWindow.closed) printWindow.close();
      toast({ title: "برگه آماده نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function exportResults() {
    setBusy("csv");
    try {
      const csv = await resultsApi.exportCsv(examId);
      downloadFile(`results-${stamp()}.csv`, typeof csv === "string" ? csv : "", "text/csv");
      toast({ title: "جدول نتایج دانلود شد", description: "یک ردیف برای هر پاسخ‌برگ، یک ستون برای هر سؤال.", variant: "success" });
    } catch (reason) {
      toast({ title: "جدول گرفته نشد", description: apiErrorMessage(reason), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  /** Reading a file back: parse locally only to fail early with a legible sentence, then let the API decide. */
  async function importBundle(file: File) {
    setBusy("import");
    try {
      const parsed = JSON.parse(await readText(file));
      const created = await examsApi.importExam(parsed);
      toast({
        title: "آزمون از فایل ساخته شد",
        description: `${toPersianNumber(created.imported?.questions ?? 0)} سؤال در یک آزمون پیش‌نویس. زمان‌بندی ندارد؛ برای برگزاری باید آن را تنظیم کنید.`,
        variant: "success",
      });
    } catch (reason) {
      toast({
        title: "فایل پذیرفته نشد",
        description: reason instanceof SyntaxError ? "محتوای فایل JSON معتبر نیست." : apiErrorMessage(reason),
        variant: "error",
      });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>داده‌های این آزمون</CardTitle>
        <CardDescription>نسخهٔ قابل‌نگهداری از خودِ برگه، و جدول نمره‌ها برای دبیرستان.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { setIncludeAnswerKey(false); setPrintOpen(true); }} disabled={busy !== null}>
            <Printer className="h-4 w-4"/>{busy === "print" ? "در حال آماده‌سازی…" : "چاپ / ذخیرهٔ PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportPaper()} disabled={busy !== null}>
            <FileJson className="h-4 w-4"/>{busy === "export" ? "در حال آماده‌سازی…" : "دانلود فایل آزمون"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportResults()} disabled={busy !== null}>
            <Download className="h-4 w-4"/>{busy === "csv" ? "در حال آماده‌سازی…" : "دانلود جدول نمره‌ها (CSV)"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
            <Upload className="h-4 w-4"/>{busy === "import" ? "در حال ساخت…" : "ساخت آزمون از فایل"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="فایل آزمون برای بارگذاری"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importBundle(file);
            }}
          />
        </div>
        <p className="flex items-start gap-2 rounded-2xl bg-muted/60 p-3 text-[11px] leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"/>
          فایل آزمون فقط خودِ برگه است: {toPersianNumber(questionCount)} سؤال به‌همراه کلید، بارم‌ها و تنظیمات — بدون هیچ پاسخی از دانش‌آموزان. آزمونِ ساخته‌شده از فایل، پیش‌نویس است و زمان‌بندی ندارد.
        </p>
        {bundle && (
          <details className="rounded-2xl border p-3 text-[11px]">
            <summary className="cursor-pointer font-bold">
              پیش‌نمایش فایل
              <Badge className="mr-2" variant="neutral">{toPersianNumber(new Blob([bundle]).size)} بایت</Badge>
            </summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-muted/50 p-3 text-[10px] leading-5" dir="ltr">
              {bundle.slice(0, 4000)}
            </pre>
          </details>
        )}
        <p className="text-[11px] text-muted-foreground">«{examTitle}» روی همین سرور مانده است؛ این فایل فقط یک نسخهٔ اضافه است.</p>
      </CardContent>
    </Card>
    <Dialog open={printOpen} onClose={() => setPrintOpen(false)} title="چاپ برگهٔ آزمون" description="نسخهٔ موردنیاز را انتخاب کنید. پنجرهٔ چاپ باز می‌شود؛ برای دریافت فایل، «ذخیره به‌صورت PDF» را بزنید." size="md">
      <div role="radiogroup" aria-label="محتوای برگه" className="space-y-3">
        <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${!includeAnswerKey ? "border-primary bg-primary/[.05]" : "hover:bg-muted/40"}`}>
          <input type="radio" name="exam-paper-version" checked={!includeAnswerKey} onChange={() => setIncludeAnswerKey(false)} className="mt-1 accent-primary"/>
          <span><span className="block text-sm font-extrabold">نسخهٔ دانش‌آموز</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">سؤال‌ها و فضای پاسخ؛ بدون نمایش کلید یا پاسخ درست.</span></span>
        </label>
        <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${includeAnswerKey ? "border-primary bg-primary/[.05]" : "hover:bg-muted/40"}`}>
          <input type="radio" name="exam-paper-version" checked={includeAnswerKey} onChange={() => setIncludeAnswerKey(true)} className="mt-1 accent-primary"/>
          <span><span className="block text-sm font-extrabold">نسخهٔ دبیر + کلید پاسخ</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">کلید در صفحه‌ای جدا می‌آید؛ پیش از توزیع، صفحهٔ کلید را جدا کنید.</span></span>
        </label>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => setPrintOpen(false)}>انصراف</Button>
        <Button onClick={() => void printPaper()} disabled={busy !== null}><Printer className="h-4 w-4"/>آماده‌سازی برگه</Button>
      </div>
    </Dialog>
    </>
  );
}
