import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RoleGuard } from "@/components/auth/role-guard";
import { useAuthStore } from "@/lib/state/auth-store";
import type { Role, User } from "@/lib/types/domain";

/**
 * The guard's job is to agree with `lib/auth/page-access.ts`, which is the policy the server-side gate
 * enforces. The two panels that carry more than one role are the ones worth pinning: `/admin/*` is shared
 * by both administrators, and `/teacher/*` is open to the platform administrator as well as the teacher.
 */
const replace = vi.fn();
let pathname = "/admin/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}));

const user = (role: Role): User => ({ id: `u-${role}`, fullName: "کاربر آزمون", email: `${role}@example.ir`, role });

function signIn(role: Role | null) {
  useAuthStore.setState({ user: role ? user(role) : null, status: role ? "authenticated" : "anonymous" });
}

beforeEach(() => {
  replace.mockReset();
  pathname = "/admin/dashboard";
  useAuthStore.setState({ user: null, status: "checking" });
});

describe("RoleGuard", () => {
  it("lets a school administrator stand on the console it shares with the platform administrator", async () => {
    signIn("school_admin");
    render(<RoleGuard roles={["admin", "school_admin"]}><p>کنسول مدیر مدرسه</p></RoleGuard>);
    expect(await screen.findByText("کنسول مدیر مدرسه")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("lets a platform administrator open a teacher screen and keeps them out of a redirect loop", async () => {
    pathname = "/teacher/exams";
    signIn("admin");
    render(<RoleGuard roles={["teacher", "admin"]}><p>آزمون‌های آموزگار</p></RoleGuard>);
    expect(await screen.findByText("آزمون‌های آموزگار")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the school administrator out of the teacher panel, where the API would refuse them", async () => {
    pathname = "/teacher/exams";
    signIn("school_admin");
    render(<RoleGuard roles={["teacher", "admin"]}><p>آزمون‌های آموزگار</p></RoleGuard>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/dashboard"));
    expect(screen.queryByText("آزمون‌های آموزگار")).toBeNull();
  });

  it("still moves a role that has no business on this path to its own dashboard", async () => {
    pathname = "/admin/users";
    signIn("teacher");
    render(<RoleGuard roles={["admin", "school_admin"]}><p>کاربران</p></RoleGuard>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/teacher/dashboard"));
  });

  it("sends an anonymous visitor to the login screen with the path remembered", async () => {
    pathname = "/student/exam/e1";
    signIn(null);
    render(<RoleGuard roles={["student"]}><p>برگهٔ آزمون</p></RoleGuard>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fstudent%2Fexam%2Fe1"));
  });
});
