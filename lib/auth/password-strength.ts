/**
 * The four password rules the server enforces, mirrored in the browser.
 *
 * `backend/apps/users/passwords.py` maps Django's validators to Persian messages, and a sign-up that fails
 * one of them costs a round trip and reads as a rejection after the fact. Checking the same four rules as
 * the user types turns that into guidance instead.
 *
 * This is a *mirror*, not a substitute: the server re-validates everything and its answer wins. Two of the
 * four cannot be reproduced exactly offline, and both are deliberately conservative here so the client never
 * says «strong» about something the server will refuse —
 *   - `CommonPasswordValidator` reads a list of roughly a million leaked passwords. Bundling that is not
 *     worth it, so the client checks a short list of the passwords people actually try first.
 *   - `UserAttributeSimilarityValidator` uses `SequenceMatcher` ratios against every user attribute. The
 *     client only has the name and address on this form, and containment is a stricter test than a 0.7
 *     ratio, so anything it passes could still be refused — never the reverse.
 */

export interface PasswordRule {
  key: "length" | "numeric" | "similar" | "common";
  /** What the user has to do, in the imperative. Reads correctly whether it is met or not. */
  label: string;
  met: boolean;
}

/** Deliberately short: the server holds the real list, and this only catches the first thing people type. */
const COMMON = new Set([
  "password", "passw0rd", "password1", "password123", "123456", "12345678", "123456789", "1234567890",
  "qwerty", "qwerty123", "abc123", "abcdef", "abcdefg", "111111", "000000", "123123", "112233",
  "iloveyou", "letmein", "welcome", "welcome1", "admin", "admin123", "root", "test", "test123",
  "changeme", "sunshine", "princess", "football", "baseball", "superman", "batman", "dragon", "monkey",
  "master", "shadow", "michael", "jennifer", "pass123", "pass1234", "qazwsx", "zxcvbn", "zxcvbnm",
  "examora", "examora123", "examora1234", "student", "student123", "teacher", "teacher123", "school",
  "school123", "tehran", "tehran123", "iran", "iran123", "1403", "1404", "1405",
]);

/** Lower-cased fragments of the account that a password must not be built out of. */
function identityParts(name: string, email: string): string[] {
  const local = email.split("@")[0] ?? "";
  const parts = [...name.trim().split(/\s+/), ...local.split(/[._\-+\d]+/), email.trim()];
  return parts
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3);
}

export function passwordRules(password: string, identity: { name?: string; email?: string } = {}): PasswordRule[] {
  const value = password;
  const lower = value.toLowerCase();
  const parts = identityParts(identity.name ?? "", identity.email ?? "");
  // Code points, not UTF-16 units: that is what Python's `len()` counts, and the server's length rule is
  // the one this has to agree with.
  const length = [...value].length;

  return [
    {
      key: "length",
      label: "دست‌کم ۸ کاراکتر",
      met: length >= 8,
    },
    {
      key: "numeric",
      label: "فقط از عدد تشکیل نشده باشد",
      // An empty password is not "entirely numeric", and showing this rule as already met before anyone has
      // typed would be the one green tick that means nothing.
      //
      // `\p{Nd}` rather than `\d`: Django's validator calls `str.isdigit()`, which is Unicode-aware, so
      // «۲۴۶۸» is refused server-side. An ASCII-only mirror here would have shown all four rules green for
      // a password the server was about to reject.
      met: length > 0 && !/^[\p{Nd}]+$/u.test(value),
    },
    {
      key: "similar",
      label: "به نام یا ایمیل شما شبیه نباشد",
      met: length > 0 && !parts.some((part) => lower.includes(part) || part.includes(lower)),
    },
    {
      key: "common",
      label: "از گذرواژه‌های رایج نباشد",
      met: length > 0 && !COMMON.has(lower),
    },
  ];
}

export interface PasswordStrength {
  rules: PasswordRule[];
  /** 0–4. The bars shown, and the only figure the server-side check is allowed to disagree with upwards. */
  score: number;
  label: string;
  /** Tailwind classes for the bars and the label, so the four levels stay visually distinct in both themes. */
  barClass: string;
  textClass: string;
}

const LEVELS: Array<{ label: string; barClass: string; textClass: string }> = [
  { label: "خیلی ضعیف", barClass: "bg-destructive", textClass: "text-destructive" },
  { label: "ضعیف", barClass: "bg-destructive", textClass: "text-destructive" },
  { label: "متوسط", barClass: "bg-warning", textClass: "text-warning" },
  { label: "خوب", barClass: "bg-primary", textClass: "text-primary" },
  { label: "قوی", barClass: "bg-success", textClass: "text-success" },
];

/**
 * Rules met, plus one level of credit for real variety.
 *
 * Counting the rules alone caps a password at «خوب»: eight characters of lowercase letters satisfies all
 * four and is still a weak password. Length and character-class variety are what the rules cannot express,
 * so they move the last step — but never past a rule that is unmet, or the meter would read «قوی» next to a
 * red «only digits» line.
 */
export function passwordStrength(password: string, identity: { name?: string; email?: string } = {}): PasswordStrength {
  const rules = passwordRules(password, identity);
  const metCount = rules.filter((rule) => rule.met).length;
  const allMet = metCount === rules.length;

  let score: number;
  if (password.length === 0) {
    score = 0;
  } else if (!allMet) {
    // Below the required floor, and the meter says so no matter how long the string is: one unmet rule is
    // «ضعیف», two or more is «خیلی ضعیف». Length cannot buy its way past a rule the server enforces.
    score = metCount >= rules.length - 1 ? 1 : 0;
  } else {
    // All four rules are the floor, not the ceiling: eight lowercase characters clear every one of them and
    // are still a poor password, so length and character-class variety carry the top three levels.
    // Unicode classes, because a Persian password has no case and ASCII `\w` would file every Persian
    // letter as a symbol: letters, digits, punctuation, and mixed case — the last one only Latin can score.
    const classes = [/\p{L}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u, /\p{Ll}/u, /\p{Lu}/u]
      .filter((pattern) => pattern.test(password)).length;
    const length = [...password].length;
    score = length >= 14 && classes >= 3 ? 4 : length >= 10 || classes >= 3 ? 3 : 2;
  }

  const level = LEVELS[score];
  return { rules, score, label: password.length === 0 ? "" : level.label, barClass: level.barClass, textClass: level.textClass };
}
