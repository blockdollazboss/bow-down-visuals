/* W3b — trackSlices on the beat project: defaults for old projects,
 * defensive normalization, round-trip persistence, and the compat law:
 * a project saved before slices existed normalizes to EXACTLY the
 * project it always was, with every slice null (tracks play whole).
 * The slice model itself is lib/beat-project.ts; region math lives in
 * beat-pads.test.ts. */
import { describe, it, expect } from "vitest";
import {
  BEAT_TRACK_COUNT,
  defaultBeatProject,
  defaultTrackSlices,
  deserializeBeatProject,
  normalizeBeatProject,
  normalizeTrackSlice,
  serializeBeatProject,
  setTrackSlice,
  type BeatTrackSlice,
} from "@/lib/beat-project";

const goodSlice: BeatTrackSlice = { soundId: "upload:loop-1", index: 3, count: 8 };

describe("defaults — the pre-slice behavior", () => {
  it("a fresh project carries nine null slices", () => {
    const p = defaultBeatProject();
    expect(p.trackSlices).toHaveLength(BEAT_TRACK_COUNT);
    expect(p.trackSlices).toEqual(defaultTrackSlices());
    expect(p.trackSlices.every((s) => s === null)).toBe(true);
  });
});

describe("compat — old projects load identical, slices all null", () => {
  it("a v2 project JSON with no trackSlices normalizes unchanged", () => {
    const current = defaultBeatProject();
    const { trackSlices: _dropped, ...withoutSlices } = current as unknown as Record<string, unknown>;
    const fromOld = normalizeBeatProject(withoutSlices);
    const fromCurrent = normalizeBeatProject(current);
    expect(fromOld).toEqual(fromCurrent);
    expect(fromOld!.trackSlices.every((s) => s === null)).toBe(true);
  });

  it("a sparse legacy-shaped object still loads with null slices", () => {
    const p = normalizeBeatProject({ bpm: 90, trackSounds: ["upload:keepme"] });
    expect(p).not.toBeNull();
    expect(p!.bpm).toBe(90);
    expect(p!.trackSounds[0]).toBe("upload:keepme");
    expect(p!.trackSlices).toEqual(defaultTrackSlices());
  });

  it("explicit all-null slices and missing slices are the same project", () => {
    const base = defaultBeatProject();
    const withNulls = { ...base, trackSlices: Array(BEAT_TRACK_COUNT).fill(null) };
    const { trackSlices: _dropped, ...without } = base as unknown as Record<string, unknown>;
    expect(normalizeBeatProject(withNulls)).toEqual(normalizeBeatProject(without));
  });
});

describe("normalizeTrackSlice — only well-formed slices survive", () => {
  it("keeps a valid slice verbatim", () => {
    expect(normalizeTrackSlice(goodSlice)).toEqual(goodSlice);
    expect(normalizeTrackSlice({ soundId: "bank:x", index: 0, count: 2 })).toEqual({
      soundId: "bank:x",
      index: 0,
      count: 2,
    });
  });

  it("drops garbage instead of throwing or half-keeping it", () => {
    expect(normalizeTrackSlice(null)).toBeNull();
    expect(normalizeTrackSlice("slice")).toBeNull();
    expect(normalizeTrackSlice([1, 2])).toBeNull();
    expect(normalizeTrackSlice({ soundId: "", index: 0, count: 4 })).toBeNull();
    expect(normalizeTrackSlice({ soundId: "upload:x", index: 4, count: 4 })).toBeNull();
    expect(normalizeTrackSlice({ soundId: "upload:x", index: -1, count: 4 })).toBeNull();
    expect(normalizeTrackSlice({ soundId: "upload:x", index: 0, count: 1 })).toBeNull();
    expect(normalizeTrackSlice({ soundId: "upload:x", index: 0, count: 65 })).toBeNull();
    expect(normalizeTrackSlice({ soundId: "upload:x", index: 0.5, count: 4 })).toBeNull();
    expect(normalizeTrackSlice({ soundId: "upload:x", index: 0, count: 4.5 })).toBeNull();
  });

  it("a stored array shorter/longer than nine tracks is fitted", () => {
    const p = normalizeBeatProject({ trackSlices: [goodSlice] });
    expect(p!.trackSlices).toHaveLength(BEAT_TRACK_COUNT);
    expect(p!.trackSlices[0]).toEqual(goodSlice);
    expect(p!.trackSlices[1]).toBeNull();
    const long = normalizeBeatProject({
      trackSlices: Array(12).fill(goodSlice),
    });
    expect(long!.trackSlices).toHaveLength(BEAT_TRACK_COUNT);
  });
});

describe("persistence round-trip", () => {
  it("slices survive serialize → deserialize", () => {
    const p = setTrackSlice(defaultBeatProject(), 4, goodSlice);
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back.trackSlices[4]).toEqual(goodSlice);
    expect(back.trackSlices.filter(Boolean)).toHaveLength(1);
  });
});

describe("setTrackSlice — pure op", () => {
  it("sets, replaces and clears without touching the original", () => {
    const p0 = defaultBeatProject();
    const p1 = setTrackSlice(p0, 2, goodSlice);
    expect(p0.trackSlices[2]).toBeNull();
    expect(p1.trackSlices[2]).toEqual(goodSlice);
    const p2 = setTrackSlice(p1, 2, null);
    expect(p2.trackSlices[2]).toBeNull();
  });

  it("garbage clears the slice; out-of-range tracks are ignored", () => {
    const p1 = setTrackSlice(defaultBeatProject(), 2, goodSlice);
    const cleared = setTrackSlice(p1, 2, { soundId: "", index: 0, count: 4 } as BeatTrackSlice);
    expect(cleared.trackSlices[2]).toBeNull();
    expect(setTrackSlice(p1, 9, goodSlice)).toBe(p1);
    expect(setTrackSlice(p1, -1, goodSlice)).toBe(p1);
  });
});
