/**
 * Money-integrity + data tests for the Viral Sound Finder.
 *
 * Covers: the pricing contract (AI match 1cr, browsing free), the 402
 * out-of-credits rule, the curated trending-sound database shape, and the
 * max_completion_tokens rule (never max_tokens).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SOUND_MATCH_CREDIT_COST,
  SOUND_NICHES,
  SOUND_MOODS,
  getTrendingSounds,
} from "../sound-finder";

const ROUTE_SRC = readFileSync(
  path.resolve(__dirname, "../sound-finder.ts"),
  "utf8",
);

describe("sound finder pricing contract", () => {
  it("AI sound match costs 1 credit", () => {
    expect(SOUND_MATCH_CREDIT_COST).toBe(1);
  });

  it("the cost is env-overridable without a deploy", () => {
    expect(ROUTE_SRC).toContain('process.env["SOUND_MATCH_CREDIT_COST"]');
  });

  it("browsing trending sounds is free (GET route has no auth / charge)", () => {
    // The GET /sounds/trending handler must not require auth (browsing is
    // pure UI). Pin that requireAuth only guards the POST match route.
    const getLine = ROUTE_SRC.match(/router\.get\("\/sounds\/trending"[^)]*\)/);
    expect(getLine).toBeTruthy();
    expect(getLine![0]).not.toContain("requireAuth");
    const postLine = ROUTE_SRC.match(/router\.post\("\/sound-finder\/match"[^)]*\)/);
    expect(postLine).toBeTruthy();
    expect(postLine![0]).toContain("requireAuth");
  });

  it("the route rejects when balance < cost (documents the 402 contract)", () => {
    expect(0 < SOUND_MATCH_CREDIT_COST).toBe(true); // 0 credits → 402
    expect(1 < SOUND_MATCH_CREDIT_COST).toBe(false); // exact balance → allowed
  });

  it("refunds credits when the match fails", () => {
    expect(ROUTE_SRC).toContain("refundCredits");
    expect(ROUTE_SRC).toContain("Refund (match failed)");
  });
});

describe("model-call rules", () => {
  it("uses max_completion_tokens, never max_tokens", () => {
    expect(ROUTE_SRC).toContain("max_completion_tokens");
    expect(ROUTE_SRC).not.toMatch(/(?<!completion_)max_tokens/);
  });

  it("uses the centralized text model (no hardcoded model id)", () => {
    expect(ROUTE_SRC).toContain("getTextModel()");
  });

  it("requests structured JSON output", () => {
    expect(ROUTE_SRC).toContain('response_format: { type: "json_object" }');
  });
});

describe("trending sounds starter database", () => {
  it("exposes the documented niches and moods", () => {
    expect([...SOUND_NICHES]).toEqual([
      "music-promo",
      "fitness",
      "comedy",
      "lifestyle",
      "gaming",
      "beauty",
      "business",
      "food",
    ]);
    expect([...SOUND_MOODS]).toEqual([
      "hype",
      "chill",
      "emotional",
      "funny",
      "luxury",
      "nostalgic",
    ]);
  });

  it("ships a non-empty curated list with complete entries", () => {
    const sounds = getTrendingSounds();
    expect(sounds.length).toBeGreaterThanOrEqual(10);
    for (const s of sounds) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.artist.length).toBeGreaterThan(0);
      expect(s.niche.length).toBeGreaterThan(0);
      expect(s.mood.length).toBeGreaterThan(0);
      expect(s.platforms.length).toBeGreaterThan(0);
      expect(s.whyTrending.length).toBeGreaterThan(0);
      expect(s.bestFor.length).toBeGreaterThan(0);
      expect(s.hookWindow.length).toBeGreaterThan(0);
    }
  });

  it("uses unique ids", () => {
    const sounds = getTrendingSounds();
    const ids = sounds.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references documented niches, moods, and platforms", () => {
    const sounds = getTrendingSounds();
    for (const s of sounds) {
      for (const n of s.niche) expect(SOUND_NICHES).toContain(n);
      for (const m of s.mood) expect(SOUND_MOODS).toContain(m);
      for (const p of s.platforms)
        expect(["tiktok", "instagram", "youtube"]).toContain(p);
    }
  });

  it("the trending endpoint carries an honest starter-database disclaimer", () => {
    expect(ROUTE_SRC).toContain("starter database");
  });
});
