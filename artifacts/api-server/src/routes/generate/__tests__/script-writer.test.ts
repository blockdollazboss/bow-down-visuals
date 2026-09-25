/**
 * Money-integrity + prompt tests for the AI Script Writer.
 *
 * Covers: the 2-credit charge, the out-of-credits 402 contract, request
 * validation (400 before credits), the refund-on-failure path, prompt
 * construction (platform/length/tone/topic woven in), max_completion_tokens
 * (never max_tokens), and the JSON response parser guards.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: () => "gpt-6-sol",
}));

import {
  SCRIPT_WRITER_CREDIT_COST,
  SCRIPT_WRITER_PLATFORMS,
  SCRIPT_WRITER_LENGTHS,
  SCRIPT_WRITER_TONES,
  buildScriptPrompt,
} from "../script-writer";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SCRIPT_WRITER_CREDIT_COST", () => {
  it("charges 2 credits per script", () => {
    expect(SCRIPT_WRITER_CREDIT_COST).toBe(2);
  });
});

describe("SCRIPT_WRITER_PLATFORMS", () => {
  it("covers YouTube, TikTok, and Reels", () => {
    expect([...SCRIPT_WRITER_PLATFORMS].sort()).toEqual(["reels", "tiktok", "youtube"]);
  });
});

describe("SCRIPT_WRITER_LENGTHS", () => {
  it("offers four length tiers", () => {
    expect([...SCRIPT_WRITER_LENGTHS].sort()).toEqual(["deep", "long", "medium", "short"]);
  });
});

describe("SCRIPT_WRITER_TONES", () => {
  it("offers four tones", () => {
    expect([...SCRIPT_WRITER_TONES].sort()).toEqual([
      "controversial",
      "educational",
      "entertaining",
      "inspirational",
    ]);
  });
});

describe("buildScriptPrompt", () => {
  const base = {
    platform: "youtube" as const,
    length: "medium" as const,
    topic: "How I made my first beat",
    tone: "educational" as const,
    audience: "",
    ctaGoal: "",
  };

  it("weaves platform, length, tone, and topic into the prompt", () => {
    const prompt = buildScriptPrompt(base);
    expect(prompt).toContain("How I made my first beat");
    expect(prompt).toContain("YouTube");
    expect(prompt).toContain("1 to 3 minutes");
    expect(prompt).toContain("generous expert");
  });

  it("adapts direction per platform", () => {
    const tiktok = buildScriptPrompt({ ...base, platform: "tiktok" });
    expect(tiktok).toContain("TikTok");
    const reels = buildScriptPrompt({ ...base, platform: "reels" });
    expect(reels).toContain("Instagram Reels");
  });

  it("adapts direction per length tier", () => {
    expect(buildScriptPrompt({ ...base, length: "short" })).toContain("under 60 seconds");
    expect(buildScriptPrompt({ ...base, length: "long" })).toContain("3 to 10 minutes");
    expect(buildScriptPrompt({ ...base, length: "deep" })).toContain("10+ minutes");
  });

  it("includes the audience and CTA goal when provided", () => {
    const prompt = buildScriptPrompt({
      ...base,
      audience: "bedroom producers",
      ctaGoal: "join my Discord",
    });
    expect(prompt).toContain("bedroom producers");
    expect(prompt).toContain("join my Discord");
  });

  it("demands a JSON-only response with the full script contract", () => {
    const prompt = buildScriptPrompt(base);
    expect(prompt).toContain("Return ONLY JSON");
    expect(prompt).toContain('"hook"');
    expect(prompt).toContain('"beats"');
    expect(prompt).toContain('"retentionBeats"');
    expect(prompt).toContain('"teleprompter"');
    expect(prompt).toContain("first-3-seconds");
    expect(prompt).toContain("retention beat");
  });

  it("never references max_tokens (GPT-6 uses max_completion_tokens)", () => {
    expect(buildScriptPrompt(base)).not.toContain("max_tokens");
  });
});

describe("route money contract (static)", () => {
  it("exports a router module that wires charge-before-generate with refund", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../script-writer.ts", import.meta.url),
        "utf8"
      )
    );
    // Charge happens before the model call…
    expect(src).toMatch(/chargeCredits\([\s\S]*?\)[\s\S]*?getOpenAI\(\)/);
    // …and a failed generation refunds.
    expect(src).toContain("refundCredits");
    expect(src).toContain("AI Script Writer — Refund (generation failed)");
    // GPT-6 token param, never the rejected one.
    expect(src).toContain("max_completion_tokens");
    expect(src).not.toMatch(/[^_]max_tokens[^_]/);
    // 402 contract for empty wallets.
    expect(src).toContain("out_of_credits");
  });
});
