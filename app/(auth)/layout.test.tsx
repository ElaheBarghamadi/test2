import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthLayout from "./layout";

/**
 * The frame around login, register, forgot-password and reset-password.
 *
 * The requirement is that these screens are *full-screen*: one viewport tall, nothing scrolling behind
 * them. That is easy to lose without noticing, because every way of losing it still renders a perfectly
 * good-looking page — it just grows past the fold and the header scrolls away with it. So the invariants
 * are pinned here rather than left to eyeballing:
 *
 *  - the shell has a viewport height and clips, instead of a *minimum* height that content can push open;
 *  - `main` is allowed to shrink (`min-h-0`). A flex child defaults to `min-height: auto`, which refuses
 *    to go below its content and quietly turns `h-dvh` back into "at least a viewport";
 *  - the header and the trust strip are `shrink-0`, so a tall form squeezes the card rather than the chrome.
 */
describe("AuthLayout", () => {
  it("is exactly one viewport tall and does not scroll as a page", () => {
    const { container } = render(<AuthLayout><div data-testid="child">فرم</div></AuthLayout>);
    const shell = container.firstElementChild as HTMLElement;

    expect(shell.className).toContain("h-dvh");
    expect(shell.className).toContain("overflow-hidden");
    expect(shell.className).toContain("flex-col");
    // A minimum height is the bug: the page then grows with the form and the shell stops being a screen.
    expect(shell.className).not.toContain("min-h-dvh");
    expect(shell.className).not.toContain("min-h-[calc");
  });

  it("lets main shrink into the leftover height and scroll only below lg", () => {
    render(<AuthLayout><div data-testid="child">فرم</div></AuthLayout>);
    const main = screen.getByRole("main");

    expect(main.className).toContain("min-h-0");
    expect(main.className).toContain("flex-1");
    // Phones get one scroll container here; on lg the card fills the space and scrolls inside itself.
    expect(main.className).toContain("overflow-y-auto");
    expect(main.className).toContain("lg:overflow-hidden");
    expect(main.className).not.toContain("justify-center");

    // The narrow reset-password card must be centred, not stretched into a tall thin panel.
    expect(screen.getByTestId("child").parentElement?.className).toContain("lg:items-center");
  });

  it("keeps the header and the trust strip from being squeezed away", () => {
    render(<AuthLayout><div>فرم</div></AuthLayout>);

    expect(screen.getByRole("banner").className).toContain("shrink-0");
    const strip = screen.getByText("اجرا بدون نیاز به اینترنت").closest("ul") as HTMLElement;
    expect(strip.className).toContain("shrink-0");
  });

  it("renders the screen it is given, plus the phone-only tagline and a way back", () => {
    render(<AuthLayout><div data-testid="child">فرم</div></AuthLayout>);

    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.getByText("ارزیابی مدرن، برای آموزش معنادار.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /بازگشت به سایت/ })).toBeTruthy();
  });
});
