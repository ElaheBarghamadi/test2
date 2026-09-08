"use client";

import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Dialog({ open, onClose, title, description, children, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; size?: "sm" | "md" }) {
  const titleId = useId(); const descriptionId = useId(); const panelRef = useRef<HTMLDivElement>(null); const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    window.setTimeout(() => (panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable()?.[0])?.focus(), 0);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const nodes = Array.from(focusable() ?? []); if (!nodes.length) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [open, onClose]);
  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[90] grid place-items-center p-4" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><button aria-label="بستن پنجره" className="absolute inset-0 cursor-default bg-slate-950/35 backdrop-blur-[2px]" onClick={onClose}/><motion.div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} initial={reduced ? false : { opacity: 0, y: 10, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .99 }} transition={{ duration: .18 }} className={`relative w-full rounded-3xl border bg-card p-5 shadow-lift sm:p-6 ${size === "sm" ? "max-w-md" : "max-w-lg"}`}><div className="flex items-start justify-between gap-4"><div><h2 id={titleId} className="text-lg font-black">{title}</h2>{description && <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>}</div><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="بستن"><X className="h-4 w-4"/></Button></div><div className="mt-5">{children}</div></motion.div></motion.div>}</AnimatePresence>;
}
