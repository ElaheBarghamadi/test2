"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToastStore } from "@/lib/state/toast-store";

export function Toaster() {
  const { toasts, remove } = useToastStore();
  const icons = { default: Info, success: CheckCircle2, error: CircleAlert };
  return <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:right-6 sm:left-auto sm:w-96">
    <AnimatePresence initial={false}>{toasts.map((toast) => { const Icon = icons[toast.variant ?? "default"]; return <motion.div key={toast.id} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} className="pointer-events-auto flex w-full items-start gap-3 rounded-2xl border bg-card p-3 shadow-lift">
      <div className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="text-sm font-extrabold">{toast.title}</p>{toast.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{toast.description}</p>}</div><Button variant="ghost" size="icon-sm" aria-label="بستن پیام" onClick={() => remove(toast.id)}><X className="h-4 w-4" /></Button>
    </motion.div>; })}</AnimatePresence>
  </div>;
}
