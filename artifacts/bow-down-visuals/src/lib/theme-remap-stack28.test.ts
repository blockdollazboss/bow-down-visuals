/**
 * Stack-28 L5 — light-theme remap pins (A4 audit, board items 35–42).
 *
 * Every finding in a4-theme.md was a table gap, not a design: the class
 * existed in the shipped tree, its labels/ink remapped in light, but the
 * surface/border/gradient rung itself had no `.light` rule, so it stayed
 * near-black (or vanished) while its content went dark-on-dark. Each
 * describe below pins one board item's table additions so the rungs
 * cannot be trimmed away again. All rules are `.light`-scoped with the
 * standard data-dark-lock guards — dark rendering is untouched, and
 * deliberate dark-locked surfaces (Stream Controller deck, locked
 * players) keep their authored treatment.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

const GUARDED = ":not([data-dark-lock]):not([data-dark-lock] *)";

describe("item 35 — DAW rail hexes join the §18 bg sweep (A4-D1)", () => {
  it.each(["171208", "241b08"])("bg-[#%s] has a guarded .light rule in the marble group", (hex) => {
    expect(css).toContain(`.light .bg-\\[\\#${hex}\\]${GUARDED}`);
  });

  it("the group still lands on marble white", () => {
    const anchor = css.indexOf(".light .bg-\\[\\#171208\\]");
    expect(anchor).toBeGreaterThan(-1);
    const groupTail = css.slice(anchor, anchor + 1200);
    expect(groupTail).toContain("background-color: #FFFFFF;");
  });

  it("the DAW sources keep their authored classes (table fix, no redesign)", () => {
    const arrangement = readFileSync(
      new URL("../components/audio-studio/ArrangementStudio.tsx", import.meta.url),
      "utf8",
    );
    const pianoRoll = readFileSync(
      new URL("../components/audio-studio/PianoRoll.tsx", import.meta.url),
      "utf8",
    );
    expect(arrangement).toContain("bg-[#171208]");
    expect(arrangement).toContain("bg-[#241b08]");
    expect(pianoRoll).toContain("bg-[#171208]");
  });
});

describe("item 36 — text-amber-100 opacity ladder is complete (A4-D2)", () => {
  it.each([
    ["90", "0.92"],
    ["80", "0.88"],
    ["75", "0.86"],
    ["70", "0.85"],
    ["60", "0.8"],
    ["50", "0.74"],
    ["40", "0.68"],
  ])("text-amber-100/%s deepens to stepped antique gold", (rung, alpha) => {
    expect(css).toContain(
      `.light .text-amber-100\\/${rung}${GUARDED} { color: rgb(138 107 31 / ${alpha}); }`,
    );
  });

  it("the base rule is untouched", () => {
    expect(css).toContain(`.light .text-amber-100${GUARDED},`);
  });
});
