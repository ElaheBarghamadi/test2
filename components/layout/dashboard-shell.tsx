import type { Role, User } from "@/lib/types/domain";
import { NavigationProgress } from "@/components/shared/navigation-progress";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export function DashboardShell({
  role,
  user,
  children,
}: {
  role: Role;
  user: User;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell min-h-dvh">
      {/* Mounted once for the whole panel: every navigation inside it, link or programmatic, gets the bar. */}
      <NavigationProgress />
      <Sidebar role={role} user={user} />
      <div className="min-h-dvh min-w-0 lg:pr-72">
        <Topbar role={role} user={user} />
        <div className="min-h-[calc(100dvh-4rem)]">{children}</div>
      </div>
    </div>
  );
}
