import { describe, expect, it } from "vitest";
import {
  estimatePodcastCost,
  estimateTopicModeCost,
  estimateDialogueCost,
  formatDuration,
  WORDS_PER_MINUTE,
  SECONDS_PER_BLOCK,
  PODCAST_CREDITS_PER_10MIN,
  DIALOGUE_CREDITS_PER_10MIN,
  DIALOGUE_SECONDS_PER_BLOCK,
} from "./podcast";

describe("estimatePodcastCost", () => {
  it("counts words and estimates at 150 wpm", () => {
    const words = new Array(1500).fill("word").join(" ");
    const est = estimatePodcastCost(words);
    expect(est.wordCount).toBe(1500);
    expect(est.estimatedSeconds).toBe(600);
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(PODCAST_CREDITS_PER_10MIN);
  });

  it("rounds up partial 10-minute blocks", () => {
    const words = new Array(1501).fill("word").join(" ");
    const est = estimatePodcastCost(words);
    expect(est.billableBlocks).toBe(2);
    expect(est.credits).toBe(2 * PODCAST_CREDITS_PER_10MIN);
  });

  it("charges a 1-block minimum for tiny scripts", () => {
    const est = estimatePodcastCost("Hello world");
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(PODCAST_CREDITS_PER_10MIN);
  });

  it("keeps pricing constants in sync with the backend", () => {
    expect(WORDS_PER_MINUTE).toBe(150);
    expect(SECONDS_PER_BLOCK).toBe(600);
    expect(PODCAST_CREDITS_PER_10MIN).toBe(300);
  });
});

describe("estimateDialogueCost — ruling #32 (300 VB per 10 min, approved 2026-11-02)", () => {
  /** A two-speaker tagged script of exactly `words` spoken words. */
  function taggedScript(words: number): string {
    const half = Math.floor(words / 2);
    return `ALEX: ${new Array(half).fill("word").join(" ")}\nJORDAN: ${new Array(words - half).fill("word").join(" ")}`;
  }

  it("keeps the dialogue rate in sync with the backend at the ruled 300", () => {
    expect(DIALOGUE_CREDITS_PER_10MIN).toBe(300);
    expect(DIALOGUE_SECONDS_PER_BLOCK).toBe(600);
  });

  // The FE estimator counts the raw script's words — the two speaker
  // tags included (the base estimatePodcastCost word count) — so the
  // scripts below carry 1,498 / 1,499 spoken words + 2 tags = exactly
  // 1,500 / 1,501 counted words. (The server strips tags before
  // counting; the rate and block formula are identical on both sides.)
  it("1500 counted words = 10 minutes = 1 block = 300 VB", () => {
    const est = estimateDialogueCost(taggedScript(1498));
    expect(est.wordCount).toBe(1500);
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(300);
    expect(est.speakerCount).toBe(2);
    expect(est.turnCount).toBe(2);
  });

  it("rounds partial blocks up (1501 counted words = 2 blocks = 600 VB)", () => {
    const est = estimateDialogueCost(taggedScript(1499));
    expect(est.wordCount).toBe(1501);
    expect(est.billableBlocks).toBe(2);
    expect(est.credits).toBe(600);
  });
});

describe("estimateTopicModeCost", () => {
  it("estimates roughly one 10-minute block before the script exists", () => {
    const est = estimateTopicModeCost();
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(PODCAST_CREDITS_PER_10MIN);
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });
});
