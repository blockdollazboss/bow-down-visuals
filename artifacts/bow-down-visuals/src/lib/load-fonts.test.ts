import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPTION_FONTS_CSS_URL, LIBRARY_FONTS_CSS_URL, UI_FONTS_CSS_URL } from "./load-fonts";

/**
 * Stack-28 #50 (A5-P4) — only UI fonts are global; caption/library
 * families load on demand, with font-display behavior (display=swap)
 * preserved on every URL.
 *
 * Stack-200 fonts lane update: the house pairing is now Cinzel +
 * Manrope, SELF-HOSTED via @font-face in index.css — index.html
 * carries NO global Google Fonts stylesheet at all, and
 * UI_FONTS_CSS_URL is only the documented CDN fallback string for
 * the same pairing.
 */
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("on-demand fonts (Stack-28 #50)", () => {
  it("index.html carries NO global Google Fonts stylesheet (house set is self-hosted)", () => {
    const links = html.match(/fonts\.googleapis\.com\/css2[^"]*/g) ?? [];
    expect(links).toHaveLength(0);
    expect(html).not.toContain("family=Inter");
    expect(html).not.toContain("Playfair+Display");
    expect(html).not.toContain("family=Anton");
    expect(html).not.toContain("family=Creepster");
  });
  it("all three URLs keep display=swap (font-display pinned)", () => {
    for (const u of [CAPTION_FONTS_CSS_URL, LIBRARY_FONTS_CSS_URL, UI_FONTS_CSS_URL]) {
      expect(u).toContain("display=swap");
    }
    expect(UI_FONTS_CSS_URL).toBe(
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Manrope:wght@400;500;600;700;800&display=swap",
    );
  });
  it("surfaces load their families on mount", () => {
    expect(read("../components/editor/sections/CaptionsSection.tsx")).toContain("ensureCaptionFonts()");
    expect(read("../pages/video-editor.tsx")).toContain("ensureCaptionFonts()");
    expect(read("../pages/library.tsx")).toContain("ensureLibraryFonts()");
  });
});
