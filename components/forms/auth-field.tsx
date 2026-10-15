"use client";

import { Check, Sparkles, type LucideIcon } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { passwordStrength } from "@/lib/auth/password-strength";

/**
 * The field furniture shared by every screen a signed-out visitor reaches: sign-in, sign-up, forgotten
 * password, and the reset link that follows it.
 *
 * These four used to be built three different ways across two files, which is why the reset screen looked
 * like a different product from the sign-up that led to it. They live here so a change to how a field reads
 * — or to how an error is announced — happens everywhere at once.
 */

/**
 * Label, icon, control and optional trailing button in one bordered box.
 *
 * The error sits *outside* the `<label>`: everything inside a label becomes part of the field's accessible
 * name, so an error there would rename «گذرواژه» to «گذرواژه گذرواژه باید دست‌کم…» the moment it appeared —
 * and take the field's identity with it.
 */
export function Field({
  label, icon: Icon, error, hint, trailing, children,
}: {
  label: string;
  icon: LucideIcon;
  error?: string;
  hint?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold">{label}</span>
        <span className={cn("field-shell", error && "has-error")}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
          {children}
          {trailing}
        </span>
      </label>
      {hint && !error && <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1.5 text-xs font-bold text-destructive">{error}</p>}
    </div>
  );
}

/** The app's own `<select>`, flattened to sit inside `Field`'s shell like an `Input` does. */
export function FieldSelect({ value, onChange, options }: { value: string; onChange: (next: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 min-w-0 flex-1 appearance-none rounded-xl border border-input bg-background text-sm font-medium outline-none"
    >
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

/**
 * Caps Lock is the one invisible reason a correct password is refused, and the failure the server returns
 * («ایمیل یا گذرواژه نادرست است») points somewhere else entirely.
 *
 * Read from the key event rather than polled: modifier state is only reported on an event, and a handler
 * that runs on every keystroke costs nothing.
 */
export function useCapsLock() {
  const [on, setOn] = useState(false);
  function read(event: KeyboardEvent<HTMLInputElement>) {
    // Not every environment implements it; a browser that cannot answer is not a browser with Caps Lock on.
    if (typeof event.getModifierState !== "function") return;
    setOn(event.getModifierState("CapsLock"));
  }
  return { on, handlers: { onKeyUp: read, onKeyDown: read } };
}

export function CapsLockNotice() {
  return (
    <p className="flex items-center gap-1.5 rounded-xl bg-warning/10 px-3 py-2 text-[11px] font-bold text-warning">
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>
      Caps Lock روشن است.
    </p>
  );
}

/**
 * The four server-side password rules, shown while the user types.
 *
 * Guidance, never a gate: two of the four are approximations of what Django checks, and an approximation is
 * not allowed to lock someone out of their own account. The server's answer is the only one that counts.
 */
export function StrengthMeter({ strength }: { strength: ReturnType<typeof passwordStrength> }) {
  const { rules, score, label, barClass, textClass } = strength;
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className={cn("min-w-[3.5rem] shrink-0 text-[10px] font-black", textClass)} aria-hidden="true">{label || "—"}</span>
        <span className="flex flex-1 items-center gap-1">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", index < score ? barClass : "bg-muted")}/>
          ))}
        </span>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {rules.map((rule) => (
          <li key={rule.key} className={cn("flex items-center gap-1.5 text-[10px] font-bold transition-colors", rule.met ? "text-success" : "text-muted-foreground")}>
            <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border transition-colors", rule.met ? "border-success bg-success text-success-foreground" : "border-border")}>
              {rule.met && <Check className="h-2.5 w-2.5" aria-hidden="true"/>}
            </span>
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
