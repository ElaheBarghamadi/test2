"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlignRight, ArrowLeft, BarChart3, BookOpenCheck, CalendarClock, Check, ChevronLeft, CircleDot,
  Clock3, Eye, FileCheck2, GraduationCap, Image as ImageIcon, Layers, Link2, ListChecks, Menu,
  Mic, PlayCircle, Save, School, ShieldCheck, Sparkles, Target, TextCursorInput, Timer, ToggleLeft,
  UserRoundCog, WifiOff, X,
} from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { ExamDemoCard } from "@/components/shared/exam-demo-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The only page a visitor sees before deciding whether to make an account.
 *
 * One rule was applied to every number and claim on it: it has to be true of the code in this repository.
 * The earlier version opened with a strip of invented statistics («۹۸٪ رضایت مدارس», «+۴۵هزار آزمون موفق»,
 * «۲۴/۷ پایداری سرویس») for a product with no deployed customers, which is the kind of thing a school
 * administrator — the person actually being asked to trust this with an exam — is best at spotting. What
 * replaces it is the count of question types, audience rules, result-detail levels and network
 * dependencies, each of which can be checked in the source.
 */

const fade = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } };

const NAV = [
  { href: "#question-types", label: "انواع سؤال" },
  { href: "#features", label: "قابلیت‌ها" },
  { href: "#how", label: "چطور کار می‌کند" },
  { href: "#teacher", label: "فضای آموزگار" },
  { href: "#security", label: "امنیت" },
];

/** Every figure here is a count of something that exists in this codebase, not a claim about adoption. */
const FACTS = [
  { value: "۶", label: "نوع سؤال", note: "از چهارگزینه‌ای تا تشریحی" },
  { value: "۳", label: "راه تعیین مخاطب", note: "دانش‌آموز، گروه، یا پایه و کلاس" },
  { value: "۴", label: "سطح نمایش نتیجه", note: "از فقط نمره تا پاسخ‌نامهٔ کامل" },
  { value: "۰", label: "وابستگی به اینترنت", note: "قلم و کتابخانه‌ها داخل پروژه" },
];

/** Mirrors `questionTypeMeta` in the frontend and the `type` choices in `apps/exams/models.py`. */
const QUESTION_TYPES = [
  { icon: CircleDot, title: "چهارگزینه‌ای", text: "یک پاسخ درست، تصحیح خودکار، و گزینه‌هایی که می‌توانند تصویر باشند." },
  { icon: ListChecks, title: "چندگزینه‌ای چندپاسخی", text: "تعداد پاسخ‌های درست را خود آموزگار تعیین می‌کند، نه یک عدد ثابت." },
  { icon: ToggleLeft, title: "درست و نادرست", text: "دو گزینه، بدون حدس‌زدن تصادفی در گزارش‌ها." },
  { icon: Link2, title: "وصل‌کردنی", text: "جفت‌کردنی؛ هر سمت ترتیب خودش را دارد و پاسخ‌ها جابه‌جا نمایش داده می‌شوند." },
  { icon: TextCursorInput, title: "پاسخ کوتاه", text: "چند پاسخ قابل قبول برای یک سؤال، با تطبیق خودکار." },
  { icon: AlignRight, title: "پاسخ تشریحی", text: "تایپ، تصویر یا صدا؛ نمرهٔ دستی با بازخورد نوشتاری آموزگار." },
];

const FEATURES = [
  { icon: Layers, title: "گروه‌بندی دانش‌آموزان", text: "یک بار گروه بسازید و برای هر آزمون همان گروه را انتخاب کنید، به‌جای تیک‌زدن سی نام در هر نوبت." },
  { icon: Target, title: "مخاطب هر آزمون", text: "یا دانش‌آموزان مشخص، یا یک گروه، یا همهٔ یک پایه و کلاس. نتیجهٔ نهایی اجتماع این سه است، نه جمعشان." },
  { icon: ImageIcon, title: "سؤال و پاسخ تصویری", text: "تصویر در متن سؤال، یا کل سؤال به‌صورت تصویر؛ و پاسخ تصویری دانش‌آموز با بررسی محتوای واقعی فایل." },
  { icon: Mic, title: "پاسخ صوتی", text: "ضبط صدا در همان جلسهٔ آزمون، برای سؤالی که نوشتن جوابش از گفتنش سخت‌تر است." },
  { icon: Save, title: "ذخیرهٔ خودکار", text: "هر پاسخ به‌محض ثبت ذخیره می‌شود؛ بسته شدن مرورگر یا قطع شبکه، جلسه را از بین نمی‌برد." },
  { icon: BarChart3, title: "گزارش‌های قابل اقدام", text: "میانگین، روند و تفکیک هر دانش‌آموز — و نتیجهٔ منتشرنشده هرگز صفر نمایش داده نمی‌شود." },
];

