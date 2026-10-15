"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExamIntegrityRules } from "@/lib/types/domain";
import { examAttemptService, type IntegritySignalKind } from "@/lib/services/exam-attempt-service";
import { OFF_RULES, tabBudgetNotice } from "@/lib/exam/integrity";
import { toPersianNumber } from "@/lib/utils";

/**
 * Browser-side observations and the few explicitly requested page-level blocks.
 *
 * The server chooses the rules and measures visibility duration. This hook only reports transitions and
 * renders the server's response; it does not decide that an event is cheating. A regular web page cannot
 * reliably block operating-system screenshots or enumerate/disable extensions.
 */
export function useExamIntegrity({
  attemptId,
  examSession,
  rules,
  active,
  onEndedByServer,
}: {
  attemptId: string | null;
  examSession: string;
  rules?: ExamIntegrityRules;
  /** Only an in-progress attempt is watched; a submitted sheet is not an exam any more. */
  active: boolean;
  onEndedByServer?: (reason: string) => void;
}) {
  const [tabSwitchesRemaining, setTabSwitchesRemaining] = useState<number | null>(rules?.tabSwitchesRemaining ?? null);
  const [fullscreenMissing, setFullscreenMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ended = useRef(onEndedByServer);
  ended.current = onEndedByServer;
  const visibilityQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setTabSwitchesRemaining(rules?.tabSwitchesRemaining ?? null);
    setFullscreenMissing(Boolean(rules?.requireFullscreen) && !document.fullscreenElement);
  }, [rules?.requireFullscreen, rules?.tabSwitchesRemaining]);

  /** One signal, one chance to react. A report that cannot be sent must never interrupt an exam. */
  const report = useCallback(
    async (kind: IntegritySignalKind, detail?: Record<string, unknown>) => {
      if (!attemptId || !rules?.records) return null;
      try {
        const summary = await examAttemptService.recordSignal(attemptId, kind, examSession, detail);
        if (typeof summary.tab_switches_remaining === "number") setTabSwitchesRemaining(summary.tab_switches_remaining);
        if (summary.violation_recorded) {
          const count = toPersianNumber(summary.tab_switches);
          const grace = toPersianNumber(summary.tab_switch_grace_seconds ?? rules.tabSwitchGraceSeconds);
          const limit = summary.max_tab_switches;
          if (summary.auto_submitted) {
            setNotice(`خروج طولانیِ ${grace} ثانیه‌ای پس از ${toPersianNumber(limit)} اخطار آزمون را بست؛ پاسخ‌های ذخیره‌شده باقی مانده‌اند.`);
          } else if (summary.policy === "observe") {
            setNotice(`خروج بیش از ${grace} ثانیه ثبت شد (اخطار ${count}). این آزمون خودکار متوقف نمی‌شود.`);
          } else if (limit > 0 && summary.tab_switches >= limit) {
            setNotice(`اخطار ${count} از ${toPersianNumber(limit)} ثبت شد؛ خروج طولانیِ بعدی آزمون را می‌بندد.`);
          } else if (limit > 0) {
            setNotice(`خروج بیش از ${grace} ثانیه ثبت شد؛ اخطار ${count} از ${toPersianNumber(limit)}.`);
          } else {
            setNotice(`خروج بیش از ${grace} ثانیه ثبت شد (اخطار ${count}). توقف خودکار خاموش است.`);
          }
        }
        if (summary.auto_submitted) ended.current?.(summary.reason ?? "integrity");
        return summary;
      } catch {
        // The teacher's log is the loser here, not the student's exam.
        return null;
      }
    },
    [attemptId, examSession, rules],
  );

  /** Keep the hidden/start and visible/end requests in order, even when the student returns quickly. */
  const enqueueVisibility = useCallback((kind: "tab_hidden" | "tab_hidden_timeout" | "tab_visible") => {
    visibilityQueue.current = visibilityQueue.current
      .then(() => report(kind))
      .then(() => undefined)
      .catch(() => undefined);
    return visibilityQueue.current;
  }, [report]);

  // The server holds a provisional departure and only records it once its own clock passes the grace period.
  // A client timer prompts that check while hidden; the return event is a second check if background timers were
  // throttled. A quick return clears the provisional state without creating any warning event.
  useEffect(() => {
    if (!active || !attemptId || !rules?.records) return;
    const graceMs = Math.max(0, rules.tabSwitchGraceSeconds) * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let previousHidden = false;

    const onVisibility = () => {
      const hidden = Boolean(document.hidden);
      if (hidden === previousHidden) return;
      previousHidden = hidden;
      if (hidden) {
        void enqueueVisibility("tab_hidden");
        if (graceMs > 0) {
          timer = setTimeout(() => {
            timer = null;
            if (document.hidden) void enqueueVisibility("tab_hidden_timeout");
          }, graceMs);
        }
      } else {
        if (timer) clearTimeout(timer);
        timer = null;
        void enqueueVisibility("tab_visible");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    // Reconcile a departure which was still provisional when the student refreshed or reopened the attempt.
    if (document.hidden) onVisibility();
    else void enqueueVisibility("tab_visible");
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [active, attemptId, enqueueVisibility, rules?.records, rules?.tabSwitchGraceSeconds]);

  // Clipboard events are watched when monitoring is on; only enforced policy blocks paste. The content is
  // never sent — only the event, field label, and bounded length — because answers must not leave the page.
  useEffect(() => {
    if (!active || !attemptId || !rules?.records) return;
    const observe = (kind: "copy" | "cut" | "paste") => (event: ClipboardEvent) => {
      if (rules.blockCopyPaste && kind !== "copy") event.preventDefault();
      const target = event.target as HTMLElement | null;
      const length = (event.clipboardData?.getData("text/plain") ?? "").length;
      void report(kind, { field: target?.tagName?.toLowerCase() ?? "unknown", length });
      if (rules.blockCopyPaste && kind === "paste") setNotice("چسباندن در صفحهٔ آزمون مسدود شد؛ رویدادهای clipboard ثبت می‌شوند.");
    };
    const onCopy = observe("copy");
    const onCut = observe("cut");
    const onPaste = observe("paste");
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCut, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCut, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [active, attemptId, report, rules?.blockCopyPaste, rules?.records]);

  // These are page shortcuts only: OS screenshot tools and extension APIs are outside a web page's control.
  useEffect(() => {
    if (!active || !attemptId || !rules?.blockScreenshotShortcuts) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const printScreen = event.key === "PrintScreen";
      const printOrSave = (event.ctrlKey || event.metaKey) && (key === "p" || key === "s");
      if (!printScreen && !printOrSave) return;
      event.preventDefault();
      event.stopPropagation();
      const shortcut = printScreen ? "printscreen" : `${event.metaKey ? "meta" : "ctrl"}+${key}`;
      setNotice("تلاش برای مسدودکردن این میان‌بر در صفحه انجام شد؛ ابزارهای سیستم‌عامل یا افزونه ممکن است همچنان کار کنند.");
      void report("screenshot_shortcut", { shortcut });
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, attemptId, report, rules?.blockScreenshotShortcuts]);

  // The fullscreen requirement is the one rule with an on-screen consequence: the sheet is covered, not the
  // student punished, and pressing the button hands the exam back immediately.
  useEffect(() => {
    if (!active || !rules?.requireFullscreen) return;
    const onChange = () => {
      const open = Boolean(document.fullscreenElement);
      setFullscreenMissing(!open);
      void report(open ? "fullscreen_enter" : "fullscreen_exit");
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [active, report, rules?.requireFullscreen]);

  const requestFullscreen = useCallback(() => {
    void document.documentElement
      .requestFullscreen?.()
      .then(() => undefined)
      .catch(() => {
        // Browsers refuse a fullscreen request they did not see a gesture for. The overlay stays up, which is
        // the honest outcome: the rule is not satisfied, and the student is told why.
        setNotice("مرورگر اجازهٔ تمام‌صفحه نداد؛ دوباره دکمه را بزنید.");
      });
  }, []);

  const budgetRules: ExamIntegrityRules = {
    ...OFF_RULES,
    ...(rules ?? {}),
    tabSwitchesRemaining,
  };

  return {
    rules,
    tabSwitchesRemaining,
    budgetNotice: tabBudgetNotice(budgetRules),
    blockClipboard: Boolean(rules?.blockCopyPaste),
    requireFullscreen: Boolean(rules?.requireFullscreen),
    fullscreenMissing,
    requestFullscreen,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
