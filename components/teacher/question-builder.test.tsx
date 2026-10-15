import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TeacherQuestionBuilder, blankQuestion, questionIssues } from "@/components/teacher/question-builder";
import type { Question } from "@/lib/types/domain";

const option = (id: string, label: string, isCorrect = false) => ({ id, label, value: id, isCorrect });

function singleChoice(overrides: Partial<Extract<Question, { type: "single_choice" }>> = {}): Question {
  return {
    id: "q1", order: 1, stem: "کدام‌یک واحد قدرت است؟", type: "single_choice", points: 2, required: true,
    options: [option("o1", "وات", true), option("o2", "ژول")], correctOptionId: "o1",
    ...overrides,
  } as Question;
}

/** The builder is fully controlled, so the test holds the state and records what it emits. */
function Harness({ initial, onEmit }: { initial: Question[]; onEmit?: (questions: Question[]) => void }) {
  const [questions, setQuestions] = useState<Question[]>(initial);
  const latest = useRef<Question[]>(initial);
  return (
    <TeacherQuestionBuilder
      questions={questions}
      onChange={(next) => {
        latest.current = next;
        setQuestions(next);
        onEmit?.(next);
      }}
    />
  );
}

const optionInputs = () => screen.getAllByRole("textbox", { name: /متن گزینه/ });
/** Narrowing helpers, so the assertions read against the right union member. */
function firstSingle(list: Question[]) { const question = list[0]; if (!question || question.type !== "single_choice") throw new Error("expected a single-choice question"); return question; }
function firstMulti(list: Question[]) { const question = list[0]; if (!question || question.type !== "multiple_choice") throw new Error("expected a multi-answer question"); return question; }
const attribute = (element: HTMLElement, name: string) => element.getAttribute(name);
const isDisabled = (element: HTMLElement) => (element as HTMLButtonElement).disabled === true;

