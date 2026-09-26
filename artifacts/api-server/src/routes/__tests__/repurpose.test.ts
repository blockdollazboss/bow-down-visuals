/**
 * Tests for the Content Repurposer backend
 * (artifacts/api-server/src/routes/generate/repurpose.ts).
 *
 * Covers the pure, testable core: timestamp formatting, ffmpeg arg
 * building, transcript rendering, master-analysis JSON parsing, re-roll
 * parsing, and pricing constants. The model call is never hit — parse
 * functions take raw JSON strings. Refund safety is structural: parse
 * returns null on garbage instead of throwing, and the route refunds
 * whenever parse returns null.
 */
import { describe, it, expect } from "vitest";
import {
  REPURPOSE_PACK_CREDITS,
  REPURPOSE_REROLL_CREDITS,
  formatTimestamp,
  buildClipCutArgs,
  buildTimestampedTranscript,
  parseAnalysis,
  parseReroll,
} from "../generate/repurpose";

describe("pricing constants", () => {
  it("charges 5 credits for the full pack and 1 per re-roll", () => {
    expect(REPURPOSE_PACK_CREDITS).toBe(5);
    expect(REPURPOSE_REROLL_CREDITS).toBe(1);
  });
});

describe("formatTimestamp", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(65)).toBe("01:05");
    expect(formatTimestamp(3599)).toBe("59:59");
  });
  it("floors fractional seconds and clamps negatives", () => {
    expect(formatTimestamp(90.9)).toBe("01:30");
    expect(formatTimestamp(-3)).toBe("00:00");
  });
});

describe("buildClipCutArgs", () => {
  it("seeks, trims, and reframes to 720x1280 vertical", () => {
    const args = buildClipCutArgs("/tmp/in.mp4", "/tmp/out.mp4", 61.5, 91.5);
    expect(args[args.indexOf("-ss") + 1]).toBe("61.5");
    expect(args[args.indexOf("-t") + 1]).toBe("30");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("crop=ih*9/16:ih");
    expect(vf).toContain("scale=720:1280");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
  });
  it("never produces a zero/negative duration", () => {
    const args = buildClipCutArgs("/tmp/in.mp4", "/tmp/out.mp4", 10, 10);
    expect(args[args.indexOf("-t") + 1]).toBe("1");
  });
});

describe("buildTimestampedTranscript", () => {
  it("renders [mm:ss] markers per segment", () => {
    const out = buildTimestampedTranscript([
      { start: 0, end: 4, text: "hello chat" },
      { start: 65, end: 70, text: "big play!" },
    ]);
    expect(out).toContain("[00:00] hello chat");
    expect(out).toContain("[01:05] big play!");
  });
  it("truncates very long transcripts with a marker", () => {
    const segs = Array.from({ length: 500 }, (_, i) => ({
      start: i * 10,
      end: i * 10 + 5,
      text: "lorem ipsum dolor sit amet consectetur adipiscing elit sed do",
    }));
    const out = buildTimestampedTranscript(segs, 1000);
    expect(out.length).toBeLessThan(1200);
    expect(out).toContain("truncated");
  });
});

const GOOD_ANALYSIS = JSON.stringify({
  videoTitle: "The Clutch Play",
  summary: "An insane comeback win with chat going wild.",
  moments: [
    { startSec: 61, endSec: 91, title: "Clutch win", reason: "Insane comeback", quote: "no way!" },
    { startSec: 200, title: "Funny fail", reason: "Fell off the map", quote: "oops" },
    { startSec: 400, endSec: 430, title: "Big celebration", reason: "Crowd goes wild", quote: "let's go!" },
  ],
  captions: [
    { caption: "POV: you hit the impossible shot", hashtags: ["gaming", "clutch"] },
    { caption: "Chat called it before it happened", hashtags: ["stream", "highlights"] },
    { caption: "This is why we never give up", hashtags: ["comeback"] },
    { caption: "Rate this play 1-10", hashtags: ["fyp"] },
    { caption: "The timing was unreal", hashtags: ["viral"] },
  ],
  descriptions: {
    tiktok: "tiktok desc #fyp",
    reels: "reels desc",
    shorts: "shorts desc",
    x: "x desc",
  },
  thumbnailPrompts: ["prompt one", "prompt two", "prompt three"],
});