const STEPS = [
  { icon: UserRoundCog, title: "حساب بسازید", text: "آموزگار یا دانش‌آموز. نقش، پایه و کلاس در همان یک درخواست ثبت می‌شود، نه در یک مرحلهٔ جداگانه." },
  { icon: FileCheck2, title: "آزمون را در شش گام بسازید", text: "اطلاعات پایه، تنظیمات، مخاطبان، سؤال‌ها، زمان‌بندی و بازبینی. سؤال‌ها نوع‌اول هستند: اول نوع، بعد فیلدهای همان نوع." },
  { icon: CalendarClock, title: "منتشر و برگزار کنید", text: "بلافاصله یا زمان‌بندی‌شده. دانش‌آموز از همان داشبورد می‌بیند چه آزمونی در جریان است و چقدر وقت دارد." },
];

const SECURITY = [
  { icon: Save, title: "ذخیرهٔ مطمئن پاسخ‌ها", text: "پاسخ‌ها پیش از هر جابه‌جایی ثبت می‌شوند و نیمه‌کاره‌ماندن، جلسه را باطل نمی‌کند." },
  { icon: Eye, title: "رویدادهای قابل پیگیری", text: "هر رویداد جلسه ثبت می‌شود تا یک تصمیم انسانی، نه یک حدس خودکار، پشت آن باشد." },
  { icon: ShieldCheck, title: "دسترسی بر پایهٔ نقش", text: "هر صفحه و هر endpoint نقش خودش را می‌پرسد؛ نتیجهٔ منتشرنشده برای دانش‌آموز خطای دسترسی است، نه صفر." },
  { icon: WifiOff, title: "بدون وابستگی بیرونی", text: "قلم، آیکون و کتابخانه‌ها داخل خود پروژه‌اند؛ هیچ CDN یا فونت دوردستی در کار نیست." },
];

