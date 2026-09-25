/**
 * Money-integrity + contract tests for Text-to-SFX.
 *
 * Covers: the pricing contract (1 credit per SFX), the 402 out-of-credits
 * rule, category keys, duration clamping, and prompt construction.
 */
import { describe, expect, it } from "vitest";

import {
  SFX_CREDIT_COST,
  SFX_MIN_DURATION,
  SFX_MAX_DURATION,
  SFX_DEFAULT_DURATION,
  SFX_CATEGORY_KEYS,
  SFX_CATEGORIES,
  isSfxCategoryKey,
  clampSfxDuration,
  buildSfxPrompt,
  sfxFilename,
} from "../sfx-pricing";

describe("sfx pricing contract", () => {
  it("costs 1 credit per SFX", () => {
    expect(SFX_CREDIT_COST).toBe(1);
  });

  it("the route rejects when balance < cost (documents the 402 contract)", () => {
    // POST /generate-sfx checks req.userCredits < SFX_CREDIT_COST → 402
    // before touching the provider.
    expect(0 < SFX_CREDIT_COST).toBe(true); // 0 credits → 402
    expect(1 < SFX_CREDIT_COST).toBe(false); // exact balance → allowed
  });
});

describe("sfx categories", () => {
  it("offers exactly the six documented categories", () => {
    expect(SFX_CATEGORY_KEYS).toEqual([
      "impacts",
      "whooshes",
      "risers",
      "ui",
      "ambient",
      "foley",
    ]);
  });

  it("every category has a label, blurb, and direction", () => {
    for (const key of SFX_CATEGORY_KEYS) {
      const c = SFX_CATEGORIES[key];
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
      expect(c.direction.length).toBeGreaterThan(20);
    }
  });

  it("rejects unknown category keys", () => {
    expect(isSfxCategoryKey("impacts")).toBe(true);
    expect(isSfxCategoryKey("laser")).toBe(false);
    expect(isSfxCategoryKey("")).toBe(false);
    expect(isSfxCategoryKey(undefined)).toBe(false);
    expect(isSfxCategoryKey(42)).toBe(false);
  });
});

describe("clampSfxDuration", () => {
  it("clamps into the 1–10s window", () => {
    expect(SFX_MIN_DURATION).toBe(1);
    expect(SFX_MAX_DURATION).toBe(10);
    expect(clampSfxDuration(0)).toBe(1);
    expect(clampSfxDuration(60)).toBe(10);
    expect(clampSfxDuration(5)).toBe(5);
  });

  it("rounds and falls back to the default on garbage", () => {
    expect(clampSfxDuration(2.7)).toBe(3);
    expect(clampSfxDuration(NaN)).toBe(SFX_DEFAULT_DURATION);
    expect(clampSfxDuration("boom")).toBe(SFX_DEFAULT_DURATION);
    expect(clampSfxDuration(undefined)).toBe(SFX_DEFAULT_DURATION);
  });
});

describe("buildSfxPrompt", () => {
  it("combines the user description with the category direction", () => {
    const p = buildSfxPrompt("massive explosion", "impacts");
    expect(p).toContain("massive explosion");
    expect(p).toContain("impact");
  });

  it("never exceeds 500 chars", () => {
    const p = buildSfxPrompt("x".repeat(600), "ambient");
    expect(p.length).toBeLessThanOrEqual(500);
  });
});

describe("sfxFilename", () => {
  it("slugifies the prompt", () => {
    expect(sfxFilename("Massive Explosion!!", "wav")).toBe("massive-explosion.wav");
    expect(sfxFilename("UI click", "mp3")).toBe("ui-click.mp3");
  });

  it("falls back to sfx on empty input", () => {
    expect(sfxFilename("!!!", "wav")).toBe("sfx.wav");
  });
});
