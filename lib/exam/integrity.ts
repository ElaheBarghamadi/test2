import { toPersianNumber } from "@/lib/utils";
import type { ExamIntegrityRules, ExamSettings, IntegrityPolicy } from "@/lib/types/domain";

/**
 * The vocabulary of exam integrity, in one place.
 *
 * Rules come from the server. This module only explains the teacher's saved policy in Persian and keeps the
 * same honest limits visible to students, teachers and the marking report.
 */
export const INTEGRITY_POLICY_OPTIONS: Array<{ value: IntegrityPolicy; title: string; description: string }> = [
  {
    value: "off",
    title: "خاموش",
    description: "پایش رفتار مرورگر و ثبت مشخصات اتصال خاموش است؛ هیچ‌کدام از قواعد این بخش اجرا نمی‌شود.",
  },
  {
    value: "observe",
    title: "فقط هشدار و ثبت",
    description: "سیگنال‌های مرورگر ثبت می‌شوند؛ خروج از صفحه فقط پس از پایان مهلت بازگشت اخطار می‌شود و آزمون هیچ‌وقت خودکار متوقف نمی‌شود.",
  },
  {
    value: "enforce",
    title: "هشدار و تشدید پیامد",
    description: "قواعد انتخابی اجرا می‌شوند؛ تعداد اخطارهای پیش از توقف قابل تنظیم است و خروج بعد از آن آزمون را می‌بندد.",
  },
];

export const INTEGRITY_POLICY_LABELS: Record<IntegrityPolicy, string> = {
  off: "بدون پایش مرورگر",
  observe: "فقط هشدار و ثبت",
  enforce: "هشدار و تشدید پیامد",
};

/** One line per recorded signal kind, including the ones only monitoring produces. */
export const SIGNAL_LABELS: Record<string, string> = {
  session_switch: "نشست دیگری برگه را در دست گرفت",
  tab_hidden: "صفحهٔ آزمون بیش از مهلت مجاز پنهان بود",
  tab_visible: "دانش‌آموز پس از خروج طولانی به آزمون برگشت",
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
  fullscreen_exit: "از تمام‌صفحه بیرون رفت",
  screenshot_shortcut: "فشردن میان‌بر چاپ/تصویر صفحه در آزمون مشاهده شد",
  session_lock_refused: "ادامهٔ آزمون از مرورگر دیگری رد شد",
  tab_limit_reached: "خروج طولانی پس از پایان اخطارها؛ آزمون متوقف شد",
};

export const OFF_RULES: ExamIntegrityRules = {
  policy: "off",
  records: false,
  enforced: false,
  blockCopyPaste: false,
  requireFullscreen: false,
  lockToOneDevice: false,
  maxTabSwitches: 0,
  tabSwitchGraceSeconds: 0,
  recordAccessInfo: false,
  blockScreenshotShortcuts: false,
  tabSwitches: 0,
  tabSwitchesRemaining: null,
  copyEvents: 0,
};

/**
 * The rules this exam runs under, read from its settings.
 *
 * Mirrors the server: the master switch is applied here rather than assumed, because a settings object can
 * hold a rule from last term while monitoring is off — and a client that enforced rules on its own would
 * enforce a rule the teacher had switched off.
 */
export function rulesFromSettings(settings: ExamSettings): ExamIntegrityRules {
  const policy = settings.integrityPolicy ?? "off";
  const records = policy !== "off";
  const enforced = policy === "enforce";
  const maxTabSwitches = enforced ? (settings.integrityTabLimit ?? 0) : 0;
  return {
    policy,
    records,
    enforced,
    blockCopyPaste: enforced && settings.integrityBlockCopyPaste === true,
    requireFullscreen: enforced && settings.integrityRequireFullscreen === true,
    lockToOneDevice: enforced && settings.integrityLockToOneDevice === true,
    maxTabSwitches,
    tabSwitchGraceSeconds: records ? (settings.integrityTabGraceSeconds ?? 5) : 0,
    recordAccessInfo: records && settings.integrityRecordAccessInfo === true,
    blockScreenshotShortcuts: enforced && settings.integrityBlockScreenshotShortcuts === true,
    tabSwitches: 0,
    tabSwitchesRemaining: maxTabSwitches > 0 ? maxTabSwitches : null,
    copyEvents: 0,
  };
}

/** What the rules mean in one sentence, for a screen that only shows rather than edits. */
export function describeIntegrity(rules: ExamIntegrityRules): string {
  if (rules.policy === "off") return "پایش رفتار مرورگر برای این آزمون خاموش است.";
  const parts = [
    `بازگشت تا ${toPersianNumber(rules.tabSwitchGraceSeconds)} ثانیه بدون ثبت تخلف`,
    rules.blockCopyPaste && "ثبت تلاش‌های کپی/بریدن و مسدودسازی چسباندن در صفحه",
    rules.requireFullscreen && "تمام‌صفحه اجباری",
    rules.lockToOneDevice && "قفل نشست بر اساس مرورگر شروع‌کننده",
    rules.blockScreenshotShortcuts && "مسدودسازی کمکیِ میان‌برهای چاپ/تصویر صفحه",
    rules.recordAccessInfo && "ثبت IP و مشخصات تقریبی مرورگر/دستگاه در گزارش معلم",
  ].filter(Boolean) as string[];
  if (!rules.enforced) {
    return `رویدادهای قابل مشاهده ثبت می‌شوند و پس از مهلت، هشدار می‌آید؛ آزمون خودکار متوقف نمی‌شود. ${parts.join("؛ ")}.`;
  }
  parts.push(
    rules.maxTabSwitches > 0
      ? `${toPersianNumber(rules.maxTabSwitches)} اخطار پیش از توقف؛ خروج طولانیِ بعدی آزمون را می‌بندد`
      : "توقف خودکار پس از خروج از صفحه خاموش است",
  );
  return `محدودیت‌های فعال: ${parts.join("؛ ")}.`;
}

/** The runner's counter, phrased as the remaining warnings before a later departure closes the attempt. */
export function tabBudgetNotice(rules: ExamIntegrityRules): string | null {
  if (!rules.maxTabSwitches || rules.tabSwitchesRemaining === null) return null;
  const left = rules.tabSwitchesRemaining;
  if (left <= 0) return "اخطارهای پیش از توقف تکمیل شد؛ خروج طولانیِ بعدی آزمون را می‌بندد.";
  if (left <= 2) return `${toPersianNumber(left)} اخطار تا توقف باقی مانده است؛ خروج طولانیِ بعدی پس از آن آزمون را می‌بندد.`;
  return null;
}

export function signalLabel(kind: string): string {
  return SIGNAL_LABELS[kind] ?? kind;
}
