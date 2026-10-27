import { describe, it, expect } from "vitest";
import {
  buildRadarFeed,
  isVerifiedSignal,
  radarGrowth,
  radarHeadline,
  scoreSignal,
  type RadarSignalInput,
} from "../trend-radar";

const base: RadarSignalInput = {
  kind: "hashtag",
  key: "kingfriday",
  label: "#kingfriday",
  currentCount: 40,
  baselineCount: 10,
  source: "posts + videos, last 24h",
};

describe("trend-radar verified-only rule", () => {
  it("rejects signals with no source", () => {
    expect(isVerifiedSignal({ ...base, source: "" })).toBe(false);
    expect(isVerifiedSignal({ ...base, source: "  " })).toBe(false);
  });
  it("rejects signals with no verified positive count", () => {
    expect(isVerifiedSignal({ ...base, currentCount: 0 })).toBe(false);
    expect(isVerifiedSignal({ ...base, currentCount: Number.NaN })).toBe(false);
  });
  it("accepts a real counted signal", () => {
    expect(isVerifiedSignal(base)).toBe(true);
  });
  it("drops unverified signals from the feed entirely", () => {
    const feed = buildRadarFeed([base, { ...base, key: "fake", source: "" }]);
    expect(feed.map((s) => s.key)).toEqual(["kingfriday"]);
  });
});

describe("trend-radar scoring", () => {
  it("growth is a capped multiple of baseline", () => {
    expect(radarGrowth(40, 10)).toBe(4);
    expect(radarGrowth(10, 0)).toBe(50);
    expect(radarGrowth(0, 10)).toBe(0);
  });
  it("labels movement by growth", () => {
    expect(scoreSignal(base).movement).toBe("surging");
    expect(scoreSignal({ ...base, currentCount: 20 }).movement).toBe("rising");
    expect(scoreSignal({ ...base, currentCount: 11 }).movement).toBe("steady");
  });
  it("dedupes by kind+key keeping the stronger signal and sorts by score", () => {
    const feed = buildRadarFeed([
      { ...base, currentCount: 12, baselineCount: 10 },
      base,
      { ...base, kind: "spike", key: "v1", label: "Video", currentCount: 900, baselineCount: 100 },
    ]);
    expect(feed).toHaveLength(2);
    expect(feed[0]?.kind).toBe("spike");
  });
  it("headline is honest about an empty radar", () => {
    expect(radarHeadline([])).toContain("No verified signals");
    expect(radarHeadline(buildRadarFeed([base]))).toContain("surging");
  });
});
