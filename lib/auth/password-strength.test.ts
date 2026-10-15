import { describe, expect, it } from "vitest";
import { passwordRules, passwordStrength } from "@/lib/auth/password-strength";

/**
 * The four rules the server enforces, checked here because a meter that disagrees with Django is worse than
 * no meter: it either waves through a sign-up that then fails, or refuses a password that would have worked.
 *
 * `backend/apps/users/passwords.py` is the other half of this contract — MinimumLengthValidator(8),
 * NumericPasswordValidator, UserAttributeSimilarityValidator and CommonPasswordValidator.
 */
const met = (password: string, key: string, identity?: { name?: string; email?: string }) =>
  passwordRules(password, identity).find((rule) => rule.key === key)?.met;

describe("the length rule", () => {
  it("draws the line at eight characters, exactly where the server draws it", () => {
    expect(met("1234567", "length")).toBe(false);
    expect(met("12345678", "length")).toBe(true);
  });
});

describe("the all-numeric rule", () => {
  it("refuses a password made only of digits", () => {
    expect(met("24681357", "numeric")).toBe(false);
  });

  it("accepts one that merely contains digits", () => {
    expect(met("tehran-2468", "numeric")).toBe(true);
  });

  it("counts Persian digits as digits, because Django's isdigit() does", () => {
    expect(met("۲۴۶۸۱۳۵۷", "numeric")).toBe(false);
    expect(met("تهران-۲۴۶۸", "numeric")).toBe(true);
  });

  it("does not congratulate an empty field for being non-numeric", () => {
    // The one green tick that would mean nothing: nothing has been typed yet.
    expect(met("", "numeric")).toBe(false);
  });
});

describe("the similarity rule", () => {
  const identity = { name: "سارا محمدی", email: "Sara.Mohadi@school.ir" };

  it("catches the address, the local part, and each part of it", () => {
    expect(met("sara.mohadi", "similar", identity)).toBe(false);
    expect(met("SARA2468", "similar", identity)).toBe(false);
    expect(met("mohadi-2468-x", "similar", identity)).toBe(false);
  });

  it("catches the Persian name as well as the Latin one", () => {
    expect(met("سارا۲۴۶۸", "similar", identity)).toBe(false);
  });

  it("leaves an unrelated password alone", () => {
    expect(met("کوهستان-۲۴۶۸", "similar", identity)).toBe(true);
  });

  it("never lets the two-letter country code in every address block a password", () => {
    // "ir" is a fragment of "iranian" and of every address at this school; at three characters minimum it
    // is not a fragment anyone builds a password from.
    expect(met("iranian-2468-x", "similar", { name: "سارا", email: "sara@school.ir" })).toBe(true);
  });

  it("ignores fragments too short to mean anything", () => {
    expect(met("xy-2468", "similar", { name: "", email: "ab@school.ir" })).toBe(true);
  });
});

describe("the common-password rule", () => {
  it("refuses the handful people try first", () => {
    expect(met("12345678", "common")).toBe(false);
    expect(met("PASSWORD", "common")).toBe(false);
    expect(met("examora1234", "common")).toBe(false);
  });

  it("accepts anything else, because the server holds the real list", () => {
    expect(met("بارانبهار", "common")).toBe(true);
  });
});

describe("the score", () => {
  it("has no level for an empty field", () => {
    expect(passwordStrength("").label).toBe("");
    expect(passwordStrength("").score).toBe(0);
  });

  it("cannot be talked into a good score by length alone", () => {
    // Twenty-four digits: long, varied-looking to a naive counter, and still refused by the server.
    expect(passwordStrength("246813579753135797531357").score).toBe(1);
    expect(passwordStrength("246813579753135797531357").label).toBe("ضعیف");
  });

  it("reserves the bottom level for a password that breaks several rules at once", () => {
    // Too short, all digits, and on the common list.
    expect(passwordStrength("1234").score).toBe(0);
    expect(passwordStrength("1234").label).toBe("خیلی ضعیف");
  });

  it("treats the four rules as a floor, not a ceiling", () => {
    // Clears every rule and is still a poor password: nine letters, one character class, no digits.
    expect(passwordStrength("بارانبهار").score).toBe(2);
  });

  it("rewards length and variety above the floor", () => {
    expect(passwordStrength("کوهستان-۲۴۶۸").score).toBe(3);
    expect(passwordStrength("کوهستان-2468-Ab!").score).toBe(4);
  });

  it("marks every rule met at the top level, so the bar and the checklist can never contradict", () => {
    const { rules, score } = passwordStrength("کوهستان-2468-Ab!");
    expect(score).toBe(4);
    expect(rules.every((rule) => rule.met)).toBe(true);
  });

  it("drops a password that is close to the account below the floor however strong it looks", () => {
    const { score, rules } = passwordStrength("Sara.Mohadi-2468-Ab!", { name: "سارا محمدی", email: "Sara.Mohadi@school.ir" });
    expect(score).toBeLessThanOrEqual(1);
    expect(rules.find((rule) => rule.key === "similar")?.met).toBe(false);
  });
});