export default function LandingPage() {
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="flex flex-wrap items-center gap-1" aria-label="ناوبری اصلی">
      {NAV.map((item) => (
        <a key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground">
          {item.label}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="overflow-hidden bg-background">
      <header className="sticky top-0 z-40 border-b border-border/65 bg-background/80 shadow-sm shadow-slate-900/[.03] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-[72px] sm:px-6">
          <Logo/>
          <div className="hidden lg:block">{nav}</div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle/>
            <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href="/login">ورود</Link></Button>
            <Button asChild className="button-sheen relative hidden overflow-hidden bg-gradient-to-l from-primary to-indigo-500 sm:inline-flex">
              <Link href="/register">شروع رایگان<ArrowLeft className="h-4 w-4"/></Link>
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "بستن منو" : "باز کردن منو"} aria-expanded={open}>
              {open ? <X/> : <Menu/>}
            </Button>
          </div>
        </div>
        {open && (
          <div className="border-t border-border/70 bg-card/95 px-4 py-3 shadow-soft backdrop-blur-xl lg:hidden">
            {nav}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button asChild variant="secondary"><Link href="/login">ورود</Link></Button>
              <Button asChild><Link href="/register">شروع رایگان</Link></Button>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* ── hero ─────────────────────────────────────────────────────────── */}
        <section className="relative isolate overflow-hidden">
          <div className="soft-grid absolute inset-0 -z-10 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"/>
          <div aria-hidden="true" className="demo-orb absolute -right-40 top-10 -z-10 h-96 w-96 rounded-full bg-indigo-400/15 blur-3xl"/>
          <div aria-hidden="true" className="demo-orb demo-orb-slow absolute -left-48 top-32 -z-10 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl"/>

          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:gap-12 sm:px-6 sm:py-16 md:py-24 lg:grid-cols-[1.04fr_.96fr] lg:py-28">
            <motion.div className="min-w-0" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: .09 } } }}>
              <motion.div variants={fade} className="inline-flex items-center gap-2 rounded-full border bg-card/85 px-3 py-1.5 text-xs font-extrabold text-primary shadow-soft">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true"/>ارزیابی دیجیتال، دقیق و انسانی
              </motion.div>
              <motion.h1 variants={fade} className="mt-6 max-w-2xl text-4xl font-black leading-[1.25] tracking-tight sm:text-5xl lg:text-6xl">
                هر آزمون، فرصتی برای <span className="text-primary">یادگیری بهتر</span> است.
              </motion.h1>
              <motion.p variants={fade} className="mt-6 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
                Examora فضای آزمون آنلاین مدارس را با تجربه‌ای آرام برای دانش‌آموزان و ابزارهایی دقیق برای
                آموزگاران، از ساخت سؤال تا تحلیل نتیجه، یک‌جا جمع می‌کند.
              </motion.p>
              <motion.div variants={fade} className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="button-sheen relative overflow-hidden bg-gradient-to-l from-primary to-indigo-500 shadow-lift">
                  <Link href="/register">ساخت فضای مدرسه<ArrowLeft className="h-4 w-4"/></Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="#experience"><PlayCircle className="h-4 w-4"/>مشاهده تجربه آزمون</Link>
                </Button>
              </motion.div>
              <motion.div variants={fade} className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-muted-foreground">
                {["کاملاً فارسی و راست‌چین", "اجرا بدون اتصال به اینترنت", "بدون نیاز به کارت بانکی"].map((item) => (
                  <span key={item} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" aria-hidden="true"/>{item}</span>
                ))}
              </motion.div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: .96, x: -12 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ duration: .55, delay: .1 }} className="relative mx-auto w-full max-w-xl">
              <div aria-hidden="true" className="absolute -inset-5 -z-10 rounded-[2.5rem] bg-gradient-to-br from-indigo-500/20 via-violet-500/10 to-teal-400/20 blur-2xl"/>
              <Card className="overflow-hidden rounded-3xl border-white/60 bg-card/95 p-4 shadow-lift dark:border-border sm:p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">زیست‌شناسی · دوازدهم · تجربهٔ ۲</p>
                    <h2 className="mt-1 text-base font-black sm:text-lg">نمای دانش‌آموز، در جریان آزمون</h2>
                  </div>
                  <span className="rounded-lg bg-muted px-2 py-1 text-[10px] font-black text-muted-foreground">نمای نمونه</span>
                </div>
                <ExamDemoCard className="mt-4"/>
              </Card>
              <div className="absolute -bottom-6 -right-5 max-w-[15rem] rounded-2xl border bg-card p-3.5 shadow-lift max-sm:static max-sm:mt-3 max-sm:w-fit max-sm:max-w-full max-sm:shadow-soft">
                <div className="flex items-center gap-2">
                  <span className="rounded-xl bg-success/10 p-2 text-success"><Timer className="h-5 w-5" aria-hidden="true"/></span>
                  <span>
                    <span className="block text-xs font-extrabold">زمان و پاسخ‌ها محفوظ‌اند</span>
                    <span className="block text-[10px] text-muted-foreground">حتی اگر مرورگر بسته شود</span>
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── honest facts ─────────────────────────────────────────────────── */}
        <section className="border-y bg-card/50">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-y-7 px-4 py-9 sm:grid-cols-4 sm:px-6">
            {FACTS.map((fact) => (
              <div key={fact.label} className="px-2 text-center">
                <p className="text-3xl font-black text-primary sm:text-4xl">{fact.value}</p>
                <p className="mt-1.5 text-xs font-black">{fact.label}</p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{fact.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── question types ───────────────────────────────────────────────── */}
        <section id="question-types" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <p className="section-label">انواع سؤال</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">اول نوع سؤال را انتخاب کنید، بعد فقط فیلدهای همان نوع.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              پیش‌تر همهٔ فیلدها یک‌جا روی صفحه بودند و ساختن یک سؤال تستی ساده هم شلوغ به نظر می‌رسید. حالا
              افزودن سؤال با انتخاب نوع شروع می‌شود و فرم، فقط همان چیزی را می‌پرسد که آن نوع لازم دارد.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {QUESTION_TYPES.map((item) => <Feature key={item.title} {...item}/>)}
          </div>
        </section>

        {/* ── features ─────────────────────────────────────────────────────── */}
        <section id="features" className="scroll-mt-24 border-y bg-card/50">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <p className="section-label">طراحی‌شده برای جریان واقعی مدرسه</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">همه‌چیز برای یک ارزیابی بهتر، در یک فضای منسجم</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                از ساخت سؤال تا تحلیل نتایج؛ Examora پیچیدگی‌های روز آزمون را از مسیر شما برمی‌دارد.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((item) => <Feature key={item.title} {...item}/>)}
            </div>
          </div>
        </section>

        {/* ── how it works ─────────────────────────────────────────────────── */}
        <section id="how" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <p className="section-label">چطور کار می‌کند</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">سه گام تا اولین آزمون</h2>
          </div>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title}>
                  <Card className="relative h-full overflow-hidden p-6">
                    <span aria-hidden="true" className="absolute -left-3 -top-5 text-7xl font-black text-muted/70">{["۱", "۲", "۳"][index]}</span>
                    <span className="relative inline-flex rounded-2xl bg-primary/10 p-3 text-primary"><Icon className="h-6 w-6" aria-hidden="true"/></span>
                    <h3 className="relative mt-5 font-black">{step.title}</h3>
                    <p className="relative mt-2 text-sm leading-7 text-muted-foreground">{step.text}</p>
                  </Card>
                </li>
              );
            })}
          </ol>
        </section>

        {/* ── student experience ───────────────────────────────────────────── */}
        <section id="experience" className="scroll-mt-24 bg-slate-950 py-14 text-white dark:bg-slate-900 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="section-label text-indigo-300">تجربه دانش‌آموز</p>
              <h2 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">در لحظه‌ای که مهم است، فقط سؤال و دانش‌آموز.</h2>
              <p className="mt-5 max-w-xl leading-8 text-slate-300">
                تایمر همیشه در دسترس است، وضعیت پاسخ‌ها روشن است و جابه‌جایی میان سؤال‌ها بدون حواس‌پرتی
                انجام می‌شود؛ روی موبایل هم به همان اندازه خوب.
              </p>
              <ul className="mt-7 space-y-3 text-sm text-slate-200">
                {[
                  "پیش از شروع، مدت، تعداد سؤال و قوانین جلسه روشن است",
                  "نشان‌دار کردن سؤال‌ها برای مرور، و نمای بازبینی پیش از ثبت نهایی",
                  "هشدار پیش از پایان وقت، و ذخیرهٔ خودکار هر پاسخ",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" aria-hidden="true"/>{item}</li>
                ))}
              </ul>
              <Button asChild variant="secondary" className="mt-8">
                <Link href="/register">ساخت حساب و شروع آزمون<ArrowLeft className="h-4 w-4"/></Link>
              </Button>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[.06] p-4 shadow-2xl backdrop-blur-sm">
              <div className="rounded-2xl bg-white p-4 text-slate-900 sm:p-5">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <p className="text-[11px] font-bold text-slate-500">آزمون جامع زیست‌شناسی</p>
                    <p className="mt-1 text-sm font-black">سؤال ۷ از ۲۰</p>
                  </div>
                  <Clock3 className="h-5 w-5 text-indigo-600" aria-hidden="true"/>
                </div>
                <div className="py-5">
                  <p className="font-bold leading-7">نقش اصلی غشای پلاسمایی در سلول چیست؟</p>
                  <div className="mt-4 grid gap-2">
                    {["تنظیم ورود و خروج مواد", "تولید پروتئین", "ذخیره اطلاعات ژنتیکی"].map((item, index) => (
                      <div key={item} className={`rounded-xl border p-3 text-xs font-bold ${index === 0 ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200"}`}>{item}</div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t pt-3 text-xs font-bold text-slate-500">
                  <span>۶ پاسخ ثبت شده</span>
                  <span className="text-indigo-600">ذخیرهٔ امن</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── teacher workspace ────────────────────────────────────────────── */}
        <section id="teacher" className="mx-auto grid max-w-7xl scroll-mt-24 gap-8 px-4 py-14 sm:gap-10 sm:px-6 sm:py-20 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
          <div className="order-2 grid grid-cols-2 gap-3 lg:order-1">
            <MiniManagement icon={FileCheck2} label="ساخت آزمون" value="۶ گام" caption="نمای نمونه"/>
            <MiniManagement icon={GraduationCap} label="مخاطبان آزمون" value="۲۸ از ۳۰" caption="نمای نمونه"/>
            <MiniManagement icon={BarChart3} label="میانگین کلاس" value="۷۶.۴٪" caption="نمای نمونه"/>
            <MiniManagement icon={Clock3} label="زمان‌سنج جلسه" value="دقیق و شفاف" caption=""/>
          </div>
          <div className="order-1 lg:order-2">
            <p className="section-label">فضای کار آموزگار</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">کنترل حرفه‌ای، بدون پیچیدگی اضافه</h2>
            <p className="mt-5 leading-8 text-muted-foreground">
              آزمون را مرحله‌به‌مرحله بسازید، بانک سؤال خود را رشد دهید، مخاطب هر آزمون را از میان گروه‌ها
              انتخاب کنید و با نتایجی که واقعاً قابل فهم هستند، برای جلسهٔ بعدی تصمیم بگیرید.
            </p>
            <ul className="mt-5 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              {["بانک سؤال با پوشه و برچسب", "تصحیح دستی با بازخورد نوشتاری", "انتخاب سطح نمایش نتیجه", "زمان‌بندی و انتشار خودکار"].map((item) => (
                <li key={item} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true"/>{item}</li>
              ))}
            </ul>
            <Button asChild variant="outline" className="mt-7">
              <Link href="/teacher/dashboard">نمایش داشبورد آموزگار<ArrowLeft className="h-4 w-4"/></Link>
            </Button>
          </div>
        </section>

        {/* ── who signs up ─────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 sm:pb-20">
          <div className="grid gap-4 md:grid-cols-2">
            <RoleCard
              icon={UserRoundCog}
              title="برای آموزگار"
              text="آزمون بسازید، مخاطب تعیین کنید، سؤال تصویر و صدا بگذارید و نتیجه را همان‌قدر که می‌خواهید به دانش‌آموز نشان دهید."
              points={["بانک سؤال و گروه‌بندی کلاس", "تصحیح خودکار و دستی", "گزارش عملکرد هر دانش‌آموز"]}
              cta="ساخت حساب آموزگار"
            />
            <RoleCard
              icon={GraduationCap}
              title="برای دانش‌آموز"
              text="یک داشبورد که می‌گوید چه آزمونی در جریان است، چقدر وقت مانده، و نتیجه‌هایی که تا الان گرفته‌اید."
              points={["ادامهٔ آزمون نیمه‌کاره از همان‌جا", "پاسخ صوتی و تصویری", "روند نمره و میانگین شخصی"]}
              cta="ساخت حساب دانش‌آموز"
            />
          </div>
        </section>

        {/* ── security ─────────────────────────────────────────────────────── */}
        <section id="security" className="mx-4 mb-14 scroll-mt-24 rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-700 px-5 py-10 text-white shadow-lift sm:mx-6 sm:mb-20 sm:px-10 sm:py-14 lg:mx-auto lg:max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
            <div>
              <span className="inline-flex rounded-xl bg-white/15 p-2.5"><ShieldCheck className="h-6 w-6" aria-hidden="true"/></span>
              <h2 className="mt-5 text-3xl font-black">اعتماد، بخشی از طراحی ماست.</h2>
              <p className="mt-4 max-w-xl leading-8 text-indigo-100">
                از ذخیرهٔ خودکار پاسخ‌ها تا کنترل شفاف وضعیت آزمون و سطح دسترسی هر نقش؛ چیزی که در گزارش
                می‌آید همان چیزی است که در جلسه اتفاق افتاده.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {SECURITY.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <Icon className="h-4 w-4 text-teal-200" aria-hidden="true"/>
                    <p className="mt-3 text-sm font-black">{item.title}</p>
                    <p className="mt-1.5 text-[11px] leading-5 text-indigo-100">{item.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── final CTA ────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-4 pb-14 text-center sm:pb-20">
          <p className="section-label">آماده برای شروع</p>
          <h2 className="mt-3 text-3xl font-black sm:text-4xl">ارزیابی را به تجربه‌ای بهتر تبدیل کنید.</h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
            فضای مدرسهٔ خود را بسازید و اولین آزمون را با آرامش برگزار کنید.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="button-sheen relative overflow-hidden bg-gradient-to-l from-primary to-indigo-500 shadow-lift">
              <Link href="/register">شروع با Examora<ArrowLeft className="h-4 w-4"/></Link>
            </Button>
            <Button asChild size="lg" variant="outline"><Link href="/login">حساب دارم، وارد می‌شوم</Link></Button>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo/>
            <p className="mt-3 max-w-sm text-xs leading-6 text-muted-foreground">
              Examora یک سامانهٔ آزمون آنلاین برای مدرسه‌هاست؛ کاملاً فارسی و راست‌چین، و قابل اجرا بدون
              اتصال به اینترنت.
            </p>
          </div>
          {/* Real destinations only: the earlier footer pointed every link at `#`, which reads as a broken
              page rather than an unfinished one. */}
          <div>
            <p className="text-xs font-black">محصول</p>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              {NAV.map((item) => <li key={item.href}><a className="transition-colors hover:text-foreground" href={item.href}>{item.label}</a></li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-black">حساب</p>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              <li><Link className="transition-colors hover:text-foreground" href="/register">ساخت حساب</Link></li>
              <li><Link className="transition-colors hover:text-foreground" href="/login">ورود</Link></li>
              <li><Link className="transition-colors hover:text-foreground" href="/forgot-password">بازیابی گذرواژه</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>© ۲۰۲۶ Examora · طراحی‌شده برای آموزش بهتر</p>
            <p className="flex items-center gap-1.5"><School className="h-3.5 w-3.5" aria-hidden="true"/>نقش‌های مدیر سامانه و مدیر مدرسه توسط مدیر ساخته می‌شوند.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, text }: { icon: typeof BookOpenCheck; title: string; text: string }) {
  return (
    <Card className="group h-full p-6 transition-all hover:-translate-y-1 hover:shadow-lift">
      <span className="inline-flex rounded-2xl bg-primary/10 p-3 text-primary transition-transform group-hover:scale-105"><Icon className="h-6 w-6" aria-hidden="true"/></span>
      <h3 className="mt-5 font-black">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">{text}</p>
    </Card>
  );
}

function MiniManagement({ icon: Icon, label, value, caption }: { icon: typeof BookOpenCheck; label: string; value: string; caption: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <span className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-primary" aria-hidden="true"/>
        {caption && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-black text-muted-foreground">{caption}</span>}
      </span>
      <p className="mt-5 text-lg font-black">{value}</p>
      <p className="mt-1 text-xs font-bold text-muted-foreground">{label}</p>
    </Card>
  );
}

function RoleCard({ icon: Icon, title, text, points, cta }: { icon: typeof BookOpenCheck; title: string; text: string; points: string[]; cta: string }) {
  return (
    <Card className="flex h-full flex-col p-6 transition-all hover:-translate-y-1 hover:shadow-lift sm:p-7">
      <span className="inline-flex w-fit rounded-2xl bg-primary/10 p-3 text-primary"><Icon className="h-6 w-6" aria-hidden="true"/></span>
      <h3 className="mt-5 text-lg font-black">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">{text}</p>
      <ul className="mt-4 space-y-2 text-xs font-bold">
        {points.map((point) => <li key={point} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true"/>{point}</li>)}
      </ul>
      <Button asChild className="mt-6 w-full sm:w-fit"><Link href="/register">{cta}<ChevronLeft className="h-4 w-4"/></Link></Button>
    </Card>
  );
}
