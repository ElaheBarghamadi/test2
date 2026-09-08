import { AuthenticatedDashboardShell } from "@/components/layout/authenticated-dashboard-shell";
export default function TeacherLayout({ children }: { children: React.ReactNode }) { return <AuthenticatedDashboardShell role="teacher">{children}</AuthenticatedDashboardShell>; }
