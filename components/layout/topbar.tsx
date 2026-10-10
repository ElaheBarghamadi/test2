"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Menu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
      <motion.div
        role="menu"
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
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
      </motion.div>
    )}
  </div>;
}

/**
 * The mobile drawer.
 *
 * A modal surface owes a touch user four things, and this one used to deliver two of them badly:
 *
 *  - **It closes when you tap outside.** The panel was wrapped in a full-width block element whose
 *    `stopPropagation` swallowed every tap on the page behind it, so the only ways out were Escape (a phone
 *    has no Escape) and the small X. The overlay and the panel are now siblings: the page behind the drawer is
 *    a real, tappable target again.
 *  - **It moves like a drawer.** It appears and disappears as a slide from the right edge with the page
 *    dimming behind it, rather than snapping into place, and a flick to the right sends it back. Users who ask
 *    their system for less motion get the same drawer with no travel at all.
 *  - **Escape closes it**, and the page behind cannot scroll while it is open (which is what stops iOS
 *    rubber-banding the list under the panel).
 *  - **Focus goes in, stays in, and comes back.** The first link is focused on open, Tab cycles inside the
 *    panel instead of wandering into the header behind it, and closing returns focus to the hamburger rather
 *    than dropping it at the top of the document.
 */
function MobileDrawer({ open, onClose, role, user, returnFocusTo }: { open: boolean; onClose: () => void; role: Role; user: User; returnFocusTo: React.RefObject<HTMLButtonElement | null> }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    // `overflow: hidden` on the body is what stops iOS from scrolling the page under the drawer.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      (panelRef.current?.querySelector<HTMLElement>("a, button") ?? panelRef.current)?.focus();
    }, reducedMotion ? 0 : 80);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      returnFocusTo.current?.focus();
    };
  }, [open, onClose, reducedMotion, returnFocusTo]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            data-testid="nav-drawer-backdrop"
            aria-hidden="true"
            className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="منوی اصلی"
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex w-[min(84vw,320px)] outline-none"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 430, damping: 38, mass: 0.9 }}
            // A flick to the right closes it, the way a phone drawer is expected to behave. `dragDirectionLock`
            // keeps a vertical swipe scrolling the menu instead of dragging it sideways.
            drag="x"
            dragDirectionLock
            dragElastic={{ left: 0, right: 0.4 }}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_event, info) => { if (info.offset.x > 90 || info.velocity.x > 600) onClose(); }}
          >
            <Sidebar role={role} user={user} mobile close={onClose}/>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Topbar({ role, user }: { role: Role; user: User }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Stable identities: the drawer's effect locks the page scroll and moves focus, and it must not re-run on
  // every render of the header (which would restart the focus timer and flicker the scroll lock).
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return <>
    <header className="dashboard-topbar sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/70 px-3 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 lg:hidden">
        <Button ref={triggerRef} variant="ghost" size="icon" onClick={openDrawer} aria-label="باز کردن منو" aria-expanded={drawerOpen} aria-haspopup="dialog"><Menu className="h-5 w-5"/></Button>
        <span className="rounded-full border border-border/70 bg-card/75 px-2.5 py-1 text-[10px] font-extrabold text-muted-foreground">{roleLabel[role]}</span>
      </div>
      <div className="hidden flex-1 lg:block"/>
      <div className="mr-auto flex items-center gap-1 sm:gap-1.5">
        <NotificationBell/>
        <ThemeToggle/>
        <UserMenu role={role} user={user}/>
      </div>
    </header>
    <MobileDrawer open={drawerOpen} onClose={closeDrawer} role={role} user={user} returnFocusTo={triggerRef}/>
  </>;
}
