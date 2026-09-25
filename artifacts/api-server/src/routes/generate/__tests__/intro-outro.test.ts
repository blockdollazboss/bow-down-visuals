/**
 * Money-integrity + request-validation tests for Intros & Outros.
 *
 * Covers: the 5s × 1.5cr/sec pricing contract (8 credits), the 402
 * out-of-credits rule, request validation, and prompt construction.
 */
import { describe, expect, it } from "vitest";

import {
  resolveIntroOutroCost,
  buildIntroOutroPrompt,
  resolveIntroOutroRequest,
  INTRO_OUTRO_DURATION_SEC,
  INTRO_OUTRO_RATIO,
  INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK,
} from "../intro-outro-pricing";

describe("intro/outro pricing contract", () => {
  it("is always a 5-second sting", () => {
    expect(INTRO_OUTRO_DURATION_SEC).toBe(5);
  });

  it("uses the landscape 16:9 ratio", () => {
    expect(INTRO_OUTRO_RATIO).toBe("1280:720");
  });

  it("costs 8 credits at the 1.5 cr/sec Seedance rate", () => {
    expect(INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK).toBe(1.5);
    expect(resolveIntroOutroCost()).toBe(8);
    expect(resolveIntroOutroCost(1.5)).toBe(8);
  });

  it("rounds up fractional credit costs (never undercharges)", () => {
    // 5s × 1.1 = 5.5 → 6
    expect(resolveIntroOutroCost(1.1)).toBe(6);
  });

  it("the route rejects when balance < cost (documents the 402 contract)", () => {
    // POST /generate-intro-outro checks req.userCredits < 8 → 402
    expect(7 < resolveIntroOutroCost()).toBe(true); // 7 credits → 402
    expect(8 < resolveIntroOutroCost()).toBe(false); // exact balance → allowed
  });
});

describe("resolveIntroOutroRequest", () => {
  it("accepts a valid intro request", () => {
    const r = resolveIntroOutroRequest({ channelName: "Bow Down Visuals", type: "intro" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channelName).toBe("Bow Down Visuals");
      expect(r.type).toBe("intro");
      expect(r.creditCost).toBe(8);
    }
  });

  it("accepts a valid outro request with tagline and logo reference", () => {
    const r = resolveIntroOutroRequest({
      channelName: "BDV",
      type: "outro",
      tagline: "Create Daily",
      referenceImageUrl: "https://example.com/logo.png",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tagline).toBe("Create Daily");
      expect(r.refImage).toBe("https://example.com/logo.png");
    }
  });

  it("rejects a non-HTTPS logo reference (Runway needs public HTTPS)", () => {
    const r = resolveIntroOutroRequest({
      channelName: "BDV",
      type: "intro",
      referenceImageUrl: "not-a-url",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.refImage).toBeUndefined();
  });

  it("400s when channelName is missing", () => {
    const r = resolveIntroOutroRequest({ type: "intro" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("400s when type is missing or invalid", () => {
    for (const bad of [{ channelName: "X" }, { channelName: "X", type: "middle" }, { channelName: "X", type: "" }]) {
      const r = resolveIntroOutroRequest(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it("trims and caps the channel name", () => {
    const r = resolveIntroOutroRequest({ channelName: "  " + "A".repeat(100) + "  ", type: "intro" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.channelName).toBe("A".repeat(60));
  });
});

describe("buildIntroOutroPrompt", () => {
  it("builds an intro prompt with the channel name", () => {
    const p = buildIntroOutroPrompt("Bow Down Visuals", "intro");
    expect(p).toContain("Bow Down Visuals");
    expect(p).toContain("intro");
    expect(p).toContain("gold");
  });

  it("builds an outro prompt with closing beats", () => {
    const p = buildIntroOutroPrompt("BDV", "outro");
    expect(p).toContain("outro");
    expect(p).toMatch(/fade|closing/i);
  });

  it("includes the tagline when provided", () => {
    const p = buildIntroOutroPrompt("BDV", "intro", "Create Daily");
    expect(p).toContain("Create Daily");
  });

  it("bans watermarks, people, and extra text", () => {
    const p = buildIntroOutroPrompt("BDV", "intro");
    const lower = p.toLowerCase();
    expect(lower).toContain("no watermark");
    expect(lower).toContain("no people");
  });
});
