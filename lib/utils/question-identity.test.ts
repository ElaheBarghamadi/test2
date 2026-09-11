import { describe, expect, it } from "vitest";
import { duplicateQuestionIndexes, questionIdentity } from "@/lib/utils/question-identity";
import type { Question } from "@/lib/types/domain";

function choice(overrides: Partial<Question> & { id: string }): Question {
  return {
    type: "single_choice",
    stem: "کدام یک واحد نیرو است؟",
    helpText: "",
    points: 2,
    required: true,
    difficulty: "medium",
    options: [
      { id: `${overrides.id}-a`, label: "نيوتن  ", value: `${overrides.id}-a` },
      { id: `${overrides.id}-b`, label: "ژول", value: `${overrides.id}-b` },
    ],
    correctOptionId: `${overrides.id}-a`,
    ...overrides,
  } as unknown as Question;
}

describe("question identity", () => {
  it("calls two rows the same question when only the ids differ", () => {
    const first = choice({ id: "q-1" });
    const second = choice({ id: "question-2", options: [
      { id: "x-a", label: "نیوتن", value: "x-a" },
      { id: "x-b", label: "ژول", value: "x-b" },
    ], correctOptionId: "x-a" });
    expect(questionIdentity(first)).toBe(questionIdentity(second));
    expect(duplicateQuestionIndexes([first, second])).toEqual(new Map([[1, 0]]));
  });

  it("keeps position, difficulty and tags out of the comparison", () => {
    const base = choice({ id: "q-1" });
    const moved = choice({ id: "q-1", order: 4, difficulty: "hard", tags: ["فیزیک"] });
    expect(questionIdentity(base)).toBe(questionIdentity(moved));
  });

  it("separates questions that differ where a student would notice", () => {
    const base = choice({ id: "q-1" });
    const reworded = choice({ id: "q-1", stem: "کدام یک واحد فشار است؟" });
    const reweighted = choice({ id: "q-1", points: 3 });
    const otherKey = choice({ id: "q-1", correctOptionId: "q-1-b" });
    const otherFeedback = choice({ id: "q-1", explanation: "نیوتن در SI تعریف شده است." });
    expect(new Set([base, reworded, reweighted, otherKey, otherFeedback].map(questionIdentity)).size).toBe(5);
    expect(duplicateQuestionIndexes([base, reworded, reweighted])).toEqual(new Map());
  });

  it("treats a true/false pair by its key, not by its label spacing", () => {
    const truth = { id: "tf-1", order: 1, type: "true_false", stem: "آب در ۱۰۰ درجه می‌جوشد", points: 1, required: true, difficulty: "medium", correctAnswer: true } as unknown as Question;
    const same = { ...truth, id: "tf-2", correctAnswer: true, helpText: "  " } as unknown as Question;
    const flipped = { ...truth, id: "tf-3", correctAnswer: false } as unknown as Question;
    expect(questionIdentity(truth)).toBe(questionIdentity(same));
    expect(questionIdentity(truth)).not.toBe(questionIdentity(flipped));
  });
});
