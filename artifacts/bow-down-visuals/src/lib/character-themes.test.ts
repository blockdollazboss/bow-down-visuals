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
 *  - bronze-gladiator + pearl-regency (stack400 D-32/D-33): the
 *    registry grows 12 → 14 — a bronze arena palette and a pearl +
 *    soft ivory palette. Both are METALS/NEUTRALS, not wheel hues:
 *    a hue-wheel slot argument cannot carry them (their primaries
 *    read 25° / 34°, inside the gold cluster), so their admission
 *    rests on the same distance benchmark the family already uses,
 *    argued in VALUE and SATURATION instead of hue — bronze is the
 *    deep, muted metal (saturation ~41%, value ~61%) where
 *    gold-royalty is the bright one (~62% / ~79%) and sunset-blaze
 *    is the saturated orange (~83% / 100%); pearl is a warm near-
 *    neutral (saturation ~11%) — the only sibling quieter is the
 *    deliberately achromatic shadow-noir grey (~11%, hue-less).
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

function hsv(hex: string): { s: number; v: number } {
  const [r, g, b] = rgb(hex).map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return { s: max === 0 ? 0 : (max - min) / max, v: max };
}

describe("registry hygiene", () => {
  it("ships exactly fourteen themes — the twelve proven plus the stack400 pair", () => {
    expect(CHARACTER_THEMES).toHaveLength(14);
  });

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

describe("bronze-gladiator — the bronze arena metal (stack400 D-32)", () => {
  const bronze = CHARACTER_THEMES.find((t) => t.id === "bronze-gladiator");

  it("exists with the standard tuple, exactly as censused", () => {
    expect(bronze).toBeDefined();
    expect(bronze!.name).toBe("Bronze Gladiator");
    expect(bronze!.vibe).toBe("Arena · sand · hard-won glory");
    expect(bronze!.primary).toBe("#9C6642");
    expect(bronze!.highlight).toBe("#DCB287");
    expect(bronze!.deep).toBe("#5C3A21");
    expect(bronze!.cardTint).toBe("rgba(156,102,66,0.08)");
    expect(getCharacterTheme("bronze-gladiator")).toBe(bronze);
  });

  it("is the deep, muted metal — distinct from gold and sunset in value + saturation, not hue", () => {
    const b = hsv(bronze!.primary);
    const gold = hsv("#C9A84C"); /* gold-royalty */
    const sunset = hsv("#FF922B"); /* sunset-blaze */
    /* Bronze reads darker AND quieter than both warm siblings. */
    expect(b.v).toBeLessThan(gold.v);
    expect(b.v).toBeLessThan(sunset.v);
    expect(b.s).toBeLessThan(gold.s);
    expect(b.s).toBeLessThan(sunset.s);
    /* …and still a metal, not a brown paint: it stays off the floor. */
    expect(b.v).toBeGreaterThan(0.55);
    expect(b.s).toBeGreaterThan(0.35);
  });

  it("its primary clears the family's RGB distance benchmark from every sibling", () => {
    for (const t of CHARACTER_THEMES) {
      if (t.id === "bronze-gladiator") continue;
      expect(rgbDistance(bronze!.primary, t.primary), t.id).toBeGreaterThan(80);
    }
  });
});

describe("pearl-regency — the pearl + soft ivory neutral (stack400 D-33)", () => {
  const pearl = CHARACTER_THEMES.find((t) => t.id === "pearl-regency");

  it("exists with the standard tuple, exactly as censused", () => {
    expect(pearl).toBeDefined();
    expect(pearl!.name).toBe("Pearl Regency");
    expect(pearl!.vibe).toBe("Pearl · ivory · quiet ceremony");
    expect(pearl!.primary).toBe("#DCCEB8");
    expect(pearl!.highlight).toBe("#FBF7EE");
    expect(pearl!.deep).toBe("#9A8B72");
    expect(pearl!.cardTint).toBe("rgba(220,206,184,0.08)");
    expect(getCharacterTheme("pearl-regency")).toBe(pearl);
  });

  it("is the shelf's palest warm identity — near-neutral saturation, high value", () => {
    const p = hsv(pearl!.primary);
    /* Every CHROMATIC sibling is far more saturated; the only theme
       as quiet is shadow-noir, whose primary is an achromatic grey
       (hue-less by design) — pearl stays a warm ivory, not a grey. */
    for (const t of CHARACTER_THEMES) {
      if (t.id === "pearl-regency" || t.id === "shadow-noir") continue;
      expect(p.s, t.id).toBeLessThan(hsv(t.primary).s);
    }
    expect(p.s).toBeLessThan(0.2);
    expect(p.v).toBeGreaterThan(0.8);
    expect(hue(pearl!.primary)).toBeGreaterThan(30);
    expect(hue(pearl!.primary)).toBeLessThan(50);
  });

  it("clears the distance benchmark from its nearest sibling (arctic-ice)", () => {
    expect(rgbDistance(pearl!.primary, "#66D9E8")).toBeGreaterThan(80);
    for (const t of CHARACTER_THEMES) {
      if (t.id === "pearl-regency") continue;
      expect(rgbDistance(pearl!.primary, t.primary), t.id).toBeGreaterThan(60);
    }
  });
});
