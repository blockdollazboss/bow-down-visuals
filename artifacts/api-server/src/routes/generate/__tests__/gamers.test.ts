/**
 * Money-integrity + schema tests for the Home of Gamers AI generator.
 *
 * Covers: the 1-credit price per generation, the zod request schema
 * (valid + invalid payloads), the content-type enum integrity, and the
 * GPT-6 `max_completion_tokens` requirement (GPT-6 rejects `max_tokens`).
 * All offline — no API calls, no credits spent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  GAMERS_CREDIT_COST,
  CONTENT_TYPES,
  gamersIdeasSchema,
} from "../gamers";

describe("GAMERS_CREDIT_COST", () => {
  it("charges 1 credit per generation", () => {
    expect(GAMERS_CREDIT_COST).toBe(1);
  });
});

describe("CONTENT_TYPES", () => {
  it("covers stream, long-form video, and shorts", () => {
    expect([...CONTENT_TYPES]).toEqual(["stream", "video", "shorts"]);
  });

  it("has no duplicates", () => {
    expect(new Set(CONTENT_TYPES).size).toBe(CONTENT_TYPES.length);
  });
});

describe("gamersIdeasSchema", () => {
  it("accepts a full valid payload", () => {
    const parsed = gamersIdeasSchema.safeParse({
      game: "Valorant",
      niche: "clutch plays",
      contentType: "stream",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a payload without the optional niche (defaults to empty)", () => {
    const parsed = gamersIdeasSchema.safeParse({ game: "Fortnite", contentType: "shorts" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.niche).toBe("");
  });

  it("rejects an empty game name", () => {
    expect(gamersIdeasSchema.safeParse({ game: "", contentType: "video" }).success).toBe(false);
  });

  it("rejects a missing game", () => {
    expect(gamersIdeasSchema.safeParse({ contentType: "video" }).success).toBe(false);
  });

  it("rejects an unknown content type", () => {
    expect(
      gamersIdeasSchema.safeParse({ game: "Minecraft", contentType: "podcast" }).success
    ).toBe(false);
  });

  it("rejects a game name over 120 characters", () => {
    expect(
      gamersIdeasSchema.safeParse({ game: "x".repeat(121), contentType: "stream" }).success
    ).toBe(false);
  });

  it("rejects a niche over 120 characters", () => {
    expect(
      gamersIdeasSchema.safeParse({
        game: "Apex Legends",
        niche: "x".repeat(121),
        contentType: "stream",
      }).success
    ).toBe(false);
  });
});

describe("gamers route source", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "gamers.ts"), "utf8");

  it("uses max_completion_tokens (GPT-6 rejects max_tokens)", () => {
    expect(src).toContain("max_completion_tokens");
    expect(src).not.toMatch(/[^_]max_tokens[^_]/);
  });

  it("charges credits before generating and refunds on failure", () => {
    expect(src).toContain("chargeCredits(");
    expect(src).toContain("refundCredits(");
  });

  it("returns creditsUsed and creditsRemaining in the response", () => {
    expect(src).toContain("creditsUsed");
    expect(src).toContain("creditsRemaining");
  });

  it("mounts POST /api/gamers/ideas behind auth + rate limit", () => {
    expect(src).toContain('"/gamers/ideas"');
    expect(src).toContain("requireAuth");
    expect(src).toContain("publicApiLimiter");
  });
});
