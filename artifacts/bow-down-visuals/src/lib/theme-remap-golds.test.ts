/**
 * Stack-27 F7 — light-theme remap pins (A5 theme audit, items S27-50..66).
 *
 * The defect family: index.css's gold-deepening tables covered the NAMED
 * gold classes (text-amber-400 …) and a few arbitrary hexes (#C9A84C,
 * #E8C86A, #e8c86a), but NOT the arbitrary pale-gold hexes below — they
 * are distinct, case-sensitive class names, so credit-history, the
 * BroadcastStudio headings, the live side panels, GuestPanel/live-guest,
 * beats, shoutouts, the jewelry totals, the editor section cards, the
 * settings header, the label-pitch badge and the create mode icon all
 * rendered ~1.5–1.7:1 straw on ivory. One table addition per hex (to the
 * same antique-gold target as the named equivalents) heals them all;
 * these pins keep the rules from being trimmed away again.
 *
 * Companion pins:
 *  - bg-white/[0.06]/[0.07]/[0.08] join the §19 ghost-card group (S27-65).
 *  - Composer/PostCard money surfaces branch their GROUND in-file —
 *    their dark gradient start (#1a1408) is remapped to an ivory scrim,
 *    so a table fix on the ink alone could never heal them (S27-59).
 *  - MilestoneTracker medal hexes are generic grays and must NEVER be
 *    table-added; they branch in-file via textLight (S27-60).
 *  - SharkRunner HUD icons branch on the `light` prop exactly like
 *    RoyalSkeetGame (S27-66).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/social/Composer.tsx", import.meta.url), "utf8");
const postCard = readFileSync(new URL("../components/social/PostCard.tsx", import.meta.url), "utf8");
const milestones = readFileSync(new URL("../components/analytics-hub/MilestoneTracker.tsx", import.meta.url), "utf8");
const sharkRunner = readFileSync(new URL("../components/arcade/SharkRunnerGame.tsx", import.meta.url), "utf8");
const royalSkeet = readFileSync(new URL("../components/arcade/RoyalSkeetGame.tsx", import.meta.url), "utf8");

const GUARDED = ":not([data-dark-lock]):not([data-dark-lock] *)";
const PALE_GOLDS = ["fbbf24", "E3C566", "E8CE7A", "F5D576", "f7dd7f", "f5e08c", "e8c96a"];

describe("pale-gold arbitrary hexes deepen in light (S27-50..58, 62..64)", () => {
  it.each(PALE_GOLDS)("text-[#%s] has a guarded .light rule", (hex) => {
    expect(css).toContain(`.light .text-\\[\\#${hex}\\]${GUARDED}`);
  });

  it("the group lands on the named equivalents' antique gold #8A6B1F", () => {
    // The grouped rule closes with the §5 target, same as text-amber-400.
    const anchor = css.indexOf(".light .text-\\[\\#fbbf24\\]");
    expect(anchor).toBeGreaterThan(-1);
    const groupTail = css.slice(anchor, anchor + 900);
    expect(groupTail).toContain("{ color: #8A6B1F; }");
  });

  it("every new rule is light-scoped — no html:not(.light) or unscoped copy exists", () => {
    for (const hex of PALE_GOLDS) {
      const bare = `.text-\\[\\#${hex}\\]`;
      const occurrences = css.split(bare).length - 1;
      const lightScoped = css.split(`.light ${bare}`).length - 1;
      expect(occurrences).toBe(lightScoped);
    }
  });

  it("opacity variants that exist in the codebase are covered with stepped bronze", () => {
    expect(css).toContain(`.light .text-\\[\\#fbbf24\\]\\/80${GUARDED} { color: rgb(138 107 31 / 0.92); }`);
    expect(css).toContain(`.light .text-\\[\\#fbbf24\\]\\/60${GUARDED} { color: rgb(138 107 31 / 0.8); }`);
    expect(css).toContain(`.light .text-\\[\\#fbbf24\\]\\/50${GUARDED} { color: rgb(138 107 31 / 0.74); }`);
    expect(css).toContain(`.light .text-\\[\\#e8c96a\\]\\/70${GUARDED} { color: rgb(138 107 31 / 0.86); }`);
  });

  it("hover / group-hover forms deepen instead of flashing straw", () => {
    expect(css).toContain(`.light .hover\\:text-\\[\\#fbbf24\\]:hover${GUARDED} { color: #7A5A12; }`);
    expect(css).toContain(`.light .group:hover .group-hover\\:text-\\[\\#e8c96a\\]${GUARDED} { color: #6E5514; }`);
  });

  it("the jewelry spinner/total hex (#E8CE7A) is in the healed group (S27-57)", () => {
    expect(css).toContain(`.light .text-\\[\\#E8CE7A\\]${GUARDED}`);
  });
});

describe("ghost fills [0.06]/[0.07]/[0.08] join the §19 group (S27-65)", () => {
  it.each(["0\\.06", "0\\.07", "0\\.08"])("bg-white/[%s] is in the ghost-card rule", (bracket) => {
    expect(css).toContain(`.light .bg-white\\/\\[${bracket}\\]${GUARDED}`);
  });

  it("the group keeps the §17 ghost values (marble fill + champagne border)", () => {
    const anchor = css.indexOf(".light .bg-white\\/\\[0\\.06\\]");
    expect(anchor).toBeGreaterThan(-1);
    const groupTail = css.slice(anchor, anchor + 700);
    expect(groupTail).toContain("background-color: rgb(255 255 255 / 0.85);");
    expect(groupTail).toContain("border-color: rgb(231 217 188 / 0.9);");
  });
});

describe("Composer / PostCard money surfaces branch their ground in-file (S27-59)", () => {
  it("Composer nudge: ivory-champagne ground + bronze ink in light, authored dark gradient kept", () => {
    expect(composer).toContain('isLight ? "bg-gradient-to-r from-[#F4E7C3] to-[#FCF7EA]" : "bg-gradient-to-r from-[#1a1408] to-transparent"');
    expect(composer).toContain('isLight ? "text-[#7A5A12]" : "text-[#f5e08c]"');
  });

  it("PostCard earning hint: same light pairing, dark gradient kept", () => {
    expect(postCard).toContain('isLight ? "bg-gradient-to-r from-[#F4E7C3] to-[#FCF7EA]" : "bg-gradient-to-r from-[#1a1408] to-transparent"');
    expect(postCard).toContain('isLight ? "text-[#7A5A12]" : "text-[#f5e08c]"');
  });

  it("PostCard voter's-own poll option: bronze ink in light, straw kept in dark", () => {
    expect(postCard).toContain('isLight ? "text-[#7A5A12]" : "text-[#f5e08c]"');
  });
});

describe("MilestoneTracker medals branch in-file, never table-added (S27-60)", () => {
  it("silver/platinum/diamond carry deeper light tones that still read as their metals", () => {
    expect(milestones).toContain('textLight: "text-[#6B6257]"'); // silver
    expect(milestones).toContain('textLight: "text-[#575046]"'); // platinum
    expect(milestones).toContain('textLight: "text-[#0E7490]"'); // diamond
  });

  it("the badge picks textLight only in light theme", () => {
    expect(milestones).toContain("isLight && s.textLight ? s.textLight : s.text");
  });

  it("the generic medal hexes stay OUT of the global tables", () => {
    expect(css).not.toContain(".text-\\[\\#c0c0c0\\]");
    expect(css).not.toContain(".text-\\[\\#e5e4e2\\]");
    expect(css).not.toContain(".text-\\[\\#b9f2ff\\]");
  });
});

describe("SharkRunner HUD branches like RoyalSkeet (S27-66)", () => {
  it("both touch controls take bronze in light, authored gold in dark", () => {
    // 3 = the two touch controls (S27-66) + the score HUD chip, which
    // was already branched in the same pattern before this lane.
    const occurrences = sharkRunner.split('light ? "text-[#7A5A12]" : "text-[#f0d878]"').length - 1;
    expect(occurrences).toBe(3);
  });

  it("the pattern matches the sibling game's branched chip", () => {
    expect(royalSkeet).toContain('light ? "text-[#7A5A12]" : "text-[#f0d878]"');
  });
});
