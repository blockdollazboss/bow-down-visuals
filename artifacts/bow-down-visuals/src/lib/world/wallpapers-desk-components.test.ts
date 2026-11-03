/**
 * wallpapers-desk-components — stack1500 world parity wave #3
 * item 34 source-contract pins. The Wallpapers Desk must exist as
 * ONE native desk in the Create Wing with the whole flow in-panel:
 * - generate art at the printed registry price, pick from your own
 *   library, render at an exact device size branded (free) or
 *   clean, the pack of 10 gated on exactly ten picks, the living
 *   wallpaper's clip + loop render, and the session .zip;
 * - spend discipline in source: priced runs ride confirmedFetch
 *   with the prices module's constants as the quote; the FREE
 *   branded render rides skipConfirm — never a bare fetch around
 *   the confirmation;
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/WallpapersDesk.tsx");
const seam = read("./wallpapers-desk.ts");

describe("one native desk, house shape", () => {
  it("is a named CreateDeskProps desk rooted at its testid", () => {
    expect(desk).toContain("export function WallpapersDesk(props: CreateDeskProps)");
    expect(desk).toContain('data-testid="world-wallpapers-desk"');
  });

  it("all four steps + the session strip are in-panel", () => {
    for (const needle of [
      'data-testid="world-wallpapers-desk-generate"',
      'data-testid="world-wallpapers-desk-render"',
      'data-testid="world-wallpapers-desk-pack-run"',
      'data-testid="world-wallpapers-desk-video-generate"',
      'data-testid="world-wallpapers-desk-ss-render"',
      'data-testid="world-wallpapers-desk-session"',
      'data-testid="world-wallpapers-desk-zip"',
      "1 · Make the art",
      "2 · Pick the device size",
      "3 · Pack of 10 clean wallpapers",
      "4 · Living wallpaper",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });
});

describe("spend discipline in source", () => {
  it("the clean render quotes the prices constant; the branded render is skipConfirm (free)", () => {
    expect(desk).toContain("overrideCost: WALLPAPER_CLEAN_RENDER_COST");
    expect(desk).toContain("skipConfirm: true");
    expect(desk).toContain('overrideFeature: "Clean Wallpaper Render"');
  });

  it("art, pack and loop quote their constants the same way", () => {
    expect(desk).toContain("overrideCost: WALLPAPER_GENERATE_COST");
    expect(desk).toContain("overrideCost: WALLPAPER_PACK_OF_10_COST");
    expect(desk).toContain("overrideCost: WALLPAPERS_SCREENSAVER_COST");
    expect(seam).toContain("WALLPAPER_PACK_OF_10_COST");
  });

  it("printed prices come from the constants, never literals", () => {
    expect(desk).toContain("WALLPAPER_GENERATE_COST.toLocaleString()");
    expect(desk).toContain("WALLPAPER_CLEAN_RENDER_COST.toLocaleString()");
    expect(desk).toContain("WALLPAPERS_SCREENSAVER_COST.toLocaleString()");
  });

  it("the pack run is gated on exactly ten picks (the seam's rule)", () => {
    expect(desk).toContain("disabled={packBusy || !packReady(packSelected)}");
    expect(desk).toContain("togglePackSelection(prev, url)");
  });

  it("the brand stamp reads the member's own brand kit — logo whole or name only", () => {
    expect(desk).toContain("fetchBrandKit(getAccessToken)");
    expect(desk).toContain("brandKit?.logoUrl");
    expect(desk).toContain("your logo goes on whole, exactly as you saved it");
  });

  it("402 reads as out-of-Visual-Bucs with the Treasury pointer", () => {
    expect(desk).toContain("Visual Buc Packs desk in the Treasury");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
