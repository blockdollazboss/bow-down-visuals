/**
 * Tests for the Sponsorship Outreach backend.
 *
 * Covers: the 2-credit price, input schema validation, and the model-output
 * parser (sanitization, follow-up clamping, and failure modes that trigger
 * the credit refund).
 */
import { describe, expect, it } from "vitest";
import {
  OUTREACH_CREDIT_COST,
  outreachSchema,
  parseOutreachKit,
} from "../sponsorship-outreach";

describe("OUTREACH_CREDIT_COST", () => {
  it("charges 2 credits per outreach kit", () => {
    expect(OUTREACH_CREDIT_COST).toBe(2);
  });
});

describe("outreachSchema", () => {
  const valid = {
    creatorName: "King Shark",
    niche: "Music",
    audienceSize: "50K",
    platforms: ["tiktok", "instagram"],
    brandName: "Wave Energy",
  };

  it("accepts a valid request", () => {
    expect(outreachSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const full = {
      ...valid,
      engagement: "8% avg engagement",
      notableWins: "1M streams on latest single",
      product: "Wave Energy Drink",
      campaignGoal: "Launch to Gen Z",
      contactName: "Alex Rivera",
    };
    expect(outreachSchema.safeParse(full).success).toBe(true);
  });

  it("rejects missing creator name", () => {
    const bad = { ...valid, creatorName: "" };
    const result = outreachSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects missing niche", () => {
    const bad = { ...valid, niche: "" };
    expect(outreachSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing audience size", () => {
    const bad = { ...valid, audienceSize: "" };
    expect(outreachSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects empty platforms", () => {
    const bad = { ...valid, platforms: [] };
    expect(outreachSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing brand name", () => {
    const bad = { ...valid, brandName: "" };
    expect(outreachSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects oversized input", () => {
    const bad = { ...valid, creatorName: "x".repeat(101) };
    expect(outreachSchema.safeParse(bad).success).toBe(false);
  });
});

describe("parseOutreachKit", () => {
  const goodKit = JSON.stringify({
    pitchEmail: { subject: "Quick collab idea for Wave", body: "Hi Alex, love what you're doing..." },
    dmVersion: "Hey! Quick idea...",
    mediaKitSummary: "King Shark is a music creator...",
    followUps: [
      { day: 7, subject: "Bumping this", body: "Just floating this up..." },
      { day: 14, subject: "One more idea", body: "Had another thought..." },
      { day: 21, subject: "Closing the loop", body: "Last nudge..." },
    ],
  });

  it("parses a well-formed kit", () => {
    const kit = parseOutreachKit(goodKit);
    expect(kit).not.toBeNull();
    expect(kit!.pitchEmail.subject).toBe("Quick collab idea for Wave");
    expect(kit!.followUps).toHaveLength(3);
    expect(kit!.disclaimer.length).toBeGreaterThan(0);
  });

  it("returns null on invalid JSON", () => {
    expect(parseOutreachKit("not json")).toBeNull();
  });

  it("returns null when pitch email is missing", () => {
    const bad = JSON.stringify({ dmVersion: "x", mediaKitSummary: "y", followUps: [{ day: 7, subject: "s", body: "b" }] });
    expect(parseOutreachKit(bad)).toBeNull();
  });

  it("returns null when follow-ups are missing", () => {
    const bad = JSON.stringify({
      pitchEmail: { subject: "s", body: "b" },
      dmVersion: "x",
      mediaKitSummary: "y",
      followUps: [],
    });
    expect(parseOutreachKit(bad)).toBeNull();
  });

  it("clamps follow-up days into range", () => {
    const kit = JSON.stringify({
      pitchEmail: { subject: "s", body: "b" },
      dmVersion: "x",
      mediaKitSummary: "y",
      followUps: [{ day: 99, subject: "s", body: "b" }],
    });
    const parsed = parseOutreachKit(kit);
    expect(parsed).not.toBeNull();
    expect(parsed!.followUps[0]!.day).toBe(30);
  });

  it("drops malformed follow-ups but keeps valid ones", () => {
    const kit = JSON.stringify({
      pitchEmail: { subject: "s", body: "b" },
      dmVersion: "x",
      mediaKitSummary: "y",
      followUps: [
        { day: "soon", subject: "s", body: "b" },
        { day: 7, subject: "s", body: "b" },
      ],
    });
    const parsed = parseOutreachKit(kit);
    expect(parsed).not.toBeNull();
    expect(parsed!.followUps).toHaveLength(1);
  });

  it("caps follow-ups at 3", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ day: 7 + i, subject: "s", body: "b" }));
    const kit = JSON.stringify({
      pitchEmail: { subject: "s", body: "b" },
      dmVersion: "x",
      mediaKitSummary: "y",
      followUps: many,
    });
    expect(parseOutreachKit(kit)!.followUps).toHaveLength(3);
  });

  it("truncates oversized text fields", () => {
    const kit = JSON.stringify({
      pitchEmail: { subject: "s", body: "b".repeat(9000) },
      dmVersion: "x",
      mediaKitSummary: "y",
      followUps: [{ day: 7, subject: "s", body: "b" }],
    });
    const parsed = parseOutreachKit(kit);
    expect(parsed).not.toBeNull();
    expect(parsed!.pitchEmail.body.length).toBeLessThanOrEqual(4000);
  });
});
