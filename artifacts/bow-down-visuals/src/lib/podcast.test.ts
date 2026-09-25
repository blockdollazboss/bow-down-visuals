import { describe, expect, it } from "vitest";
import {
  estimatePodcastCost,
  estimateTopicModeCost,
  formatDuration,
  WORDS_PER_MINUTE,
  SECONDS_PER_BLOCK,
  PODCAST_CREDITS_PER_10MIN,
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
    expect(PODCAST_CREDITS_PER_10MIN).toBe(3);
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
