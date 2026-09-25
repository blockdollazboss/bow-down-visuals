import { describe, it, expect } from "vitest";
import {
  COVER_ART_STYLES,
  COVER_ART_RATIOS,
  COVER_ART_TIERS,
  getCoverArtStyle,
  getCoverArtRatio,
  getCoverArtTier,
} from "./cover-art";

describe("cover art style presets", () => {
  it("exposes the five documented presets", () => {
    expect(COVER_ART_STYLES.map((s) => s.key)).toEqual([
      "luxury-gold",
      "dark-moody",
      "vibrant-pop",
      "retro",
      "minimal",
    ]);
  });

  it("every preset has a label, blurb, and swatch", () => {
    for (const s of COVER_ART_STYLES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
      expect(s.swatch.length).toBeGreaterThan(0);
    }
  });

  it("falls back to luxury gold for unknown keys", () => {
    expect(getCoverArtStyle("nope").key).toBe("luxury-gold");
  });
});

describe("cover art aspect ratios", () => {
  it("covers streaming, banner, and story formats", () => {
    expect(COVER_ART_RATIOS.map((r) => r.key)).toEqual(["1:1", "16:9", "9:16"]);
  });

  it("every ratio has a valid CSS aspect value", () => {
    for (const r of COVER_ART_RATIOS) {
      expect(r.css).toMatch(/^\d+ \/ \d+$/);
    }
  });

  it("falls back to square for unknown keys", () => {
    expect(getCoverArtRatio("4:3").key).toBe("1:1");
  });
});

describe("cover art pricing tiers", () => {
  it("standard costs 2 credits, premium costs 3", () => {
    expect(COVER_ART_TIERS.find((t) => t.key === "standard")?.credits).toBe(2);
    expect(COVER_ART_TIERS.find((t) => t.key === "premium")?.credits).toBe(3);
  });

  it("falls back to standard for unknown keys", () => {
    expect(getCoverArtTier("deluxe").key).toBe("standard");
  });
});
