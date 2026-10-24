/**
 * theme-packs-desk.test.ts — Stack-100 #3, lane theme-packs.
 *
 * Source-shape pins for the desk and its wiring (the pattern
 * wallpapers-desk.test.ts uses): the desk lives where appearance
 * already lives (Settings, beside the cursor card), applies packs
 * through the one engine in lib/theme-packs.ts, shows live previews
 * built from the packs' real tokens, and keeps premium packs honestly
 * locked — no price, no charge, no fake unlock.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./ThemePacksDesk.tsx");
const settings = read("../../pages/settings.tsx");
const main = read("../../main.tsx");
const themeToggle = read("../ThemeToggle.tsx");
const floatingToggle = read("../FloatingThemeToggle.tsx");
const home = read("../../pages/home.tsx");

describe("the desk is docked where appearance lives", () => {
  it("Settings mounts the desk next to the cursor card — no orphan page", () => {
    expect(settings).toContain('import { ThemePacksDesk } from "@/components/theme-packs/ThemePacksDesk"');
    expect(settings).toContain("<ThemePacksDesk />");
    expect(settings).toContain("<CursorCard />");
  });

  it("carries the settings test id and one card per pack", () => {
    expect(desk).toContain('data-testid="theme-packs-settings"');
    expect(desk).toContain("THEME_PACKS.map");
    expect(desk).toContain("theme-pack-${pack.id}");
  });
});

describe("one engine: the desk and every toggle go through lib/theme-packs", () => {
  it("desk applies through applyThemePack only", () => {
    expect(desk).toContain("applyThemePack(p.id, { mode: m })");
    expect(desk).not.toContain('localStorage.setItem("bdv-theme');
    expect(desk).not.toContain("data-theme-pack\")");
  });

  it("boot restores the pack before first paint", () => {
    expect(main).toContain("bootThemePack()");
    expect(main).not.toContain('localStorage.getItem("bdv-theme")');
  });

  it("all three mode toggles flip through applyThemeMode", () => {
    for (const src of [themeToggle, floatingToggle, home]) {
      expect(src).toContain("applyThemeMode(");
      expect(src).not.toContain('localStorage.setItem("bdv-theme"');
    }
  });

  it("back to house theme is always one tap while a pack is worn", () => {
    expect(desk).toContain('data-testid="theme-pack-back-to-house"');
    expect(desk).toContain("HOUSE_PACK_FOR_MODE[siteMode]");
  });
});

describe("previews show the packs' real tokens, phone + desktop", () => {
  it("mini frames are painted from the variant tokens, not screenshots", () => {
    expect(desk).toContain("hslCss(tk.background)");
    expect(desk).toContain("hslCss(tk.card)");
    expect(desk).toContain("hslCss(tk.primary)");
    expect(desk).toContain("hslCss(tk.sidebar)");
    expect(desk).toContain("PackPreview");
  });

  it("the shown variant follows the site mode when the pack lives there", () => {
    expect(desk).toContain("resolvePackMode(pack, siteMode)");
  });
});

describe("every pack in both modes, chosen on the card (owner steer)", () => {
  it("each card carries a Light | Dark toggle driving preview + apply", () => {
    expect(desk).toContain("theme-pack-mode-${pack.id}-${m}");
    expect(desk).toContain("aria-pressed={viewMode === m}");
    expect(desk).toContain("onApply(pack, viewMode)");
    expect(desk).toContain("Apply in {{mode}}");
  });
});

describe("device delivery — the pack reaches the actual phone + computer", () => {
  it("renders through the wallpaper rails, branded and free, logo whole", () => {
    expect(desk).toContain('"/api/wallpapers/render"');
    expect(desk).toContain("pack.deviceArt[mode]");
    expect(desk).toContain('"/logo-static.webp"');
    expect(desk).toContain('"/logo-light.webp"');
    expect(desk).toContain("branded: true");
    expect(desk).not.toContain("branded: false");
  });

  it("zips per device kind across the FULL preset list, plus single sizes", () => {
    expect(desk).toContain('"/api/wallpapers/pack-download"');
    expect(desk).toContain("WALLPAPER_PRESETS");
    expect(desk).toContain("theme-pack-device-${kind}-${pack.id}");
    expect(desk).toContain("theme-pack-device-size-${pack.id}");
    expect(desk).toContain("theme-pack-device-one-${pack.id}");
  });

  it("locked packs keep their device packs locked too", () => {
    expect(desk).toContain("Device packs unlock with the pack at launch.");
  });
});

describe("honest product shape", () => {
  it("premium packs render locked with the launch copy — no buy path", () => {
    expect(desk).toContain("isThemePackUnlocked(pack)");
    expect(desk).toContain("Premium pack — coming with launch");
    expect(desk).toContain("theme-pack-locked-${pack.id}");
  });

  it("no price, pack cost, or currency amount appears in the desk", () => {
    expect(desk).not.toMatch(/\$\s?\d/);
    expect(desk).not.toMatch(/\b\d+\s?VB\b/);
    expect(desk).not.toContain("Visual Bucs");
    expect(desk).not.toMatch(/checkout|purchase|buy now/i);
  });

  it("the desk states the editor keeps its own look under every pack", () => {
    expect(desk).toContain("The video editor keeps its own look under every pack.");
  });

  it("the desk states the cursor pairing out loud", () => {
    expect(desk).toContain("Pairs with the {{cursor}} cursor");
    expect(desk).toContain("CURSOR_OPTIONS");
  });
});
