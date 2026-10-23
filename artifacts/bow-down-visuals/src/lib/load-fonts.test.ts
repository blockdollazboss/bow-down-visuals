import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPTION_FONTS_CSS_URL, LIBRARY_FONTS_CSS_URL, UI_FONTS_CSS_URL } from "./load-fonts";

/**
 * Stack-28 #50 (A5-P4) — only UI fonts are global; caption/library
 * families load on demand, with font-display behavior (display=swap)
 * preserved on every URL.
 */
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("on-demand fonts (Stack-28 #50)", () => {
  it("index.html carries ONLY the Inter/Playfair stylesheet", () => {
    const links = html.match(/fonts\.googleapis\.com\/css2[^"]*/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain("family=Inter");
    expect(links[0]).toContain("Playfair+Display");
    expect(html).not.toContain("family=Anton");
    expect(html).not.toContain("family=Creepster");
  });
  it("all three URLs keep display=swap (font-display pinned)", () => {
    for (const u of [CAPTION_FONTS_CSS_URL, LIBRARY_FONTS_CSS_URL, UI_FONTS_CSS_URL]) {
      expect(u).toContain("display=swap");
    }
    expect(UI_FONTS_CSS_URL).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400..800;1,400..700&display=swap",
    );
  });
  it("surfaces load their families on mount", () => {
    expect(read("../components/editor/sections/CaptionsSection.tsx")).toContain("ensureCaptionFonts()");
    expect(read("../pages/video-editor.tsx")).toContain("ensureCaptionFonts()");
    expect(read("../pages/library.tsx")).toContain("ensureLibraryFonts()");
  });
});
