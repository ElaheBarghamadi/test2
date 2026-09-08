import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell";
export default function AdminLayout({ children }: { children: React.ReactNode }) { return <AuthenticatedDashboardShell role="admin">{children}</AuthenticatedDashboardShell>; }
