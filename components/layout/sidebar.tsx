"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut, Settings2, X } from "lucide-react";
import type { Role, User } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/shared/avatar";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { roleLabel, roleNavigation } from "@/components/layout/navigation";
import { dashboardForRole, profilePathForRole } from "@/lib/auth/roles";
import { useAuthStore } from "@/lib/state/auth-store";

export function Sidebar({ role, user, mobile = false, close }: { role: Role; user: User; mobile?: boolean; close?: () => void }) {
  const pathname = usePathname(); const router = useRouter(); const logout = useAuthStore((state) => state.logout);
  const nav = roleNavigation[role]; const leave = () => { close?.(); void logout().finally(() => router.replace("/login")); };
  return <aside className={cn("flex h-full flex-col bg-card", mobile ? "w-[min(84vw,320px)] rounded-l-3xl p-4 shadow-lift" : "fixed inset-y-0 right-0 z-30 hidden w-72 border-l p-5 lg:flex")}>
    <div className="flex items-center justify-between px-1"><Logo />{mobile && <Button variant="ghost" size="icon" onClick={close} aria-label="بستن منو"><X className="h-5 w-5" /></Button>}</div>
    <div className="mt-8"><p className="px-3 text-[11px] font-bold tracking-wider text-muted-foreground">فضای {roleLabel[role]}</p><nav className="mt-3 space-y-1" aria-label="ناوبری اصلی">{nav.map((item) => { const active = pathname === item.href || (item.href !== dashboardForRole(role) && pathname.startsWith(item.href)); const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={close} className={cn("relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition-colors", active ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {active && <motion.span layoutId={mobile ? "active-mobile" : "active-desktop"} className="absolute inset-0 rounded-xl bg-primary/10" transition={{ type: "spring", stiffness: 370, damping: 30 }} /> }<Icon className="relative h-[18px] w-[18px]" /><span className="relative">{item.label}</span>
    </Link>; })}</nav></div>
    <div className="mt-auto space-y-1 border-t pt-4"><Link href={profilePathForRole(role)} onClick={close} className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Settings2 className="h-[18px] w-[18px]" />تنظیمات حساب</Link>
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-muted/55 p-2"><Avatar name={user.fullName} size="sm"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{user.fullName}</p><p className="truncate text-[11px] text-muted-foreground">{user.schoolName || roleLabel[role]}</p></div><Button variant="ghost" size="icon-sm" aria-label="خروج" onClick={leave}><LogOut className="h-4 w-4" /></Button></div>
    </div>
  </aside>;
}
