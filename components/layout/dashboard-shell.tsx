import type { Role, User } from "@/lib/types/domain";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
export function DashboardShell({ role, user, children }: { role: Role; user: User; children: React.ReactNode }) { return <div className="app-shell"><Sidebar role={role} user={user}/><div className="min-h-screen lg:pr-72"><Topbar role={role} user={user}/>{children}</div></div>; }