describe("TeacherQuestionBuilder options", () => {
  it("adds an option and keeps the existing answer key", () => {
    let emittedQuestions: Question[] = [];
    render(<Harness initial={[singleChoice()]} onEmit={(next) => { emittedQuestions = next; }}/>);
    fireEvent.click(screen.getByRole("button", { name: "گزینه" }));

    expect(optionInputs()).toHaveLength(3);
    fireEvent.change(optionInputs()[2], { target: { value: "وات ساعت" } });
    // Adding an option must not silently move the correct answer.
    expect(firstSingle(emittedQuestions).options.map((item) => item.label)).toEqual(["وات", "ژول", "وات ساعت"]);
    expect(firstSingle(emittedQuestions).correctOptionId).toBe("o1");
    expect(attribute(screen.getByRole("radio", { name: /علامت‌گذاری گزینه ۱/ }), "aria-checked")).toBe("true");
  });

  it("marks exactly one correct option for single-choice questions", () => {
    let emittedQuestions: Question[] = [];
    render(<Harness initial={[singleChoice()]} onEmit={(next) => { emittedQuestions = next; }}/>);
    fireEvent.click(screen.getByRole("radio", { name: /علامت‌گذاری گزینه ۲/ }));

    expect(attribute(screen.getByRole("radio", { name: /علامت‌گذاری گزینه ۲/ }), "aria-checked")).toBe("true");
    expect(attribute(screen.getByRole("radio", { name: /علامت‌گذاری گزینه ۱/ }), "aria-checked")).toBe("false");
    expect(firstSingle(emittedQuestions).correctOptionId).toBe("o2");
    expect(firstSingle(emittedQuestions).options.find((item) => item.id === "o1")?.isCorrect).toBe(false);
  });

  it("allows several correct options for multi-answer questions", () => {
    let emittedQuestions: Question[] = [];
    const multi: Question = { id: "q2", order: 1, stem: "کدام‌ها صحیح‌اند؟", type: "multiple_choice", points: 3, required: true, options: [option("a", "یک", true), option("b", "دو")], correctOptionIds: ["a"] } as Question;
    render(<Harness initial={[multi]} onEmit={(next) => { emittedQuestions = next; }}/>);

    fireEvent.click(screen.getByRole("checkbox", { name: /علامت‌گذاری گزینه ۲/ }));
    expect(firstMulti(emittedQuestions).correctOptionIds).toEqual(expect.arrayContaining(["a", "b"]));
    expect(firstMulti(emittedQuestions).options.filter((item) => item.isCorrect).map((item) => item.id)).toEqual(expect.arrayContaining(["a", "b"]));

    fireEvent.click(screen.getByRole("checkbox", { name: /علامت‌گذاری گزینه ۱/ }));
    expect(firstMulti(emittedQuestions).correctOptionIds).toEqual(["b"]);
  });

  it("reorders and deletes options without losing their identity", () => {
    let emittedQuestions: Question[] = [];
    render(<Harness initial={[singleChoice({ options: [option("o1", "وات", true), option("o2", "ژول"), option("o3", "وات ساعت")] })]} onEmit={(next) => { emittedQuestions = next; }}/>);

    fireEvent.click(screen.getByRole("button", { name: /انتقال گزینه ۲ به بالا/ }));
    expect(firstSingle(emittedQuestions).options.map((item) => item.id)).toEqual(["o2", "o1", "o3"]);

    fireEvent.click(screen.getByRole("button", { name: /حذف گزینه ۳/ }));
    expect(firstSingle(emittedQuestions).options.map((item) => item.id)).toEqual(["o2", "o1"]);
  });

  it("refuses to drop below the minimum option count", () => {
    render(<Harness initial={[singleChoice()]}/>);
    const remove = screen.getByRole("button", { name: /حذف گزینه ۱/ });
    expect(isDisabled(remove)).toBe(true);
    fireEvent.click(remove);
    expect(optionInputs()).toHaveLength(2);
  });

  it("pressing Enter on the last option appends the next one", () => {
    let emittedQuestions: Question[] = [];
    render(<Harness initial={[singleChoice()]} onEmit={(next) => { emittedQuestions = next; }}/>);
    fireEvent.keyDown(optionInputs()[1], { key: "Enter" });
    expect(optionInputs()).toHaveLength(3);
    expect(firstSingle(emittedQuestions).options).toHaveLength(3);
  });

  it("duplicating an option creates an empty, unmarked row", () => {
    let emittedQuestions: Question[] = [];
    render(<Harness initial={[singleChoice()]} onEmit={(next) => { emittedQuestions = next; }}/>);
    fireEvent.click(screen.getByRole("button", { name: /تکثیر گزینه ۱/ }));
    const options = firstSingle(emittedQuestions).options;
    const copy = options[1];
    expect(copy.label).toBe("");
    expect(copy.isCorrect).toBeFalsy();
    expect(options).toHaveLength(3);
    // Exactly one option may keep the key after a duplicate.
    expect(options.filter((item) => item.isCorrect)).toHaveLength(1);
    expect(firstSingle(emittedQuestions).correctOptionId).toBe("o1");
  });

  it("moves the first and last option buttons out of the way", () => {
    render(<Harness initial={[singleChoice()]}/>);
    expect(isDisabled(screen.getByRole("button", { name: /انتقال گزینه ۱ به بالا/ }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: /انتقال گزینه ۲ به پایین/ }))).toBe(true);
  });

  it("previews pasted questions before adding them to the exam", () => {
    let emittedQuestions: Question[] = [];
    render(<Harness initial={[singleChoice()]} onEmit={(next) => { emittedQuestions = next; }}/>);
    fireEvent.click(screen.getByRole("button", { name: /ورود از متن/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "متن سؤال‌ها" }), { target: { value: "سؤال: رنگ آسمان چیست؟\nالف) آبی\nب) سبز\nپاسخ: الف\nنمره: ۲" } });
    fireEvent.click(screen.getByRole("button", { name: /بررسی و پیش‌نمایش/ }));

    expect(screen.getByRole("status").textContent).toContain("۱ سؤال شناسایی شد");
    expect(screen.getByText("رنگ آسمان چیست؟")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /افزودن ۱ سؤال به آزمون/ }));

    expect(emittedQuestions).toHaveLength(2);
    expect(emittedQuestions[1]).toMatchObject({ type: "single_choice", stem: "رنگ آسمان چیست؟", points: 2 });
  });
});

