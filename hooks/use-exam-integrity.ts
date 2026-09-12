"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExamIntegrityRules } from "@/lib/types/domain";
import { examAttemptService, type IntegritySignalKind } from "@/lib/services/exam-attempt-service";
import { tabBudgetNotice } from "@/lib/exam/integrity";

/**
 * The browser-side half of exam integrity: it watches what the teacher asked to be watched, blocks what the
 * teacher asked to be blocked, and stops the moment the server says there is nothing left to answer.
 *
 * Two rules hold this together.
 *
 *   * Nothing is decided here. Every judgement — is the clipboard closed, is fullscreen required, how many
 *     tab switches are left — arrives in `rules`, which the API computed from the exam's settings. A client
 *     that enforced rules on its own could be talked into enforcing none, and could also enforce a rule the
 *     teacher had switched off.
 *   * Nothing here is a defence against a determined student, and the copy says so. Clipboard events are
 *     visible to JavaScript; the text a student types with the keyboard is not. What this buys is the common
 *     case (a note pasted in, a second tab with answers open) and a record for the teacher to read.
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

  useEffect(() => {
    setTabSwitchesRemaining(rules?.tabSwitchesRemaining ?? null);
    setFullscreenMissing(Boolean(rules?.requireFullscreen) && !document.fullscreenElement);
  }, [rules?.requireFullscreen, rules?.tabSwitchesRemaining]);

  /** One signal, one chance to react. A report that cannot be sent must never interrupt an exam. */
  const report = useCallback(
    async (kind: IntegritySignalKind, detail?: Record<string, unknown>) => {
      if (!attemptId) return;
      try {
        const summary = await examAttemptService.recordSignal(attemptId, kind, examSession, detail);
        if (!summary) return;
        if (typeof summary.tab_switches_remaining === "number") setTabSwitchesRemaining(summary.tab_switches_remaining);
        if (summary.auto_submitted) ended.current?.(summary.reason ?? "integrity");
      } catch {
        // The teacher's log is the loser here, not the student's exam.
      }
    },
    [attemptId, examSession],
  );

  // Leaving the tab is the signal the teacher's budget is counted from, so it is reported whether or not
  // monitoring is on: the server has always recorded it, and the limit only exists if it was set.
  useEffect(() => {
    if (!active || !attemptId) return;
    const announce = () => void report(document.hidden ? "tab_hidden" : "tab_visible");
    document.addEventListener("visibilitychange", announce);
    return () => document.removeEventListener("visibilitychange", announce);
  }, [active, attemptId, report]);

  // Clipboard watching, and the block that only `enforce` may apply. The content is never sent — only that
  // something was pasted, and how long it was — because an exam answer is not the place to copy text around.
  useEffect(() => {
    if (!active || !attemptId || !rules?.records) return;
    const observe = (kind: "copy" | "cut" | "paste") => (event: ClipboardEvent) => {
      if (rules.blockCopyPaste && kind !== "copy") event.preventDefault();
      const target = event.target as HTMLElement | null;
      const length = (event.clipboardData?.getData("text/plain") ?? "").length;
      void report(kind, { field: target?.tagName?.toLowerCase() ?? "unknown", length });
      if (rules.blockCopyPaste && kind !== "copy") setNotice("کپی و چسباندن در این آزمون بسته شده است.");
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

  return {
    rules,
    tabSwitchesRemaining,
    /** Shown whenever a rule is one step from closing the attempt, monitoring or not. */
    budgetNotice: tabBudgetNotice({ ...(rules ?? { maxTabSwitches: 0, tabSwitchesRemaining: null }), tabSwitchesRemaining } as ExamIntegrityRules),
    blockClipboard: Boolean(rules?.blockCopyPaste),
    requireFullscreen: Boolean(rules?.requireFullscreen),
    fullscreenMissing,
    requestFullscreen,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
