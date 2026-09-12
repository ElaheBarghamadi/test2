import { describe, expect, it } from "vitest";
import type { ExamSettings } from "@/lib/types/domain";
import { describeIntegrity, rulesFromSettings, signalLabel, tabBudgetNotice } from "@/lib/exam/integrity";

/**
 * The reading of the teacher's monitoring settings, in one place.
 *
 * The important assertion here is the one that costs a feature: a rule the teacher saved while monitoring was
 * on must stay saved and still mean *nothing* while it is off. That is why the master switch is applied in
 * this module rather than left to whatever screen shows the flags.
 */
const settings = (overrides: Partial<ExamSettings> = {}): ExamSettings =>
  ({
    durationMinutes: 45,
    totalMarks: 10,
    allowBackNavigation: true,
    randomizeQuestions: false,
    randomizeOptions: false,
    allowUnanswered: true,
    questionLayout: "paged",
    showResultImmediately: false,
    resultVisibility: "pending",
    showCorrectAnswers: false,
    attemptLimit: 1,
    passingPercentage: 50,
    ...overrides,
  }) as ExamSettings;

describe("rulesFromSettings", () => {
  it("treats a settings object from before the switches as unmonitored", () => {
    const rules = rulesFromSettings(settings());
    expect({ policy: rules.policy, records: rules.records, enforced: rules.enforced }).toEqual({
      policy: "off",
      records: false,
      enforced: false,
    });
    expect(rules.blockCopyPaste).toBe(false);
  });

  it("keeps saved rules inert while monitoring is off", () => {
    const rules = rulesFromSettings(
      settings({ integrityPolicy: "off", integrityBlockCopyPaste: true, integrityRequireFullscreen: true, integrityTabLimit: 3 }),
    );
    expect(rules).toMatchObject({ blockCopyPaste: false, requireFullscreen: false, maxTabSwitches: 0 });
  });

  it("turns the rules on only under `enforce`, and counts a budget only there too", () => {
    const observed = rulesFromSettings(settings({ integrityPolicy: "observe", integrityBlockCopyPaste: true, integrityTabLimit: 2 }));
    expect(observed).toMatchObject({ records: true, enforced: false, blockCopyPaste: false, maxTabSwitches: 0, tabSwitchesRemaining: null });
    const enforced = rulesFromSettings(settings({ integrityPolicy: "enforce", integrityBlockCopyPaste: true, integrityTabLimit: 2 }));
    expect(enforced).toMatchObject({ records: true, enforced: true, blockCopyPaste: true, maxTabSwitches: 2, tabSwitchesRemaining: 2 });
  });
});

describe("the words around the rules", () => {
  it("says plainly what an unmonitored exam does not do", () => {
    expect(describeIntegrity(rulesFromSettings(settings()))).toContain("خاموش");
  });

  it("names the active restrictions without overstating them", () => {
    const text = describeIntegrity(rulesFromSettings(settings({ integrityPolicy: "enforce", integrityLockToOneDevice: true, integrityTabLimit: 4 })));
    expect(text).toContain("قفل روی یک دستگاه");
    expect(text).toContain("۴");
  });

  it("warns only when the budget is nearly gone, in Persian digits", () => {
    expect(tabBudgetNotice({ maxTabSwitches: 9, tabSwitchesRemaining: 8 } as never)).toBeNull();
    expect(tabBudgetNotice({ maxTabSwitches: 9, tabSwitchesRemaining: 2 } as never)).toContain("۲");
    expect(tabBudgetNotice({ maxTabSwitches: 9, tabSwitchesRemaining: 0 } as never)).toContain("کامل شد");
  });

  it("labels every kind the server can record, including the monitored ones", () => {
    for (const kind of ["tab_hidden", "paste", "fullscreen_exit", "session_lock_refused", "tab_limit_reached"]) {
      expect(signalLabel(kind), kind).not.toBe(kind);
    }
    expect(signalLabel("invented")).toBe("invented");
  });
});
