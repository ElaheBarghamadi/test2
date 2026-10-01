import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell";
/** The console is shared: the platform administrator sees the network, the school administrator one school. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthenticatedDashboardShell roles={["admin", "school_admin"]}>{children}</AuthenticatedDashboardShell>;
}
