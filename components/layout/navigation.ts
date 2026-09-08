import type { Role } from "@/lib/types/domain";
import { BarChart3, BookOpenCheck, Building2, ClipboardList, FileText, GraduationCap, Home, LayoutDashboard, ListChecks, School, Settings2, Users, UserRoundCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
export interface NavItem { label: string; href: string; icon: LucideIcon; }
export const roleNavigation: Record<Role, NavItem[]> = {
  student: [
    { label: "نمای کلی", href: "/student/dashboard", icon: LayoutDashboard },
    { label: "آزمون‌های من", href: "/student/dashboard#exams", icon: ClipboardList },
    { label: "نتایج و عملکرد", href: "/student/dashboard#results", icon: BarChart3 },
  ],
  teacher: [
    { label: "نمای کلی", href: "/teacher/dashboard", icon: LayoutDashboard },
    { label: "آزمون‌ها", href: "/teacher/exams", icon: ClipboardList },
    { label: "بانک سؤال", href: "/teacher/questions", icon: ListChecks },
    { label: "نتایج", href: "/teacher/results", icon: BarChart3 },
    { label: "دانش‌آموزان", href: "/teacher/students", icon: GraduationCap },
  ],
  admin: [
    { label: "نمای کلی", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "کاربران", href: "/admin/users", icon: Users },
    { label: "مدارس", href: "/admin/schools", icon: School },
    { label: "آزمون‌ها", href: "/admin/exams", icon: FileText },
  ],
};
export const roleLabel: Record<Role, string> = { student: "دانش‌آموز", teacher: "آموزگار", admin: "مدیر سامانه" };
export const roleIcon: Record<Role, LucideIcon> = { student: BookOpenCheck, teacher: UserRoundCog, admin: Building2 };
export const supportNav: NavItem = { label: "تنظیمات", href: "#", icon: Settings2 };
export const homeNav: NavItem = { label: "خانه", href: "/", icon: Home };
