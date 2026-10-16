import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The end of the recovery path — the one screen where a mistake is unrecoverable by the person making it,
 * because the token in the link is single-use.
 *
 * Three things are pinned: an incomplete link is refused *before* a password is chosen, one tap spends the
 * token once, and a mismatch is caught locally rather than by a server that has already burned the token.
 */
const api = vi.hoisted(() => ({ confirmPasswordReset: vi.fn() }));
const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ value: "?uid=u1&token=abc123" }));

vi.mock("@/lib/api/auth", () => ({ authApi: api }));
vi.mock("@/lib/api/session-mirror", () => ({
  syncSessionMirror: vi.fn().mockResolvedValue(undefined),
  clearSessionMirror: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

import { ResetPasswordForm } from "@/components/forms/reset-password-form";
import { ApiError } from "@/lib/api/client";

beforeEach(() => {
  search.value = "?uid=u1&token=abc123";
  replace.mockReset();
  api.confirmPasswordReset.mockReset().mockResolvedValue({ detail: "ok" });
});

function fill(password = "کوهستان-2468-Ab!", confirmation = password) {
  fireEvent.change(screen.getByLabelText(/^گذرواژهٔ جدید$/), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/تکرار گذرواژهٔ جدید/), { target: { value: confirmation } });
}

describe("with a usable link", () => {
  it("resets the password and walks the visitor back to sign-in", async () => {
    render(<ResetPasswordForm/>);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /ثبت گذرواژهٔ جدید/ }));

    await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledWith("u1", "abc123", "کوهستان-2468-Ab!"));
    expect(await screen.findByText(/گذرواژه شما با موفقیت تغییر کرد/)).toBeTruthy();
    // The redirect is timed rather than immediate: a screen that navigates before its own message has been
    // read looks like it swallowed the confirmation.
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"), { timeout: 3000 });
  });

  it("spends the single-use token once, however impatient the tap", async () => {
    let release!: () => void;
    api.confirmPasswordReset.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));

    render(<ResetPasswordForm/>);
    fill();
    const submit = screen.getByRole("button", { name: /ثبت گذرواژهٔ جدید/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(api.confirmPasswordReset).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledTimes(1));
  });

  it("catches a mismatch locally, before the server has burned the token", async () => {
    render(<ResetPasswordForm/>);
    fill("کوهستان-2468-Ab!", "کوهستان-2468-Ab");
    fireEvent.click(screen.getByRole("button", { name: /ثبت گذرواژهٔ جدید/ }));

    expect(await screen.findByText("تکرار گذرواژه با گذرواژهٔ جدید یکسان نیست.")).toBeTruthy();
    expect(api.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it("passes the server's own reason through when the link has expired", async () => {
    api.confirmPasswordReset.mockRejectedValue(new ApiError(400, { detail: "پیوند منقضی شده است." }));
    render(<ResetPasswordForm/>);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /ثبت گذرواژهٔ جدید/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("پیوند منقضی شده است.");
  });

  it("advises on strength while typing, the same way sign-up does", () => {
    render(<ResetPasswordForm/>);
    fill("24681357", "24681357");
    // Eight digits: legal by length, refused by the server's all-numeric rule — the checklist has to say so.
    expect(screen.getByText("فقط از عدد تشکیل نشده باشد").closest("li")?.className).not.toContain("text-success");
    fireEvent.change(screen.getByLabelText(/^گذرواژهٔ جدید$/), { target: { value: "کوهستان-2468-Ab!" } });
    expect(screen.getByText("قوی")).toBeTruthy();
  });
});

describe("with an incomplete link", () => {
  it("says so and offers a way out instead of collecting a password it cannot save", () => {
    search.value = "?uid=u1";
    render(<ResetPasswordForm/>);

    expect(screen.getByText("این پیوند کامل نیست یا اعتبار ندارد")).toBeTruthy();
    expect(screen.getByRole("link", { name: "دریافت پیوند جدید" })).toBeTruthy();
    expect(screen.queryByLabelText(/^گذرواژهٔ جدید$/)).toBeNull();
  });

  it("treats a link with no parameters at all the same way", () => {
    search.value = "";
    render(<ResetPasswordForm/>);
    expect(screen.getByText("این پیوند کامل نیست یا اعتبار ندارد")).toBeTruthy();
  });
});

describe("the full-screen screen", () => {
  it("is full-bleed, keeps its heading with the form, and offers one way out above it", () => {
    render(<ResetPasswordForm/>);
    const panel = document.querySelector(".auth-panel") as HTMLElement;

    expect(panel.className).toContain("flex-1");
    expect(panel.className).toContain("min-h-0");
    // A card floating on a background is precisely what this must not be.
    for (const gone of ["mx-auto", "max-w-md", "rounded-[1.75rem]", "border", "shadow-lift"]) {
      expect(panel.className, `still has ${gone}`).not.toContain(gone);
    }
    /*
     * The indigo gradient band that used to act as a header is gone; the heading lives with the form
     * instead. The submit button wears `bg-gradient-to-l` too, so the selector has to name both classes.
     */
    expect(panel.querySelector(".bg-gradient-to-l.from-indigo-600")).toBeNull();
    const heading = screen.getByRole("heading", { name: "ساخت گذرواژهٔ جدید" });
    expect(heading.tagName).toBe("H1");

    const link = screen.getByRole("link", { name: /بازگشت به صفحه اصلی/ });
    expect(link.getAttribute("href")).toBe("/");
    const field = screen.getByLabelText(/^گذرواژهٔ جدید$/);
    expect(link.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("scrolls inside the viewport instead of growing the page", () => {
    render(<ResetPasswordForm/>);
    const column = (document.querySelector(".auth-panel") as HTMLElement).firstElementChild as HTMLElement;

    expect(column.className).toContain("overflow-y-auto");
    expect(column.className).toContain("min-h-0");
    expect(column.className).not.toContain("items-center");
    expect((column.firstElementChild as HTMLElement).className).toContain("my-auto");
    expect(column.contains(screen.getByLabelText(/تکرار گذرواژهٔ جدید/))).toBe(true);
  });
});
