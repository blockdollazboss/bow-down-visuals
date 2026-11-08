/**
 * Tests for the Trending Remix Feed catalog (src/data/trending-presets.ts).
 *
 * The catalog is pure DATA rendered by pages/remix.tsx — every preset
 * deep-links into /video-editor through its remixParams, so each entry
 * must be well-formed on its own. The slug list is pinned in file order:
 * the Stack 200 U5 additions (speed-ramp-surge, ink-splash-reveal) close
 * out their categories, the Stack 300 additions (noir-mono-grade,
 * spin-swap, fade-through, vhs-static-drift) close out theirs, and the
 * pin keeps the count honest at 26.
 */
import { describe, it, expect } from "vitest";
import { TRENDING_PRESETS, getTrendingPreset } from "./trending-presets";

const EXPECTED_SLUGS = [
  /* Motion */
  "bullet-time-hero",
  "crash-zoom-punch",
  "fpv-drone-dive",
  "whip-pan-hero",
  "smooth-dolly-in",
  "floating-fall",
  "world-morph",
  "slow-mo-power-walk",
  "speed-ramp-surge",
  /* Style */
  "gold-luxury-grade",
  "dark-drill-grade",
  "neon-night",
  "vintage-film",
  "anime-pop",
  "noir-mono-grade",
  /* Transition */
  "match-cut-snap",
  "whoosh-wipe",
  "zoom-flash",
  "glitch-cut",
  "spin-swap",
  "fade-through",
  /* Effect */
  "film-grain-storm",
  "light-leaks",
  "particle-burst",
  "ink-splash-reveal",
  "vhs-static-drift",
];

const CATEGORIES = ["Motion", "Style", "Transition", "Effect"];

describe("trending preset catalog", () => {
  it("holds the full pinned catalog (26 presets)", () => {
    expect(TRENDING_PRESETS.map((p) => p.slug)).toEqual(EXPECTED_SLUGS);
  });

  it("uses unique, kebab-case slugs", () => {
    const slugs = TRENDING_PRESETS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug, `slug ${slug}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("round-trips every slug through getTrendingPreset", () => {
    for (const preset of TRENDING_PRESETS) {
      expect(getTrendingPreset(preset.slug)).toBe(preset);
    }
    expect(getTrendingPreset("no-such-preset")).toBeUndefined();
  });

  it("has complete, well-formed fields on every preset", () => {
    for (const preset of TRENDING_PRESETS) {
      expect(preset.name.trim().length, preset.slug).toBeGreaterThan(0);
      expect(preset.description.trim().length, preset.slug).toBeGreaterThan(0);
      expect(CATEGORIES, preset.slug).toContain(preset.category);
      expect(preset.trendScore, preset.slug).toBeGreaterThanOrEqual(1);
      expect(preset.trendScore, preset.slug).toBeLessThanOrEqual(100);
      expect(preset.platform.length, preset.slug).toBeGreaterThanOrEqual(1);
      /* The remix button needs somewhere to go: an fx slug, a transition
         slug, or the feed-built remix fallback. */
      expect(Object.keys(preset.remixParams).length, preset.slug).toBeGreaterThanOrEqual(1);
    }
  });

  it("files every preset under a category with no empty category", () => {
    for (const cat of CATEGORIES) {
      expect(
        TRENDING_PRESETS.some((p) => p.category === cat),
        `category ${cat} is empty`
      ).toBe(true);
    }
  });

  it("the U5 additions land in their census categories with the remix fallback", () => {
    expect(getTrendingPreset("speed-ramp-surge")).toMatchObject({
      name: "Speed Ramp Surge",
      category: "Motion",
      remixParams: { remix: "speed-ramp-surge" },
    });
    expect(getTrendingPreset("ink-splash-reveal")).toMatchObject({
      name: "Ink Splash Reveal",
      category: "Effect",
      remixParams: { remix: "ink-splash-reveal" },
    });
  });

  it("the Stack 300 additions ride the previously unridden editor vocabulary", () => {
    expect(getTrendingPreset("spin-swap")).toMatchObject({
      name: "Spin Swap",
      category: "Transition",
      remixParams: { transition: "tr-spin-in" },
    });
    expect(getTrendingPreset("fade-through")).toMatchObject({
      name: "Fade Through",
      category: "Transition",
      remixParams: { transition: "tr-fade-through" },
    });
    expect(getTrendingPreset("noir-mono-grade")).toMatchObject({
      name: "Noir Mono Grade",
      category: "Style",
      editorEffect: "Black & White",
      remixParams: { fx: "fx-noir" },
    });
    expect(getTrendingPreset("vhs-static-drift")).toMatchObject({
      name: "VHS Static Drift",
      category: "Effect",
      editorEffect: "VHS",
      remixParams: { fx: "fx-static-vhs" },
    });
  });
});
