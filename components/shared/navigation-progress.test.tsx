import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect, useInsertionEffect, useState } from "react";

/**
 * The hairline that says "your click was heard" — and, mostly, the reason it must not touch React state.
 *
 * `window.history.pushState` is a global that the framework also owns. Next's `HistoryUpdater` calls it from
 * inside a `useInsertionEffect` on every App Router navigation, and an earlier version of this component
 * answered with `setPending(true)` there — which is an update scheduled during the insertion-effect phase,
 * so React logged `useInsertionEffect must not schedule updates.` against this file on every single click.
 * The first test below reproduces that call site exactly; it fails loudly if the component ever goes back
 * to driving the bar with state.
 */
const nav = vi.hoisted(() => ({ pathname: "/teacher/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { NavigationProgress } from "@/components/shared/navigation-progress";

/**
 * What Next's router actually does: push a history entry from an insertion effect.
 *
 * Mounted a beat *after* `NavigationProgress`, because insertion effects run before passive ones — if both
 * mounted in the same commit, the history patch would not be installed yet and the test would pass without
 * exercising anything.
 */
function RouterLike() {
  useInsertionEffect(() => {
    window.history.pushState({}, "", "/teacher/exams");
  }, []);
  return null;
}

function Harness() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return <><NavigationProgress/>{mounted && <RouterLike/>}</>;
}

const INSERTION_WARNING = /useInsertionEffect must not schedule updates/;

function bar(container: HTMLElement) {
  return container.querySelector<HTMLElement>('[role="progressbar"]')!;
}

let consoleErrors: string[];
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  nav.pathname = "/teacher/dashboard";
  vi.useFakeTimers();
  // jsdom keeps the URL between tests in a file, and the component filters same-document pushes.
  window.history.replaceState({}, "", "/teacher/dashboard");
  consoleErrors = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe("when the router pushes history from an insertion effect", () => {
  it("does not schedule a React update", async () => {
    const { container } = render(<Harness/>);
    await act(async () => { await Promise.resolve(); });

    expect(consoleErrors.filter((line) => INSERTION_WARNING.test(line))).toEqual([]);
    // And the bar still does its job: this is not "fixed" by doing nothing.
    expect(bar(container).dataset.state).toBe("active");
  });
});

describe("the bar itself", () => {
  it("stays hidden for a same-document anchor change", async () => {
    const { container } = render(<NavigationProgress/>);
    act(() => { window.history.replaceState({}, "", "#exams"); });

    // Next's scroll restoration replaces the URL with a hash on every page; flashing the bar for that made
    // it look like a navigation was happening when nothing was.
    expect(bar(container).dataset.state).toBe("idle");
  });

  it("fills and fades once the route has settled", async () => {
    const { container, rerender } = render(<NavigationProgress/>);
    act(() => { window.history.pushState({}, "", "/teacher/exams"); });
    expect(bar(container).dataset.state).toBe("active");

    nav.pathname = "/teacher/exams";
    rerender(<NavigationProgress/>);
    expect(bar(container).dataset.state).toBe("done");

    act(() => { vi.advanceTimersByTime(400); });
    expect(bar(container).dataset.state).toBe("idle");
  });

  it("gives up on a navigation that never lands", async () => {
    const { container } = render(<NavigationProgress/>);
    act(() => { window.history.pushState({}, "", "/teacher/results"); });
    expect(bar(container).dataset.state).toBe("active");

    // A refused request or a route error settles nothing on its own; a bar stuck forever reads as a freeze.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(bar(container).dataset.state).toBe("done");
    act(() => { vi.advanceTimersByTime(400); });
    expect(bar(container).dataset.state).toBe("idle");
  });

  it("restarts rather than stacking when a second navigation begins", async () => {
    const { container } = render(<NavigationProgress/>);
    act(() => { window.history.pushState({}, "", "/teacher/exams"); });
    act(() => { vi.advanceTimersByTime(9_000); });
    act(() => { window.history.pushState({}, "", "/teacher/students"); });

    // The first fallback timer is gone with the first navigation; only the second one may fire.
    act(() => { vi.advanceTimersByTime(9_000); });
    expect(bar(container).dataset.state).toBe("active");
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(bar(container).dataset.state).toBe("done");
  });

  it("hands the native history methods back on unmount", () => {
    const before = window.history.pushState;
    const view = render(<NavigationProgress/>);
    expect(window.history.pushState).not.toBe(before);

    view.unmount();
    expect(window.history.pushState).toBe(before);
  });

  it("is in the document at all times, and out of reach while idle", () => {
    const { container } = render(<NavigationProgress/>);
    // The element is mounted but `visibility: hidden`; CSS, not a toggled attribute, decides whether an
    // assistive technology sees it. Nothing here may re-render to change that.
    expect(bar(container).getAttribute("aria-label")).toBe("در حال بارگذاری صفحه");
    expect(bar(container).dataset.state).toBe("idle");
  });
});
