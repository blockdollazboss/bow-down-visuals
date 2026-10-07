/**
 * Tests for the Sponsor Read Generator backend.
 *
 * Covers: the 100-Visual-Buc price, input schema validation, and the
 * model-output parser (sanitization and failure modes that trigger the
 * credit refund).
 */
import { describe, expect, it } from "vitest";
import {
  SPONSOR_READ_CREDIT_COST,
  sponsorReadSchema,
  parseSponsorRead,
} from "../sponsor-read";

describe("SPONSOR_READ_CREDIT_COST", () => {
  it("charges 100 Visual Bucs per sponsor read", () => {
    expect(SPONSOR_READ_CREDIT_COST).toBe(100);
  });
});

describe("sponsorReadSchema", () => {
  const valid = {
    brandName: "Wave Energy",
    readLength: "30",
    tone: "energetic",
    keyPoints: ["Zero sugar", "Tastes like a blue raspberry slushie"],
  };

  it("accepts a valid request", () => {
    expect(sponsorReadSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all read lengths and tones", () => {
    for (const readLength of ["30", "60", "90"]) {
      for (const tone of ["energetic", "casual", "luxury", "humorous"]) {
        expect(sponsorReadSchema.safeParse({ ...valid, readLength, tone }).success).toBe(true);
      }
    }
  });

  it("accepts the optional product description", () => {
    const full = { ...valid, productDescription: "A zero-sugar energy drink for creators." };
    expect(sponsorReadSchema.safeParse(full).success).toBe(true);
  });

  it("rejects a missing brand name", () => {
    expect(sponsorReadSchema.safeParse({ ...valid, brandName: "" }).success).toBe(false);
  });

  it("rejects an invalid read length", () => {
    expect(sponsorReadSchema.safeParse({ ...valid, readLength: "45" }).success).toBe(false);
  });

  it("rejects an invalid tone", () => {
    expect(sponsorReadSchema.safeParse({ ...valid, tone: "sleepy" }).success).toBe(false);
  });

  it("rejects an empty keyPoints array", () => {
    expect(sponsorReadSchema.safeParse({ ...valid, keyPoints: [] }).success).toBe(false);
  });

  it("rejects more than 10 key points", () => {
    const many = Array.from({ length: 11 }, (_, i) => `Point ${i}`);
    expect(sponsorReadSchema.safeParse({ ...valid, keyPoints: many }).success).toBe(false);
  });
});

describe("parseSponsorRead", () => {
  const good = JSON.stringify({
    script: "Okay real talk — [PAUSE] I used to crash at 3pm every day. [EMPHASIS] Wave Energy fixed that. Zero sugar, tastes like a blue raspberry slushie, and I am locked in. Link in the description.",
    hookLine: "I used to crash at 3pm every single day.",
    ctaLine: "Grab Wave Energy with my link in the description for 20% off.",
    estimatedSeconds: 28,
  });

  it("parses a complete read", () => {
    const read = parseSponsorRead(good);
    expect(read).not.toBeNull();
    expect(read!.hookLine).toContain("3pm");
    expect(read!.ctaLine).toContain("20% off");
    expect(read!.estimatedSeconds).toBe(28);
    expect(read!.script).toContain("[PAUSE]");
    expect(read!.script).toContain("[EMPHASIS]");
  });

  it("estimates seconds from word count when the model omits it", () => {
    const withoutSeconds = JSON.stringify({
      script: "This is a short sponsor read with enough words to estimate timing.",
      hookLine: "Short hook.",
      ctaLine: "Click the link.",
    });
    const read = parseSponsorRead(withoutSeconds);
    expect(read).not.toBeNull();
    expect(read!.estimatedSeconds).toBeGreaterThan(0);
  });

  it("clamps a wild estimatedSeconds into a sane range", () => {
    const wild = JSON.stringify({
      script: "Some script text here for the sponsor read.",
      hookLine: "Hook.",
      ctaLine: "CTA.",
      estimatedSeconds: 9999,
    });
    const read = parseSponsorRead(wild);
    expect(read!.estimatedSeconds).toBeLessThanOrEqual(180);
  });

  it("returns null for non-JSON", () => {
    expect(parseSponsorRead("not json at all")).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    const missing = JSON.stringify({ script: "x".repeat(50), hookLine: "hook" });
    expect(parseSponsorRead(missing)).toBeNull();
  });
});
