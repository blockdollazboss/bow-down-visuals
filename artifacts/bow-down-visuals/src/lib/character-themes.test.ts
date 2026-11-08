/**
 * character-themes.test.ts — the CHARACTER_THEMES registry.
 *
 * Pins:
 *  - hygiene: unique ids, complete tuples (name/vibe/primary/
 *    highlight/deep/cardTint), hex colors, and every cardTint is
 *    exactly its primary at 0.08 alpha — the family's own convention;
 *  - resolution: getCharacterTheme falls back to the house theme
 *    for unknown/absent ids instead of rendering unstyled;
 *  - teal-abyss (stack300): the deep-teal court fills the wheel's
 *    one open slot between emerald-throne (145°) and arctic-ice
 *    (187°), at the family's accepted distinctness benchmark
 *    (sapphire-court was admitted at RGB distance 89.4 from its
 *    nearest sibling; teal sits 91.5 / 84.1 from its two nearest).
 */
import { describe, it, expect } from "vitest";
import { CHARACTER_THEMES, getCharacterTheme, themeAlpha } from "./character-themes";

const HEX_RE = /^#[0-9A-F]{6}$/;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function rgbDistance(a: string, b: string): number {
  const pa = rgb(a);
  const pb = rgb(b);
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  if (max === r) return (60 * ((g - b) / d) + 360) % 360;
  if (max === g) return 60 * ((b - r) / d) + 120;
  return 60 * ((r - g) / d) + 240;
}

describe("registry hygiene", () => {
  it("ships unique ids with complete, well-formed tuples", () => {
    const ids = CHARACTER_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of CHARACTER_THEMES) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.vibe.trim().length).toBeGreaterThan(0);
      expect(t.primary).toMatch(HEX_RE);
      expect(t.highlight).toMatch(HEX_RE);
      expect(t.deep).toMatch(HEX_RE);
      /* cardTint is the primary at the family's fixed 0.08 alpha. */
      expect(t.cardTint).toBe(themeAlpha(t.primary, 0.08));
    }
  });

  it("getCharacterTheme resolves real ids and falls back for unknown ones", () => {
    for (const t of CHARACTER_THEMES) {
      expect(getCharacterTheme(t.id)).toBe(t);
    }
    expect(getCharacterTheme("no-such-theme")).toBe(CHARACTER_THEMES[0]);
    expect(getCharacterTheme(null)).toBe(CHARACTER_THEMES[0]);
    expect(getCharacterTheme(undefined)).toBe(CHARACTER_THEMES[0]);
  });
});

describe("teal-abyss — the deep teal court (stack300)", () => {
  const teal = CHARACTER_THEMES.find((t) => t.id === "teal-abyss");

  it("exists with the standard tuple, exactly as censused", () => {
    expect(teal).toBeDefined();
    expect(teal!.name).toBe("Teal Abyss");
    expect(teal!.vibe).toBe("Deep water · pressure · quiet money");
    expect(teal!.primary).toBe("#0F766E");
    expect(teal!.highlight).toBe("#5EEAD4");
    expect(teal!.deep).toBe("#134E4A");
    expect(teal!.cardTint).toBe("rgba(15,118,110,0.08)");
    expect(getCharacterTheme("teal-abyss")).toBe(teal);
  });

  it("its primary hue fills the open slot between emerald and arctic", () => {
    const h = hue(teal!.primary);
    expect(h).toBeGreaterThan(hue("#2ECC71")); /* emerald-throne, 145° */
    expect(h).toBeLessThan(hue("#66D9E8")); /* arctic-ice, 187° */
    expect(h).toBeGreaterThan(170);
    expect(h).toBeLessThan(180);
  });

  it("its primary is a distinct color, not a value shift of a sibling", () => {
    for (const t of CHARACTER_THEMES) {
      if (t.id === "teal-abyss") continue;
      expect(rgbDistance(teal!.primary, t.primary), t.id).toBeGreaterThan(80);
    }
  });
});
