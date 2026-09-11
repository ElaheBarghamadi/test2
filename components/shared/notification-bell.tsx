"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/lib/state/notification-store";
import { useAuthStore } from "@/lib/state/auth-store";
import { cn, formatDateTime, toPersianNumber } from "@/lib/utils";
import type { NotificationItem } from "@/lib/types/domain";

const POLL_INTERVAL_MS = 60_000;

const copyForKind: Record<string, string> = {
  exam_published: "آزمون منتشر شد",
  exam_started: "آزمون آغاز شد",
  exam_ended: "آزمون پایان یافت",
  grading_required: "نیازمند تصحیح",
  grading_completed: "تصحیح کامل شد",
  result_published: "نتیجه منتشر شد",
};

/**
 * In-app notification bell.
 *
 * Reads on mount, on tab focus and once a minute while the tab is visible — no push channel, which is the
 * honest design at this scale. Rows that link to a route are links; every row can be dismissed as read, and
 * unread state is applied optimistically then rolled back if the server refused.
 */
export function NotificationBell({ className }: { className?: string }) {
  const authenticated = useAuthStore((state) => Boolean(state.user));
  const { items, unreadCount, loading, open, setOpen, refresh, markRead, markAllRead } = useNotifications();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authenticated, refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  if (!authenticated) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open) void refresh(); }}
        aria-expanded={open}
        aria-label={unreadCount ? `اعلان‌ها، ${toPersianNumber(unreadCount)} خوانده‌نشده` : "اعلان‌ها"}
        className={cn("relative grid h-10 w-10 place-items-center rounded-xl border bg-card text-muted-foreground transition-colors hover:text-foreground", className)}
      >
        <Bell className="h-4 w-4"/>
        {unreadCount > 0 && <span className="absolute -left-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-black text-primary-foreground" aria-hidden>{toPersianNumber(unreadCount > 99 ? "۹۹+" : unreadCount)}</span>}
      </button>
      {open && <div className="absolute left-0 top-12 z-50 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border bg-card shadow-lift">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <p className="text-sm font-black">اعلان‌ها</p>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && <Button size="sm" variant="ghost" onClick={() => void markAllRead()}><CheckCheck className="h-3.5 w-3.5"/>خواندن همه</Button>}
            <Button size="icon-sm" variant="ghost" onClick={close} aria-label="بستن اعلان‌ها"><X className="h-4 w-4"/></Button>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!items.length ? <p className="p-5 text-center text-xs leading-6 text-muted-foreground">{loading ? "در حال دریافت…" : "هنوز اعلانی برای شما ثبت نشده است."}</p> : items.map((item) => <NotificationRow key={item.id} item={item} onRead={() => void markRead(item.id)} onClose={close}/>)}
        </div>
      </div>}
    </div>
  );
}

function NotificationRow({ item, onRead, onClose }: { item: NotificationItem; onRead: () => void; onClose: () => void }) {
  const body = <>
    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.isRead ? "bg-muted" : "bg-primary")}/>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2"><span className="truncate text-xs font-black">{item.title}</span><Badge variant="neutral">{copyForKind[item.kind] ?? "اطلاع‌رسانی"}</Badge></span>
      {item.body && <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{item.body}</span>}
      <span className="mt-1 block text-[10px] text-muted-foreground">{formatDateTime(item.createdAt)}</span>
    </span>
  </>;
  if (!item.link) {
    // Nothing to navigate to: reading the row is the whole action.
    return <button type="button" onClick={onRead} className="flex w-full gap-2 border-b p-3 text-left transition-colors last:border-0 hover:bg-muted/40">{body}</button>;
  }
  return <Link href={item.link} onClick={() => { if (!item.isRead) onRead(); onClose(); }} className="flex gap-2 border-b p-3 text-left transition-colors last:border-0 hover:bg-muted/50">{body}</Link>;
}
