/* Stack 6 — arrangement model tests: automation lanes, FX chain order,
 * comp resolution, export expansion, MIDI note ops, persistence shape. */
import { describe, it, expect } from "vitest";
import {
  automationValueAt,
  upsertPoint,
  removePointNear,
  moveFxStep,
  makeFxStep,
  resolveCompSegments,
  compCoverage,
  expandArrangementToExportStems,
  emptyArrangement,
  makeAudioTrack,
  makeMidiTrack,
  arrangementDuration,
  moveNote,
  resizeNote,
  notesInRange,
  clampNote,
  normalizeArrangement,
  COMP_FADE_SEC,
  type ArrangementClip,
  type TrackTake,
  type CompRegion,
} from "@/lib/arrangement";

describe("automation lanes", () => {
  const lane = [
    { time: 0, value: 100 },
    { time: 4, value: 50 },
    { time: 8, value: 50 },
  ];
  it("holds ends and lerps between breakpoints", () => {
    expect(automationValueAt(lane, -1, 0)).toBe(100);
    expect(automationValueAt(lane, 2, 0)).toBe(75);
    expect(automationValueAt(lane, 6, 0)).toBe(50);
    expect(automationValueAt(lane, 99, 0)).toBe(50);
  });
  it("fallback when the lane is empty", () => {
    expect(automationValueAt(undefined, 3, 42)).toBe(42);
    expect(automationValueAt([], 3, 42)).toBe(42);
  });
  it("upsert replaces a point at the same time and keeps order", () => {
    const next = upsertPoint(lane, 4, 80);
    expect(next).toEqual([
      { time: 0, value: 100 },
      { time: 4, value: 80 },
      { time: 8, value: 50 },
    ]);
    const added = upsertPoint(lane, 2, 90);
    expect(added.map((p) => p.time)).toEqual([0, 2, 4, 8]);
  });
  it("removePointNear removes only within tolerance", () => {
    expect(removePointNear(lane, 4.1).map((p) => p.time)).toEqual([0, 8]);
    expect(removePointNear(lane, 6).map((p) => p.time)).toEqual([0, 4, 8]);
  });
});

describe("FX chain order", () => {
  it("moveFxStep reorders and clamps", () => {
    const chain = [makeFxStep("eq", "a"), makeFxStep("compressor", "b"), makeFxStep("reverb", "c")];
    expect(moveFxStep(chain, "c", 0).map((s) => s.id)).toEqual(["c", "a", "b"]);
    expect(moveFxStep(chain, "a", 99).map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(moveFxStep(chain, "nope", 0)).toBe(chain);
  });
  it("defaults are sane per type", () => {
    expect(makeFxStep("compressor", "x").thresholdDb).toBe(-18);
    expect(makeFxStep("eq", "x").bands).toHaveLength(3);
  });
});

const takes: TrackTake[] = [
  { id: "t1", name: "Take 1", url: "https://x/t1.wav", durationSec: 20 },
  { id: "t2", name: "Take 2", url: "https://x/t2.wav", durationSec: 20 },
];

describe("comp resolution", () => {
  const comp: CompRegion[] = [
    { id: "r1", takeId: "t1", srcStart: 0, srcEnd: 4, startTime: 0 },
    { id: "r2", takeId: "t2", srcStart: 8, srcEnd: 12, startTime: 4 },
  ];
  it("expands regions into trimmed segments of the chosen takes", () => {
    const segs = resolveCompSegments(takes, comp);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ url: "https://x/t1.wav", trimStart: 0, startTime: 0 });
    expect(segs[0]!.trimEnd).toBe(16); // 20 - 4
    expect(segs[1]).toMatchObject({ url: "https://x/t2.wav", trimStart: 8, startTime: 4 });
    expect(segs[1]!.trimEnd).toBe(8); // 20 - 12
    expect(segs[0]!.fadeInSec).toBe(COMP_FADE_SEC);
  });
  it("a later region covers an earlier region's tail", () => {
    const overlapping: CompRegion[] = [
      { id: "r1", takeId: "t1", srcStart: 0, srcEnd: 6, startTime: 0 },
      { id: "r2", takeId: "t2", srcStart: 0, srcEnd: 4, startTime: 4 },
    ];
    const segs = resolveCompSegments(takes, overlapping);
    expect(segs).toHaveLength(2);
    /* first segment is cut at the second's start: length 4, srcEnd 4 */
    expect(segs[0]!.trimEnd).toBe(16);
    expect(compCoverage(overlapping)).toEqual([
      { start: 0, end: 6 },
      { start: 4, end: 8 },
    ]);
  });
  it("regions naming a missing take are dropped, never faked", () => {
    const segs = resolveCompSegments(takes, [
      { id: "rx", takeId: "ghost", srcStart: 0, srcEnd: 4, startTime: 0 },
    ]);
    expect(segs).toHaveLength(0);
  });
});

