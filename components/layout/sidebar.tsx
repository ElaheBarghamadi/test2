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
import { roleIcon, roleLabel, roleNavigation } from "@/components/layout/navigation";
import { dashboardForRole, profilePathForRole } from "@/lib/auth/roles";
import { useAuthStore } from "@/lib/state/auth-store";

export function Sidebar({
  role,
  user,
  mobile = false,
  close,
}: {
  role: Role;
  user: User;
  mobile?: boolean;
  close?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);
  const nav = roleNavigation[role];
  const RoleIcon = roleIcon[role];
  const leave = () => {
    close?.();
    void logout().finally(() => router.replace("/login"));
  };

  return (
    <aside
      className={cn(
        "app-sidebar flex h-full flex-col",
        mobile
          ? "w-[min(84vw,320px)] rounded-l-3xl p-4 shadow-lift"
          : "fixed inset-y-0 right-0 z-30 hidden w-72 border-l border-border/80 p-5 lg:flex",
      )}
    >
      <div className="flex items-center justify-between px-1">
        <Logo />
        {mobile && (
          <Button variant="ghost" size="icon" onClick={close} aria-label="بستن منو">
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <div className="mt-8 rounded-[1.35rem] border border-primary/10 bg-gradient-to-bl from-primary/[.10] via-card to-teal-500/[.05] p-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-card text-primary shadow-sm ring-1 ring-primary/10">
            <RoleIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-muted-foreground">فضای اختصاصی</p>
            <p className="mt-0.5 truncate text-sm font-black">{roleLabel[role]}</p>
          </div>
        </div>
      </div>

      <nav className="mt-5 space-y-1" aria-label="ناوبری اصلی">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== dashboardForRole(role) && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-11 items-center gap-3 overflow-hidden rounded-xl px-3 text-sm font-bold transition-all duration-200",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId={mobile ? "active-mobile" : "active-desktop"}
                  className="pointer-events-none absolute inset-0 rounded-xl bg-primary/[.09]"
                  transition={{ type: "spring", stiffness: 370, damping: 30 }}
                />
              )}
              {active && <span className="absolute inset-y-2 right-0 w-[3px] rounded-full bg-primary" aria-hidden="true" />}
              <Icon className={cn("relative h-[18px] w-[18px] shrink-0 transition-transform duration-200", !active && "group-hover:-translate-x-0.5")} aria-hidden="true" />
              <span className="relative truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-border/75 pt-4">
        <Link
          href={profilePathForRole(role)}
          onClick={close}
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings2 className="h-[18px] w-[18px]" aria-hidden="true" />
          تنظیمات حساب
        </Link>
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-background/75 p-2 shadow-sm">
          <Avatar name={user.fullName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-extrabold">{user.fullName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user.schoolName || roleLabel[role]}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="خروج" onClick={leave}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
