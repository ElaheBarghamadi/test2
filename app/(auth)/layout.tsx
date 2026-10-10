import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell relative min-h-dvh overflow-hidden bg-surface">
      <header className="relative z-10 flex h-16 items-center justify-between px-4 sm:h-[72px] sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/" className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ArrowRight className="h-3.5 w-3.5" />بازگشت به سایت
          </Link>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl items-center px-4 py-7 sm:min-h-[calc(100svh-4.5rem)] sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
