"use client";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { RoleGuard } from "@/components/auth/role-guard";
import { useAuthStore } from "@/lib/state/auth-store";
import type { Role } from "@/lib/types/domain";

/**
 * The shell for a panel that more than one role may enter.
 *
 * The sidebar is drawn from the *visitor's own* role, not from the panel they are standing on: an
 * administrator who opens a teacher screen keeps the console's navigation (and can leave again), and a
 * school administrator gets their own, narrowed menu. Passing the panel's role here is what used to make
 * `/admin/*` a dead end for `school_admin`.
 */
export function AuthenticatedDashboardShell({ roles, children }: { roles: readonly Role[]; children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  return <RoleGuard roles={roles}>{user && <DashboardShell role={user.role} user={user}>{children}</DashboardShell>}</RoleGuard>;
}
