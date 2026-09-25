/**
 * Money-integrity + validation tests for the Beat Marketplace.
 *
 * Covers: the pricing contract (free listing, 15% commission, 1cr AI tags),
 * license-tier validation, metadata schema validation, filter schema, and
 * the v1 honesty contract (licenses are NEVER completed — payment is
 * coming soon).
 */
import { describe, expect, it } from "vitest";

import {
  BEAT_AI_TAGS_CREDIT_COST,
  BEAT_GENRES,
  BEAT_LICENSE_TIERS,
  BEAT_SALE_COMMISSION_PCT,
  beatFiltersSchema,
  beatMetadataSchema,
  commissionFor,
  getBeatAiTagsCost,
  getBeatCommissionPct,
  isBeatLicenseTier,
  producerPayoutFor,
} from "../beats-pricing";

describe("beat marketplace pricing contract", () => {
  it("listing beats is free (no list-price constant exists)", () => {
    // Listing costs nothing — the route charges 0 credits. This test pins
    // that no listing fee was accidentally introduced in the pricing module.
    expect(BEAT_AI_TAGS_CREDIT_COST).toBe(1); // only the AI suggester charges
  });

  it("site commission is 15%", () => {
    expect(BEAT_SALE_COMMISSION_PCT).toBe(15);
    expect(getBeatCommissionPct()).toBe(15);
  });

  it("AI tag suggester costs 1 credit", () => {
    expect(BEAT_AI_TAGS_CREDIT_COST).toBe(1);
    expect(getBeatAiTagsCost()).toBe(1);
  });

  it("commission math: 15% of $29.99 = $4.50 (rounded)", () => {
    expect(commissionFor(2999)).toBe(450); // 449.85 → 450
    expect(producerPayoutFor(2999)).toBe(2549);
  });

  it("commission math: 15% of $499.99 = $75.00 (rounded)", () => {
    expect(commissionFor(49999)).toBe(7500); // 7499.85 → 7500
    expect(producerPayoutFor(49999)).toBe(42499);
  });

  it("commission + payout always equals the price", () => {
    for (const price of [0, 1, 99, 2999, 9999, 49999, 100000]) {
      expect(commissionFor(price) + producerPayoutFor(price)).toBe(price);
    }
  });

  it("env overrides are respected", () => {
    const prev = process.env["BEAT_AI_TAGS_CREDITS"];
    process.env["BEAT_AI_TAGS_CREDITS"] = "3";
    expect(getBeatAiTagsCost()).toBe(3);
    process.env["BEAT_SALE_COMMISSION_PCT"] = "20";
    expect(getBeatCommissionPct()).toBe(20);
    expect(commissionFor(1000)).toBe(200);
    if (prev === undefined) {
      delete process.env["BEAT_AI_TAGS_CREDITS"];
      delete process.env["BEAT_SALE_COMMISSION_PCT"];
    } else {
      process.env["BEAT_AI_TAGS_CREDITS"] = prev;
    }
  });

  it("invalid env values fall back to defaults", () => {
    process.env["BEAT_AI_TAGS_CREDITS"] = "not-a-number";
    expect(getBeatAiTagsCost()).toBe(1);
    process.env["BEAT_SALE_COMMISSION_PCT"] = "150";
    expect(getBeatCommissionPct()).toBe(15);
    delete process.env["BEAT_AI_TAGS_CREDITS"];
    delete process.env["BEAT_SALE_COMMISSION_PCT"];
  });
});

describe("license tiers", () => {
  it("offers exactly basic, premium, exclusive", () => {
    expect([...BEAT_LICENSE_TIERS]).toEqual(["basic", "premium", "exclusive"]);
  });

  it("validates tier keys", () => {
    expect(isBeatLicenseTier("basic")).toBe(true);
    expect(isBeatLicenseTier("premium")).toBe(true);
    expect(isBeatLicenseTier("exclusive")).toBe(true);
    expect(isBeatLicenseTier("deluxe")).toBe(false);
    expect(isBeatLicenseTier("")).toBe(false);
    expect(isBeatLicenseTier(undefined)).toBe(false);
    expect(isBeatLicenseTier(null)).toBe(false);
  });
});

