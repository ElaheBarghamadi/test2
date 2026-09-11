import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrueFalseQuestion } from "@/components/exam/questions/true-false-question";
import type { TrueFalseQuestion as Model } from "@/lib/types/domain";

const question: Model = {
  id: "q-1",
  order: 1,
  stem: "بارش برف در مرداد ممکن نیست.",
  points: 2,
  required: true,
  difficulty: "medium",
  type: "true_false",
  correctAnswer: true,
  optionIds: { true: "opt-true", false: "opt-false" },
};

function renderField(props: Partial<Parameters<typeof TrueFalseQuestion>[0]> = {}) {
  const onChange = vi.fn();
  render(<TrueFalseQuestion question={question} value={null} onChange={onChange} {...props}/>);
  return { onChange };
}

describe("TrueFalseQuestion", () => {
  it("gives each choice its own control, which is what used to make «نادرست» unreachable", () => {
    renderField();
    const inputs = screen.getAllByRole("radio") as (HTMLInputElement & { id: string })[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.id).not.toBe(inputs[1]!.id);
    expect(inputs.map((input) => input.id)).toEqual(["q-1-tf-true", "q-1-tf-false"]);
    for (const input of inputs) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      expect(label).toBeTruthy();
      expect(label?.textContent).toContain(input.id.endsWith("-true") ? "درست" : "نادرست");
    }
  });

  it("reports the choice the student actually clicked", () => {
    const { onChange } = renderField();
    fireEvent.click(screen.getByText("نادرست"));
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("درست"));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("shows the stored answer on the right control", () => {
    render(<TrueFalseQuestion question={question} value={false} onChange={vi.fn()}/>);
    const [truthy, falsy] = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(truthy!.checked).toBe(false);
    expect(falsy!.checked).toBe(true);
  });

  it("lets a student take the answer back before sending it", () => {
    const { onChange } = renderField({ value: true });
    fireEvent.click(screen.getByRole("button", { name: /پاک کردن انتخاب/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("hides the way out and locks the pair once the attempt is closed", () => {
    const { onChange } = renderField({ disabled: true });
    expect(screen.getAllByRole("radio").every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: /پاک کردن انتخاب/ })).toBeNull();
    fireEvent.click(screen.getByText("درست"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
