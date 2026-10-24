import { describe, expect, it } from "vitest";
import {
  WALLPAPER_PRESETS,
  THEME_PACK_PRESET_KEYS,
  buildThemeConfigFromPalette,
  extractPalette,
  relativeLuminance,
  wallpaperPresetByKey,
} from "./wallpapers";
import { presetById } from "./artist-profiles";

const HEX = /^#[0-9a-f]{6}$/;

describe("WALLPAPER_PRESETS — exact device pixels (pinned contract)", () => {
  it("carries exactly the 15 presets with their literal dimensions", () => {
    expect(WALLPAPER_PRESETS).toEqual([
      { key: "phone-iphone-promax", kind: "phone", label: "iPhone Pro Max", width: 1320, height: 2868 },
      { key: "phone-iphone-pro", kind: "phone", label: "iPhone Pro", width: 1206, height: 2622 },
      { key: "phone-iphone", kind: "phone", label: "iPhone", width: 1179, height: 2556 },
      { key: "phone-android-flagship", kind: "phone", label: "Android Flagship", width: 1440, height: 3120 },
      { key: "phone-android", kind: "phone", label: "Android", width: 1080, height: 2400 },
      { key: "tablet-ipad-pro", kind: "tablet", label: "iPad Pro", width: 2048, height: 2732 },
      { key: "tablet-ipad", kind: "tablet", label: "iPad", width: 1640, height: 2360 },
      { key: "tablet-ipad-mini", kind: "tablet", label: "iPad mini", width: 1488, height: 2266 },
      { key: "desktop-fhd", kind: "desktop", label: "Desktop Full HD", width: 1920, height: 1080 },
      { key: "laptop-macbook-14", kind: "desktop", label: "MacBook Pro 14\"", width: 3024, height: 1964 },
      { key: "laptop-16-10", kind: "desktop", label: "Laptop 16:10", width: 2880, height: 1800 },
      { key: "desktop-qhd", kind: "desktop", label: "Desktop QHD", width: 2560, height: 1440 },
      { key: "desktop-4k", kind: "desktop", label: "Desktop 4K", width: 3840, height: 2160 },
      { key: "desktop-5k", kind: "desktop", label: "Desktop 5K", width: 5120, height: 2880 },
      { key: "desktop-ultrawide", kind: "desktop", label: "Ultrawide", width: 3440, height: 1440 },
    ]);
  });

  it("resolves presets by key, with a safe fallback", () => {
    expect(wallpaperPresetByKey("desktop-4k").width).toBe(3840);
    expect(wallpaperPresetByKey("nope")).toBe(WALLPAPER_PRESETS[0]);
  });

  it("the theme pack is phone + lock (same preset) + desktop FHD", () => {
    expect(THEME_PACK_PRESET_KEYS).toEqual({
      phone: "phone-iphone",
      lockScreen: "phone-iphone",
      desktop: "desktop-fhd",
    });
    expect(THEME_PACK_PRESET_KEYS.lockScreen).toBe(THEME_PACK_PRESET_KEYS.phone);
  });
});

describe("relativeLuminance", () => {
  it("reads black as 0 and white as 1", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("not-a-color")).toBe(0);
  });
});

describe("buildThemeConfigFromPalette", () => {
  const PALETTE = ["#f0d488", "#0d0a04", "#c9a84c", "#5a4020", "#efe6cc"];

  it("returns a complete ThemeConfig — all 8 color tokens valid #rrggbb", () => {
    const cfg = buildThemeConfigFromPalette(PALETTE);
    expect(cfg.themeId).toBe("custom");
    for (const token of ["background", "surface", "primary", "accent", "text", "mutedText", "cardBg", "border"] as const) {
      expect(cfg.colors[token], token).toMatch(HEX);
    }
    const royal = presetById("royal-gold");
    expect(cfg.fonts).toEqual(royal.fonts);
    expect(cfg.banner).toEqual(royal.banner);
    expect(cfg.spacing).toBe(royal.spacing);
    expect(cfg.cornerRadius).toBe(royal.cornerRadius);
  });

  it("picks the darkest palette color as the background", () => {
    const cfg = buildThemeConfigFromPalette(PALETTE);
    expect(cfg.colors.background).toBe("#0d0a04");
    for (const hex of PALETTE) {
      expect(relativeLuminance(cfg.colors.background)).toBeLessThanOrEqual(relativeLuminance(hex));
    }
  });

  it("keeps readable text — light ink on a dark ground, dark ink on a light one", () => {
    const dark = buildThemeConfigFromPalette(PALETTE);
    expect(dark.colors.text).toBe("#f7ecd2");
    expect(relativeLuminance(dark.colors.text)).toBeGreaterThan(relativeLuminance(dark.colors.background));

    const light = buildThemeConfigFromPalette(["#f5efe0", "#efe6cc", "#e8dcc0"]);
    expect(light.colors.text).toBe("#241a08");
    expect(relativeLuminance(light.colors.text)).toBeLessThan(relativeLuminance(light.colors.background));
  });

  it("prefers a saturated gold as primary and a light warm accent", () => {
    const cfg = buildThemeConfigFromPalette(["#808080", "#c9a84c", "#202020", "#f0d488"]);
    expect(cfg.colors.primary).toBe("#c9a84c");
    expect(cfg.colors.accent).toBe("#f0d488");
  });

  it("is pure and deterministic", () => {
    expect(buildThemeConfigFromPalette(PALETTE)).toEqual(buildThemeConfigFromPalette(PALETTE));
  });

  it("falls back cleanly on an empty palette — royal-gold colors, themeId custom", () => {
    const cfg = buildThemeConfigFromPalette([]);
    expect(cfg.themeId).toBe("custom");
    expect(cfg.colors).toEqual(presetById("royal-gold").colors);
    expect(buildThemeConfigFromPalette(["junk", ""]).colors).toEqual(presetById("royal-gold").colors);
  });
});

describe("extractPalette", () => {
  it("resolves [] instead of throwing when the image cannot load", async () => {
    await expect(extractPalette("")).resolves.toEqual([]);
    await expect(extractPalette("https://invalid.example/nope.png")).resolves.toEqual([]);
  });
});