describe("parseAnalysis", () => {
  it("parses a complete pack", () => {
    const out = parseAnalysis(GOOD_ANALYSIS, 3600);
    expect(out).not.toBeNull();
    expect(out!.videoTitle).toBe("The Clutch Play");
    expect(out!.moments).toHaveLength(3);
    expect(out!.captions).toHaveLength(5);
    expect(out!.descriptions.tiktok).toBe("tiktok desc #fyp");
    expect(out!.descriptions.x).toBe("x desc");
    expect(out!.thumbnailPrompts).toHaveLength(3);
    expect(out!.moments.every((m) => typeof m.id === "string" && m.id.length > 0)).toBe(true);
  });

  it("normalizes a moment missing endSec to startSec + 30s", () => {
    const out = parseAnalysis(GOOD_ANALYSIS, 3600);
    expect(out!.moments[1].endSec).toBe(230);
  });

  it("strips # symbols from hashtags", () => {
    const raw = JSON.stringify({
      ...JSON.parse(GOOD_ANALYSIS),
      captions: [{ caption: "hi", hashtags: ["#fyp", "##gaming", "clean"] }],
    });
    const out = parseAnalysis(raw, 3600);
    expect(out!.captions[0].hashtags).toEqual(["fyp", "gaming", "clean"]);
  });

  it("returns null on malformed JSON instead of throwing", () => {
    expect(parseAnalysis("not json", 3600)).toBeNull();
    expect(parseAnalysis('{"nope": 1}', 3600)).toBeNull();
  });

  it("returns null when required sections are missing (triggers refund)", () => {
    const noMoments = JSON.stringify({ ...JSON.parse(GOOD_ANALYSIS), moments: [] });
    expect(parseAnalysis(noMoments, 3600)).toBeNull();
    const noCaptions = JSON.stringify({ ...JSON.parse(GOOD_ANALYSIS), captions: [] });
    expect(parseAnalysis(noCaptions, 3600)).toBeNull();
    const noThumbs = JSON.stringify({ ...JSON.parse(GOOD_ANALYSIS), thumbnailPrompts: [] });
    expect(parseAnalysis(noThumbs, 3600)).toBeNull();
  });

  it("drops moments with bad timestamps and clamps to duration", () => {
    const raw = JSON.stringify({
      ...JSON.parse(GOOD_ANALYSIS),
      moments: [
        { startSec: -5, title: "bad" },
        { startSec: 3590, title: "clamped", quote: "q" },
        { startSec: 100, title: "good", quote: "q" },
      ],
    });
    const out = parseAnalysis(raw, 3600);
    expect(out!.moments.map((m) => m.title)).toEqual(["good", "clamped"]);
    expect(out!.moments[1].endSec).toBe(3600);
  });

  it("dedupes near-identical moment starts", () => {
    const raw = JSON.stringify({
      ...JSON.parse(GOOD_ANALYSIS),
      moments: [
        { startSec: 100, title: "a", quote: "q" },
        { startSec: 102, title: "b", quote: "q" },
        { startSec: 500, title: "c", quote: "q" },
      ],
    });
    const out = parseAnalysis(raw, 3600);
    expect(out!.moments.map((m) => m.title)).toEqual(["a", "c"]);
  });

  it("caps moments at 3, captions at 5, thumbnail prompts at 3", () => {
    const raw = JSON.stringify({
      videoTitle: "t",
      moments: Array.from({ length: 10 }, (_, i) => ({ startSec: i * 60, title: `m${i}`, quote: "q" })),
      captions: Array.from({ length: 10 }, (_, i) => ({ caption: `c${i}`, hashtags: [] })),
      descriptions: {},
      thumbnailPrompts: ["a", "b", "c", "d", "e"],
    });
    const out = parseAnalysis(raw, 3600);
    expect(out!.moments).toHaveLength(3);
    expect(out!.captions).toHaveLength(5);
    expect(out!.thumbnailPrompts).toHaveLength(3);
  });
});

describe("parseReroll", () => {
  it("parses fresh captions", () => {
    const raw = JSON.stringify({
      captions: [{ caption: "fresh one", hashtags: ["new"] }],
    });
    const out = parseReroll(raw, "captions", 0) as Array<{ caption: string }>;
    expect(out).toHaveLength(1);
    expect(out[0].caption).toBe("fresh one");
  });

  it("parses fresh descriptions", () => {
    const raw = JSON.stringify({
      descriptions: { tiktok: "t", reels: "r", shorts: "s", x: "x" },
    });
    const out = parseReroll(raw, "descriptions", 0) as { tiktok: string; x: string };
    expect(out.tiktok).toBe("t");
    expect(out.x).toBe("x");
  });

  it("parses fresh moments with normalization", () => {
    const raw = JSON.stringify({
      moments: [{ startSec: 50, title: "fresh moment", quote: "q" }],
    });
    const out = parseReroll(raw, "moments", 3600) as Array<{ startSec: number; endSec: number }>;
    expect(out).toHaveLength(1);
    expect(out[0].endSec).toBe(80);
  });

  it("parses fresh thumbnail prompts", () => {
    const raw = JSON.stringify({ thumbnailPrompts: ["fresh prompt"] });
    const out = parseReroll(raw, "thumbnailPrompts", 0) as string[];
    expect(out).toEqual(["fresh prompt"]);
  });

  it("returns null on garbage (triggers refund)", () => {
    expect(parseReroll("not json", "captions", 0)).toBeNull();
    expect(parseReroll('{"captions": []}', "captions", 0)).toBeNull();
    expect(parseReroll('{"moments": []}', "moments", 0)).toBeNull();
    expect(parseReroll('{"thumbnailPrompts": []}', "thumbnailPrompts", 0)).toBeNull();
  });
});
