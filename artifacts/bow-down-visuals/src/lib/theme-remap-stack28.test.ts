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

describe("item 37 — border remap gaps closed (A4-E1/E2)", () => {
  it("border-white/12 takes the [0.12] bracket value", () => {
    expect(css).toContain(
      `.light .border-white\\/12${GUARDED} { border-color: rgb(231 217 188 / 0.85); }`,
    );
    expect(css).toContain(`.light .border-white\\/\\[0\\.12\\]${GUARDED}`);
  });

  it("border-white/[0.09] joins the [0.06]–[0.10] champagne group", () => {
    expect(css).toContain(`.light .border-white\\/\\[0\\.09\\]${GUARDED},`);
    const anchor = css.indexOf(".light .border-white\\/\\[0\\.09\\]");
    expect(anchor).toBeGreaterThan(-1);
    expect(css.slice(anchor, anchor + 400)).toContain("{ border-color: #EDE3CB; }");
  });
});

describe("item 38 — pale 100/200 variants deepen to their 700 steps (A4-D3)", () => {
  it.each([
    ["text-emerald-100\\/80", "rgb(4 120 87 / 0.88)"],
    ["text-emerald-100\\/60", "rgb(4 120 87 / 0.78)"],
    ["text-red-100\\/80", "rgb(185 28 28 / 0.88)"],
    ["text-green-100\\/85", "rgb(21 128 61 / 0.9)"],
    ["text-sky-200\\/90", "rgb(3 105 161 / 0.92)"],
    ["text-sky-200\\/70", "rgb(3 105 161 / 0.82)"],
    ["text-emerald-200\\/90", "rgb(4 120 87 / 0.92)"],
    ["text-emerald-200\\/80", "rgb(4 120 87 / 0.88)"],
    ["text-blue-200\\/80", "rgb(29 78 216 / 0.88)"],
  ])("%s has a guarded .light rule", (cls, value) => {
    expect(css).toContain(`.light .${cls}${GUARDED} { color: ${value}; }`);
  });

  it("text-blue-200 (no rule at all before) deepens to blue-700", () => {
    expect(css).toContain(`.light .text-blue-200${GUARDED} { color: #1D4ED8; }`);
  });

  it("the base steps the variants hang off are still covered", () => {
    expect(css).toContain(`.light .text-emerald-200${GUARDED} { color: #047857; }`);
    expect(css).toContain(`.light .text-sky-200${GUARDED} { color: #0369A1; }`);
    expect(css).toContain(`.light .text-red-100${GUARDED}`);
  });
});

describe("item 39 — gradient ends to-[#0d0a04] / to-[#0d0d0d] fade to ivory (A4-A1/A2/A3)", () => {
  it.each(["0d0a04", "0d0d0d"])("to-[#%s] has a guarded .light rule", (hex) => {
    expect(css).toContain(`.light .to-\\[\\#${hex}\\]${GUARDED}`);
  });

  it("the ends land on the to-[#0b0603] ivory value", () => {
    const anchor = css.indexOf(".light .to-\\[\\#0d0a04\\]");
    expect(anchor).toBeGreaterThan(-1);
    expect(css.slice(anchor, anchor + 500)).toContain(
      "--tw-gradient-to: rgb(250 247 240 / 0.95) var(--tw-gradient-to-position);",
    );
  });

  it("the from-[#171208] / from-[#14100a] partners were already covered (pairing intact)", () => {
    expect(css).toContain(`.light .from-\\[\\#171208\\]${GUARDED}`);
    expect(css).toContain(`.light .from-\\[\\#14100a\\]${GUARDED}`);
    expect(css).toContain(`.light .from-\\[\\#1a1408\\]${GUARDED}`);
  });
});