describe("export expansion", () => {
  it("clips become placed stems carrying track FX + automation", () => {
    const a = emptyArrangement();
    const track = makeAudioTrack("Beat", "Beat");
    const clip: ArrangementClip = {
      id: "c1", url: "https://x/beat.wav", name: "beat.wav",
      startTime: 2, trimStart: 1, trimEnd: 0, durationSec: 10,
    };
    track.clips = [clip];
    track.fxChain = [makeFxStep("eq", "fx1")];
    track.automation = { volume: [{ time: 0, value: 100 }, { time: 8, value: 60 }] };
    a.tracks = [track];
    const stems = expandArrangementToExportStems(a);
    expect(stems).toHaveLength(1);
    expect(stems[0]).toMatchObject({ startTime: 2, trimStart: 1, url: "https://x/beat.wav" });
    expect(stems[0]!.fxChain).toHaveLength(1);
    expect(stems[0]!.automation?.volume).toHaveLength(2);
    expect(arrangementDuration(a)).toBe(11);
  });

  it("a comped vocal expands to one stem per comp region", () => {
    const a = emptyArrangement();
    const vox = makeAudioTrack("Vocal", "Lead Vocal");
    vox.takes = takes;
    vox.comp = [
      { id: "r1", takeId: "t1", srcStart: 0, srcEnd: 4, startTime: 0 },
      { id: "r2", takeId: "t2", srcStart: 8, srcEnd: 12, startTime: 4 },
    ];
    a.tracks = [vox];
    const stems = expandArrangementToExportStems(a);
    expect(stems).toHaveLength(2);
    expect(stems.map((s) => s.startTime)).toEqual([0, 4]);
    expect(stems[0]!.fadeInSec).toBe(COMP_FADE_SEC);
  });

  it("MIDI tracks are skipped without a bounce — never faked", () => {
    const a = emptyArrangement();
    const midi = makeMidiTrack();
    midi.notes = [{ id: "n1", pitch: 60, start: 0, duration: 1, velocity: 100 }];
    a.tracks = [midi];
    expect(expandArrangementToExportStems(a)).toHaveLength(0);
    const withBounce = expandArrangementToExportStems(a, { [midi.id]: "https://x/bounce.wav" });
    expect(withBounce).toHaveLength(1);
    expect(withBounce[0]!.url).toBe("https://x/bounce.wav");
  });

  it("ducking wires every target segment against all source segments", () => {
    const a = emptyArrangement();
    const vox = makeAudioTrack("Vocal", "Lead Vocal");
    vox.takes = takes;
    vox.comp = [
      { id: "r1", takeId: "t1", srcStart: 0, srcEnd: 4, startTime: 0 },
      { id: "r2", takeId: "t2", srcStart: 8, srcEnd: 12, startTime: 4 },
    ];
    const music = makeAudioTrack("Music", "Beat");
    music.clips = [{ id: "c1", url: "https://x/m.wav", name: "m", startTime: 0, trimStart: 0, trimEnd: 0, durationSec: 8 }];
    music.ducking = { againstTrackId: vox.id, amount: 70, sensitivity: 40 };
    a.tracks = [vox, music];
    const stems = expandArrangementToExportStems(a);
    const musicStem = stems.find((s) => s.url === "https://x/m.wav")!;
    expect(musicStem.duck?.amount).toBe(70);
    expect(musicStem.duck?.sourceStemIds).toHaveLength(2); // both comp segments
  });
});

describe("MIDI note ops", () => {
  const notes = [
    { id: "a", pitch: 60, start: 0, duration: 0.5, velocity: 100 },
    { id: "b", pitch: 64, start: 1, duration: 0.5, velocity: 90 },
  ];
  it("move + resize clamp to legal ranges", () => {
    const moved = moveNote(notes, "a", -5, 200);
    expect(moved[0]).toMatchObject({ start: 0, pitch: 127 });
    const resized = resizeNote(notes, "b", 0.001);
    expect(resized[1]!.duration).toBe(0.03);
  });
  it("range query overlaps note tails", () => {
    expect(notesInRange(notes, 0.4, 0.6).map((n) => n.id)).toEqual(["a"]);
    expect(notesInRange(notes, 2, 3)).toHaveLength(0);
  });
  it("clampNote rounds pitch/velocity", () => {
    expect(clampNote({ id: "x", pitch: 60.6, start: 0, duration: 1, velocity: 300 }).pitch).toBe(61);
    expect(clampNote({ id: "x", pitch: 60, start: 0, duration: 1, velocity: 300 }).velocity).toBe(127);
  });
});

describe("normalizeArrangement (backward compatibility)", () => {
  it("empty/garbage input loads as null or an empty arrangement", () => {
    expect(normalizeArrangement(null)).toBeNull();
    expect(normalizeArrangement("junk")).toBeNull();
    const a = normalizeArrangement({});
    expect(a?.tracks).toEqual([]);
    expect(a?.version).toBe(1);
  });
  it("partial tracks gain the new fields with defaults", () => {
    const a = normalizeArrangement({
      title: "Old project",
      tracks: [{ id: "t", name: "Legacy", kind: "audio", clips: [] }],
    });
    expect(a?.title).toBe("Old project");
    expect(a?.tracks[0]).toMatchObject({ fxChain: [], automation: {}, muted: false });
  });
});
