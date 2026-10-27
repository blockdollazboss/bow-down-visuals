/**
 * Podcast Multiplier (#163 delta) — logic tests for the pure helpers:
 * moment picking (chapter preference, zone fallback, no overlaps, never
 * past the episode end), script→segment timing distribution, show-notes
 * assembly, and the cover-art prompt.
 */
import { describe, expect, it } from "vitest";
import {
  PODCAST_MULTIPLIER_CREDITS,
  MULTIPLIER_MAX_SHORTS,
  MULTIPLIER_SHORT_SECONDS,
  pickShortMoments,
  segmentsFromScript,
  buildShowNotesText,
  coverArtPrompt,
  type MultiplierSegment,
} from "../podcast-multiplier";
import type { Chapter } from "../podcast";

function segs(): MultiplierSegment[] {
  const out: MultiplierSegment[] = [];
  for (let i = 0; i < 20; i++) {
    out.push({
      startSec: i * 30,
      endSec: i * 30 + 28,
      text: `Segment ${i} talks about topic number ${i} with some substance in it`,
    });
  }
  return out; // 600 s episode
}

describe("PODCAST_MULTIPLIER_CREDITS", () => {
  it("prices one kit at 300 Visual Bucs", () => {
    expect(PODCAST_MULTIPLIER_CREDITS).toBe(300);
    expect(MULTIPLIER_MAX_SHORTS).toBe(3);
    expect(MULTIPLIER_SHORT_SECONDS).toBe(45);
  });
});

describe("pickShortMoments", () => {
  it("prefers chapter starts and titles the shorts from the chapters", () => {
    const chapters: Chapter[] = [
      { title: "Cold open", startSeconds: 0 },
      { title: "The big story", startSeconds: 210 },
      { title: "Listener questions", startSeconds: 420 },
    ];
    const moments = pickShortMoments(segs(), chapters, 600);
    expect(moments).toHaveLength(3);
    expect(moments[0]!.title).toBe("Cold open");
    expect(moments[1]!.startSec).toBe(210);
    expect(moments[2]!.title).toBe("Listener questions");
  });

  it("never overlaps windows and never runs past the episode end", () => {
    const chapters: Chapter[] = [
      { title: "A", startSeconds: 580 },
      { title: "B", startSeconds: 590 },
    ];
    const moments = pickShortMoments(segs(), chapters, 600);
    for (const m of moments) {
      expect(m.endSec).toBeLessThanOrEqual(600);
      expect(m.endSec - m.startSec).toBeGreaterThanOrEqual(10);
    }
    for (let i = 1; i < moments.length; i++) {
      expect(moments[i]!.startSec).toBeGreaterThanOrEqual(moments[i - 1]!.endSec);
    }
  });

  it("falls back to spaced transcript zones when there are no chapters", () => {
    const moments = pickShortMoments(segs(), [], 600);
    expect(moments).toHaveLength(3);
    expect(moments[0]!.startSec).toBeLessThan(200);
    expect(moments[1]!.startSec).toBeGreaterThanOrEqual(200);
    expect(moments[1]!.startSec).toBeLessThan(400);
    expect(moments[2]!.startSec).toBeGreaterThanOrEqual(400);
  });

  it("caps windows at the short length inside the episode", () => {
    const moments = pickShortMoments(segs(), [], 600);
    for (const m of moments) {
      expect(m.endSec - m.startSec).toBeLessThanOrEqual(MULTIPLIER_SHORT_SECONDS);
    }
  });

  it("returns nothing for an episode with no speech segments", () => {
    expect(pickShortMoments([], [], 600)).toEqual([]);
    expect(pickShortMoments(segs(), [], 0)).toEqual([]);
  });

  it("carries a quote from the segment under the window", () => {
    const moments = pickShortMoments(segs(), [{ title: "Mid", startSeconds: 300 }], 600);
    const chapterMoment = moments.find((m) => m.startSec === 300);
    expect(chapterMoment).toBeDefined();
    expect(chapterMoment!.quote).toContain("Segment 10");
  });
});

describe("segmentsFromScript", () => {
  it("distributes sentences across the duration by word share", () => {
    const script = "One two three four. Five six. Seven eight nine ten eleven twelve.";
    const segments = segmentsFromScript(script, 100);
    expect(segments).toHaveLength(3);
    expect(segments[0]!.startSec).toBe(0);
    expect(segments[0]!.endSec).toBe(33); // 4 of 12 words
    expect(segments[2]!.endSec).toBe(100);
  });

  it("strips chapter headings from the spoken text", () => {
    const segments = segmentsFromScript("# Intro\nHello there friend. More words follow here now.", 60);
    const joined = segments.map((s) => s.text).join(" ");
    expect(joined).not.toContain("# Intro");
    expect(joined).toContain("Hello there friend.");
  });

  it("returns nothing for an empty script or zero duration", () => {
    expect(segmentsFromScript("", 100)).toEqual([]);
    expect(segmentsFromScript("Hello world.", 0)).toEqual([]);
  });
});

describe("buildShowNotesText", () => {
  it("assembles title, summary, chapters and moments with timestamps", () => {
    const notes = buildShowNotesText({
      title: "My Episode",
      description: "A show about things.",
      summary: "We talked about things at length.",
      chapters: [{ title: "The start", startSeconds: 65 }],
      moments: [{ startSec: 125, endSec: 170, title: "Big moment", quote: "This is the line." }],
    });
    expect(notes).toContain("# My Episode");
    expect(notes).toContain("## About this episode");
    expect(notes).toContain("1:05 — The start");
    expect(notes).toContain("2:05 — Big moment");
    expect(notes).toContain("> This is the line.");
  });

  it("omits empty sections honestly", () => {
    const notes = buildShowNotesText({
      title: "Bare",
      description: "",
      summary: "",
      chapters: [],
      moments: [],
    });
    expect(notes).not.toContain("## Chapters");
    expect(notes).not.toContain("## About this episode");
    expect(notes).toContain("# Bare");
  });
});

describe("coverArtPrompt", () => {
  it("carries the title, bans text, and stays in the house palette", () => {
    const prompt = coverArtPrompt("Deep Dive", "All about the ocean.");
    expect(prompt).toContain("Deep Dive");
    expect(prompt).toContain("no text");
    expect(prompt.toLowerCase()).toContain("gold and black");
  });
});