describe("questionIssues", () => {
  it("flags an incomplete single-choice question and clears once fixed", () => {
    const broken = singleChoice({ options: [option("o1", "", false), option("o2", "ژول")], correctOptionId: "" });
    expect(questionIssues(broken).length).toBeGreaterThan(0);
    expect(questionIssues(singleChoice())).toEqual([]);
  });

  it("requires a stem and a positive mark", () => {
    expect(questionIssues(singleChoice({ stem: "   " }))).toContain("متن سؤال را وارد کنید یا یک تصویر به‌عنوان صورت کامل سؤال ثبت کنید.");
    expect(questionIssues(singleChoice({ points: 0 }))).toContain("نمرهٔ سؤال باید بزرگ‌تر از صفر باشد.");
  });

  it("flags a pasted question that exceeds the option limit", () => {
    const options = Array.from({ length: 11 }, (_, index) => option(`o${index + 1}`, `گزینه ${index + 1}`, index === 0));
    expect(questionIssues(singleChoice({ options, correctOptionId: "o1" }))).toContain("حداکثر ۱۰ گزینه مجاز است.");
  });

  it("requires at least one accepted answer to be filled for short answers", () => {
    const short: Question = { id: "q3", order: 1, stem: "نام اندامک", type: "short_answer", points: 1, required: true, expectedAnswers: [""], caseSensitive: false };
    expect(questionIssues(short)).toContain("پاسخ‌های قابل‌قبول را خالی نگذارید.");
  });

  it("only asks for a stem on a blank true/false question", () => {
    // The two fixed options are always valid, so no option rule should fire.
    expect(questionIssues(blankQuestion("true_false", 1))).toEqual(["متن سؤال را وارد کنید یا یک تصویر به‌عنوان صورت کامل سؤال ثبت کنید."]);
    const filled = { ...blankQuestion("true_false", 1), stem: "سؤال درست است؟" };
    expect(questionIssues(filled)).toEqual([]);
  });

  it("does not invent option rules for written answers", () => {
    const essay = { ...blankQuestion("essay", 1), stem: "پدیده را توضیح دهید." };
    expect(questionIssues(essay)).toEqual([]);
    expect(essay.type).toBe("essay");
  });
});

/**
 * Adding a question is a two-step dialog: the type on its own, then only the fields that type has.
 *
 * `within(dialog)` throughout, because the trigger button and the dialog's own confirm button carry the same
 * label — a bare `getByRole` matches both and tells you nothing about which one was clicked.
 */