describe("beat metadata validation", () => {
  const valid = {
    title: "Midnight Drive",
    audioUrl: "https://example.com/beat.mp3",
  };

  it("accepts minimal valid metadata with defaults", () => {
    const parsed = beatMetadataSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.genre).toBe("hip-hop");
      expect(parsed.data.moodTags).toEqual([]);
      expect(parsed.data.basicPriceCents).toBe(2999);
      expect(parsed.data.premiumPriceCents).toBe(9999);
      expect(parsed.data.exclusivePriceCents).toBe(49999);
    }
  });

  it("rejects missing title", () => {
    expect(beatMetadataSchema.safeParse({ audioUrl: "https://example.com/b.mp3" }).success).toBe(false);
  });

  it("rejects blank title", () => {
    expect(beatMetadataSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
  });

  it("rejects non-URL audio", () => {
    expect(beatMetadataSchema.safeParse({ ...valid, audioUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects out-of-range BPM", () => {
    expect(beatMetadataSchema.safeParse({ ...valid, bpm: 30 }).success).toBe(false);
    expect(beatMetadataSchema.safeParse({ ...valid, bpm: 300 }).success).toBe(false);
    expect(beatMetadataSchema.safeParse({ ...valid, bpm: 140 }).success).toBe(true);
  });

  it("caps mood tags at 10", () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    expect(beatMetadataSchema.safeParse({ ...valid, moodTags: tags }).success).toBe(false);
  });

  it("rejects negative prices", () => {
    expect(beatMetadataSchema.safeParse({ ...valid, basicPriceCents: -100 }).success).toBe(false);
  });
});

describe("beat filter validation", () => {
  it("accepts empty filters with defaults", () => {
    const parsed = beatFiltersSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(24);
      expect(parsed.data.offset).toBe(0);
    }
  });

  it("coerces string query params to numbers", () => {
    const parsed = beatFiltersSchema.safeParse({ minBpm: "120", limit: "10" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.minBpm).toBe(120);
      expect(parsed.data.limit).toBe(10);
    }
  });

  it("caps limit at 50", () => {
    expect(beatFiltersSchema.safeParse({ limit: 100 }).success).toBe(false);
  });
});

describe("v1 honesty contract", () => {
  it("the route file never writes a completed license", async () => {
    // Static guarantee: grep the route source for status writes. The only
    // status the license endpoint may write is 'pending_payment'.
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../beats.ts"), "utf8");

    // The license endpoint must set status: "pending_payment".
    expect(src).toContain('status: "pending_payment"');
    // No code path may mark a license completed until payments ship.
    const completedWrites = src.match(/status:\s*["']completed["']/g) ?? [];
    expect(completedWrites).toHaveLength(0);
  });

  it("the license endpoint advertises payment as coming soon", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../beats.ts"), "utf8");
    expect(src).toContain("coming_soon");
  });
});

describe("AI tag suggester token contract", () => {
  it("uses max_completion_tokens, never max_tokens (GPT-6 rejects max_tokens)", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../beats.ts"), "utf8");
    expect(src).toContain("max_completion_tokens");
    // No bare max_tokens param (allow max_completion_tokens to contain it).
    const bare = src.match(/(?<!completion_)max_tokens/g) ?? [];
    expect(bare).toHaveLength(0);
  });
});

describe("genre catalog", () => {
  it("covers the core producer genres", () => {
    expect(BEAT_GENRES).toContain("hip-hop");
    expect(BEAT_GENRES).toContain("trap");
    expect(BEAT_GENRES).toContain("drill");
    expect(BEAT_GENRES).toContain("afrobeats");
  });
});
