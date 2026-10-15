"use client";

import Link from "next/link";
import {
  ArrowLeft, Check, Eye, EyeOff, GraduationCap, LockKeyhole, LoaderCircle, Mail,
  ShieldCheck, UserRound, UsersRound, Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CapsLockNotice, Field, FieldSelect, StrengthMeter, useCapsLock } from "@/components/forms/auth-field";
import { ExamDemoCard } from "@/components/shared/exam-demo-card";
import { authErrorMessage, dashboardForRole, useAuthStore } from "@/lib/state/auth-store";
import { authApi } from "@/lib/api/auth";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToastStore } from "@/lib/state/toast-store";
import { safeNextPath } from "@/lib/auth/page-access";
import { passwordStrength } from "@/lib/auth/password-strength";
import { cn } from "@/lib/utils";

type Mode = "login" | "register" | "forgot";
const content: Record<Mode, { title: string; subtitle: string; submit: string; eyebrow: string }> = {
  login: { eyebrow: "ورود", title: "خوش آمدید", subtitle: "برای ادامه به فضای Examora وارد شوید.", submit: "ورود به حساب" },
  register: { eyebrow: "شروع کار", title: "ساخت فضای جدید", subtitle: "در کمتر از چند دقیقه حساب آموزگار یا دانش‌آموز بسازید.", submit: "ساخت حساب" },
  forgot: { eyebrow: "دسترسی مجدد", title: "بازیابی گذرواژه", subtitle: "ایمیل حساب را وارد کنید تا پیوند امن ساخت گذرواژهٔ جدید برایتان ارسال شود.", submit: "ارسال پیوند بازیابی" },
};

// The same rule the page gate uses, so `?next=` can never become a way to hand a session to another site.
const safeNext = safeNextPath;

const offlineCopy = "اتصال اینترنت برقرار نیست؛ پس از وصل‌شدن دوباره تلاش کنید. چیزی که وارد کرده‌اید از بین نمی‌رود.";
// The browser cannot type an email address for you, and it fails quietly: a phone keyboard that
// capitalises the first letter or turns "name@school.edu" into a suggestion produces a sign-in that
// "does not work" for reasons the user cannot see.
const addressInput = { type: "email" as const, dir: "ltr" as const, autoCapitalize: "none" as const, autoCorrect: "off" as const, spellCheck: false, inputMode: "email" as const };

/** Filled by the «حساب نمونه» shortcut. Kept next to `seed_demo`'s own output, which is the source. */
const DEMO_ACCOUNTS = [
  { role: "دانش‌آموز", email: "student1@examora.test", password: "Examora1234!" },
  { role: "آموزگار", email: "teacher@examora.test", password: "Examora1234!" },
] as const;

