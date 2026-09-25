/**
 * Tests for the Thumbnail A/B Tester.
 *
 * Covers: the pure helpers (prompt building, JSON parsing/sanitization),
 * pricing constants, the honesty disclaimer, and the max_completion_tokens
 * rule (GPT-6 rejects max_tokens).
 */
import { describe, expect, it } from "vitest";
import {
  buildTestPrompt,
  parseTestResult,
  THUMBNAIL_TEST_CREDIT_COST,
  THUMBNAIL_IMPROVE_CREDIT_COST,
} from "../thumbnail-test";

describe("thumbnail-test pricing", () => {
  it("charges 2 credits per test", () => {
    expect(THUMBNAIL_TEST_CREDIT_COST).toBe(2);
  });

  it("charges 2 credits to apply suggestions", () => {
    expect(THUMBNAIL_IMPROVE_CREDIT_COST).toBe(2);
  });
});

describe("buildTestPrompt", () => {
  it("mentions the thumbnail count and scoring dimensions", () => {
    const prompt = buildTestPrompt("", "", 3);
    expect(prompt).toContain("3 thumbnail");
    expect(prompt).toContain("curiosityGap");
    expect(prompt).toContain("readability");
    expect(prompt).toContain("emotionalImpact");
    expect(prompt).toContain("colorContrast");
    expect(prompt).toContain("facePresence");
  });

  it("includes title/niche context when provided", () => {
    const prompt = buildTestPrompt("My Banger", "hip-hop", 2);
    expect(prompt).toContain("My Banger");
    expect(prompt).toContain("hip-hop");
  });

  it("frames the output as a prediction, not a guarantee", () => {
    const prompt = buildTestPrompt("", "", 2);
    expect(prompt.toLowerCase()).toContain("prediction");
  });

  it("demands strict JSON output", () => {
    const prompt = buildTestPrompt("", "", 2);
    expect(prompt).toContain("ONLY valid JSON");
    expect(prompt).toContain("winnerIndex");
  });
});

const VALID_JSON = JSON.stringify({
  analyses: [
    {
      scores: {
        curiosityGap: 82,
        readability: 74,
        emotionalImpact: 90,
        colorContrast: 88,
        facePresence: 95,
        overall: 85,
      },
      strengths: ["Big expressive face", "High contrast"],
      weaknesses: ["Text slightly small"],
      tips: ["Make the text 30% larger", "Add a red arrow"],
    },
    {
      scores: {
        curiosityGap: 60,
        readability: 55,
        emotionalImpact: 62,
        colorContrast: 58,
        facePresence: 40,
        overall: 57,
      },
      strengths: ["Clean layout"],
      weaknesses: ["No face", "Washed out colors"],
      tips: ["Add your face with a shocked expression", "Boost saturation"],
    },
  ],
  winnerIndex: 0,
  confidence: 78,
  reasoning: "Thumbnail 1 wins on face presence and emotional impact.",
});

describe("parseTestResult", () => {
  it("parses a valid model response", () => {
    const result = parseTestResult(VALID_JSON, 2);
    expect(result).not.toBeNull();
    expect(result!.analyses).toHaveLength(2);
    expect(result!.winnerIndex).toBe(0);
    expect(result!.confidence).toBe(78);
    expect(result!.analyses[0]!.scores.overall).toBe(85);
    expect(result!.analyses[0]!.tips).toContain("Make the text 30% larger");
  });

  it("always includes the honesty disclaimer", () => {
    const result = parseTestResult(VALID_JSON, 2);
    expect(result!.disclaimer.toLowerCase()).toContain("not a guarantee");
    expect(result!.disclaimer.toLowerCase()).toContain("prediction");
  });

  it("strips markdown fences before parsing", () => {
    const fenced = "```json\n" + VALID_JSON + "\n```";
    const result = parseTestResult(fenced, 2);
    expect(result).not.toBeNull();
    expect(result!.winnerIndex).toBe(0);
  });

  it("returns null for invalid JSON", () => {
    expect(parseTestResult("not json at all", 2)).toBeNull();
  });

  it("returns null when analysis count mismatches the upload count", () => {
    expect(parseTestResult(VALID_JSON, 3)).toBeNull();
    expect(parseTestResult(VALID_JSON, 4)).toBeNull();
  });

  it("returns null for an out-of-range winnerIndex", () => {
    const bad = JSON.stringify({ ...JSON.parse(VALID_JSON), winnerIndex: 7 });
    expect(parseTestResult(bad, 2)).toBeNull();
  });

  it("clamps scores to 0-100", () => {
    const parsed = JSON.parse(VALID_JSON);
    parsed.analyses[0].scores.overall = 999;
    parsed.analyses[0].scores.readability = -20;
    const result = parseTestResult(JSON.stringify(parsed), 2);
    expect(result!.analyses[0]!.scores.overall).toBe(100);
    expect(result!.analyses[0]!.scores.readability).toBe(0);
  });

  it("sanitizes non-string strengths/weaknesses/tips", () => {
    const parsed = JSON.parse(VALID_JSON);
    parsed.analyses[0].tips = ["good tip", 42, null, { x: 1 }, "another tip"];
    const result = parseTestResult(JSON.stringify(parsed), 2);
    expect(result!.analyses[0]!.tips).toEqual(["good tip", "another tip"]);
  });

  it("caps the number of tips to avoid prompt bloat", () => {
    const parsed = JSON.parse(VALID_JSON);
    parsed.analyses[0].tips = Array.from({ length: 20 }, (_, i) => `tip ${i}`);
    const result = parseTestResult(JSON.stringify(parsed), 2);
    expect(result!.analyses[0]!.tips.length).toBeLessThanOrEqual(5);
  });
});

describe("GPT-6 token parameter rule", () => {
  it("never uses max_tokens in the thumbnail-test route source", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "thumbnail-test.ts"),
      "utf-8",
    );
    // max_completion_tokens is allowed; bare max_tokens is not.
    const bareMaxTokens = /(?<!completion_)max_tokens\b/;
    expect(bareMaxTokens.test(src)).toBe(false);
    expect(src).toContain("max_completion_tokens");
  });
});
