import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell";
/** Teachers author here; administrators may look, because the API accepts both roles on these surfaces. */
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <AuthenticatedDashboardShell roles={["teacher", "admin"]}>{children}</AuthenticatedDashboardShell>;
}
