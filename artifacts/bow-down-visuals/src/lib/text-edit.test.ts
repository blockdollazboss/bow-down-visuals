import { describe, it, expect } from "vitest";
import { buildTextSegments, applyTextReorder, applyTextDelete } from "./text-edit";
import type { CaptionLine } from "./editor-settings";

const scenes = [
  { id: "s1", lyricLine: "first line", section: "Verse" },
  { id: "s2", lyricLine: "second line", section: "Hook" },
  { id: "s3", lyricLine: "third line", section: "Verse 2" },
];
const durations = { s1: 4, s2: 4, s3: 4 };
const line = (id: string, startSec: number, text: string): CaptionLine => ({
  id, startSec, endSec: startSec + 1.5, text,
});
const captions = [line("c1", 0.5, "first line"), line("c2", 4.5, "second line"), line("c3", 8.5, "third line")];

describe("buildTextSegments", () => {
  it("maps caption lines into their scene windows", () => {
    const segs = buildTextSegments(scenes, captions, durations);
    expect(segs.map((s) => [s.sceneId, s.text])).toEqual([
      ["s1", "first line"], ["s2", "second line"], ["s3", "third line"],
    ]);
    expect(segs[1]).toMatchObject({ startSec: 4, endSec: 8, captionIds: ["c2"] });
  });
  it("falls back to lyric text when a scene has no captions", () => {
    const segs = buildTextSegments(scenes, [], durations);
    expect(segs[0]!.text).toBe("first line");
  });
});

describe("applyTextReorder", () => {
  it("reorders the scenes (timeline stays source of truth)", () => {
    const { scenes: out } = applyTextReorder(scenes, captions, ["s3", "s1", "s2"], durations);
    expect(out.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
  });
  it("re-times caption lines with their scenes, preserving relative offsets", () => {
    const { captionLines } = applyTextReorder(scenes, captions, ["s3", "s1", "s2"], durations);
    const byId = Object.fromEntries(captionLines.map((l) => [l.id, l.startSec]));
    expect(byId["c3"]).toBeCloseTo(0.5); // s3 moved to front: 8.5 - 8
    expect(byId["c1"]).toBeCloseTo(4.5); // s1 shifted one scene later
    expect(byId["c2"]).toBeCloseTo(8.5);
  });
  it("unknown ids in the order list are ignored, unlisted scenes keep order", () => {
    const { scenes: out } = applyTextReorder(scenes, captions, ["nope", "s2"], durations);
    expect(out.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
  });
});

describe("applyTextDelete", () => {
  it("removes the scene, its captions, and shifts later captions up", () => {
    const { scenes: out, captionLines } = applyTextDelete(scenes, captions, "s1", durations);
    expect(out.map((s) => s.id)).toEqual(["s2", "s3"]);
    expect(captionLines.map((l) => l.id)).toEqual(["c2", "c3"]);
    expect(captionLines.find((l) => l.id === "c2")!.startSec).toBeCloseTo(0.5);
    expect(captionLines.find((l) => l.id === "c3")!.startSec).toBeCloseTo(4.5);
  });
});
