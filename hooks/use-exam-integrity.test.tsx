import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ExamIntegrityRules } from "@/lib/types/domain";

/**
 * What the runner does with the integrity rules the server sent, and what it refuses to do on its own.
 *
 * The tests are mostly about *restraint*: an unmonitored exam must not have its clipboard watched, a rule the
 * teacher saved but switched off must not block anything, and a signal that cannot be delivered must never
 * interrupt a student's answer.
 */
const recordSignal = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/exam-attempt-service", () => ({
  examAttemptService: { recordSignal: (...args: unknown[]) => recordSignal(...args) },
}));

import { useExamIntegrity } from "@/hooks/use-exam-integrity";

const rules = (overrides: Partial<ExamIntegrityRules> = {}): ExamIntegrityRules => ({
  policy: "off",
  records: false,
  enforced: false,
  blockCopyPaste: false,
  requireFullscreen: false,
  lockToOneDevice: false,
  maxTabSwitches: 0,
  tabSwitchGraceSeconds: 5,
  recordAccessInfo: false,
  blockScreenshotShortcuts: false,
  tabSwitches: 0,
  tabSwitchesRemaining: null,
  copyEvents: 0,
  ...overrides,
});

function mount(overrides?: Partial<ExamIntegrityRules>, onEndedByServer?: (reason: string) => void) {
  return renderHook(() =>
    useExamIntegrity({ attemptId: "attempt-1", examSession: "tab-a", rules: rules(overrides), active: true, onEndedByServer }),
  );
}

beforeEach(() => {
  recordSignal.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

describe("the tab budget", () => {
  it("does not watch visibility when the teacher left monitoring off", async () => {
    mount();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recordSignal).not.toHaveBeenCalled();
  });

  it("starts a provisional interval and clears it on a quick return", async () => {
    mount({ policy: "observe", records: true, tabSwitchGraceSeconds: 1 });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await vi.waitFor(() => expect(recordSignal).toHaveBeenCalledWith("attempt-1", "tab_hidden", "tab-a", undefined));

    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await vi.waitFor(() => expect(recordSignal).toHaveBeenCalledWith("attempt-1", "tab_visible", "tab-a", undefined));
    expect(recordSignal).not.toHaveBeenCalledWith("attempt-1", "tab_hidden_timeout", "tab-a", undefined);
  });

  it("asks the server to confirm after the grace period", async () => {
    recordSignal.mockImplementation(async (_attemptId: string, kind: string) =>
      kind === "tab_hidden_timeout"
        ? { policy: "observe", violation_recorded: true, tab_switches: 1, tab_switch_grace_seconds: 1, max_tab_switches: 0 }
        : { policy: "observe" },
    );
    const view = mount({ policy: "observe", records: true, tabSwitchGraceSeconds: 1 });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await vi.waitFor(
      () => expect(recordSignal).toHaveBeenCalledWith("attempt-1", "tab_hidden_timeout", "tab-a", undefined),
      { timeout: 2000 },
    );
    await vi.waitFor(() => expect(view.result.current.notice).toContain("خودکار متوقف نمی‌شود"));
  });

  it("stops the runner only when the server says the next long departure closed the exam", async () => {
    const ended = vi.fn();
    recordSignal.mockImplementation(async (_attemptId: string, kind: string) =>
      kind === "tab_hidden_timeout"
        ? { status: "expired", auto_submitted: true, reason: "tab_switch_limit", tab_switches_remaining: 0 }
        : { policy: "enforce" },
    );
    const view = mount(
      { policy: "enforce", enforced: true, records: true, maxTabSwitches: 1, tabSwitchesRemaining: 1, tabSwitchGraceSeconds: 1 },
      ended,
    );
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith("tab_switch_limit"), { timeout: 2000 });
    expect(view.result.current.tabSwitchesRemaining).toBe(0);
  });

  it("warns while the budget is short and says nothing when it is not", () => {
    expect(mount({ policy: "enforce", enforced: true, maxTabSwitches: 4, tabSwitchesRemaining: 4 }).result.current.budgetNotice).toBeNull();
    expect(mount({ policy: "enforce", enforced: true, maxTabSwitches: 4, tabSwitchesRemaining: 1 }).result.current.budgetNotice).toContain("۱");
  });
});

describe("the clipboard", () => {
  it("is not watched while the teacher left monitoring off", async () => {
    mount();
    act(() => document.dispatchEvent(new Event("copy")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recordSignal).not.toHaveBeenCalled();
  });

  it("is watched in `observe`, and the pasted text is never part of what is sent", async () => {
    mount({ policy: "observe", records: true });
    const event = new Event("paste", { cancelable: true });
    const pasted = "یک متن طولانی که نباید از این مرز رد شود".repeat(20);
    Object.defineProperty(event, "clipboardData", { value: { getData: () => pasted } });
    act(() => document.dispatchEvent(event));
    await vi.waitFor(() =>
      expect(recordSignal).toHaveBeenCalledWith("attempt-1", "paste", "tab-a", { field: "unknown", length: pasted.length }),
    );
    expect(event.defaultPrevented).toBe(false); // observing never takes the paste away
    // Only the length travels. The answer a student is writing is not something the runner uploads.
    expect(JSON.stringify(recordSignal.mock.calls.at(-1))).not.toContain("نباید");
  });

  it("is blocked when the teacher enforced it, with a word to the student", async () => {
    const view = mount({ policy: "enforce", records: true, enforced: true, blockCopyPaste: true });
    const paste = new Event("paste", { cancelable: true });
    act(() => document.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(view.result.current.notice).toContain("چسباندن در صفحهٔ آزمون مسدود شد");

    // Copy remains available; the signal is logged, while blocking paste must not break editing in the answer box.
    const copy = new Event("copy", { cancelable: true });
    act(() => document.dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(false);
  });
});

describe("page-level screenshot and print shortcuts", () => {
  it("blocks and reports a common page shortcut only when the teacher enabled it", async () => {
    mount({ policy: "enforce", records: true, enforced: true, blockScreenshotShortcuts: true });
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, cancelable: true, bubbles: true });
    act(() => document.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(recordSignal).toHaveBeenCalledWith("attempt-1", "screenshot_shortcut", "tab-a", { shortcut: "ctrl+p" }),
    );
  });

  it("leaves OS capture and shortcuts alone when the server sends no page guard", () => {
    mount();
    const event = new KeyboardEvent("keydown", { key: "PrintScreen", cancelable: true, bubbles: true });
    act(() => document.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(recordSignal).not.toHaveBeenCalled();
  });
});

describe("the fullscreen rule", () => {
  it("covers the sheet while the rule is unsatisfied, and never when the server did not send it", () => {
    // The hook does not decide whether the rule is active — the API already AND-ed it with the master
    // switch (`lib/exam/integrity.test.ts` covers that half). What the hook guarantees is that it obeys
    // exactly what arrives: gated when `requireFullscreen` is true, untouched when it is not.
    expect(mount({ policy: "enforce", records: true, enforced: true, requireFullscreen: true }).result.current.fullscreenMissing).toBe(true);
    expect(mount({ policy: "enforce", records: true, enforced: true, requireFullscreen: false }).result.current.fullscreenMissing).toBe(false);
    expect(mount().result.current.requireFullscreen).toBe(false);
  });

  it("reports the moment fullscreen is left, so the teacher reads it too", async () => {
    mount({ policy: "enforce", records: true, enforced: true, requireFullscreen: true });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    await vi.waitFor(() => expect(recordSignal).toHaveBeenCalledWith("attempt-1", "fullscreen_exit", "tab-a", undefined));
  });
});
