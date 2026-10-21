/**
 * The World — capsule color tests (lib/world/capsule-color).
 * The fallback capsule is the house figure: whatever presence tint
 * a member carries, the body must read gold — never skin, never a
 * jewel tone — in either hall look.
 */
import { describe, it, expect } from "vitest";
import {
  capsuleBodyHex,
  hexToHsl,
  HOUSE_GOLD_HEX,
  CAPSULE_HUE_MIN,
  CAPSULE_HUE_MAX,
  CAPSULE_SAT_MIN,
  CAPSULE_SAT_MAX,
  CAPSULE_LIGHT_MIN,
  CAPSULE_LIGHT_MAX,
} from "./capsule-color";

/* The server presence palette (api-server world-room.ts WORLD_TINTS)
 * — every one of these must land in the gold family as a capsule. */
const PRESENCE_TINTS = [
  "#d4af37", // house gold
  "#f0d98c", // pale gold
  "#b8860b", // dark gold
  "#7fd4c1", // jade
  "#8ab6ff", // sapphire mist
  "#e08aff", // amethyst
  "#ff9d7a", // coral — the screenshot's skin-tone peach
  "#a8e07a", // peridot
];

describe("capsule body color", () => {
  it("anchors every presence tint into the gold band", () => {
    for (const tint of PRESENCE_TINTS) {
      const out = hexToHsl(capsuleBodyHex(tint));
      expect(out, tint).not.toBeNull();
      // ±0.5°/±0.01: 8-bit hex storage quantizes the round-trip.
      expect(out!.h, tint).toBeGreaterThanOrEqual(CAPSULE_HUE_MIN - 0.5);
      expect(out!.h, tint).toBeLessThanOrEqual(CAPSULE_HUE_MAX + 0.5);
      expect(out!.s, tint).toBeGreaterThanOrEqual(CAPSULE_SAT_MIN - 0.01);
      expect(out!.s, tint).toBeLessThanOrEqual(CAPSULE_SAT_MAX + 0.01);
      expect(out!.l, tint).toBeGreaterThanOrEqual(CAPSULE_LIGHT_MIN - 0.01);
      expect(out!.l, tint).toBeLessThanOrEqual(CAPSULE_LIGHT_MAX + 0.01);
    }
  });

  it("the coral tint no longer reads as skin", () => {
    const coral = hexToHsl("#ff9d7a")!;
    expect(coral.h).toBeLessThan(25); // skin-adjacent hue going in…
    const out = hexToHsl(capsuleBodyHex("#ff9d7a"))!;
    expect(out.h).toBeGreaterThanOrEqual(CAPSULE_HUE_MIN - 0.5); // …gold coming out
    expect(out.l).toBeLessThanOrEqual(CAPSULE_LIGHT_MAX);
  });

  it("pale gold is deepened so the sunlit hall can't wash it peach", () => {
    const out = hexToHsl(capsuleBodyHex("#f0d98c"))!;
    expect(out.l).toBeLessThanOrEqual(CAPSULE_LIGHT_MAX);
    expect(out.s).toBeGreaterThanOrEqual(CAPSULE_SAT_MIN - 0.01);
  });

  it("house gold stays house gold family, and the map is stable", () => {
    const out = capsuleBodyHex(HOUSE_GOLD_HEX);
    expect(hexToHsl(out)!.h).toBeGreaterThanOrEqual(CAPSULE_HUE_MIN - 0.5);
    expect(hexToHsl(out)!.h).toBeLessThanOrEqual(CAPSULE_HUE_MAX + 0.5);
    for (const tint of PRESENCE_TINTS) {
      expect(capsuleBodyHex(tint)).toBe(capsuleBodyHex(tint));
    }
  });

  it("a non-color tint falls back to house gold; grey becomes gold too", () => {
    expect(capsuleBodyHex("not-a-color")).toBe(HOUSE_GOLD_HEX);
    expect(capsuleBodyHex("")).toBe(HOUSE_GOLD_HEX);
    const grey = hexToHsl(capsuleBodyHex("#808080"))!;
    expect(grey.h).toBeGreaterThanOrEqual(CAPSULE_HUE_MIN - 0.5);
    expect(grey.s).toBeGreaterThanOrEqual(CAPSULE_SAT_MIN - 0.01);
  });
});
