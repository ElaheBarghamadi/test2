"use client";

import { usePathname } from "next/navigation";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { useAuthStore } from "@/lib/state/auth-store";

export function StudentRouteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isFocusedExamFlow = pathname.startsWith("/student/exam/") || pathname.startsWith("/student/results/");
  return <RoleGuard role="student">{isFocusedExamFlow ? children : user && <DashboardShell role="student" user={user}>{children}</DashboardShell>}</RoleGuard>;
}
