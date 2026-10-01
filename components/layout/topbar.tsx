"use client";

import { ChevronDown, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/state/auth-store";
import type { Role, User } from "@/lib/types/domain";
import { Avatar } from "@/components/shared/avatar";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/layout/sidebar";
import { roleLabel } from "@/components/layout/navigation";
import { profilePathForRole } from "@/lib/auth/roles";

/**
 * The account menu, closed by every gesture a phone actually uses.
 *
 * The old version only toggled on the avatar: tapping anywhere else left it open, and on a narrow screen the
 * panel hung off the side of the viewport because it was positioned relative to the avatar. Both are fixed
 * here — outside-pointer and Escape close it, and below `sm` it is anchored to the viewport instead of to the
 * button, so it can never be half off-screen.
 */
function UserMenu({ role, user }: { role: Role; user: User }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);
  const profilePath = profilePathForRole(role);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div className="relative" ref={menuRef}>
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label="منوی حساب کاربری"
      className="mr-1 flex items-center gap-2 rounded-xl p-1.5 hover:bg-muted"
    >
      <div className="hidden text-right sm:block">
        <p className="max-w-36 truncate text-xs font-extrabold">{user.fullName}</p>
        <p className="max-w-36 truncate text-[10px] text-muted-foreground">{user.schoolName || roleLabel[role]}</p>
      </div>
      <Avatar name={user.fullName} size="sm"/>
      <ChevronDown className={open ? "h-3 w-3 rotate-180 text-muted-foreground transition-transform" : "h-3 w-3 text-muted-foreground transition-transform"}/>
    </button>
    {open && (
      <div
        role="menu"
        className="fixed inset-x-3 top-16 z-50 rounded-2xl border bg-card p-1.5 shadow-lift sm:absolute sm:inset-x-auto sm:left-0 sm:top-12 sm:w-44"
      >
        <button
          type="button"
          role="menuitem"
          className="w-full rounded-lg px-3 py-2.5 text-right text-xs font-bold hover:bg-muted"
          onClick={() => { setOpen(false); router.push(profilePath); }}
        >
          پروفایل و امنیت
        </button>
        <button
          type="button"
          role="menuitem"
          className="w-full rounded-lg px-3 py-2.5 text-right text-xs font-bold text-destructive hover:bg-destructive/10"
          onClick={() => { setOpen(false); void logout().finally(() => router.replace("/login")); }}
        >
          خروج
        </button>
      </div>
    )}
  </div>;
}

/**
 * The mobile drawer, with the three things a modal surface owes a touch user: Escape closes it, the page
 * behind it stops scrolling, and focus moves inside it so the first Tab lands in the menu instead of in the
 * header behind the overlay.
 */
function MobileDrawer({ open, onClose, role, user }: { open: boolean; onClose: () => void; role: Role; user: User }) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    // `overflow: hidden` on the body is what stops iOS from scrolling the page under the drawer.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      (panelRef.current?.querySelector<HTMLElement>("a, button") ?? panelRef.current)?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] lg:hidden" role="dialog" aria-modal="true" aria-label="منوی اصلی" onMouseDown={onClose}>
      <div ref={panelRef} tabIndex={-1} className="h-full outline-none" onMouseDown={(event) => event.stopPropagation()}>
        <Sidebar role={role} user={user} mobile close={onClose}/>
      </div>
    </div>
  );
}

export function Topbar({ role, user }: { role: Role; user: User }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return <>
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/85 px-3 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)} aria-label="باز کردن منو"><Menu className="h-5 w-5"/></Button>
      </div>
      <div className="hidden flex-1 lg:block"/>
      <div className="mr-auto flex items-center gap-1 sm:gap-1.5">
        <NotificationBell/>
        <ThemeToggle/>
        <UserMenu role={role} user={user}/>
      </div>
    </header>
    <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} role={role} user={user}/>
  </>;
}
