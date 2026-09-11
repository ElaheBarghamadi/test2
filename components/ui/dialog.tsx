"use client";

import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, description, children, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; size?: "sm" | "md" | "lg" }) {
  const titleId = useId(); const descriptionId = useId(); const panelRef = useRef<HTMLDivElement>(null); const reduced = useReducedMotion();
  // Callers pass freshly created arrow functions as onClose, so its identity changes on every
  // render (i.e. on every keystroke). Reading it through a ref keeps the listeners below attached
  // once per open/close cycle instead of being re-subscribed, which previously replayed the
  // autofocus timer and snapped the caret back to the first field of the dialog.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    const previousFocus = document.activeElement as HTMLElement | null;
    let focusTimer: number | undefined;
    if (!panelRef.current?.contains(previousFocus)) {
      // Move focus into the dialog only on open, and never while a field inside it already has focus.
      focusTimer = window.setTimeout(() => {
        if (panelRef.current?.contains(document.activeElement)) return;
        (panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()[0])?.focus();
      }, 0);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = focusable(); if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      // Runs only on a real open -> closed transition (or unmount), so focus returns to its trigger.
      previousFocus?.focus();
    };
  }, [open]);
  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[90] grid place-items-center p-4" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><button aria-label="بستن پنجره" className="absolute inset-0 cursor-default bg-slate-950/35 backdrop-blur-[2px]" onClick={() => closeRef.current()}/><motion.div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} initial={reduced ? false : { opacity: 0, y: 10, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .99 }} transition={{ duration: .18 }} className={`relative max-h-[88vh] w-full overflow-y-auto rounded-3xl border bg-card p-5 shadow-lift sm:p-6 ${size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-lg"}`}><div className="flex items-start justify-between gap-4"><div><h2 id={titleId} className="text-lg font-black">{title}</h2>{description && <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}</div><Button variant="ghost" size="icon-sm" onClick={() => closeRef.current()} aria-label="بستن"><X className="h-4 w-4"/></Button></div><div className="mt-5">{children}</div></motion.div></motion.div>}</AnimatePresence>;
}
