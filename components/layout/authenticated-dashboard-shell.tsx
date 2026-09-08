"use client";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { RoleGuard } from "@/components/auth/role-guard";
import { useAuthStore } from "@/lib/state/auth-store";
import type { Role } from "@/lib/types/domain";

export function AuthenticatedDashboardShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  return <RoleGuard role={role}>{user && <DashboardShell role={role} user={user}>{children}</DashboardShell>}</RoleGuard>;
}
