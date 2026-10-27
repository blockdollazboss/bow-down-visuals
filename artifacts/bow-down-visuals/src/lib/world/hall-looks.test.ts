/**
 * The World — hall look tests (lib/world/hall-looks).
 *
 * The owner picked the King's Hall's two faces (2026-10-16): LIGHT
 * theme wears Look A "Golden Hour Palace", DARK theme wears Look B
 * "Midnight Throne Room", and the room re-skins when the visitor flips
 * the site theme. These tests pin the wiring contract hall-scene.ts
 * builds from — the pure look data — so a future edit can't quietly
 * swap the looks, drop the sun, or move the big screen off centre.
 */
import { describe, it, expect } from "vitest";
import { HALL_LOOKS, HALL_SCREEN, LOOK_FADE_MS, areaWashFor, hallLookFor, lookFadeProgress, normalizeHallTheme } from "./hall-looks";

function luminance(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("normalizeHallTheme", () => {
  it("maps the app's light theme to the light hall", () => {
    expect(normalizeHallTheme("light")).toBe("light");
  });

  it("defaults everything else to the dark hall, like the app shell", () => {
    expect(normalizeHallTheme("dark")).toBe("dark");
    expect(normalizeHallTheme(null)).toBe("dark");
    expect(normalizeHallTheme(undefined)).toBe("dark");
    expect(normalizeHallTheme("")).toBe("dark");
    expect(normalizeHallTheme("sepia")).toBe("dark");
  });
});

describe("the two looks", () => {
  it("light theme is the Golden Hour Palace, dark the Midnight Throne Room", () => {
    expect(hallLookFor("light").name).toBe("Golden Hour Palace");
    expect(hallLookFor("dark").name).toBe("Midnight Throne Room");
    expect(HALL_LOOKS.light.theme).toBe("light");
    expect(HALL_LOOKS.dark.theme).toBe("dark");
  });

  it("the light look is sunlit: windows, sun, beams, dust, chandeliers — no candles", () => {
    const a = hallLookFor("light");
    expect(a.windows).toBe(true);
    expect(a.sun.present).toBe(true);
    expect(a.sun.intensity).toBeGreaterThan(0);
    expect(a.lightBeams).toBe(true);
    expect(a.dust).toBe(true);
    expect(a.chandeliers).toBe(true);
    expect(a.candles).toBe(false);
    expect(a.haze).toBe(false);
    expect(a.columnStyle).toBe("gold-round");
    expect(a.marbleTextureUrl).toContain("marble-cream");
    expect(a.throneFabricTextureUrl).toContain("brocade-gold");
  });

  it("the dark look is candlelit: sconces and braziers, haze, no sun", () => {
    const b = hallLookFor("dark");
    expect(b.candles).toBe(true);
    expect(b.haze).toBe(true);
    expect(b.windows).toBe(false);
    expect(b.sun.present).toBe(false);
    expect(b.lightBeams).toBe(false);
    expect(b.dust).toBe(false);
    expect(b.chandeliers).toBe(false);
    expect(b.columnStyle).toBe("black-square");
    expect(b.marbleTextureUrl).toContain("marble-black");
    expect(b.throneFabricTextureUrl).toContain("velvet-black");
  });

  it("the palaces are honestly brighter than the throne room at midnight", () => {
    const a = hallLookFor("light");
    const b = hallLookFor("dark");
    expect(luminance(a.fogColor)).toBeGreaterThan(luminance(b.fogColor));
    expect(luminance(a.background)).toBeGreaterThan(luminance(b.background));
    expect(a.ambient.intensity + a.hemisphere.intensity).toBeGreaterThan(
      b.ambient.intensity + b.hemisphere.intensity,
    );
  });

  it("both looks keep a true mirror floor under the marble", () => {
    for (const look of [hallLookFor("light"), hallLookFor("dark")]) {
      // The overlay never goes fully opaque — the planar reflection
      // always reads through it — and the polish stays low-roughness.
      expect(look.floorOverlayOpacity).toBeGreaterThan(0.3);
      expect(look.floorOverlayOpacity).toBeLessThan(0.75);
      expect(look.floorRoughness).toBeLessThan(0.15);
    }
  });
});

describe("the plaza daylight trim (#90)", () => {
  it("indoors, both looks keep their authored wash exactly — the hall is untouched", () => {
    for (const theme of ["light", "dark"] as const) {
      const look = hallLookFor(theme);
      const wash = areaWashFor(look, false);
      expect(wash.ambientIntensity).toBe(look.ambient.intensity);
      expect(wash.hemisphereIntensity).toBe(look.hemisphere.intensity);
      expect(wash.sunIntensity).toBeNull();
    }
  });

  it("the dark look is untouched outdoors too — no dark regression", () => {
    const look = hallLookFor("dark");
    const wash = areaWashFor(look, true);
    expect(wash.ambientIntensity).toBe(look.ambient.intensity);
    expect(wash.hemisphereIntensity).toBe(look.hemisphere.intensity);
    expect(wash.sunIntensity).toBeNull();
  });

  it("outdoors in daylight the flat wash and sun ease off the bright paving", () => {
    const look = hallLookFor("light");
    const wash = areaWashFor(look, true);
    // The directionless wash is the contrast killer — it must drop.
    expect(wash.ambientIntensity).toBeLessThan(look.ambient.intensity);
    expect(wash.hemisphereIntensity).toBeLessThan(look.hemisphere.intensity);
    expect(wash.ambientIntensity + wash.hemisphereIntensity).toBeLessThanOrEqual(1.0);
    // The sun stays a real sun (shadows + modelling), just eased.
    expect(wash.sunIntensity).not.toBeNull();
    expect(wash.sunIntensity!).toBeLessThan(look.sun.intensity);
    expect(wash.sunIntensity!).toBeGreaterThan(2.0);
    // Peak stack on the day paving (sun + wash) drops by ~a fifth
    // vs the untrimmed look — the washout margin.
    const before = look.sun.intensity + look.ambient.intensity + look.hemisphere.intensity;
    const after = wash.sunIntensity! + wash.ambientIntensity + wash.hemisphereIntensity;
    expect(after).toBeLessThan(before * 0.85);
    // …while staying honestly sunnier than the night rig.
    expect(after).toBeGreaterThan(1.5);
  });
});

describe("the big screen", () => {
  it("stays centre of the front wall — placement is law, not a theme choice", () => {
    expect(HALL_SCREEN.centerX).toBe(0);
    expect(HALL_SCREEN.width).toBeGreaterThan(10);
    expect(HALL_SCREEN.z).toBeLessThan(-17);
  });

  it("day/night crossfade (Stack-100 #2): a smoothstep over LOOK_FADE_MS, clamped both ends", () => {
    expect(LOOK_FADE_MS).toBeGreaterThanOrEqual(500);
    expect(LOOK_FADE_MS).toBeLessThanOrEqual(1500);
    expect(lookFadeProgress(0)).toBe(0);
    expect(lookFadeProgress(-50)).toBe(0);
    expect(lookFadeProgress(LOOK_FADE_MS)).toBe(1);
    expect(lookFadeProgress(LOOK_FADE_MS * 3)).toBe(1);
    const mid = lookFadeProgress(LOOK_FADE_MS / 2);
    expect(mid).toBeCloseTo(0.5, 6);
    // Monotonic — the ease never runs backwards.
    let prev = 0;
    for (let ms = 0; ms <= LOOK_FADE_MS; ms += LOOK_FADE_MS / 10) {
      const p = lookFadeProgress(ms);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});
