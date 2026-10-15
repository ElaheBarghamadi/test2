"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one modal in the app: question composer, exam submission, grading, school and user editors.
 *
 * Three things here are structural rather than cosmetic, and each one was a real complaint:
 *
 * **It renders through a portal into `document.body`.** Every page wraps its content in `PageTransition`, a
 * `motion.main` that animates `y` and also carries a `.page-enter` keyframe. Any non-`none` transform,
 * filter or `backdrop-filter` on an ancestor makes it the containing block for `position: fixed`
 * descendants — so a dialog declared inside a page was centred on *that* box, not the viewport, and drifted
 * or clipped once the page was scrolled. Portalling out removes the whole class of bug instead of chasing
 * whichever ancestor happens to be transformed today.
 *
 * **The page underneath cannot scroll.** `overflow: hidden` goes on `<html>` for as long as the dialog is
 * open, with the scrollbar's own width added back as padding so the layout does not jump sideways when the
 * scrollbar disappears. The panel is the only scrollable thing, and `overscroll-contain` stops a scroll that
 * reaches its end from chaining into the page behind — which is what made it feel like both were moving.
 *
 * **The backdrop actually dims.** See `.dialog-overlay` in `globals.css`: a theme-aware wash plus a blur, so
 * what is behind reads as inactive rather than as a second copy of the page.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /**
   * Pinned below the scrolling body. Long forms — the question composer above all — used to put their own
   * action row at the end of the content, so on a short screen the only way to reach «افزودن سؤال» was to
   * scroll past everything you were still editing.
   */
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  /**
   * Portals need `document`, which does not exist during SSR — and returning different trees on the server
   * and the first client render is a hydration mismatch. So the dialog mounts one effect later. It is always
   * closed at first paint anyway, since nothing here opens a modal without a click.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Callers pass freshly created arrow functions as onClose, so its identity changes on every
  // render (i.e. on every keystroke). Reading it through a ref keeps the listeners below attached
  // once per open/close cycle instead of being re-subscribed, which previously replayed the
  // autofocus timer and snapped the caret back to the first field of the dialog.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // Scroll lock. On `<html>`, not `<body>`: that is the element that actually scrolls in this layout.
  useEffect(() => {
    if (!open || !mounted) return;
    const root = document.documentElement;
    const body = document.body;
    const scrollbar = window.innerWidth - root.clientWidth;
    const previous = { rootOverflow: root.style.overflow, bodyPadding: body.style.paddingRight };
    root.style.overflow = "hidden";
    // Only when a classic scrollbar was taking up room; overlay scrollbars (macOS, mobile) have none, and
    // adding padding there would shift the page sideways for nothing.
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      root.style.overflow = previous.rootOverflow;
      body.style.paddingRight = previous.bodyPadding;
    };
  }, [open, mounted]);

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

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          // `touch-action: none` on the sheet means a touch that starts outside the panel cannot scroll
          // anything; the panel itself re-enables it for its own content.
          className="dialog-sheet fixed inset-0 z-[90] grid place-items-center p-4 sm:p-6"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="بستن پنجره"
            tabIndex={-1}
            className="dialog-overlay absolute inset-0 cursor-default"
            onClick={() => closeRef.current()}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            initial={reduced ? false : { opacity: 0, y: 12, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: .99 }}
            transition={{ duration: .18 }}
            className={`dialog-panel relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-3xl border bg-card shadow-lift ${size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-lg"}`}
          >
            {/* Header and footer stay put; only the body scrolls, so a long form never hides its own title
                or its way out. `min-h-0` is what lets a flex child shrink below its content and scroll. */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-black leading-8">{title}</h2>
                {description && <p id={descriptionId} className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>}
              </div>
              <Button variant="ghost" size="icon-sm" className="h-9 w-9 shrink-0" onClick={() => closeRef.current()} aria-label="بستن">
                <X className="h-4 w-4"/>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
            {footer && <div className="shrink-0 border-t bg-muted/30 px-5 py-3.5 sm:px-6">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
