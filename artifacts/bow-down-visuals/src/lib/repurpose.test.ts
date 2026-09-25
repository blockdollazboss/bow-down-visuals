import { describe, it, expect } from "vitest";
import {
  PACK_CREDITS,
  REROLL_CREDITS,
  formatRepurposeTimestamp,
  buildCaptionsExport,
  packProgress,
  PLATFORM_LABELS,
} from "./repurpose";

describe("pricing", () => {
  it("pack costs 5 credits, re-rolls cost 1", () => {
    expect(PACK_CREDITS).toBe(5);
    expect(REROLL_CREDITS).toBe(1);
  });
});

describe("formatRepurposeTimestamp", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatRepurposeTimestamp(0)).toBe("00:00");
    expect(formatRepurposeTimestamp(61.5)).toBe("01:01");
    expect(formatRepurposeTimestamp(3600)).toBe("60:00");
  });
  it("clamps negatives", () => {
    expect(formatRepurposeTimestamp(-10)).toBe("00:00");
  });
});

describe("buildCaptionsExport", () => {
  it("renders numbered captions with # hashtags", () => {
    const out = buildCaptionsExport([
      { caption: "POV: you did it", hashtags: ["fyp", "win"] },
      { caption: "No notes", hashtags: [] },
    ]);
    expect(out).toContain("Caption 1:\nPOV: you did it\n#fyp #win");
    expect(out).toContain("Caption 2:\nNo notes\n");
  });
  it("handles empty list", () => {
    expect(buildCaptionsExport([])).toBe("No captions yet.");
  });
});

describe("packProgress", () => {
  it("sums the 10 pack outputs", () => {
    expect(packProgress({ clips: 3, thumbnails: 3, captions: 1, descriptions: 1 })).toEqual({
      done: 8,
      total: 10,
    });
    expect(packProgress({ clips: 0, thumbnails: 0, captions: 0, descriptions: 0 })).toEqual({
      done: 0,
      total: 10,
    });
  });
});

describe("PLATFORM_LABELS", () => {
  it("covers all four platforms", () => {
    expect(Object.keys(PLATFORM_LABELS)).toEqual(["tiktok", "reels", "shorts", "x"]);
    expect(PLATFORM_LABELS.tiktok).toBe("TikTok");
    expect(PLATFORM_LABELS.shorts).toBe("YouTube Shorts");
  });
});
