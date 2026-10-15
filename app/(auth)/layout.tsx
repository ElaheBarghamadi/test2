import Link from "next/link";
import { ArrowRight, Cable, Lock, Wifi } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";

/**
 * The frame around every screen a signed-out visitor sees: login, register, forgot and reset password.
 *
 * It is exactly one viewport tall (`h-dvh`) and never scrolls as a page. Everything that can overflow —
 * the register form on a short laptop, the brand panel's showcase — scrolls inside its own box instead, so
 * the header and the trust strip stay put and the screen reads as an app rather than a document.
 *
 * Two things this layout is responsible for that the forms are not:
 *  - on a phone the panel's showcase side is hidden, so the tagline has to be said here or nowhere;
 *  - the background has to be interesting enough that the form reads as a card placed on something, rather
 *    than a rectangle floating on white.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell relative flex h-dvh flex-col overflow-hidden bg-surface">
      <span aria-hidden="true" className="soft-grid pointer-events-none absolute inset-0 opacity-40"/>

      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between px-4 sm:h-[72px] sm:px-8">
        <Logo/>
        <div className="flex items-center gap-2">
          <ThemeToggle/>
          <Link href="/" className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true"/>بازگشت به سایت
          </Link>
        </div>
      </header>

      {/*
       * `min-h-0` is what lets the panel below actually fill the space instead of pushing the page open;
       * without it a flex child refuses to shrink below its content and `h-dvh` stops meaning anything.
       * Below `lg` the card is natural-height and this element scrolls, because a phone has no room for a
       * second, nested scrollbar.
       */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6 lg:overflow-hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 lg:min-h-0 lg:gap-6">
          <div className="w-full shrink-0 lg:hidden">
            <p className="section-label">Examora for education</p>
            <p className="mt-2 text-lg font-black leading-8">ارزیابی مدرن، برای آموزش معنادار.</p>
            <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
              محیطی آرام برای دانش‌آموز و ابزارهایی روشن برای آموزگار؛ از ساخت سؤال تا تحلیل نتیجه.
            </p>
          </div>

          {/*
       * `lg:items-center` is for the one screen whose card is a single narrow column (reset-password):
       * as a flex child it would otherwise stretch into a tall thin panel. The two-column card carries an
       * explicit `lg:h-full`, so centring does not stop it filling the space.
       */}
          <div className="w-full lg:flex lg:min-h-0 lg:flex-1 lg:items-center">{children}</div>

          <ul className="flex w-full shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-bold text-muted-foreground">
            <li className="flex items-center gap-1.5"><Wifi className="h-3.5 w-3.5 text-primary" aria-hidden="true"/>اجرا بدون نیاز به اینترنت</li>
            <li className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true"/>ذخیرهٔ خودکار پاسخ‌ها</li>
            <li className="flex items-center gap-1.5"><Cable className="h-3.5 w-3.5 text-primary" aria-hidden="true"/>قلم و وابستگی‌ها داخل خود پروژه</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
