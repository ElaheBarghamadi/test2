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
