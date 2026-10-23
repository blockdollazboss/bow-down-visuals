/**
 * wallpapers-prices.test.ts — Stack-28 item 15 (audit A6-W4): every
 * price the Wallpapers desk displays or quotes in a confirmation is
 * derived from its source of truth and pinned equal to the server
 * constant that actually charges:
 *
 *   WALLPAPER_GENERATE_COST          == NANO_BANANA_21_CREDIT_COST (artist-image-pricing.ts)
 *   WALLPAPER_CLEAN_RENDER_COST      == CLEAN_RENDER_COST           (routes/wallpapers.ts)
 *   WALLPAPER_CLEAN_PACK_COST        == 2 × CLEAN_RENDER_COST
 *   WALLPAPER_SCREENSAVER_RENDER_COST== SCREENSAVER_RENDER_COST     (routes/wallpapers.ts)
 *   WALLPAPER_SCREENSAVER_VIDEO_COST == GEN45_CREDIT_COST           (clip-pricing.ts)
 *
 * Server constants are re-derived from the API source files (the
 * credit-costs-rail-truth.test.ts pattern), so a rail price change
 * fails this suite until the desk's derivation follows it — the desk
 * itself carries no price literal to update by hand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, getCreditCost } from "../../lib/credit-costs";
import {
  WALLPAPER_CLEAN_PACK_COST,
  WALLPAPER_CLEAN_RENDER_COST,
  WALLPAPER_GENERATE_COST,
  WALLPAPER_SCREENSAVER_RENDER_COST,
  WALLPAPER_SCREENSAVER_VIDEO_COST,
} from "../../lib/wallpapers-prices";

function readApi(rel: string): string {
  const url = new URL(`../../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\](?:\\s*\\?\\?\\s*\\d+)?\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1]);
}

const desk = readFileSync(new URL("./WallpapersDesk.tsx", import.meta.url), "utf8");
const pricesSrc = readFileSync(new URL("../../lib/wallpapers-prices.ts", import.meta.url), "utf8");

describe("Stack-28 item 15 — desk prices are derived and pinned to the rails", () => {
  it("generate cost == the nano model's server price (100), from the model catalogue", () => {
    const rail = deriveServerConstant("routes/generate/artist-image-pricing.ts", "NANO_BANANA_21_CREDIT_COST");
    expect(rail).toBe(100);
    expect(WALLPAPER_GENERATE_COST).toBe(rail);
    expect(pricesSrc).toContain('ARTIST_IMAGE_MODELS.find((m) => m.id === "nano-banana-2.1")');
    // NOT the registry's Pro price — the desk sends the nano model.
    expect(CREDIT_COSTS["/api/generate-artist-image"]?.cost).toBe(200);
    expect(WALLPAPER_GENERATE_COST).not.toBe(CREDIT_COSTS["/api/generate-artist-image"]?.cost);
  });

  it("clean render cost == server CLEAN_RENDER_COST (400), derived via the clean-export rail the server maps from", () => {
    const rail = deriveServerConstant("routes/wallpapers.ts", "CLEAN_RENDER_COST");
    expect(rail).toBe(400);
    expect(WALLPAPER_CLEAN_RENDER_COST).toBe(rail);
    expect(WALLPAPER_CLEAN_RENDER_COST).toBe(getCreditCost("/api/export-final-video")?.cost);
    // The registry's branded entry stays 0 — clean is the override variant.
    expect(CREDIT_COSTS["/api/wallpapers/render"]?.cost).toBe(0);
  });

  it("clean pack cost == 2 × clean render (800) — derived, not a hand-doubled literal", () => {
    expect(WALLPAPER_CLEAN_PACK_COST).toBe(WALLPAPER_CLEAN_RENDER_COST * 2);
    expect(WALLPAPER_CLEAN_PACK_COST).toBe(800);
    expect(pricesSrc).toContain("WALLPAPER_CLEAN_RENDER_COST * 2");
  });

  it("screensaver render cost == registry == server SCREENSAVER_RENDER_COST (400)", () => {
    const rail = deriveServerConstant("routes/wallpapers.ts", "SCREENSAVER_RENDER_COST");
    expect(rail).toBe(400);
    expect(getCreditCost("/api/wallpapers/screensaver-render")?.cost).toBe(rail);
    expect(WALLPAPER_SCREENSAVER_RENDER_COST).toBe(rail);
  });

  it("screensaver video cost == registry == GEN45_CREDIT_COST (400)", () => {
    const rail = deriveServerConstant("routes/generate/clip-pricing.ts", "GEN45_CREDIT_COST");
    expect(rail).toBe(400);
    expect(getCreditCost("/api/generate-runway-clip")?.cost).toBe(rail);
    expect(WALLPAPER_SCREENSAVER_VIDEO_COST).toBe(rail);
  });

  it("the desk carries no price literals and renders every figure from the derived constants", () => {
    expect(desk).not.toMatch(/const (GENERATE_COST|CLEAN_RENDER_COST)\s*=/);
    expect(desk).not.toMatch(/— \d+ Visual Bucs/);
    expect(desk).toContain("overrideCost: WALLPAPER_GENERATE_COST");
    expect(desk).toContain("overrideCost: WALLPAPER_CLEAN_RENDER_COST");
    expect(desk).toContain("cost: WALLPAPER_CLEAN_PACK_COST");
    for (const name of [
      "WALLPAPER_GENERATE_COST",
      "WALLPAPER_CLEAN_RENDER_COST",
      "WALLPAPER_CLEAN_PACK_COST",
      "WALLPAPER_SCREENSAVER_VIDEO_COST",
      "WALLPAPER_SCREENSAVER_RENDER_COST",
    ]) {
      expect(desk, name).toContain(`\${${name}} Visual Bucs`);
    }
  });
});