describe("adding a question", () => {
  function openComposer() {
    render(<Harness initial={[singleChoice()]}/>);
    fireEvent.click(screen.getByRole("button", { name: /افزودن سؤال/ }));
    return screen.getByRole("dialog", { name: /افزودن سؤال/ });
  }

  it("asks for the type before showing any field", async () => {
    const dialog = openComposer();
    expect(await within(dialog).findByRole("button", { name: /چهارگزینه‌ای/ })).toBeTruthy();
    // No field yet: not a stem, not an option, not a mark.
    expect(within(dialog).queryByRole("textbox", { name: /متن سؤال/ })).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: /متن گزینه/ })).toBeNull();
    for (const label of ["چهارگزینه‌ای", "چندگزینه‌ای چندپاسخی", "درست / نادرست", "وصل‌کردنی", "پاسخ کوتاه", "پاسخ تشریحی"]) {
      expect(within(dialog).getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("shows only the fields the chosen type has", async () => {
    const dialog = openComposer();
    fireEvent.click(await within(dialog).findByRole("button", { name: /پاسخ تشریحی/ }));

    expect(await within(dialog).findByRole("textbox", { name: /متن سؤال/ })).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: /راهنمای تصحیح/ })).toBeTruthy();
    // An essay has no options at all, and no accepted-answer list.
    expect(within(dialog).queryByRole("textbox", { name: /متن گزینه/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^پاسخ$/ })).toBeNull();
  });

  it("appends the question only when the teacher confirms", async () => {
    // `onEmit` records the whole list, and only when the list actually changes — so an untouched draft in a
    // dialog that is then closed must leave this empty, which is the point being tested.
    let emitted: Question[] = [];
    render(<Harness initial={[singleChoice()]} onEmit={(next) => { emitted = next; }}/>);
    fireEvent.click(screen.getByRole("button", { name: /افزودن سؤال/ }));
    const dialog = screen.getByRole("dialog", { name: /افزودن سؤال/ });
    fireEvent.click(await within(dialog).findByRole("button", { name: /وصل‌کردنی/ }));
    fireEvent.change(await within(dialog).findByRole("textbox", { name: /متن سؤال/ }), { target: { value: "هر اندامک را به کارش وصل کنید." } });

    // Closing the dialog throws the half-typed question away rather than dropping it into the paper.
    fireEvent.click(within(dialog).getByRole("button", { name: "بستن" }));
    expect(emitted).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /افزودن سؤال/ }));
    const reopened = screen.getByRole("dialog", { name: /افزودن سؤال/ });
    fireEvent.click(await within(reopened).findByRole("button", { name: /وصل‌کردنی/ }));
    fireEvent.change(await within(reopened).findByRole("textbox", { name: /متن سؤال/ }), { target: { value: "هر اندامک را به کارش وصل کنید." } });
    fireEvent.click(within(reopened).getByRole("button", { name: /افزودن و تکمیل در فهرست/ }));

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ type: "matching", stem: "هر اندامک را به کارش وصل کنید.", order: 2 });
  });

  it("goes back to the type choice without losing the stem", async () => {
    const dialog = openComposer();
    fireEvent.click(await within(dialog).findByRole("button", { name: /چهارگزینه‌ای/ }));
    fireEvent.change(await within(dialog).findByRole("textbox", { name: /متن سؤال/ }), { target: { value: "کدام‌یک واحد نیرو است؟" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /بازگشت به انتخاب نوع/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /پاسخ کوتاه/ }));
    expect((await within(dialog).findByRole("textbox", { name: /متن سؤال/ }) as HTMLTextAreaElement).value).toBe("کدام‌یک واحد نیرو است؟");
  });
});

describe("optional sections stay out of the way", () => {
  it("keeps the answer-media and metadata sections closed on a plain question", () => {
    render(<Harness initial={[singleChoice()]}/>);
    const media = screen.getByRole("button", { name: /پاسخ رسانه‌ای دانش‌آموز/ });
    const metadata = screen.getByRole("button", { name: /راهنما، برچسب و توضیح/ });
    expect(media.getAttribute("aria-expanded")).toBe("false");
    expect(metadata.getAttribute("aria-expanded")).toBe("false");
    // The stem and the options — the actual question — are never hidden.
    expect(screen.getByRole("textbox", { name: /متن سؤال/ })).toBeTruthy();
    expect(screen.getAllByRole("textbox", { name: /متن گزینه/ })).toHaveLength(2);

    fireEvent.click(media);
    expect(media.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/اجازهٔ بارگذاری تصویر/)).toBeTruthy();
  });

  it("opens a section that already holds something", () => {
    const withMedia = { ...singleChoice(), allowAudioAnswer: true } as Question;
    render(<Harness initial={[withMedia]}/>);
    const media = screen.getByRole("button", { name: /پاسخ رسانه‌ای دانش‌آموز/ });
    expect(media.getAttribute("aria-expanded")).toBe("true");
    expect(media.textContent).toContain("صدا");
  });
});
