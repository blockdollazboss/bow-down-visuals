import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Logo handling rule (owner law, Oct 22 2026): a creator's logo is
   composited ONLY as the complete, intact artwork — never cropped,
   never sliced into parts (no banner-only or icon-only cuts), never
   redrawn. Scale and placement only. This pins the desk's side of the
   rule: the brand section shows the FULL lockup with object-contain,
   the desk passes logoUrl through untouched, and no UI anywhere in
   the desk offers a logo crop or a partial-logo variant. */

const src = readFileSync(new URL("./WallpapersDesk.tsx", import.meta.url), "utf8");

describe("WallpapersDesk — the logo goes on whole", () => {
  it("renders the brand logo with object-contain, never object-cover", () => {
    const at = src.indexOf("src={brandKit.logoUrl}");
    expect(at).toBeGreaterThan(-1);
    /* The logo <img> element itself (the JSX block around its src). */
    const el = src.slice(src.lastIndexOf("<img", at), src.indexOf("/>", at) + 2);
    expect(el).toContain("object-contain");
    expect(el).not.toContain("object-cover");
    expect(el).not.toContain("overflow-hidden");
  });

  it("passes logoUrl to the render endpoints untouched — no transformation params", () => {
    expect(src).toContain("logoUrl: brandKit?.logoUrl ?? undefined");
    expect(src).not.toMatch(/logoUrl[^,\n]*[?&](w|h|width|height|crop|fit)=/);
    expect(src).not.toMatch(/drawImage\([^)]*logo/i);
  });

  it("offers no logo cropping and no partial-logo variants anywhere", () => {
    expect(src.toLowerCase()).not.toContain("icon-only");
    expect(src.toLowerCase()).not.toContain("banner-only");
    expect(src).not.toMatch(/crop(Logo|MyLogo|TheLogo|YourLogo)/);
    expect(src).not.toMatch(/logo(Crop|Slice|Cut)\b/);
  });

  it("states the whole-logo rule in copy next to the logo", () => {
    expect(src).toContain('t("wallpapers.logoWholeNote"');
  });
});
