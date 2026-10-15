import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toPersianNumber(value: number | string) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

/**
 * Persian-language date labels, on the Persian calendar by request rather than by locale default: a browser
 * whose `fa-IR` data resolves to another calendar would otherwise print Gregorian numbers inside a Persian
 * sentence, which is the kind of wrong that nobody notices until a student misses an exam.
 *
 * `timeZone` is for values that belong to the school's clock (an exam window) rather than to wherever the
 * reader happens to be sitting.
 */
export function formatDate(date: string, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric", month: "long", year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(new Date(date));
  } catch {
    return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(date));
  }
}

export function formatDateTime(date: string, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(new Date(date));
  } catch {
    return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
  }
}

export function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  const parts = hours > 0 ? [hours, minutes, remainder] : [minutes, remainder];
  return parts.map((part) => toPersianNumber(String(part).padStart(2, "0"))).join(":");
}

/**
 * A time gap in words a student can act on.
 *
 * Coarse on purpose. The authoritative countdown lives on the exam page, driven by the server clock; a
 * dashboard that claims «۴۲ دقیقه و ۱۷ ثانیه» from a snapshot taken thirty seconds ago is a number that
 * looks precise and is not, which is worse than «۴۲ دقیقه».
 */
export function humanRemaining(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "کمتر از یک دقیقه";
  if (minutes < 60) return `${toPersianNumber(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest >= 30 ? `${toPersianNumber(hours)} ساعت و نیم` : `${toPersianNumber(hours)} ساعت`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours >= 12 ? `${toPersianNumber(days)} روز و ${toPersianNumber(restHours)} ساعت` : `${toPersianNumber(days)} روز`;
}
