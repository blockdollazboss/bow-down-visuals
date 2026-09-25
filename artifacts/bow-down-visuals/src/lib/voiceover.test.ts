import { describe, expect, it } from "vitest";
import {
  estimateVoiceoverCost,
  formatDuration,
  WORDS_PER_MINUTE,
  VOICEOVER_CREDITS_PER_MINUTE,
} from "./voiceover";

describe("estimateVoiceoverCost", () => {
  it("counts words and estimates at 150 wpm", () => {
    const words = new Array(150).fill("word").join(" ");
    const est = estimateVoiceoverCost(words);
    expect(est.wordCount).toBe(150);
    expect(est.estimatedSeconds).toBe(60);
    expect(est.billableMinutes).toBe(1);
    expect(est.credits).toBe(VOICEOVER_CREDITS_PER_MINUTE);
  });

  it("rounds up partial minutes", () => {
    // 151 words ≈ 60.4s → 2 billable minutes
    const words = new Array(151).fill("word").join(" ");
    const est = estimateVoiceoverCost(words);
    expect(est.billableMinutes).toBe(2);
    expect(est.credits).toBe(2 * VOICEOVER_CREDITS_PER_MINUTE);
  });

  it("charges a 1-minute minimum for tiny scripts", () => {
    const est = estimateVoiceoverCost("Hello world");
    expect(est.wordCount).toBe(2);
    expect(est.billableMinutes).toBe(1);
    expect(est.credits).toBe(VOICEOVER_CREDITS_PER_MINUTE);
  });

  it("handles empty and whitespace-only scripts", () => {
    expect(estimateVoiceoverCost("").wordCount).toBe(0);
    expect(estimateVoiceoverCost("   \n  ").wordCount).toBe(0);
  });

  it("scales linearly for long scripts", () => {
    // 1500 words = 10 minutes → 20 credits
    const words = new Array(1500).fill("word").join(" ");
    const est = estimateVoiceoverCost(words);
    expect(est.billableMinutes).toBe(10);
    expect(est.credits).toBe(10 * VOICEOVER_CREDITS_PER_MINUTE);
  });

  it("keeps pricing constants in sync with the backend", () => {
    expect(WORDS_PER_MINUTE).toBe(150);
    expect(VOICEOVER_CREDITS_PER_MINUTE).toBe(2);
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(125)).toBe("2:05");
  });
});
