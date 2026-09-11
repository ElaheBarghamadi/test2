import { describe, expect, it } from "vitest";
import { dashboardForRole, isPlatformAdministrator, panelPath, profilePathForRole, rolePanel } from "@/lib/auth/roles";

/**
 * The one table that says where a role's screens live.
 *
 * `/school_admin/…` URLs do not exist, and the pages that build links from the role (`/${role}/profile` in
 * the sidebar, `/${role}/dashboard` after a login) would otherwise send a school administrator to a 404 of
 * their own making. `rolePanel` is the single answer both the gate and the interface read.
 */
describe("role panels", () => {
  it("maps every role to a panel that has pages behind it", () => {
    expect(Object.keys(rolePanel).sort()).toEqual(["admin", "school_admin", "student", "teacher"]);
    expect(rolePanel.school_admin).toBe("admin");
  });

  it("builds the paths the shell links to", () => {
    expect(dashboardForRole("school_admin")).toBe("/admin/dashboard");
    expect(profilePathForRole("school_admin")).toBe("/admin/profile");
    expect(dashboardForRole("teacher")).toBe("/teacher/dashboard");
    expect(panelPath("student")).toBe("/student");
    expect(panelPath("teacher", "exams", "exam-1")).toBe("/teacher/exams/exam-1");
  });

  it("keeps the platform-only distinction explicit", () => {
    expect(isPlatformAdministrator("admin")).toBe(true);
    expect(isPlatformAdministrator("school_admin")).toBe(false);
    expect(isPlatformAdministrator(undefined)).toBe(false);
  });
});