const ROLES = [
  { value: "student", label: "دانش‌آموز", hint: "پایه و کلاس خود را انتخاب می‌کنید", icon: GraduationCap },
  { value: "teacher", label: "آموزگار", hint: "آزمون می‌سازید و نمره می‌دهید", icon: UsersRound },
] as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [grade, setGrade] = useState("پایه دوازدهم");
  const [className, setClassName] = useState("تجربی ۲");
  const [schoolCode, setSchoolCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  /**
   * The button's `disabled` is React state, and state lands one render later — a double tap on a slow
   * phone, or Enter pressed twice, used to send two sign-ups and turn the second one into an
   * "email already registered" error. This ref is set synchronously, before the first `await`.
   */
  const submitting = useRef(false);
  const online = useOnlineStatus();
  const toast = useToastStore((state) => state.push);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const authStatus = useAuthStore((state) => state.status);
  const currentUser = useAuthStore((state) => state.user);
  const router = useRouter();
  const copy = content[mode];
  /**
   * Live validity, and separately whether to *show* it.
   *
   * The guard below used to read these through `submitted &&`, which is the render-time value: on the very
   * first click `submitted` was still `false`, so nothing was refused locally and a typo'd address or a
   * three-character password went to the server to be answered after a round trip — on a slow connection,
   * the longest way to be told something the form already knew.
   */
  const emailInvalid = !/^\S+@\S+\.\S+$/.test(email.trim());
  const passwordInvalid = mode !== "forgot" && password.length < 8;
  const nameInvalid = mode === "register" && !name.trim();
  const confirmationInvalid = mode === "register" && confirmation !== password;
  const emailError = submitted && emailInvalid;
  const passwordError = submitted && passwordInvalid;
  const nameError = submitted && nameInvalid;
  const confirmationError = submitted && confirmationInvalid;

  // The meter mirrors what the server will check, so it reads the same two fields the server compares
  // against; a strength bar that ignores the name typed above it would green-light a refusal.
  const strength = useMemo(
    () => passwordStrength(password, { name, email }),
    [password, name, email],
  );
  const capsLock = useCapsLock();

  useEffect(() => {
    if (authStatus !== "authenticated" || !currentUser) return;
    // `?next=` is the reason this screen was opened at all, so it is honoured whether the sign-in just
    // happened here or was already in place when the tab loaded. Sending an already-signed-in visitor to
    // their dashboard instead used to swallow a deep link (the page gate puts the intended path there).
    const target = safeNext(new URLSearchParams(window.location.search).get("next")) || dashboardForRole(currentUser.role);
    router.replace(target);
  }, [authStatus, currentUser, router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true); setServerError(null);
    if (mode === "forgot") {
      if (emailInvalid || !email) return;
      if (submitting.current) return;
      if (!online) { setServerError(offlineCopy); return; }
      submitting.current = true;
      setLoading(true);
      try {
        await authApi.requestPasswordReset(email.trim());
        setRecoverySent(true);
      } catch (error) { setServerError(authErrorMessage(error)); } finally { submitting.current = false; setLoading(false); }
      return;
    }
    if (emailInvalid || passwordInvalid || nameInvalid || confirmationInvalid || !email || !password) return;
    if (submitting.current) return;
    if (!online) { setServerError(offlineCopy); return; }
    submitting.current = true;
    setLoading(true);
    try {
      let user;
      if (mode === "register") {
        const parts = name.trim().split(/\s+/);
        // The account, its role, and (for a pupil) grade and class travel in *one* request, so a network
        // that drops halfway cannot leave a registered account with an empty profile — or a form that
        // insists the sign-up failed when the account already exists.
        user = await register({
          email: email.trim(),
          password,
          // Only what the user actually typed: a made-up surname ("Examora") used to appear in every
          // report and certificate next to a pupil who had entered a single word.
          first_name: parts[0],
          last_name: parts.slice(1).join(" "),
          role,
          school_code: schoolCode.trim() || undefined,
          grade: role === "student" ? grade : undefined,
          class_name: role === "student" ? className : undefined,
        });
        toast({ title: "حساب شما ساخته شد", description: "همین حالا وارد شدید؛ نیازی به ورود دوباره نیست.", variant: "success" });
      } else {
        user = await login(email, password);
        toast({ title: "خوش آمدید", description: "ورود شما با موفقیت انجام شد.", variant: "success" });
      }
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")) || dashboardForRole(user.role));
    } catch (error) {
      setServerError(authErrorMessage(error));
    } finally { submitting.current = false; setLoading(false); }
  }

  /** Typing the demo credentials is the slowest part of a demo; this removes it without inventing data. */
  function fillDemo(account: { email: string; password: string }) {
    setEmail(account.email);
    setPassword(account.password);
    setConfirmation(account.password);
    setSubmitted(false);
    setServerError(null);
  }

  return (
    <div className="auth-panel mx-auto grid w-full max-w-6xl overflow-hidden rounded-[1.75rem] border bg-card shadow-lift lg:grid-cols-[1.02fr_.98fr]">
      <BrandPanel mode={mode}/>

      <div className="flex items-center justify-center p-5 sm:p-8 lg:p-11">
        <div className="w-full max-w-md">
          <p className="section-label">{copy.eyebrow}</p>
          <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-[1.75rem]">{copy.title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>

          <form className="mt-7 space-y-4" noValidate onSubmit={handleSubmit}>
            {mode === "register" && <>
              <Field label="نام و نام خانوادگی" icon={UserRound} error={nameError ? "نام خود را وارد کنید." : undefined}>
                <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="مثلاً سارا محمدی" aria-invalid={nameError || undefined}/>
              </Field>

              <fieldset>
                <legend className="mb-1.5 flex items-center gap-1.5 text-xs font-bold"><UsersRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true"/>نقش شما</legend>
                <div className="grid grid-cols-2 gap-2.5">
                  {ROLES.map((item) => {
                    const Icon = item.icon;
                    const active = role === item.value;
                    return (
                      <label
                        key={item.value}
                        className={cn(
                          "relative cursor-pointer rounded-2xl border p-3 text-right transition-all duration-200",
                          active
                            ? "border-primary/55 bg-primary/[.07] shadow-[0_0_0_3px_hsl(var(--ring)/.10)]"
                            : "hover:border-primary/35 hover:bg-muted/50",
                        )}
                      >
                        <input type="radio" name="role" value={item.value} checked={active} onChange={() => setRole(item.value)} className="sr-only"/>
                        <span className={cn("grid h-8 w-8 place-items-center rounded-xl transition-colors", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                          <Icon className="h-4 w-4" aria-hidden="true"/>
                        </span>
                        <span className={cn("mt-2 block text-xs font-black", active && "text-primary")}>{item.label}</span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{item.hint}</span>
                        {active && <Check className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-primary" aria-hidden="true"/>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <Field label="کد عضویت مدرسه (اختیاری)" icon={ShieldCheck} hint="اگر مدرسهٔ شما کد داده، اینجا وارد کنید">
                <Input value={schoolCode} onChange={(event) => setSchoolCode(event.target.value.toUpperCase())} autoComplete="off" maxLength={16} placeholder="مثلاً AB12CD34" dir="ltr" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="text-center tracking-[.18em]"/>
              </Field>

              {role === "student" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="پایه" icon={GraduationCap}>
                    <FieldSelect value={grade} onChange={setGrade} options={["پایه دهم", "پایه یازدهم", "پایه دوازدهم"]}/>
                  </Field>
                  <Field label="کلاس" icon={UsersRound}>
                    <FieldSelect value={className} onChange={setClassName} options={["تجربی ۲", "تجربی ۱", "ریاضی ۱", "انسانی ۱"]}/>
                  </Field>
                </div>
              )}
            </>}

            <Field label="ایمیل" icon={Mail} error={emailError ? "یک ایمیل معتبر وارد کنید." : undefined}>
              <Input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@school.edu" aria-invalid={emailError || undefined} className="text-left" {...addressInput}/>
            </Field>

            {mode !== "forgot" && <>
              <Field
                label="گذرواژه"
                icon={LockKeyhole}
                error={passwordError ? "گذرواژه باید دست‌کم ۸ کاراکتر باشد." : undefined}
                trailing={
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="-me-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={showPassword ? "پنهان کردن گذرواژه" : "نمایش گذرواژه"} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                  </button>
                }
              >
                <Input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="••••••••" aria-invalid={passwordError || undefined} dir="ltr" className="text-left" {...capsLock.handlers}/>
              </Field>

              {/* Outside the `<label>`: a strength meter inside it would become part of the field's
                  accessible name, and «گذرواژه» would stop being «گذرواژه». */}
              {capsLock.on && <CapsLockNotice/>}
              {mode === "register" && <StrengthMeter strength={strength}/>}
            </>}

            {mode === "register" && (
              <Field label="تکرار گذرواژه" icon={LockKeyhole} error={confirmationError ? "تکرار گذرواژه با گذرواژهٔ بالا یکسان نیست." : undefined}>
                <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="••••••••" aria-invalid={confirmationError || undefined} dir="ltr" className="text-left"/>
              </Field>
            )}

            {mode === "login" && (
              <div className="flex items-center justify-between gap-3 pt-0.5">
                <Link href="/forgot-password" className="text-xs font-bold text-primary transition-colors hover:underline">گذرواژه را فراموش کرده‌اید؟</Link>
                {process.env.NODE_ENV !== "production" && (
                  <div className="flex items-center gap-1.5" title="حساب‌های نمونهٔ seed_demo">
                    <Wand2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true"/>
                    <span className="text-[10px] font-bold text-muted-foreground">حساب نمونه:</span>
                    {DEMO_ACCOUNTS.map((account) => (
                      <button key={account.email} type="button" onClick={() => fillDemo(account)} className="rounded-lg border bg-card px-2 py-1 text-[10px] font-bold text-muted-foreground transition-colors hover:border-primary/45 hover:text-primary">
                        {account.role}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!online && <p role="status" className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold leading-6 text-amber-800 dark:text-amber-300">اتصال اینترنت برقرار نیست. همین که وصل شد، دکمه فعال می‌شود.</p>}
            {serverError && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-bold leading-6 text-destructive">{serverError}</p>}
            {recoverySent && <p role="status" className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-bold leading-6 text-emerald-800 dark:text-emerald-300">اگر این ایمیل برای یک حساب فعال باشد، پیوند بازیابی ارسال شده است. پوشهٔ هرزنامه را هم بررسی کنید.</p>}

            <Button type="submit" size="lg" className="button-sheen relative mt-2 w-full overflow-hidden bg-gradient-to-l from-primary to-indigo-500 text-base shadow-lift transition-transform hover:-translate-y-0.5 active:translate-y-0" disabled={loading || recoverySent || !online}>
              {loading && <LoaderCircle className="h-4 w-4 animate-spin"/>}
              {!loading && <ArrowLeft className="h-4 w-4"/>}
              {recoverySent ? "پیوند ارسال شد" : copy.submit}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-muted-foreground">
            {mode === "login" ? <>حساب ندارید؟ <Link href="/register" className="font-bold text-primary hover:underline">ساخت حساب</Link></>
              : mode === "register" ? <>از قبل حساب دارید؟ <Link href="/login" className="font-bold text-primary hover:underline">وارد شوید</Link></>
                : <Link href="/login" className="font-bold text-primary hover:underline">بازگشت به ورود</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The half of the screen that sells the product while the other half collects an address.
 *
 * Everything that moves here is CSS (see the `demo-*` keyframes in `globals.css`): one 15-second loop with
 * three phases, no timers, no re-renders, and one reduced-motion rule that holds the first phase as a still.
 */
const PANEL_POINTS = ["تجربهٔ فارسی و راست‌چین", "گزارش‌های روشن و قابل فهم", "برای مدرسه، نه صرفاً یک آزمون"];

function BrandPanel({ mode }: { mode: Mode }) {
  const heading = mode === "forgot" ? "بازگشت به حساب، بدون دردسر." : "ارزیابی مدرن، برای آموزش معنادار.";
  return (
    <aside className="relative hidden min-h-[600px] overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 p-8 text-white lg:flex lg:flex-col xl:p-10">
      <span aria-hidden="true" className="demo-orb absolute -left-28 -top-24 h-72 w-72 rounded-full bg-white/12 blur-3xl"/>
      <span aria-hidden="true" className="demo-orb demo-orb-slow absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-teal-300/22 blur-3xl"/>
      <span aria-hidden="true" className="soft-grid pointer-events-none absolute inset-0 opacity-[.14]"/>

      <div className="relative">
        <p className="text-xs font-black uppercase tracking-[.18em] text-indigo-200">Examora for education</p>
        <h2 className="mt-4 text-[1.75rem] font-black leading-snug xl:text-3xl">{heading}</h2>
        <p className="mt-4 max-w-sm text-sm leading-7 text-indigo-100">
          محیطی آرام برای دانش‌آموز و ابزارهایی روشن برای آموزگار؛ از ساخت سؤال تا تحلیل نتیجه، در یک فضای منسجم.
        </p>
      </div>

      <ExamDemoCard tone="glass" className="relative mt-7"/>

      <ul className="relative mt-auto space-y-2 pt-7">
        {PANEL_POINTS.map((point) => (
          <li key={point} className="flex items-center gap-2.5 rounded-xl border border-white/12 bg-white/[.07] px-3 py-2.5 text-xs font-bold">
            <Check className="h-3.5 w-3.5 shrink-0 text-teal-200" aria-hidden="true"/>{point}
          </li>
        ))}
      </ul>
    </aside>
  );
}
