import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Signing in and signing up, from the form the user actually touches.
 *
 * Four things are pinned here, each of them a way a first-time user could have been left stuck:
 *  - a mistyped address or an unconfirmed password never reaches the API;
 *  - one submit is one request, however impatient the tap;
 *  - sign-up carries grade and class in the same request that creates the account, so a dropped
 *    connection cannot leave an account without a profile behind a form that says it failed;
 *  - with no network, the form says so instead of spinning, and the button is not a trap.
 *
 * Plus two of the new affordances: the password meter has to *advise* without ever refusing a password the
 * server would accept, and Caps Lock has to be named, because "credentials incorrect" points nowhere.
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
    // The role is two visible cards, not a collapsed default: a pupil who never noticed the control still
    // has to be able to see which one is chosen.
    expect((screen.getByRole("radio", { name: /دانش‌آموز/ }) as HTMLInputElement).checked).toBe(true);
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

describe("the sign-up form: role and password guidance", () => {
  it("drops grade and class when the teacher card is the one chosen", async () => {
    render(<AuthForm mode="register"/>);
    fillRegistration();
    fireEvent.click(screen.getByRole("radio", { name: /آموزگار/ }));

    // They are a pupil's attributes; asking a teacher for them produced empty fields on real accounts.
    expect(screen.queryByLabelText(/^پایه$/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ساخت حساب" }));

    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(1));
    expect(api.register.mock.calls[0][0]).toMatchObject({ role: "teacher", grade: undefined, class_name: undefined });
  });

  it("advises on a weak password without refusing one the server might accept", async () => {
    render(<AuthForm mode="register"/>);
    fillRegistration();
    fireEvent.change(screen.getByLabelText(/^گذرواژه$/), { target: { value: "24681357" } });
    fireEvent.change(screen.getByLabelText(/تکرار گذرواژه/), { target: { value: "24681357" } });

    // Eight digits clears the length rule and the two the client can only approximate — and still fails
    // the server's "not entirely numeric" check, so the meter has to say so in plain words.
    expect(screen.getByText("ضعیف")).toBeTruthy();
    expect(screen.getByText("فقط از عدد تشکیل نشده باشد").closest("li")?.className).not.toContain("text-success");

    // Deliberate: the client's "too similar" and "too common" checks are approximations of the server's,
    // and approximations must not be allowed to lock someone out of their own sign-up. The server decides.
    fireEvent.click(screen.getByRole("button", { name: "ساخت حساب" }));
    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(1));
  });

});

describe("the sign-in form: keyboard and demo shortcuts", () => {
  it("names Caps Lock instead of letting a correct password fail silently", async () => {
    render(<AuthForm mode="login"/>);
    const input = screen.getByLabelText(/^گذرواژه$/);
    const event = createEvent.keyUp(input, { key: "A" });
    // jsdom reports no modifier state; the shadowing own property is what the handler will actually read.
    (event as unknown as { getModifierState: (key: string) => boolean }).getModifierState = (key) => key === "CapsLock";
    fireEvent(input, event);

    expect(await screen.findByText("Caps Lock روشن است.")).toBeTruthy();
  });

  it("fills the seeded demo account in one click, outside production", async () => {
    render(<AuthForm mode="login"/>);
    fireEvent.click(screen.getByRole("button", { name: "دانش‌آموز" }));

    expect((screen.getByLabelText(/ایمیل/) as HTMLInputElement).value).toBe("student1@examora.test");
    expect((screen.getByLabelText(/^گذرواژه$/) as HTMLInputElement).value).toBe("Examora1234!");
    expect(api.login).not.toHaveBeenCalled();
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

describe("the full-screen screen", () => {
  function panel() {
    return document.querySelector(".auth-panel") as HTMLElement;
  }

  it("is the whole screen — full-bleed and filling the height, on every mode", () => {
    // `/reset-password` renders its own component; these three all render this one.
    for (const mode of ["login", "register", "forgot"] as const) {
      const { unmount } = render(<AuthForm mode={mode}/>);
      const classes = panel().className;
      expect(classes, mode).toContain("flex-1");
      expect(classes, mode).toContain("min-h-0");
      // A card floating on a background is precisely what this must not be.
      for (const gone of ["mx-auto", "max-w-6xl", "rounded-[1.75rem]", "border", "shadow-lift"]) {
        expect(classes, `${mode} still has ${gone}`).not.toContain(gone);
      }
      // Transparent on a phone, where the shell's decoration shows through behind the form; opaque from
      // `lg` up, where the split needs its two halves to read as two halves.
      expect(classes, mode).toContain("bg-transparent");
      expect(classes, mode).toContain("lg:bg-card");
      unmount();
    }
  });

  it("offers exactly one way out, and puts it above the form", () => {
    render(<AuthForm mode="login"/>);
    const exits = screen.getAllByRole("link", { name: /بازگشت به صفحه اصلی/ });
    expect(exits).toHaveLength(1);

    const link = exits[0];
    /*
     * A real link to `/`, not `router.back()`: plenty of visitors land on /login from a shared link or a
     * redirected protected route, where there is no history to go back to.
     */
    expect(link.getAttribute("href")).toBe("/");
    // Above the form, not below it or floating over it.
    const field = screen.getByLabelText(/ایمیل/);
    expect(link.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And inside the scrolling column, so it belongs to the form rather than to a chrome that no longer exists.
    expect((panel().children[1] as HTMLElement).contains(link)).toBe(true);
  });

  it("scrolls the tall register form inside the screen rather than centring its top out of reach", () => {
    render(<AuthForm mode="register"/>);
    const column = panel().children[1] as HTMLElement;

    expect(column.className).toContain("overflow-y-auto");
    expect(column.className).toContain("min-h-0");
    expect(column.className).toContain("flex-col");
    /*
     * `items-center` on a column that scrolls clips whatever overflows the top, which is exactly the part
     * of a form a visitor needs first. Auto margins on the child centre it when there is room and collapse
     * to zero when there is not.
     */
    expect(column.className).not.toContain("items-center");
    expect((column.firstElementChild as HTMLElement).className).toContain("my-auto");
    expect(column.contains(screen.getByLabelText(/نام و نام خانوادگی/))).toBe(true);
  });

  it("keeps the brand side from pushing the screen open on a short viewport", () => {
    render(<AuthForm mode="login"/>);
    const aside = panel().querySelector("aside") as HTMLElement;

    expect(aside.className).toContain("lg:min-h-0");
    expect(aside.className).not.toContain("min-h-[600px]");
    const scroll = aside.querySelector(".auth-brand-scroll") as HTMLElement;
    expect(scroll.className).toContain("overflow-y-auto");
    // The decorative blocks are what a short screen gives up, so they have to be hookable from CSS.
    expect(aside.querySelector(".auth-panel-demo")).toBeTruthy();
    expect(aside.querySelector(".auth-panel-points")).toBeTruthy();
  });
});
