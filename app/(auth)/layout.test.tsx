import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthLayout from "./layout";

/**
 * The frame around login, register, forgot-password and reset-password — which is to say, almost nothing.
 *
 * The requirement is a screen that is *only* the form: one viewport tall, full-bleed, with no site header,
 * no footer, no logo and no trust strip, and a single «بازگشت به صفحه اصلی» link that the forms render
 * themselves. Every one of those absences is invisible when it goes wrong — removing `min-h-0`, or letting
 * a header creep back in, still renders a perfectly good-looking page — so they are pinned here.
 */
describe("AuthLayout", () => {
  it("is exactly one viewport tall and does not scroll as a page", () => {
    const { container } = render(<AuthLayout><div data-testid="child">فرم</div></AuthLayout>);
    const shell = container.firstElementChild as HTMLElement;

    expect(shell.className).toContain("h-dvh");
    expect(shell.className).toContain("overflow-hidden");
    expect(shell.className).toContain("flex-col");
    // A minimum height is the bug: the page then grows with the form and the screen stops being a screen.
    expect(shell.className).not.toContain("min-h-dvh");
    expect(shell.className).not.toContain("min-h-[calc");
  });

  it("lets the screen inside fill the height, and leaves the scrolling to it", () => {
    render(<AuthLayout><div data-testid="child">فرم</div></AuthLayout>);
    const main = screen.getByRole("main");

    /*
     * `min-h-0` is the one that silently undoes everything else: a flex child defaults to
     * `min-height: auto`, refuses to shrink below its content, and turns `h-dvh` back into "at least a
     * viewport" while the class string still looks correct.
     */
    expect(main.className).toContain("min-h-0");
    expect(main.className).toContain("flex-1");
    // The form column owns the only scrollbar; a second one here would fight it.
    expect(main.className).not.toContain("overflow-y-auto");
    expect(screen.getByTestId("child").parentElement).toBe(main);
  });

  it("carries no site chrome of its own", () => {
    const { container } = render(<AuthLayout><div>فرم</div></AuthLayout>);

    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    // The old frame's header link and its three-item trust strip.
    expect(screen.queryByRole("link", { name: /بازگشت به سایت/ })).toBeNull();
    expect(screen.queryByText("اجرا بدون نیاز به اینترنت")).toBeNull();
    expect(container.querySelector("header, footer, ul")).toBeNull();
    // Only the shell, its decoration and `main` — nothing between the visitor and the form.
    expect(screen.getByRole("main").parentElement?.childElementCount).toBe(2);
  });
});
