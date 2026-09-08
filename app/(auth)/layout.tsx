import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
export default function AuthLayout({ children }: { children: React.ReactNode }) { return <div className="min-h-screen bg-surface"><header className="flex h-16 items-center justify-between px-4 sm:px-8"><Logo/><div className="flex items-center gap-2"><ThemeToggle/><Link href="/" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowRight className="h-3.5 w-3.5"/>بازگشت به سایت</Link></div></header><main className="mx-auto flex min-h-[calc(100vh-64px)] max-w-6xl items-center px-4 py-8 sm:px-6">{children}</main></div>; }
