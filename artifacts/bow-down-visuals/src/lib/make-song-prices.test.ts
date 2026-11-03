/**
 * make-song-prices.test.ts — Tutorial F2 (owner ruling, Oct 27, 2026):
 * the Make Song journey's FULL combined charge displays up front.
 *
 * The journey is two charges: the song package (400) and the real
 * audio as a second step (400 at the default 60-second tier) = 800.
 * These pins hold (a) each derived figure equal to the registry entry
 * it quotes, (b) each registry entry equal to the server constant
 * re-derived from the API source, and (c) the Make Song module
 * rendering the combined figure BEFORE the first charge button, so
 * the disclosure can never drift behind the spend again.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "./credit-costs";
import {
  MAKE_SONG_AUDIO_COST,
  MAKE_SONG_FULL_JOURNEY_COST,
  MAKE_SONG_PACKAGE_COST,
  makeSongPackageCostForLength,
} from "./make-song-prices";

function readApi(rel: string): string {
  const url = new URL(`../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

function readPage(rel: string): string {
  const url = new URL(`../pages/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

describe("F2 — Make Song journey prices (400 + 400 = 800, up front)", () => {
  it("package figure == registry == first tier of the shared song tiers (400)", () => {
    /* Audit #5: the legacy rail no longer keeps a flat CREDIT_COST —
       it imports creditCostForLength from music-audio.ts and prices
       by the same SONG_PRICE_TIERS. The package figure quoted for
       the standard journey is the FIRST tier (the 60-second
       default), which the registry also records. */
    const songSrc = readApi("routes/generate/song.ts");
    expect(songSrc).not.toMatch(/const\s+CREDIT_COST\s*=/);
    expect(songSrc).toContain("creditCostForLength");
    expect(songSrc).toMatch(/from\s+"\.\/music-audio"/);
    const audioSrc = readApi("routes/generate/music-audio.ts");
    const tiers = audioSrc.match(
      /SONG_PRICE_TIERS\s*=\s*\[\s*\{\s*maxLengthMs:\s*60_000,\s*cost:\s*(\d+)\s*\}/,
    );
    expect(tiers, "first SONG_PRICE_TIERS rung in music-audio.ts").toBeTruthy();
    expect(Number(tiers![1])).toBe(400);
    expect(CREDIT_COSTS["/api/generate-song"]?.cost).toBe(400);
    expect(MAKE_SONG_PACKAGE_COST).toBe(400);
  });

  it("the per-length package helper prices the labels the form sends at the server tiers", () => {
    expect(makeSongPackageCostForLength("")).toBe(400);
    expect(makeSongPackageCostForLength("30 seconds")).toBe(400);
    expect(makeSongPackageCostForLength("60 seconds")).toBe(400);
    expect(makeSongPackageCostForLength("2 minutes")).toBe(800);
    expect(makeSongPackageCostForLength("Full song")).toBe(800);
    expect(makeSongPackageCostForLength(null, 300)).toBe(1200);
    expect(makeSongPackageCostForLength(null, 301)).toBe(2400);
  });

  it("audio figure == registry == first SONG_PRICE_TIERS rung (60s default, 400)", () => {
    const audioSrc = readApi("routes/generate/music-audio.ts");
    // The result-page Generate Audio sends no length, so the server
    // default (60s) applies — the FIRST tier rung is the charge.
    const tiers = audioSrc.match(
      /SONG_PRICE_TIERS\s*=\s*\[\s*\{\s*maxLengthMs:\s*60_000,\s*cost:\s*(\d+)\s*\}/,
    );
    expect(tiers, "first SONG_PRICE_TIERS rung in music-audio.ts").toBeTruthy();
    expect(Number(tiers![1])).toBe(400);
    expect(CREDIT_COSTS["/api/generate-music-audio"]?.cost).toBe(400);
    expect(MAKE_SONG_AUDIO_COST).toBe(400);
  });

  it("combined figure is the sum — 800 Visual Bucs", () => {
    expect(MAKE_SONG_FULL_JOURNEY_COST).toBe(
      MAKE_SONG_PACKAGE_COST + MAKE_SONG_AUDIO_COST,
    );
    expect(MAKE_SONG_FULL_JOURNEY_COST).toBe(800);
  });

  it("the module renders the combined figure up front, before the first charge", () => {
    const src = readPage("make-song.tsx");
    expect(src).toContain('from "@/lib/make-song-prices"');
    expect(src).toContain('data-testid="make-song-full-journey-note"');
    const noteAt = src.indexOf('data-testid="make-song-full-journey-note"');
    const firstChargeAt = src.indexOf("Generate Song <CostBadge");
    expect(noteAt).toBeGreaterThan(-1);
    expect(firstChargeAt).toBeGreaterThan(-1);
    expect(noteAt).toBeLessThan(firstChargeAt);
    // The note quotes the combined figure AND both halves, derived.
    const noteBlock = src.slice(noteAt, noteAt + 1600);
    expect(noteBlock).toContain("{MAKE_SONG_FULL_JOURNEY_COST}");
    expect(noteBlock).toContain("{MAKE_SONG_PACKAGE_COST}");
    expect(noteBlock).toContain("{MAKE_SONG_AUDIO_COST}");
  });
});
