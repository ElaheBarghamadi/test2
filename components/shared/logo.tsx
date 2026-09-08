import Link from "next/link";
import { cn } from "@/lib/utils";
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) { return <Link href="/" className={cn("group inline-flex items-center gap-2.5", className)} aria-label="Examora، صفحه اصلی"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-black text-white shadow-lg shadow-indigo-500/25">E</span>{!compact && <span className="text-lg font-black tracking-tight text-foreground">Examora</span>}</Link>; }
