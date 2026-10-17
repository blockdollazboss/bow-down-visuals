/**
 * Figure-kind decision + measurement tests (lib/world/figure): the
 * default presence is the palace-guard figure once its art loads,
 * the capsule is only the loading/failure fallback, and a vault
 * character always wins over both.
 */
import { describe, it, expect } from "vitest";
import {
  figureKindFor,
  figureWidthForHeight,
  defaultFigureCanvasSize,
  defaultCharacterUrl,
  guardCharacterUrl,
  guardVariantForKey,
  houseGuardVariantForId,
  GUARD_CHARACTER_PATHS,
  HOUSE_GUARD_ID,
  HOUSE_GUARD_FEMALE_ID,
  DEFAULT_FIGURE_HEIGHT,
} from "./figure";

describe("figureKindFor", () => {
  it("a vault character always stands as their portrait", () => {
    expect(figureKindFor(true, "ready")).toBe("portrait");
    expect(figureKindFor(true, "pending")).toBe("portrait");
    expect(figureKindFor(true, "failed")).toBe("portrait");
  });

  it("no character: the guard figure once art is ready; capsule only while pending or failed", () => {
    expect(figureKindFor(false, "ready")).toBe("default");
    expect(figureKindFor(false, "pending")).toBe("capsule");
    expect(figureKindFor(false, "failed")).toBe("capsule");
  });
});

describe("figure measurements", () => {
  it("width follows the art's aspect at life-size height — never stretched", () => {
    expect(figureWidthForHeight(DEFAULT_FIGURE_HEIGHT, 0.5)).toBeCloseTo(0.96);
    expect(figureWidthForHeight(2, 0.45)).toBeCloseTo(0.9);
  });

  it("wild aspects are clamped to a humanoid band", () => {
    expect(figureWidthForHeight(2, 10)).toBeCloseTo(3);
    expect(figureWidthForHeight(2, 0.01)).toBeCloseTo(0.5);
    expect(figureWidthForHeight(2, Number.NaN)).toBeCloseTo(1);
  });

  it("the canvas matches the art's aspect (cover-fit lands edge-to-edge)", () => {
    const { w, h } = defaultFigureCanvasSize(0.5);
    expect(h).toBe(768);
    expect(w).toBe(384);
    expect(defaultFigureCanvasSize(2).w).toBeLessThanOrEqual(1024);
    expect(defaultFigureCanvasSize(0).w).toBeGreaterThanOrEqual(128);
  });

  it("the slot URL is BASE_URL-aware, like the hall's textures", () => {
    expect(defaultCharacterUrl("/")).toBe("/world/default-character.png");
    expect(defaultCharacterUrl("/app/")).toBe("/app/world/default-character.png");
  });
});

describe("the two house guards", () => {
  it("both slots are named — the male guard keeps the original slot", () => {
    expect(GUARD_CHARACTER_PATHS.male).toBe("/world/default-character.png");
    expect(GUARD_CHARACTER_PATHS.female).toBe("/world/default-character-female.png");
    expect(guardCharacterUrl("/", "female")).toBe("/world/default-character-female.png");
    expect(guardCharacterUrl("/app/", "male")).toBe("/app/world/default-character.png");
  });

  it("house pick ids map to their guard — vault ids and no pick map to nothing", () => {
    expect(houseGuardVariantForId(HOUSE_GUARD_ID)).toBe("male");
    expect(houseGuardVariantForId(HOUSE_GUARD_FEMALE_ID)).toBe("female");
    expect(houseGuardVariantForId("char-nova")).toBeNull();
    expect(houseGuardVariantForId(null)).toBeNull();
    expect(houseGuardVariantForId(undefined)).toBeNull();
  });

  it("the deal is deterministic — same key, same guard, every call", () => {
    for (const key of ["thy-cheat-code", "peer-1", "some-long-slug-xyz", ""]) {
      expect(guardVariantForKey(key)).toBe(guardVariantForKey(key));
    }
  });

  it("the deal actually deals both guards across a crowd of presences", () => {
    const dealt = new Set(Array.from({ length: 200 }, (_, i) => guardVariantForKey(`peer-${i}`)));
    expect(dealt).toEqual(new Set(["male", "female"]));
  });
});
