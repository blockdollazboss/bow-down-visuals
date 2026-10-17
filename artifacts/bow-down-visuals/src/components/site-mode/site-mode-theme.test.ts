/**
 * site-mode-theme.test.ts — Stack-30 Lane E (E6).
 *
 * The public profile has ONE theme contract, honored by its main-app
 * rendering (pages/artist-public.tsx): the root carries data-dark-lock
 * + ap-profile-root (exempting the subtree from the light theme's
 * global class remaps) and paints themeVars(theme, isLight) — panels
 * follow the SITE theme (house ivory/bronze in light, the creator's
 * colorway in dark).
 *
 * SiteMode renders the SAME profile as the creator's standalone site
 * but broke the contract on the same root element: it called
 * themeVars(profile.theme_config) with no light flag (the creator's
 * stored — typically dark — preset won in light mode too) and carried
 * neither marker, so in light mode the global remap painted the
 * site's palace backdrop over the creator's ground. These tests pin
 * the twin parity and themeVars' light behavior itself.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE_LIGHT_PANEL, themeVars, type ThemeConfig } from "@/lib/artist-profiles";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const siteModeSource = read("./SiteMode.tsx");
const artistPublicSource = read("../../pages/artist-public.tsx");

const DARK_PRESET: ThemeConfig = {
  themeId: "royal-gold",
  colors: {
    background: "#0d0a04",
    surface: "#14100a",
    primary: "#C9A84C",
    accent: "#C9A84C",
    text: "#F5EDD8",
    mutedText: "#A08C5A",
    cardBg: "#171208",
    border: "rgba(201,168,76,0.25)",
  },
  fonts: { heading: "Cinzel", body: "Inter" },
  banner: { layout: "full-bleed", overlayOpacity: 0.4 },
  spacing: "comfortable",
  cornerRadius: "rounded",
};

describe("themeVars — the light flag is what makes panels follow the site theme", () => {
  it("light: panel tokens come from the house light palette, not the stored preset", () => {
    const vars = themeVars(DARK_PRESET, true) as Record<string, string>;
    expect(vars["--ap-bg"]).toBe(PROFILE_LIGHT_PANEL.background);
    expect(vars["--ap-card"]).toBe(PROFILE_LIGHT_PANEL.cardBg);
    expect(vars["--ap-text"]).toBe(PROFILE_LIGHT_PANEL.text);
    // The creator's brand colors still ride along in light mode.
    expect(vars["--ap-primary"]).toBe(DARK_PRESET.colors.primary);
    // On-art ink keeps the colorway in BOTH themes.
    expect(vars["--ap-onart-text"]).toBe(DARK_PRESET.colors.text);
  });

  it("dark (and the no-flag default): the creator's own colorway paints", () => {
    for (const vars of [themeVars(DARK_PRESET, false), themeVars(DARK_PRESET)] as Array<Record<string, string>>) {
      expect(vars["--ap-bg"]).toBe(DARK_PRESET.colors.background);
      expect(vars["--ap-card"]).toBe(DARK_PRESET.colors.cardBg);
      expect(vars["--ap-text"]).toBe(DARK_PRESET.colors.text);
    }
  });
});

describe("SiteMode root — twin parity with /artist/:slug", () => {
  it("SiteMode follows the visitor's theme selection via useIsLightTheme", () => {
    expect(siteModeSource).toContain('import { useIsLightTheme } from "@/hooks/use-is-light-theme"');
    expect(siteModeSource).toContain("const isLight = useIsLightTheme();");
    expect(siteModeSource).toContain("themeVars(profile.theme_config, isLight)");
    expect(siteModeSource).not.toContain("themeVars(profile.theme_config)");
  });

  it("SiteMode's profile root carries the same remap exemption markers as artist-public", () => {
    expect(siteModeSource).toContain('className="min-h-screen ap-profile-root"');
    expect(siteModeSource).toContain("data-dark-lock");
    // The twin contract itself stays put — if artist-public ever drops
    // the markers, this lane's parity claim needs re-examining.
    expect(artistPublicSource).toContain('className="min-h-screen ap-profile-root"');
    expect(artistPublicSource).toContain("data-dark-lock");
    expect(artistPublicSource).toContain("themeVars(profile.theme_config, isLight)");
  });
});
