/**
 * Money-integrity and logic tests for the AI Voiceover Studio.
 *
 * Covers: per-minute pricing, word-count duration estimates, emotion →
 * ElevenLabs voice_settings mapping, TTS request construction, and the
 * validation schema boundaries.
 */
import { describe, expect, it } from "vitest";
import {
  VOICEOVER_CREDITS_PER_MINUTE,
  WORDS_PER_MINUTE,
  MAX_SCRIPT_CHARS,
  EMOTIONS,
  EMOTION_SETTINGS,
  EMOTION_BLURBS,
  estimateVoiceoverCost,
  buildTtsRequest,
} from "../voiceover";

describe("VOICEOVER_CREDITS_PER_MINUTE", () => {
  it("charges 2 credits per minute of audio", () => {
    expect(VOICEOVER_CREDITS_PER_MINUTE).toBe(2);
  });
});

describe("estimateVoiceoverCost", () => {
  it("estimates 150 words as 1 minute", () => {
    const words = new Array(150).fill("word").join(" ");
    const est = estimateVoiceoverCost(words);
    expect(est.wordCount).toBe(150);
    expect(est.estimatedSeconds).toBe(60);
    expect(est.billableMinutes).toBe(1);
    expect(est.credits).toBe(2);
  });

  it("rounds partial minutes up", () => {
    // 151 words ≈ 60.4s → 2 billable minutes → 4 credits
    const words = new Array(151).fill("word").join(" ");
    const est = estimateVoiceoverCost(words);
    expect(est.billableMinutes).toBe(2);
    expect(est.credits).toBe(4);
  });

  it("enforces a 1-minute minimum charge", () => {
    const est = estimateVoiceoverCost("Hello world");
    expect(est.billableMinutes).toBe(1);
    expect(est.credits).toBe(VOICEOVER_CREDITS_PER_MINUTE);
  });

  it("handles empty scripts", () => {
    const est = estimateVoiceoverCost("   ");
    expect(est.wordCount).toBe(0);
    expect(est.billableMinutes).toBe(1);
  });

  it("scales for long scripts (1500 words = 10 min = 20 credits)", () => {
    const words = new Array(1500).fill("word").join(" ");
    const est = estimateVoiceoverCost(words);
    expect(est.billableMinutes).toBe(10);
    expect(est.credits).toBe(20);
  });
});

describe("EMOTIONS", () => {
  it("offers the four documented directions", () => {
    expect([...EMOTIONS].sort()).toEqual(
      ["calm", "conversational", "dramatic", "energetic"].sort(),
    );
  });

  it("has settings and blurbs for every emotion", () => {
    for (const emotion of EMOTIONS) {
      expect(EMOTION_SETTINGS[emotion]).toBeDefined();
      expect(EMOTION_BLURBS[emotion]).toBeDefined();
      expect(EMOTION_BLURBS[emotion].length).toBeGreaterThan(0);
    }
  });

  it("keeps voice settings in valid ElevenLabs ranges", () => {
    for (const emotion of EMOTIONS) {
      const s = EMOTION_SETTINGS[emotion];
      expect(s.stability).toBeGreaterThanOrEqual(0);
      expect(s.stability).toBeLessThanOrEqual(1);
      expect(s.similarity_boost).toBeGreaterThanOrEqual(0);
      expect(s.similarity_boost).toBeLessThanOrEqual(1);
      expect(s.style).toBeGreaterThanOrEqual(0);
      expect(s.style).toBeLessThanOrEqual(1);
    }
  });

  it("differentiates emotions (not all identical)", () => {
    const serialized = EMOTIONS.map((e) => JSON.stringify(EMOTION_SETTINGS[e]));
    expect(new Set(serialized).size).toBeGreaterThan(1);
  });
});

describe("buildTtsRequest", () => {
  it("builds a valid ElevenLabs TTS body", () => {
    const body = buildTtsRequest("Hello world", "energetic", 1.0);
    expect(body.text).toBe("Hello world");
    expect(typeof body.model_id).toBe("string");
    expect(body.model_id.length).toBeGreaterThan(0);
    expect(body.voice_settings.stability).toBe(
      EMOTION_SETTINGS["energetic"].stability,
    );
    expect(body.voice_settings.speed).toBe(1.0);
  });

  it("passes the speed through to voice_settings", () => {
    const body = buildTtsRequest("Hi", "calm", 0.85);
    expect(body.voice_settings.speed).toBe(0.85);
  });

  it("never uses max_tokens (GPT-6 rejects it)", () => {
    const body = buildTtsRequest("Hi", "dramatic", 1.0);
    expect(JSON.stringify(body)).not.toContain("max_tokens");
  });
});

describe("MAX_SCRIPT_CHARS", () => {
  it("caps scripts at a sane length", () => {
    expect(MAX_SCRIPT_CHARS).toBe(18_000);
    expect(WORDS_PER_MINUTE).toBe(150);
  });
});
