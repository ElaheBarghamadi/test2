"use client";

import { ChevronDown, Menu } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/state/auth-store";
import type { Role, User } from "@/lib/types/domain";
import { Avatar } from "@/components/shared/avatar";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NotificationBell } from "@/components/shared/notification-bell";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/layout/sidebar";

export function Topbar({ role, user }: { role: Role; user: User }) {
 const [open, setOpen] = useState(false); const [menu, setMenu] = useState(false); const logout = useAuthStore((state) => state.logout); const router = useRouter();
 return <><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
   <div className="flex items-center gap-2 lg:hidden"><Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="باز کردن منو"><Menu className="h-5 w-5" /></Button></div>
   <div className="hidden flex-1 lg:block"/>
   <div className="mr-auto flex items-center gap-1.5"><NotificationBell/><ThemeToggle/><div className="relative"><button onClick={() => setMenu(!menu)} aria-expanded={menu} className="mr-1 flex items-center gap-2 rounded-xl p-1.5 hover:bg-muted"><div className="hidden text-right sm:block"><p className="max-w-36 truncate text-xs font-extrabold">{user.fullName}</p><p className="max-w-36 truncate text-[10px] text-muted-foreground">{user.schoolName || (role === "student" ? "دانش‌آموز" : role === "teacher" ? "آموزگار" : "مدیر")}</p></div><Avatar name={user.fullName} size="sm"/><ChevronDown className="h-3 w-3 text-muted-foreground"/></button>{menu && <div className="absolute left-0 top-12 w-44 rounded-xl border bg-card p-1.5 shadow-lift"><button className="w-full rounded-lg px-3 py-2 text-right text-xs font-bold hover:bg-muted" onClick={() => { setMenu(false); router.push(`/${role}/profile`); }}>پروفایل و امنیت</button><button className="w-full rounded-lg px-3 py-2 text-right text-xs font-bold hover:bg-muted" onClick={() => { setMenu(false); void logout().finally(() => router.replace("/login")); }}>خروج</button></div>}</div></div>
 </header>{open && <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px] lg:hidden" onMouseDown={() => setOpen(false)}><div onMouseDown={(event) => event.stopPropagation()} className="h-full"><Sidebar role={role} user={user} mobile close={() => setOpen(false)} /></div></div>}</>;
}
