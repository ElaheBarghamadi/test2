import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("draft status and bounded settings", () => {
  it("does not call a brand-new exam saved before the first save", () => {
    render(<ExamCreator/>);
    expect(screen.getByText("آزمون هنوز ذخیره نشده")).toBeTruthy();
  });

  it("keeps duration within the form's five-to-three-hundred-minute range", () => {
    openSettings();
    const duration = screen.getByLabelText(/مدت آزمون/);
    fireEvent.change(duration, { target: { value: "450" } });
    expect((duration as HTMLInputElement).value).toBe("300");
  });
});

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

describe("starter templates and flexible class details", () => {
  it("applies a practice template without overwriting the teacher's title or class", () => {
    render(<ExamCreator/>);
    fireEvent.change(screen.getByRole("textbox", { name: /عنوان آزمون/ }), { target: { value: "تمرین فصل دوم" } });
    fireEvent.change(screen.getByRole("combobox", { name: /کلاس/ }), { target: { value: "۹-الف" } });

    const template = screen.getByRole("button", { name: /تمرین کوتاه/ });
    fireEvent.click(template);
    expect(template.getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("textbox", { name: /عنوان آزمون/ }) as HTMLInputElement).value).toBe("تمرین فصل دوم");
    expect((screen.getByRole("combobox", { name: /کلاس/ }) as HTMLInputElement).value).toBe("۹-الف");

    fireEvent.click(screen.getByRole("button", { name: /ادامه/ }));
    expect((screen.getByLabelText(/مدت آزمون/) as HTMLInputElement).value).toBe("20");
    expect((screen.getByRole("combobox", { name: /نمایش نتیجه/ }) as HTMLSelectElement).value).toBe("immediate");
    expect((screen.getByRole("combobox", { name: /تعداد تلاش مجاز/ }) as HTMLSelectElement).value).toBe("2");
  });

  it("clears the chosen template marker when a setting is customized", () => {
    render(<ExamCreator/>);
    fireEvent.click(screen.getByRole("button", { name: /تمرین کوتاه/ }));
    fireEvent.click(screen.getByRole("button", { name: /ادامه/ }));
    fireEvent.change(screen.getByLabelText(/مدت آزمون/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /اطلاعات پایه/ }));

    expect(screen.getByRole("button", { name: /تمرین کوتاه/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("accepts subjects, grades and class names outside the suggestion list", () => {
    render(<ExamCreator/>);
    const subject = screen.getByRole("combobox", { name: /درس/ }) as HTMLInputElement;
    const grade = screen.getByRole("combobox", { name: /پایه/ }) as HTMLInputElement;
    const className = screen.getByRole("combobox", { name: /کلاس/ }) as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "علوم رایانه" } });
    fireEvent.change(grade, { target: { value: "پایه نهم ویژه" } });
    fireEvent.change(className, { target: { value: "گروه المپیاد" } });

    expect(subject.value).toBe("علوم رایانه");
    expect(grade.value).toBe("پایه نهم ویژه");
    expect(className.value).toBe("گروه المپیاد");
    expect(subject.getAttribute("list")).toBe("exam-subject-suggestions");
  });
});

describe("quick scheduling", () => {
  it("fills tomorrow morning in the school's Persian calendar", () => {
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /زمان‌بندی/ }));
    fireEvent.click(screen.getByRole("button", { name: /فردا، ۸:۳۰/ }));

    expect(screen.getByText(/۰۸:۳۰/)).toBeTruthy();
    expect(screen.getByText(/۰۹:۳۰/)).toBeTruthy();
    expect(screen.getByText(/بازهٔ برگزاری ۱ ساعت است/)).toBeTruthy();
  });

  it("includes leftover minutes in the schedule summary", () => {
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: /زمان‌بندی/ }));
    fireEvent.click(screen.getByRole("button", { name: /فردا، ۸:۳۰/ }));
    fireEvent.click(screen.getByRole("button", { name: /تاریخ و ساعت پایان/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "ساعت" }), { target: { value: "10" } });
    fireEvent.change(screen.getByRole("combobox", { name: "دقیقه" }), { target: { value: "00" } });

    expect(screen.getByText(/بازهٔ برگزاری ۱ ساعت و ۳۰ دقیقه است/)).toBeTruthy();
  });
});

describe("integrity monitoring", () => {
  /** The switch is the teacher's, so it starts off — and stays unreachable until they move it. */
  it("starts off, with the saved rules inert beside it", () => {
    openSettings();
    const fieldset = screen.getByText("مراقبت از تقلب").closest("fieldset")!;
    expect((within(fieldset).getByRole("radio", { name: /خاموش/ }) as HTMLInputElement).checked).toBe(true);
    const switches = within(fieldset).getAllByRole("switch");
    expect(switches).toHaveLength(5);
    expect(switches.every((item) => (item as HTMLButtonElement).disabled)).toBe(true);
    expect(within(fieldset).getByText(/خاموش‌بودن، حالت پیش‌فرض هر آزمون است/)).toBeTruthy();
  });

  it("hands the rules to the teacher when enforcement is chosen", () => {
    openSettings();
    const fieldset = screen.getByText("مراقبت از تقلب").closest("fieldset")!;
    fireEvent.click(within(fieldset).getByRole("radio", { name: /هشدار و تشدید پیامد/ }));

    const clipboard = within(fieldset).getByRole("switch", { name: /ثبت کپی\/بریدن و بستن چسباندن/ });
    expect((clipboard as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(clipboard);
    expect(clipboard.getAttribute("aria-checked")).toBe("true");
    // A warning budget only exists once enforcement is selected.
    expect((within(fieldset).getByRole("spinbutton", { name: /اخطارهای پیش از توقف/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it("says what the mechanism cannot do, in the same breath as what it can", () => {
    openSettings();
    const fieldset = screen.getByText("مراقبت از تقلب").closest("fieldset")!;
    expect(within(fieldset).getByText(/نمی‌تواند همهٔ افزونه‌های هوش مصنوعی.*تقلب را ناممکن/)).toBeTruthy();
  });
});
