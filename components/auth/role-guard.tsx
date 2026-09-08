"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dashboardForRole, useAuthStore } from "@/lib/state/auth-store";
import type { Role } from "@/lib/types/domain";

function LoadingScreen() {
  return <main className="grid min-h-screen place-items-center bg-background"><div className="flex items-center gap-3 text-sm font-bold text-muted-foreground"><span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"/>در حال بررسی دسترسی…</div></main>;
}

export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "checking") return;
    if (!user) { router.replace(`/login?next=${encodeURIComponent(pathname)}`); return; }
    if (user.role !== role) router.replace(dashboardForRole(user.role));
  }, [pathname, role, router, status, user]);

  if (status === "checking" || !user || user.role !== role) return <LoadingScreen />;
  return <>{children}</>;
}
