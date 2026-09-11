import { describe, expect, it } from "vitest";
import {
  ACCESS_RULES,
  decideAccess,
  dashboardFor,
  isRole,
  loginTarget,
  ruleFor,
  safeNextPath,
} from "@/lib/auth/page-access";

describe("ruleFor", () => {
  it("covers a whole subtree, not just the index page", () => {
    expect(ruleFor("/student")?.allow).toEqual(["student"]);
    expect(ruleFor("/student/exam/exam-1/review")?.allow).toEqual(["student"]);
    expect(ruleFor("/admin/users")?.allow).toEqual(["admin", "school_admin"]);
  });

  it("does not let a prefix match a look-alike route", () => {
    // "/students-are-cool" is not the student panel; matching it would bounce a public page.
    expect(ruleFor("/students-are-cool")).toBeNull();
    expect(ruleFor("/teacher-of-the-year")).toBeNull();
    expect(ruleFor("/")).toBeNull();
    expect(ruleFor("/login")).toBeNull();
  });

  it("lists the teacher panel for teachers and administrators, and the admin panel for nobody else", () => {
    expect(ACCESS_RULES.find((rule) => rule.prefix === "/teacher")?.allow).toEqual(["teacher", "admin"]);
    // The school administrator shares the admin console — one school of it — and is not admitted to the
    // teacher panel, because authoring a paper is not their job.
    expect(ACCESS_RULES.find((rule) => rule.prefix === "/admin")?.allow).toEqual(["admin", "school_admin"]);
  });
});

describe("safeNextPath", () => {
  it("keeps an in-app path with its query and fragment", () => {
    expect(safeNextPath("/teacher/exams?tab=published")).toBe("/teacher/exams?tab=published");
    expect(safeNextPath("/student/dashboard#top")).toBe("/student/dashboard#top");
  });

  it("refuses the shapes that turn `?next=` into an open redirect", () => {
    expect(safeNextPath("//evil.test/path")).toBeNull();
    expect(safeNextPath("/\\evil.test")).toBeNull();
    expect(safeNextPath("https://evil.test/teacher")).toBeNull();
    expect(safeNextPath("teacher/exams")).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it("treats the site root as no destination at all", () => {
    expect(safeNextPath("/")).toBeNull();
    // A root with a query is not the root; dropping it would silently change where the visitor lands.
    expect(safeNextPath("/?lang=fa")).toBe("/?lang=fa");
  });
});

describe("loginTarget", () => {
  it("remembers a protected path, encoded so the query survives", () => {
    expect(loginTarget("/admin/users?status=active")).toBe("/login?next=%2Fadmin%2Fusers%3Fstatus%3Dactive");
  });

  it("sends a public or root path to a bare login screen", () => {
    expect(loginTarget("/")).toBe("/login");
    expect(loginTarget("//evil.test")).toBe("/login");
  });
});

describe("isRole and dashboardFor", () => {
  it("only accepts the roles the API can hand out", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("school_admin")).toBe(true);
    expect(isRole("school admin")).toBe(false);
    expect(isRole("ADMIN")).toBe(false);
    expect(isRole("root")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("sends each role to its own dashboard", () => {
    expect(dashboardFor("teacher")).toBe("/teacher/dashboard");
    expect(dashboardFor("admin")).toBe("/admin/dashboard");
    expect(dashboardFor("student")).toBe("/student/dashboard");
    // A school administrator has no panel of their own: the console they share with the platform admin.
    expect(dashboardFor("school_admin")).toBe("/admin/dashboard");
  });
});

describe("decideAccess", () => {
  it("leaves everything outside the guarded subtrees alone", () => {
    expect(decideAccess("/", { kind: "anonymous" })).toEqual({ action: "render" });
    expect(decideAccess("/login", { kind: "invalid" })).toEqual({ action: "render" });
  });

  it("asks an anonymous visitor to sign in, and remembers where they were going", () => {
    expect(decideAccess("/teacher/exams", { kind: "anonymous" })).toEqual({
      action: "login",
      to: "/login?next=%2Fteacher%2Fexams",
    });
  });

  it("clears a session Django has refused, instead of bouncing on it forever", () => {
    expect(decideAccess("/admin/users", { kind: "invalid" })).toEqual({
      action: "logout",
      to: "/login?next=%2Fadmin%2Fusers",
    });
  });

  it("renders a panel for the roles it belongs to", () => {
    expect(decideAccess("/student/exam/e1", { kind: "verified", role: "student" })).toEqual({ action: "render" });
    expect(decideAccess("/teacher/exams", { kind: "verified", role: "teacher" })).toEqual({ action: "render" });
    // An administrator may open a teacher screen: the API accepts both roles there.
    expect(decideAccess("/teacher/exams", { kind: "verified", role: "admin" })).toEqual({ action: "render" });
    expect(decideAccess("/admin/users", { kind: "verified", role: "admin" })).toEqual({ action: "render" });
    expect(decideAccess("/admin/users", { kind: "verified", role: "school_admin" })).toEqual({ action: "render" });
    expect(decideAccess("/admin/schools", { kind: "verified", role: "school_admin" })).toEqual({ action: "render" });
    // …but not the teacher surfaces: the API would answer 403 and the school admin has no business there.
    expect(decideAccess("/teacher/exams", { kind: "verified", role: "school_admin" })).toEqual({
      action: "foreign-role",
      to: "/admin/dashboard",
    });
    expect(decideAccess("/student/dashboard", { kind: "verified", role: "school_admin" })).toEqual({
      action: "foreign-role",
      to: "/admin/dashboard",
    });
  });

  it("moves a signed-in stranger to their own panel without logging them out", () => {
    expect(decideAccess("/admin/users", { kind: "verified", role: "teacher" })).toEqual({
      action: "foreign-role",
      to: "/teacher/dashboard",
    });
    expect(decideAccess("/student/exam/e1", { kind: "verified", role: "teacher" })).toEqual({
      action: "foreign-role",
      to: "/teacher/dashboard",
    });
    // The teacher panel is where a teacher (or an admin) lands; a student may not see it at all.
    expect(decideAccess("/teacher/exams", { kind: "verified", role: "student" })).toEqual({
      action: "foreign-role",
      to: "/student/dashboard",
    });
  });

  it("renders the shell when a session exists but its role cannot be read", () => {
    // The fallback is deliberate: an unreachable API must not lock a school out of its own screens, and the
    // data behind the shell is still refused by Django. Documented as the failure stance in architecture.md.
    expect(decideAccess("/teacher/exams", { kind: "verified", role: null })).toEqual({ action: "render" });
    expect(decideAccess("/admin/users", { kind: "unreachable", role: null })).toEqual({ action: "render" });
  });

  it("still applies the rule when only a hint is available", () => {
    expect(decideAccess("/admin/users", { kind: "unreachable", role: "teacher" })).toEqual({
      action: "foreign-role",
      to: "/teacher/dashboard",
    });
    expect(decideAccess("/teacher/exams", { kind: "unreachable", role: "teacher" })).toEqual({ action: "render" });
  });
});
