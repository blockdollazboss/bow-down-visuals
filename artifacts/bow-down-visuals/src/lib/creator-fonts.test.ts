import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  CREATOR_FONT_CATEGORIES,
  CREATOR_FONT_COUNT,
  CREATOR_FONTS,
  HOUSE_FONTS,
  creatorFontFamily,
  creatorFontsByCategory,
  getCreatorFont,
} from "./creator-fonts";
import { parseFontFavorites, toggleFontFavorite } from "./font-favorites";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("creator font catalog", () => {
  it("has 60+ families across all 8 categories, house set on top", () => {
    expect(CREATOR_FONT_COUNT).toBeGreaterThanOrEqual(60);
    expect(CREATOR_FONTS[0]?.house).toBe(true);
    expect(CREATOR_FONTS[1]?.house).toBe(true);
    expect(HOUSE_FONTS.map((f) => f.family)).toEqual(["Cinzel", "Manrope"]);
    for (const cat of CREATOR_FONT_CATEGORIES) {
      expect(creatorFontsByCategory(cat).length, cat).toBeGreaterThan(0);
    }
  });

  it("every family is open-license only (OFL-1.1 / Apache-2.0) with unique ids", () => {
    const ids = new Set<string>();
    for (const f of CREATOR_FONTS) {
      expect(["OFL-1.1", "Apache-2.0"]).toContain(f.license);
      expect(ids.has(f.id)).toBe(false);
      ids.add(f.id);
      expect(f.files.length).toBeGreaterThan(0);
    }
  });

  it("every catalog file exists on disk and is declared in creator-fonts.css", () => {
    const css = read("../../public/fonts/creator-fonts.css");
    for (const f of CREATOR_FONTS) {
      for (const file of f.files) {
        const url = new URL(`../../public/fonts/creator/${file}`, import.meta.url);
        expect(existsSync(url), `${f.id}/${file}`).toBe(true);
        expect(css).toContain(`/fonts/creator/${file}`);
      }
    }
  });

  it("resolves by id or family and builds fallback stacks", () => {
    expect(getCreatorFont("cinzel")?.family).toBe("Cinzel");
    expect(getCreatorFont("Manrope")?.id).toBe("manrope");
    expect(getCreatorFont("Comic Sans MS")).toBeUndefined();
    expect(creatorFontFamily("anton")).toContain('"Anton"');
    expect(creatorFontFamily(undefined)).toBeUndefined();
  });
});

describe("font favorites", () => {
  it("parses stored favorites, dropping garbage and unknown ids", () => {
    expect(parseFontFavorites(null)).toEqual([]);
    expect(parseFontFavorites("not json")).toEqual([]);
    expect(parseFontFavorites('{"a":1}')).toEqual([]);
    expect(parseFontFavorites('["cinzel","nope","cinzel",42,"anton"]')).toEqual(["cinzel", "anton"]);
  });

  it("toggles favorites without mutating and ignores unknown fonts", () => {
    const start = ["cinzel"];
    expect(toggleFontFavorite(start, "anton")).toEqual(["cinzel", "anton"]);
    expect(toggleFontFavorite(start, "cinzel")).toEqual([]);
    expect(toggleFontFavorite(start, "nope")).toBe(start);
    expect(start).toEqual(["cinzel"]);
  });
});

describe("site-wide house pass", () => {
  const css = read("../index.css");

  it("index.css tokens are Cinzel display + Manrope body/UI, self-hosted", () => {
    expect(css).toContain("--font-sans: 'Manrope'");
    expect(css).toContain("--font-display: 'Cinzel'");
    expect(css).toContain('src: url("/fonts/creator/cinzel-700.woff2")');
    expect(css).toContain('src: url("/fonts/creator/manrope-400.woff2")');
    expect(css).not.toContain("--font-display: 'Playfair Display'");
    expect(css).not.toContain("--font-sans: 'Inter'");
  });

  it("per-pack character (pixel) fonts are preserved", () => {
    expect(css).toContain('.pixel-display');
    expect(css).toContain('font-family: "Press Start 2P"');
    expect(css).toContain(".tcc-display");
    expect(css).toContain('font-family: "VT323"');
  });

  it("index.html carries no global Google Fonts stylesheet for the house set", () => {
    const html = read("../../index.html");
    expect(html).not.toContain("fonts.googleapis.com/css2?family=Cinzel");
  });
});

describe("picker wiring — docked in CREATE tools, never standalone", () => {
  it("shared picker component exists with preview, categories and favorites", () => {
    const picker = read("../components/CreatorFontPicker.tsx");
    expect(picker).toContain("ensureCreatorFonts");
    expect(picker).toContain("CREATOR_FONT_CATEGORIES");
    expect(picker).toContain("setFontFavorite");
    expect(picker).toContain('data-testid="creator-font-picker"');
  });

  it("is imported by the CREATE surfaces named in the spec", () => {
    const surfaces: Record<string, string> = {
      "video editor (CaptionsSection)": "../components/editor/sections/CaptionsSection.tsx",
      "thumbnail studio/maker": "../pages/thumbnail-studio.tsx",
      "branding kit": "../components/branding/BrandKitPanel.tsx",
      "promo clips": "../pages/promo-clip.tsx",
      "cover art": "../pages/cover-art.tsx",
    };
    for (const [name, rel] of Object.entries(surfaces)) {
      expect(read(rel), name).toContain("CreatorFontPicker");
    }
  });
});
