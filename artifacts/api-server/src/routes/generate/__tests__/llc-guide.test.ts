/**
 * Tests for the AI LLC guide endpoints' pure logic.
 *
 * Covers: 1-credit pricing constant, request validation schemas,
 * plan JSON parsing/validation (good, malformed, and empty outputs),
 * and the state-fee grounding data (50 states, sane numbers).
 */
import { describe, expect, it } from "vitest";
import {
  LLC_GUIDE_CREDIT_COST,
  CREATOR_TYPES,
  askSchema,
  planSchema,
  parsePlanJson,
  buildAskSystemPrompt,
  buildPlanUserPrompt,
} from "../llc-guide";
import { LLC_STATE_FEES, getLlcStateFee } from "../../../lib/llc-state-fees";

describe("LLC_GUIDE_CREDIT_COST", () => {
  it("charges 1 credit per AI answer or plan", () => {
    expect(LLC_GUIDE_CREDIT_COST).toBe(1);
  });
});

describe("askSchema", () => {
  it("accepts a question with optional state and history", () => {
    const r = askSchema.safeParse({
      question: "Should I file in Delaware or my home state?",
      state: "TX",
      history: [{ role: "user", content: "hi" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty question", () => {
    expect(askSchema.safeParse({ question: "" }).success).toBe(false);
  });

  it("rejects an overlong question", () => {
    expect(askSchema.safeParse({ question: "x".repeat(1001) }).success).toBe(false);
  });

  it("rejects an unknown state code", () => {
    expect(askSchema.safeParse({ question: "hi?", state: "XX" }).success).toBe(false);
  });

  it("accepts lowercase state codes", () => {
    const r = askSchema.safeParse({ question: "hi?", state: "tx" });
    expect(r.success).toBe(true);
  });
});

describe("planSchema", () => {
  it("accepts a valid plan request", () => {
    const r = planSchema.safeParse({
      state: "WY",
      creatorType: "streamer",
      businessName: "Shark Streams LLC",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown creator type", () => {
    expect(
      planSchema.safeParse({ state: "WY", creatorType: "astronaut" }).success,
    ).toBe(false);
  });

  it("rejects a missing state", () => {
    expect(planSchema.safeParse({ creatorType: "musician" }).success).toBe(false);
  });

  it("rejects an overlong business name", () => {
    expect(
      planSchema.safeParse({
        state: "WY",
        creatorType: "musician",
        businessName: "x".repeat(121),
      }).success,
    ).toBe(false);
  });

  it("accepts every creator type", () => {
    for (const t of CREATOR_TYPES) {
      expect(planSchema.safeParse({ state: "CA", creatorType: t }).success).toBe(true);
    }
  });
});

describe("parsePlanJson", () => {
  it("parses a well-formed plan", () => {
    const plan = parsePlanJson(
      JSON.stringify({
        title: "Texas streamer plan",
        steps: [
          { title: "Name check", detail: "Search the SOS database.", estCost: "$0", timeline: "1 day" },
          { title: "File", detail: "File online.", estCost: "$300", timeline: "3–5 days" },
        ],
        totalEstimate: "$300–$400 first year",
        notes: ["EIN is free from the IRS."],
      }),
    );
    expect(plan.title).toBe("Texas streamer plan");
    expect(plan.steps).toHaveLength(2);
    expect(plan.totalEstimate).toContain("$300");
    expect(plan.notes).toHaveLength(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parsePlanJson("not json")).toThrow();
  });

  it("throws when the model returns no usable steps", () => {
    expect(() => parsePlanJson(JSON.stringify({ steps: [] }))).toThrow();
    expect(() => parsePlanJson(JSON.stringify({}))).toThrow();
  });

  it("drops empty steps and caps at 8", () => {
    const steps = Array.from({ length: 12 }, (_, i) => ({
      title: `Step ${i}`,
      detail: "do it",
      estCost: "$0",
      timeline: "soon",
    }));
    steps.push({ title: "", detail: "", estCost: "", timeline: "" });
    const plan = parsePlanJson(JSON.stringify({ steps }));
    expect(plan.steps).toHaveLength(8);
  });
});

describe("buildAskSystemPrompt", () => {
  it("grounds answers in the selected state's real fees", () => {
    const prompt = buildAskSystemPrompt("CA");
    expect(prompt).toContain("$70");
    expect(prompt).toContain("$800");
  });

  it("works without a state", () => {
    const prompt = buildAskSystemPrompt();
    expect(prompt).toContain("not legal advice");
  });

  it("always carries the not-legal-advice framing", () => {
    expect(buildAskSystemPrompt("TX")).toContain("not legal advice");
  });
});

describe("buildPlanUserPrompt", () => {
  it("injects exact state fee numbers for the plan", () => {
    const prompt = buildPlanUserPrompt("WY", "streamer", "Shark Streams LLC");
    expect(prompt).toContain("$100");
    expect(prompt).toContain("Shark Streams LLC");
    expect(prompt).toContain("WY");
  });

  it("warns the model never to pay for an EIN", () => {
    expect(buildPlanUserPrompt("TX", "musician", "").toLowerCase()).toContain(
      "never pay for one",
    );
  });
});

describe("LLC_STATE_FEES grounding data", () => {
  it("covers all 50 states", () => {
    expect(LLC_STATE_FEES).toHaveLength(50);
    expect(new Set(LLC_STATE_FEES.map((s) => s.code)).size).toBe(50);
  });

  it("has sane filing fees ($35–$500 range)", () => {
    for (const s of LLC_STATE_FEES) {
      expect(s.filingFee).toBeGreaterThanOrEqual(35);
      expect(s.filingFee).toBeLessThanOrEqual(500);
      expect(s.ongoingYearly).toBeGreaterThanOrEqual(0);
      expect(s.processing.length).toBeGreaterThan(0);
    }
  });

  it("looks up states case-insensitively", () => {
    expect(getLlcStateFee("ca")?.name).toBe("California");
    expect(getLlcStateFee("XX")).toBeUndefined();
  });
});
