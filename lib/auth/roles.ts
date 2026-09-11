import type { Role } from "@/lib/types/domain";

/**
 * Which panel a role lives in.
 *
 * `school_admin` shares the `/admin/*` console with the platform administrator on purpose. Everything the
 * principal needs — the roster, the papers, the monitoring tables — is the same surface with the data
 * narrowed to one school, and the API does that narrowing (`apps/organizations/scope.py`). A second copy of
 * those pages would be a second place where the scoping rule has to be remembered, and places like that are
 * where a school ends up seeing another school's rows.
 *
 * What the two roles *do not* share is authoring: the console hides creating a school and granting
 * administrator roles, and every one of those refusals is also enforced server-side.
 */
export const rolePanel: Record<Role, "student" | "teacher" | "admin"> = {
  student: "student",
  teacher: "teacher",
  admin: "admin",
  school_admin: "admin",
};

/** Whether this account governs the whole platform rather than one school. */
export const isPlatformAdministrator = (role: Role | null | undefined): role is "admin" => role === "admin";

export function panelPath(role: Role, ...segments: string[]): string {
  const base = `/${rolePanel[role]}`;
  return segments.length ? `${base}/${segments.join("/")}` : base;
}

export const dashboardForRole = (role: Role): string => panelPath(role, "dashboard");
export const profilePathForRole = (role: Role): string => panelPath(role, "profile");
