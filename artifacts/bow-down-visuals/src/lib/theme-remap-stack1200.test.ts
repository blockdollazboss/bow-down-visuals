/**
 * Stack1200 light/dark-everywhere audit — pins for the §21 rungs and the
 * three in-file branches. The census swept every FE surface for the real
 * defect classes (dark gradient slabs, inline-styled dark surfaces,
 * uncovered colour tokens, structure-losing borders); nearly every
 * candidate proved to be a theme ternary's dark branch, a covered remap,
 * a designed preset (bio themes, carousel designs, cover palettes) or a
 * data-dark-lock island. The genuine escapes:
 *
 *  - §21: the platforms' pale screen blues on FinalVideoExport's share
 *    buttons (and the Discord settings icon) and the jackpot d-pad's
 *    hover straw — arbitrary hexes the §5 tables never had.
 *  - analytics-hub's Views chart: Recharts grid/axis ink was hardcoded
 *    cream rgba(247,241,222,*) — invisible on the ivory card in light.
 *  - jewelry's "choose different" logo link: unconditional #DDBB62.
 *  - World's roster "voice off" label: unconditional #e08a6d (its
 *    "deafened" sibling already branched).
 *
 * The pins keep the rungs/branches from being trimmed away, and the
 * scoping test keeps every §21 rule light-only (dark must never move).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const analytics = readFileSync(
  new URL("../pages/analytics-hub.tsx", import.meta.url),
  "utf8",
);
const jewelry = readFileSync(
  new URL("../pages/jewelry.tsx", import.meta.url),
  "utf8",
);
const world = readFileSync(
  new URL("../pages/world.tsx", import.meta.url),
  "utf8",
);
const streamDeck = readFileSync(
  new URL("../components/live/StreamDeck.tsx", import.meta.url),
  "utf8",
);

const GUARDED = ":not([data-dark-lock]):not([data-dark-lock] *)";

const RUNGS: Array<[string, string]> = [
  [`.light .text-\\[\\#6ea8fe\\]${GUARDED}`, "color: #1D6FE0"],
  [`.light .text-\\[\\#8b9bff\\]${GUARDED}`, "color: #4753D8"],
  [`.light .hover\\:text-\\[\\#FFE9A8\\]:hover${GUARDED}`, "color: #8A6B1F"],
];

describe("stack1200 §21 rungs exist, guarded, with their values", () => {
  it.each(RUNGS)("%s", (selector, declaration) => {
    const at = css.indexOf(selector);
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, at + 300)).toContain(declaration);
  });

  it("every §21 selector is light-scoped (no unscoped copy can move dark)", () => {
    const start = css.indexOf("── 21. Stack1200 light/dark everywhere");
    const end = css.indexOf("HOMEPAGE LIGHT MODE", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = css.slice(start, end);
    const selectorLines = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("."));
    expect(selectorLines.length).toBe(3);
    expect(selectorLines.every((l) => l.startsWith(".light"))).toBe(true);
    expect(
      selectorLines.every((l) => l.includes("[data-dark-lock]")),
    ).toBe(true);
  });
});

describe("analytics-hub Views chart ink branches with the theme", () => {
  it("grid and axes take bronze ink in light, cream in dark", () => {
    expect(analytics).toContain(
      'stroke={isLight ? "rgba(122,90,18,0.18)" : "rgba(247,241,222,0.07)"}',
    );
    expect(analytics).toContain(
      'tick={{ fill: isLight ? "rgba(90,70,20,0.75)" : "rgba(247,241,222,0.6)", fontSize: 12 }}',
    );
    expect(analytics).not.toContain(
      '<CartesianGrid strokeDasharray="3 3" stroke="rgba(247,241,222,0.07)" />',
    );
  });
});

describe("pale one-off labels branch like their siblings", () => {
  it("jewelry choose-different link deepens in light", () => {
    expect(jewelry).toContain(
      'isLight ? "text-[#7A5A12]" : "text-[#DDBB62]"',
    );
    expect(jewelry).not.toContain(
      'className="mt-3 text-sm text-[#DDBB62] hover:underline"',
    );
  });

  it("world roster voice-off label deepens in light", () => {
    expect(world).toContain(
      'isLight ? "text-[#A8432A]" : "text-[#e08a6d]"',
    );
    expect(world).not.toContain(
      'className="text-[11px] font-semibold text-[#e08a6d]"',
    );
  });
});

describe("the StreamDeck dark island keeps its lock", () => {
  it("deck root is data-dark-lock (deliberate dark control surface)", () => {
    expect(streamDeck).toContain('<div className="w-full" data-dark-lock>');
  });
});
