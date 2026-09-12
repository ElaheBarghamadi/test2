import { describe, expect, it } from "vitest";
import { RESULT_DETAIL_LABELS, RESULT_DETAIL_OPTIONS, resolveResultDetail } from "./result-detail";

describe("result detail ladder", () => {
  it("lists the four rungs the API accepts, smallest first", () => {
    expect(RESULT_DETAIL_OPTIONS.map((option) => option.value)).toEqual([
      "score_only",
      "own_answers",
      "own_answers_with_feedback",
      "full_key",
    ]);
    expect(RESULT_DETAIL_OPTIONS.every((option) => option.title && option.description)).toBe(true);
    expect(Object.keys(RESULT_DETAIL_LABELS)).toHaveLength(4);
  });

  it("falls back to the legacy switch when no rung was chosen", () => {
    expect(resolveResultDetail({ showCorrectAnswers: false })).toBe("score_only");
    expect(resolveResultDetail({ showCorrectAnswers: true })).toBe("full_key");
    expect(resolveResultDetail({ resultDetail: null, showCorrectAnswers: true })).toBe("full_key");
  });

  it("lets the chosen rung win over the legacy switch", () => {
    expect(resolveResultDetail({ resultDetail: "own_answers", showCorrectAnswers: true })).toBe("own_answers");
    expect(resolveResultDetail({ resultDetail: "full_key", showCorrectAnswers: false })).toBe("full_key");
  });
});
