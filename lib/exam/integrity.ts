import { toPersianNumber } from "@/lib/utils";
import type { ExamIntegrityRules, ExamSettings, IntegrityPolicy } from "@/lib/types/domain";

/**
 * The vocabulary of exam integrity, in one place.
 *
 * The rules themselves are the server's to decide (`ExamSettings.integrityPolicy` plus the flags under it);
 * this module only says what they mean in Persian, so a label is never invented twice — and so the sentence a
 * teacher reads while switching monitoring on is the same sentence the student's screen and the marking sheet
 * repeat back to them.
 */

export const INTEGRITY_POLICY_OPTIONS: Array<{ value: IntegrityPolicy; title: string; description: string }> = [
  {
    value: "off",
    title: "خاموش",
    description: "هیچ رفتاری در مرورگر دانش‌آموز ثبت یا محدود نمی‌شود. حالت پیش‌فرض هر آزمون.",
  },
  {
    value: "observe",
    title: "فقط ثبت",
    description: "خروج از تب، کپی و چسباندن، و تمام‌صفحه در کارنامه ثبت می‌شود تا خودتان قضاوت کنید. چیزی از دانش‌آموز گرفته نمی‌شود.",
  },
  {
    value: "enforce",
    title: "ثبت و محدودیت",
    description: "قواعد پایین اجرا می‌شوند: کپی/چسباندن بسته، تمام‌صفحهٔ اجباری، قفل دستگاه، و سقف بیرون‌رفتن از تب.",
  },
];

export const INTEGRITY_POLICY_LABELS: Record<IntegrityPolicy, string> = {
  off: "بدون مراقبت",
  observe: "فقط ثبت رویداد",
  enforce: "ثبت و محدودیت",
};

/** One line per recorded signal kind, including the ones only monitoring produces. */
export const SIGNAL_LABELS: Record<string, string> = {
  session_switch: "نشست دیگری برگه را در دست گرفت",
  tab_hidden: "تب آزمون پنهان شد",
  tab_visible: "دانش‌آموز به تب آزمون برگشت",
  disconnected: "اتصال قطع شد",
  reconnected: "اتصال برقرار شد",
  auto_submitted: "آزمون به‌صورت خودکار ارسال شد",
  exam_closed: "معلم آزمون را بست",
  stale_write_rejected: "ذخیرهٔ کهنه پذیرفته نشد",
  question_locked: "ویرایش سؤال قفل‌شده رد شد",
  copy: "متن از آزمون کپی شد",
  cut: "متن بریده شد",
  paste: "متنی به پاسخ چسبانده شد",
  fullscreen_enter: "حالت تمام‌صفحه آغاز شد",
  fullscreen_exit: "از حالت تمام‌صفحه بیرون رفت",
  session_lock_refused: "ادامهٔ آزمون از دستگاه دیگر رد شد",
  tab_limit_reached: "سقف بیرون‌رفتن از تب پر شد",
};

export const OFF_RULES: ExamIntegrityRules = {
  policy: "off",
  records: false,
  enforced: false,
  blockCopyPaste: false,
  requireFullscreen: false,
  lockToOneDevice: false,
  maxTabSwitches: 0,
  tabSwitches: 0,
  tabSwitchesRemaining: null,
  copyEvents: 0,
};

export function signalLabel(kind: string): string {
  return SIGNAL_LABELS[kind] ?? kind;
}

/**
 * The rules this exam runs under, read from its settings.
 *
 * Mirrors the server: the master switch is applied here rather than assumed, because a settings object can
 * hold `block_copy_paste: true` from last term while monitoring is off — and a client that blocked the
 * clipboard on its own initiative would be enforcing a rule nobody chose.
 */
export function rulesFromSettings(settings: ExamSettings): ExamIntegrityRules {
  const policy = settings.integrityPolicy ?? "off";
  const records = policy !== "off";
  const enforced = policy === "enforce";
  return {
    policy,
    records,
    enforced,
    blockCopyPaste: enforced && settings.integrityBlockCopyPaste === true,
    requireFullscreen: enforced && settings.integrityRequireFullscreen === true,
    lockToOneDevice: enforced && settings.integrityLockToOneDevice === true,
    maxTabSwitches: enforced ? (settings.integrityTabLimit ?? 0) : 0,
    tabSwitches: 0,
    tabSwitchesRemaining: enforced && settings.integrityTabLimit ? settings.integrityTabLimit : null,
    copyEvents: 0,
  };
}

/** What the rules mean in one sentence, for a screen that only shows rather than edits. */
export function describeIntegrity(rules: ExamIntegrityRules): string {
  if (rules.policy === "off") return "مراقبت مرورگر برای این آزمون خاموش است.";
  const active = [
    rules.blockCopyPaste && "کپی و چسباندن بسته",
    rules.requireFullscreen && "تمام‌صفحه اجباری",
    rules.lockToOneDevice && "قفل روی یک دستگاه",
    rules.maxTabSwitches > 0 && `سقف ${toPersianNumber(rules.maxTabSwitches)} بار بیرون‌رفتن از تب`,
  ].filter(Boolean) as string[];
  if (rules.policy === "observe") return `رویدادها ثبت می‌شوند؛ چیزی محدود نمی‌شود. (${active.length ? `قواعد ذخیره‌شده: ${active.join("، ")}` : "بدون قاعده"})`;
  return active.length ? `محدودیت‌های فعال: ${active.join("، ")}` : "ثبت رویداد فعال است، بدون قاعدهٔ محدودکننده.";
}

/** The runner's own counter, phrased the way a student should read it: what is left, not what was done. */
export function tabBudgetNotice(rules: ExamIntegrityRules): string | null {
  if (!rules.maxTabSwitches || rules.tabSwitchesRemaining === null) return null;
  const left = rules.tabSwitchesRemaining;
  if (left <= 0) return "سقف بیرون‌رفتن از تب کامل شد؛ آزمون بسته می‌شود.";
  if (left <= 2) return `باقی‌ماندهٔ خروج مجاز از تب: ${toPersianNumber(left)} بار. پس از آن آزمون بسته می‌شود.`;
  return null;
}
