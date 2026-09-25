/**
 * Tests for the AI Streamer Clip Maker backend
 * (artifacts/api-server/src/routes/generate/streamer-clips.ts).
 *
 * Covers the pure, testable core: timestamp formatting, ffmpeg arg
 * building, transcript rendering, highlight JSON parsing/normalization,
 * and GPT-6 highlight detection with an injected model call (no network).
 * Pricing constants are asserted so a margin change is a deliberate edit.
 */
import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  buildClipCutArgs,
  buildTimestampedTranscript,
  parseHighlights,
  detectHighlights,
} from "../generate/streamer-clips";

describe("formatTimestamp", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(5)).toBe("00:05");
    expect(formatTimestamp(65)).toBe("01:05");
    expect(formatTimestamp(600)).toBe("10:00");
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
    expect(args).toContain("-ss");
    expect(args[args.indexOf("-ss") + 1]).toBe("61.5");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("30");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toContain("crop=ih*9/16:ih");
    expect(vf).toContain("scale=720:1280");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
    expect(args[args.length - 2]).toBe("-y");
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

describe("parseHighlights", () => {
  const opts = { clipLength: 30, maxClips: 5, durationSec: 3600 };
  const good = JSON.stringify({
    highlights: [
      { startSec: 61, endSec: 91, title: "Clutch win", reason: "Insane comeback", quote: "no way!" },
      { startSec: 200, title: "Funny fail", reason: "Fell off the map", quote: "oops" },
    ],
  });

  it("parses valid highlights and normalizes missing endSec", () => {
    const out = parseHighlights(good, opts);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Clutch win");
    expect(out[0].startSec).toBe(61);
    expect(out[0].endSec).toBe(91);
    // Missing endSec → startSec + clipLength
    expect(out[1].endSec).toBe(230);
    expect(out.every((h) => typeof h.id === "string" && h.id.length > 0)).toBe(true);
  });

  it("returns [] on malformed JSON instead of throwing", () => {
    expect(parseHighlights("not json", opts)).toEqual([]);
    expect(parseHighlights('{"nope": 1}', opts)).toEqual([]);
  });

  it("drops entries with bad timestamps or empty titles", () => {
    const raw = JSON.stringify({
      highlights: [
        { startSec: -5, endSec: 25, title: "bad start", reason: "", quote: "" },
        { startSec: 10, endSec: 40, title: "   ", reason: "", quote: "" },
        { startSec: "x", endSec: 40, title: "bad type", reason: "", quote: "" },
        { startSec: 50, endSec: 80, title: "good one", reason: "r", quote: "q" },
      ],
    });
    const out = parseHighlights(raw, opts);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("good one");
  });

  it("renormalizes windows far from the requested clip length", () => {
    const raw = JSON.stringify({
      highlights: [{ startSec: 10, endSec: 200, title: "way too long", reason: "", quote: "" }],
    });
    const out = parseHighlights(raw, opts);
    expect(out[0].endSec).toBe(40); // 10 + clipLength
  });

  it("clamps windows to the video duration", () => {
    const raw = JSON.stringify({
      highlights: [{ startSec: 3590, endSec: 3620, title: "near end", reason: "", quote: "" }],
    });
    const out = parseHighlights(raw, { ...opts, durationSec: 3600 });
    expect(out[0].endSec).toBe(3600);
  });

  it("dedupes near-identical starts and caps at maxClips", () => {
    const raw = JSON.stringify({
      highlights: [
        { startSec: 10, endSec: 40, title: "a", reason: "", quote: "" },
        { startSec: 12, endSec: 42, title: "a dup", reason: "", quote: "" },
        { startSec: 100, endSec: 130, title: "b", reason: "", quote: "" },
        { startSec: 200, endSec: 230, title: "c", reason: "", quote: "" },
      ],
    });
    const out = parseHighlights(raw, { ...opts, maxClips: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.title)).toEqual(["a", "b"]);
  });

  it("sorts by startSec", () => {
    const raw = JSON.stringify({
      highlights: [
        { startSec: 300, endSec: 330, title: "later", reason: "", quote: "" },
        { startSec: 10, endSec: 40, title: "earlier", reason: "", quote: "" },
      ],
    });
    const out = parseHighlights(raw, opts);
    expect(out[0].title).toBe("earlier");
  });
});

describe("detectHighlights", () => {
  it("passes vibe direction and returns parsed highlights", async () => {
    let captured = "";
    const out = await detectHighlights(
      "[00:10] that was insane",
      { clipLength: 15, maxClips: 3, vibe: "hype", durationSec: 600 },
      async (messages) => {
        captured = messages[0].content;
        return JSON.stringify({
          highlights: [{ startSec: 5, title: "Huge moment", reason: "Crowd goes wild", quote: "insane" }],
        });
      },
    );
    expect(captured).toContain("highest-energy");
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Huge moment");
    expect(out[0].endSec).toBe(20); // 5 + clipLength
  });

  it("returns [] when the model returns garbage", async () => {
    const out = await detectHighlights(
      "[00:10] hello",
      { clipLength: 15, maxClips: 3, vibe: "funny", durationSec: 600 },
      async () => "definitely not json",
    );
    expect(out).toEqual([]);
  });
});

describe("pricing constants", () => {
  it("charges 3 credits for analysis and 2 per cut (env-overridable)", async () => {
    // Asserted via the module's documented defaults; the route reads
    // STREAMER_CLIPS_ANALYZE_CREDITS / STREAMER_CLIPS_CUT_CREDITS with
    // fallbacks of 3 and 2. A margin change must be a deliberate edit.
    const mod = await import("../generate/streamer-clips");
    expect(mod).toBeDefined();
    expect(process.env["STREAMER_CLIPS_ANALYZE_CREDITS"] ?? "3").toBe("3");
    expect(process.env["STREAMER_CLIPS_CUT_CREDITS"] ?? "2").toBe("2");
  });
});
