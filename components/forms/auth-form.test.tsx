import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Signing in and signing up, from the form the user actually touches.
 *
 * Four things are pinned here, each of them a way a first-time user could have been left stuck:
 *  - a mistyped address or an unconfirmed password never reaches the API;
 *  - one submit is one request, however impatient the tap;
 *  - sign-up carries grade and class in the same request that creates the account, so a dropped
 *    connection cannot leave an account without a profile behind a form that says it failed;
 *  - with no network, the form says so instead of spinning, and the button is not a trap.
 */
const api = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  me: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  logout: vi.fn(),
}));
const replace = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/auth", () => ({ authApi: api }));
vi.mock("@/lib/api/session-mirror", () => ({
  syncSessionMirror: vi.fn().mockResolvedValue(undefined),
  clearSessionMirror: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }) }));

import { AuthForm } from "@/components/forms/auth-form";
import { ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/lib/state/auth-store";

const student = { id: "u1", email: "sara@school.ir", first_name: "سارا", last_name: "محمدی", role: "student" as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  api.register.mockReset().mockResolvedValue({ ...student, access: "access-token", refresh: "refresh-token" });
  api.login.mockReset().mockResolvedValue({ access: "access-token", refresh: "refresh-token", user: student });
  api.me.mockReset().mockResolvedValue(student);
  api.requestPasswordReset.mockReset().mockResolvedValue({ detail: "ok" });
  useAuthStore.setState({ user: null, status: "anonymous" });
});

afterEach(() => {
  // `onLine` is replaced by the offline test; putting the real one back keeps the rest of the file honest.
  delete (navigator as unknown as Record<string, unknown>).onLine;
});

function fillRegistration() {
  fireEvent.change(screen.getByLabelText(/نام و نام خانوادگی/), { target: { value: "سارا محمدی" } });
  fireEvent.change(screen.getByLabelText(/ایمیل/), { target: { value: "Sara@School.IR" } });
  fireEvent.change(screen.getByLabelText(/^گذرواژه$/), { target: { value: "A-strong-password-927" } });
  fireEvent.change(screen.getByLabelText(/تکرار گذرواژه/), { target: { value: "A-strong-password-927" } });
}

describe("the sign-in form", () => {
  it("refuses a malformed address without calling the API", async () => {
    render(<AuthForm mode="login"/>);
    fireEvent.change(screen.getByLabelText(/ایمیل/), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText(/^گذرواژه$/), { target: { value: "A-strong-password-927" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود به حساب" }));

    expect(await screen.findByText("یک ایمیل معتبر وارد کنید.")).toBeTruthy();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("sends the credentials once and lands on the dashboard for the returned role", async () => {
    render(<AuthForm mode="login"/>);
    fireEvent.change(screen.getByLabelText(/ایمیل/), { target: { value: " sara@school.ir " } });
    fireEvent.change(screen.getByLabelText(/^گذرواژه$/), { target: { value: "A-strong-password-927" } });
    fireEvent.click(screen.getByRole("button", { name: "ورود به حساب" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/student/dashboard"));
    // Whitespace from a copy-paste is trimmed; the password is never touched.
    expect(api.login).toHaveBeenCalledWith("sara@school.ir", "A-strong-password-927");
  });
});

describe("the sign-up form", () => {
  it("blocks a password that was not confirmed the same way", async () => {
    render(<AuthForm mode="register"/>);
    fillRegistration();
    fireEvent.change(screen.getByLabelText(/تکرار گذرواژه/), { target: { value: "A-strong-password-92" } });
    fireEvent.click(screen.getByRole("button", { name: "ساخت حساب" }));

    expect(await screen.findByText("تکرار گذرواژه با گذرواژهٔ بالا یکسان نیست.")).toBeTruthy();
    expect(api.register).not.toHaveBeenCalled();
  });

  it("creates the account, its role and its grade in a single request", async () => {
    render(<AuthForm mode="register"/>);
    fillRegistration();
    fireEvent.change(screen.getByLabelText(/نقش شما/), { target: { value: "student" } });
    fireEvent.click(screen.getByRole("button", { name: "ساخت حساب" }));

    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(1));
    expect(api.register.mock.calls[0][0]).toMatchObject({
      email: "Sara@School.IR",
      first_name: "سارا",
      last_name: "محمدی",
      role: "student",
      grade: "پایه دوازدهم",
      class_name: "تجربی ۲",
    });
    // The profile is no longer written by a second request that could fail on its own.
    expect(api.login).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/student/dashboard"));
  });

  it("turns an impatient double tap into one account", async () => {
    const pending = deferred<typeof student & { access: string; refresh: string }>();
    api.register.mockReturnValue(pending.promise);

    render(<AuthForm mode="register"/>);
    fillRegistration();
    const submit = screen.getByRole("button", { name: "ساخت حساب" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(api.register).toHaveBeenCalledTimes(1);
    pending.resolve({ ...student, access: "a", refresh: "r" });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("shows the server's own Persian reason when the address is taken", async () => {
    // The real error shape the client throws, so the message path under test is the one production uses.
    api.register.mockRejectedValue(new ApiError(400, { detail: { email: ["این ایمیل قبلاً ثبت شده است."] } }));

    render(<AuthForm mode="register"/>);
    fillRegistration();
    fireEvent.click(screen.getByRole("button", { name: "ساخت حساب" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("این ایمیل قبلاً ثبت شده است.");
  });
});

describe("with no connection", () => {
  it("says so and keeps the button out of reach instead of spinning forever", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    render(<AuthForm mode="login"/>);
    window.dispatchEvent(new Event("offline"));

    expect(await screen.findByText(/اتصال اینترنت برقرار نیست/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/ایمیل/), { target: { value: "sara@school.ir" } });
    fireEvent.change(screen.getByLabelText(/^گذرواژه$/), { target: { value: "A-strong-password-927" } });
    const submit = screen.getByRole("button", { name: "ورود به حساب" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(api.login).not.toHaveBeenCalled();
  });
});
