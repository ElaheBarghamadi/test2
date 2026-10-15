"use client";

import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CapsLockNotice, Field, StrengthMeter, useCapsLock } from "@/components/forms/auth-field";
import { authApi } from "@/lib/api/auth";
import { apiErrorMessage } from "@/lib/api/client";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { passwordStrength } from "@/lib/auth/password-strength";

/**
 * The screen at the end of a recovery email.
 *
 * The link in that email carries `uid` and `token`; if either is missing the visitor arrived here by hand or
 * the address was truncated by a mail client, and the only useful thing to say is how to get a new one —
 * before asking them to choose a password that cannot be saved.
 */
export function ResetPasswordForm() {
  const search = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = search.get("uid") || "";
  const token = search.get("token") || "";
  const invalidLink = !uid || !token;
  // The same synchronous latch as the sign-in form: a double tap must not spend the one-time token twice,
  // because the second attempt would be answered with "link invalid or expired" for a reset that worked.
  const submitting = useRef(false);
  const online = useOnlineStatus();
  const capsLock = useCapsLock();
  const [passwordError, setPasswordError] = useState(false);
  const [confirmationError, setConfirmationError] = useState(false);
  // No name or address on this screen to compare against, so only the two rules that stand alone are live
  // here; the server re-checks all four against the account it is resetting.
  const strength = useMemo(() => passwordStrength(password), [password]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null); setMessage(null);
    setPasswordError(password.length < 8);
    setConfirmationError(confirmation !== password);
    if (invalidLink) return;
    if (password.length < 8 || confirmation !== password) return;
    if (submitting.current) return;
    if (!online) { setError("اتصال اینترنت برقرار نیست؛ پس از وصل‌شدن دوباره تلاش کنید."); return; }
    submitting.current = true;
    setLoading(true);
    try {
      await authApi.confirmPasswordReset(uid, token, password);
      setMessage("گذرواژه شما با موفقیت تغییر کرد. اکنون می‌توانید وارد شوید.");
      // Long enough to be read, short enough that nobody waits on a screen that has already finished.
      window.setTimeout(() => router.replace("/login"), 1200);
    } catch (reason) {
      setError(apiErrorMessage(reason, "پیوند بازیابی نامعتبر یا منقضی شده است."));
    } finally { submitting.current = false; setLoading(false); }
  }

  return (
    <div className="auth-panel mx-auto w-full max-w-md overflow-hidden rounded-[1.75rem] border bg-card shadow-lift">
      <div className="relative overflow-hidden bg-gradient-to-l from-indigo-600 to-violet-700 px-6 py-5 text-white sm:px-8">
        <span aria-hidden="true" className="soft-grid pointer-events-none absolute inset-0 opacity-20"/>
        <p className="relative section-label !text-indigo-200">امنیت حساب</p>
        <h1 className="relative mt-2 text-xl font-black sm:text-2xl">ساخت گذرواژهٔ جدید</h1>
        <p className="relative mt-1.5 text-xs leading-6 text-indigo-100">یک گذرواژهٔ تازه و مطمئن برای حساب Examora انتخاب کنید.</p>
      </div>

      <div className="p-6 sm:p-8">
        {invalidLink ? (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/[.06] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-destructive">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true"/>این پیوند کامل نیست یا اعتبار ندارد
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              پیوند بازیابی یک‌بار مصرف است و تاریخ انقضا دارد. اگر آن را از ایمیل کپی کرده‌اید، مطمئن شوید نشانی کامل منتقل شده است؛ در غیر این صورت پیوند تازه بگیرید.
            </p>
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link href="/forgot-password">دریافت پیوند جدید</Link>
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <Field
              label="گذرواژهٔ جدید"
              icon={LockKeyhole}
              error={passwordError ? "گذرواژه باید دست‌کم ۸ کاراکتر باشد." : undefined}
              trailing={
                <button type="button" className="-me-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setVisible(!visible)} aria-label={visible ? "پنهان کردن گذرواژه" : "نمایش گذرواژه"} aria-pressed={visible}>
                  {visible ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                </button>
              }
            >
              <Input data-autofocus type={visible ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required dir="ltr" className="text-left" aria-invalid={passwordError || undefined} {...capsLock.handlers}/>
            </Field>

            {capsLock.on && <CapsLockNotice/>}
            <StrengthMeter strength={strength}/>

            <Field label="تکرار گذرواژهٔ جدید" icon={KeyRound} error={confirmationError ? "تکرار گذرواژه با گذرواژهٔ جدید یکسان نیست." : undefined}>
              <Input type={visible ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required dir="ltr" className="text-left" aria-invalid={confirmationError || undefined}/>
            </Field>

            {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-bold leading-6 text-destructive">{error}</p>}
            {message && <p role="status" className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-bold leading-6 text-emerald-800 dark:text-emerald-300">{message}</p>}
            {!online && <p role="status" className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold leading-6 text-amber-800 dark:text-amber-300">اتصال اینترنت برقرار نیست. همین که وصل شد، دکمه فعال می‌شود.</p>}

            <Button type="submit" size="lg" className="button-sheen relative mt-1 w-full overflow-hidden bg-gradient-to-l from-primary to-indigo-500 shadow-lift transition-transform hover:-translate-y-0.5 active:translate-y-0" disabled={loading || !!message || !online}>
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <KeyRound className="h-4 w-4"/>}
              ثبت گذرواژهٔ جدید
            </Button>
          </form>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <Link className="inline-flex items-center gap-1 font-bold text-primary hover:underline" href="/login">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true"/>بازگشت به ورود
          </Link>
        </div>
      </div>
    </div>
  );
}
