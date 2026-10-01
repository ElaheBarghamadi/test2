import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A wide table must come with a phone alternative.
 *
 * The teacher and admin screens are the ones a phone actually opens: a teacher checking who has finished, a
 * principal adding an account. A `min-w-[840px]` table inside `overflow-x-auto` "works" in the sense that
 * nothing breaks, and it hides the status column and the action button off the right edge of a 360px screen -
 * which is the two things the page exists for. Every such table therefore has to render a card list below
 * `sm`, and this test is the thing that notices when a new one is added without it.
 *
 * There is no allow-list. If a genuinely tabular, scroll-only screen ever appears, it should be named here
 * with the reason, so the exception reads as a decision instead of an oversight.
 */
const ALLOWED_WITHOUT_CARDS: string[] = [];

const ROOTS = ["app", "components"];
const WIDE_TABLE = /<table[^>]*min-w-\[(\d+)px\]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe("responsive tables", () => {
  const projectRoot = path.resolve(__dirname, "../..");
  const files = ROOTS.flatMap((root) => sourceFiles(path.join(projectRoot, root)));

  it("covers every screen that renders a table", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("gives every table wider than 640px a card list for phones", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const relative = path.relative(projectRoot, file);
      if (ALLOWED_WITHOUT_CARDS.includes(relative)) continue;
      for (const match of source.matchAll(WIDE_TABLE)) {
        if (Number(match[1]) < 640) continue;
        // The card list is what makes the table below `sm` unnecessary: it has to exist, and it has to come
        // before the table's own wrapper, which must in turn be hidden under `sm`. Catches both a missing card
        // list and the inverted mistake of a card list that is hidden at every width.
        const cardAt = source.search(/sm:hidden/);
        const desktopAt = source.search(/hidden[^"`']*sm:block/);
        if (cardAt < 0) offenders.push(`${relative} (${match[1]}px): no card list`);
        else if (desktopAt < 0 || desktopAt < cardAt) offenders.push(`${relative} (${match[1]}px): table is not desktop-only`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
