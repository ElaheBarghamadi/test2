"use client";

import Link from "next/link";
import { Eye, EyeOff, LoaderCircle, Mail, LockKeyhole, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authErrorMessage, dashboardForRole, useAuthStore } from "@/lib/state/auth-store";
import { authApi } from "@/lib/api/auth";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToastStore } from "@/lib/state/toast-store";
import { safeNextPath } from "@/lib/auth/page-access";

type Mode = "login" | "register" | "forgot";
const content: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: { title: "خوش آمدید", subtitle: "برای ادامه به فضای Examora وارد شوید.", submit: "ورود به حساب" },
  register: { title: "ساخت فضای جدید", subtitle: "در کمتر از چند دقیقه حساب آموزگار یا دانش‌آموز بسازید.", submit: "ساخت حساب" },
  forgot: { title: "بازیابی گذرواژه", subtitle: "ایمیل حساب را وارد کنید تا پیوند امن ساخت گذرواژهٔ جدید برایتان ارسال شود.", submit: "ارسال پیوند بازیابی" },
};

// The same rule the page gate uses, so `?next=` can never become a way to hand a session to another site.
const safeNext = safeNextPath;

const offlineCopy = "اتصال اینترنت برقرار نیست؛ پس از وصل‌شدن دوباره تلاش کنید. چیزی که وارد کرده‌اید از بین نمی‌رود.";
// The browser cannot type an email address for you, and it fails quietly: a phone keyboard that
// capitalises the first letter or turns "name@school.edu" into a suggestion produces a sign-in that
// "does not work" for reasons the user cannot see.
const addressInput = { type: "email" as const, dir: "ltr" as const, autoCapitalize: "none" as const, autoCorrect: "off" as const, spellCheck: false, inputMode: "email" as const };

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

  return <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border bg-card shadow-lift md:grid-cols-[.9fr_1.1fr]">
    <aside className="relative hidden min-h-[580px] overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 p-9 text-white md:flex md:flex-col"><div className="absolute -left-28 -top-20 h-72 w-72 rounded-full bg-white/10 blur-2xl"/><div className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full bg-teal-300/20 blur-2xl"/><div className="relative"><p className="text-sm font-bold text-indigo-200 dark:text-indigo-300">Examora for education</p><h2 className="mt-4 text-3xl font-black leading-tight">ارزیابی مدرن، برای آموزش معنادار.</h2><p className="mt-5 text-sm leading-7 text-indigo-100 dark:text-indigo-300">با محیطی آرام برای دانش‌آموز و ابزارهای روشن برای آموزگار، مسیر آزمون را بهتر کنید.</p></div><div className="relative mt-auto space-y-3">{["تجربهٔ فارسی و راست‌چین", "گزارش‌های روشن و قابل فهم", "برای مدرسه، نه صرفاً یک آزمون"].map((item) => <div key={item} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-xs font-bold">{item}</div>)}</div></aside>
    <div className="flex items-center justify-center p-5 sm:p-10"><Card className="w-full max-w-md border-0 shadow-none"><div><p className="section-label">{mode === "login" ? "ورود" : mode === "register" ? "شروع کار" : "دسترسی مجدد"}</p><h1 className="mt-2 text-2xl font-black">{copy.title}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.subtitle}</p></div>
      <form className="mt-7 space-y-4" noValidate onSubmit={handleSubmit}>
        {mode === "register" && <><Field label="نام و نام خانوادگی" icon={UserRound} error={nameError ? "نام خود را وارد کنید." : undefined}><Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="مثلاً سارا محمدی" aria-invalid={nameError}/></Field><Field label="نقش شما" icon={UsersRound}><select value={role} onChange={(event) => setRole(event.target.value as "student" | "teacher")} className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-base font-medium outline-none focus:ring-2 focus:ring-ring sm:text-sm"><option value="student">دانش‌آموز</option><option value="teacher">آموزگار</option></select></Field><Field label="کد عضویت مدرسه (اختیاری)" icon={UsersRound}><Input value={schoolCode} onChange={(event) => setSchoolCode(event.target.value.toUpperCase())} autoComplete="off" maxLength={16} placeholder="مثلاً AB12CD34" dir="ltr" autoCapitalize="characters" autoCorrect="off" spellCheck={false}/></Field>{role === "student" && <div className="grid gap-4 sm:grid-cols-2"><Field label="پایه" icon={UserRound}><select value={grade} onChange={(event) => setGrade(event.target.value)} className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-base font-medium outline-none focus:ring-2 focus:ring-ring sm:text-sm"><option>پایه دهم</option><option>پایه یازدهم</option><option>پایه دوازدهم</option></select></Field><Field label="کلاس" icon={UserRound}><select value={className} onChange={(event) => setClassName(event.target.value)} className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-base font-medium outline-none focus:ring-2 focus:ring-ring sm:text-sm"><option>تجربی ۲</option><option>تجربی ۱</option><option>ریاضی ۱</option><option>انسانی ۱</option></select></Field></div>}</>}
        <Field label="ایمیل" icon={Mail} error={emailError ? "یک ایمیل معتبر وارد کنید." : undefined}><Input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@school.edu" aria-invalid={emailError} {...addressInput}/></Field>{mode !== "forgot" && <Field label="گذرواژه" icon={LockKeyhole} error={passwordError ? "گذرواژه باید دست‌کم ۸ کاراکتر باشد." : undefined}><div className="relative"><Input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} className="pl-10" placeholder="••••••••" aria-invalid={passwordError} dir="ltr"/><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label={showPassword ? "پنهان کردن گذرواژه" : "نمایش گذرواژه"}>{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></Field>}
        {mode === "register" && <Field label="تکرار گذرواژه" icon={LockKeyhole} error={confirmationError ? "تکرار گذرواژه با گذرواژهٔ بالا یکسان نیست." : undefined}><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="••••••••" aria-invalid={confirmationError} dir="ltr"/></Field>}
        {mode === "login" && <div className="text-left"><Link href="/forgot-password" className="text-xs font-bold text-primary hover:underline">گذرواژه را فراموش کرده‌اید؟</Link></div>}
        {!online && <p role="status" className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold leading-6 text-amber-800 dark:text-amber-300">اتصال اینترنت برقرار نیست. همین که وصل شد، دکمه فعال می‌شود.</p>}
        {serverError && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">{serverError}</p>}
        {recoverySent && <p role="status" className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-bold leading-6 text-emerald-800 dark:text-emerald-300">اگر این ایمیل برای یک حساب فعال باشد، پیوند بازیابی ارسال شده است. پوشهٔ هرزنامه را هم بررسی کنید.</p>}
        <Button type="submit" size="lg" className="mt-2 w-full" disabled={loading || recoverySent || !online}>{loading && <LoaderCircle className="h-4 w-4 animate-spin"/>}{recoverySent ? "پیوند ارسال شد" : copy.submit}</Button>
      </form>
      <div className="mt-6 text-center text-xs text-muted-foreground">{mode === "login" ? <>حساب ندارید؟ <Link href="/register" className="font-bold text-primary hover:underline">ساخت حساب</Link></> : mode === "register" ? <>از قبل حساب دارید؟ <Link href="/login" className="font-bold text-primary hover:underline">وارد شوید</Link></> : <Link href="/login" className="font-bold text-primary hover:underline">بازگشت به ورود</Link>}</div>
    </Card></div>
  </div>;
}
function Field({ label, icon: Icon, error, children }: { label: string; icon: typeof Mail; error?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold"><Icon className="h-3.5 w-3.5 text-muted-foreground"/>{label}</span>{children}{error && <span className="mt-1.5 block text-xs font-bold text-destructive">{error}</span>}</label>; }
