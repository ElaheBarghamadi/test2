import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExamCreator } from "@/components/forms/exam-creator";

/**
 * The delivery-layout control, on its own.
 *
 * The choice of one page versus a page per question belongs to the teacher, and the "no going back" rule
 * only means something on the paged sheet — so the switch has to disappear (with a reason) rather than sit
 * there promising an effect the server will not enforce. The payload side is pinned in
 * `lib/api/mappers.test.ts`, which is where `question_layout` is actually written.
 */

const { saveExam } = vi.hoisted(() => ({ saveExam: vi.fn().mockResolvedValue({ id: "exam-1" }) }));

// The builder swaps steps inside `AnimatePresence mode="wait"`, and an exit animation never finishes under
// jsdom: the panel would stay on step one no matter what was clicked. Rendering the children directly keeps
// the test about the form, not about the animation library.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children ?? null,
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/use-teacher-exams", () => ({
  useTeacherExams: () => ({
    exams: [], loading: false, detailLoadingId: null, initialized: true, error: null,
    clearError: vi.fn(), saveExam, loadExam: vi.fn(),
  }),
}));

function openSettings() {
  render(<ExamCreator/>);
  // The builder walks one step at a time, so the first screen has to be satisfied to reach the settings.
  fireEvent.change(screen.getByRole("textbox", { name: /عنوان آزمون/ }), { target: { value: "آزمون شیمی" } });
  fireEvent.change(screen.getByRole("textbox", { name: /توضیح کوتاه/ }), { target: { value: "فصل ۲ و ۳" } });
  fireEvent.click(screen.getByRole("button", { name: /ادامه/ }));
}

describe("delivery layout", () => {
  it("offers the two layouts with paged selected by default", () => {
    openSettings();
    expect(screen.getByText("چیدمان سؤال‌ها در صفحهٔ آزمون")).toBeTruthy();
    const paged = screen.getByRole("button", { name: /صفحه‌به‌صفحه/ });
    const single = screen.getByRole("button", { name: /همه سؤال‌ها زیر هم/ });
    expect(paged.getAttribute("aria-pressed")).toBe("true");
    expect(single.getAttribute("aria-pressed")).toBe("false");
    // Back navigation is a rule about moving between pages, so it is editable here.
    expect(screen.getByText("اجازهٔ بازگشت به سؤال‌ها")).toBeTruthy();
  });

  it("replaces the back-navigation switch with a reason when the sheet becomes one page", () => {
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /همه سؤال‌ها زیر هم/ }));

    expect(screen.getByRole("button", { name: /همه سؤال‌ها زیر هم/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("اجازهٔ بازگشت به سؤال‌ها")).toBeNull();
    expect(screen.getByText(/«بازگشت به سؤال قبلی» معنایی ندارد/)).toBeTruthy();

    // And the switch comes back: the stored value is left alone, only its row is hidden.
    fireEvent.click(screen.getByRole("button", { name: /صفحه‌به‌صفحه/ }));
    expect(screen.getByText("اجازهٔ بازگشت به سؤال‌ها")).toBeTruthy();
  });
});
