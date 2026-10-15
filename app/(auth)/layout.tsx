import Link from "next/link";
import { ArrowRight, Cable, Lock, Wifi } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";

/**
 * The frame around every screen a signed-out visitor sees.
 *
 * Two things this layout is responsible for that the forms are not:
 *  - on a phone the panel's showcase side is hidden, so the tagline and the three facts about the product
 *    have to be said here or nowhere;
 *  - the background has to be interesting enough that the form reads as a card placed on something, rather
 *    than a rectangle floating on white.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell relative min-h-dvh overflow-hidden bg-surface">
      <span aria-hidden="true" className="soft-grid pointer-events-none absolute inset-0 opacity-40"/>

      <header className="relative z-10 flex h-16 items-center justify-between px-4 sm:h-[72px] sm:px-8">
        <Logo/>
        <div className="flex items-center gap-2">
          <ThemeToggle/>
          <Link href="/" className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true"/>بازگشت به سایت
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-6xl flex-col items-center justify-center gap-6 px-4 py-7 sm:min-h-[calc(100svh-4.5rem)] sm:px-6 sm:py-10">
        <div className="w-full lg:hidden">
          <p className="section-label">Examora for education</p>
          <p className="mt-2 text-lg font-black leading-8">ارزیابی مدرن، برای آموزش معنادار.</p>
          <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
            محیطی آرام برای دانش‌آموز و ابزارهایی روشن برای آموزگار؛ از ساخت سؤال تا تحلیل نتیجه.
          </p>
        </div>

        <div className="w-full">{children}</div>

        <ul className="flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-bold text-muted-foreground">
          <li className="flex items-center gap-1.5"><Wifi className="h-3.5 w-3.5 text-primary" aria-hidden="true"/>اجرا بدون نیاز به اینترنت</li>
          <li className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true"/>ذخیرهٔ خودکار پاسخ‌ها</li>
          <li className="flex items-center gap-1.5"><Cable className="h-3.5 w-3.5 text-primary" aria-hidden="true"/>قلم و وابستگی‌ها داخل خود پروژه</li>
        </ul>
      </main>
    </div>
  );
}
