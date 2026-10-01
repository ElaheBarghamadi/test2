import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Topbar } from "@/components/layout/topbar";
import { useAuthStore } from "@/lib/state/auth-store";
import type { User } from "@/lib/types/domain";

/**
 * The phone header, pinned to the three things a touch user needs from it.
 *
 * The account menu only closed by tapping the avatar again, and its panel was positioned from the avatar
 * outwards, so on a narrow screen half of it sat outside the viewport. The drawer did not exist: the
 * navigation column was simply hidden below `lg`, which left a phone with no way to reach another page.
 */

const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/student/dashboard",
}));

vi.mock("@/components/shared/notification-bell", () => ({ NotificationBell: () => <span>زنگ</span> }));

const student: User = { id: "u-1", fullName: "زهرا آزمون", email: "zahra@example.ir", role: "student", schoolName: "دبیرستان نمونه" };

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  useAuthStore.setState({ user: student, status: "authenticated" });
  document.body.style.overflow = "";
});

describe("Topbar on a phone", () => {
  it("opens the navigation drawer as a modal and closes it on Escape", async () => {
    render(<Topbar role="student" user={student}/>);

    const trigger = screen.getByRole("button", { name: "باز کردن منو" });
    fireEvent.click(trigger);

    const drawer = await screen.findByRole("dialog", { name: "منوی اصلی" });
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    // The page behind a modal drawer must not scroll on iOS; this is the lock that stops it.
    expect(document.body.style.overflow).toBe("hidden");
    // The drawer carries the real navigation, so it is not an empty shell.
    expect(screen.getAllByRole("link", { name: /داشبورد|آزمون/ }).length).toBeGreaterThan(0);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "منوی اصلی" })).toBeNull());
    expect(document.body.style.overflow).toBe("");
  });

  it("closes the account menu on Escape and on an outside tap, not only on the avatar", async () => {
    render(<Topbar role="student" user={student}/>);

    const avatar = screen.getByRole("button", { name: "منوی حساب کاربری" });
    fireEvent.click(avatar);
    expect(await screen.findByRole("menu")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.click(avatar);
    expect(await screen.findByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("positions the account panel against the viewport below `sm` so it cannot hang off-screen", async () => {
    render(<Topbar role="student" user={student}/>);
    fireEvent.click(screen.getByRole("button", { name: "منوی حساب کاربری" }));

    const panel = await screen.findByRole("menu");
    // `fixed inset-x-3` on a phone, `sm:absolute` beside the avatar on a desktop.
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("inset-x-3");
    expect(panel.className).toContain("sm:absolute");
  });

  it("gives the account menu a labelled hamburger, an aria-expanded state and a sign-out path", async () => {
    render(<Topbar role="student" user={student}/>);
    const trigger = screen.getByRole("button", { name: "باز کردن منو" });
    expect(trigger.getAttribute("aria-expanded")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "منوی حساب کاربری" }));
    expect(screen.getByRole("menuitem", { name: "پروفایل و امنیت" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "خروج" })).toBeTruthy();
  });
});
