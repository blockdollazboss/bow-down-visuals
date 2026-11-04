/* W3b — pads + slicing + sample-pack load: the pure logic contract.
 * Region math, hit-position velocity, file classification and the
 * pack plan (whose core promise is: exactly one outcome per file —
 * nothing is ever silently dropped). Behavior of the registry and the
 * project model live in their own suites; page wiring is pinned in
 * beat-pads-wiring.test.ts. */
import { describe, it, expect } from "vitest";
import {
  BEAT_PACK_MAX_BYTES,
  classifyPackFile,
  clampPadVelocity,
  isFreePackTrack,
  padHitVelocity,
  padVelocityFromHit,
  planPackLoad,
  planSliceSpread,
  resolveSliceRegion,
  sliceRegionFor,
  type BeatPackFileMeta,
} from "@/lib/beat-pads";
import { BEAT_TRACK_COUNT, defaultTrackSounds } from "@/lib/beat-project";

const noSlices: (null)[] = Array(BEAT_TRACK_COUNT).fill(null);

describe("sliceRegionFor — equal slices over the buffer", () => {
  it("splits evenly and the last slice ends exactly at the buffer end", () => {
    expect(sliceRegionFor(8, 0, 4)).toEqual({ offset: 0, duration: 2 });
    expect(sliceRegionFor(8, 3, 4)).toEqual({ offset: 6, duration: 2 });
    expect(sliceRegionFor(10, 7, 8)).toEqual({ offset: 8.75, duration: 1.25 });
    expect(sliceRegionFor(3, 15, 16)).toEqual({ offset: 2.8125, duration: 0.1875 });
  });

  it("adjacent slices tile the buffer with no gaps or overlaps", () => {
    const dur = 7.3;
    let covered = 0;
    for (let i = 0; i < 8; i++) {
      const r = sliceRegionFor(dur, i, 8)!;
      expect(r.offset).toBeCloseTo(covered, 10);
      covered += r.duration;
    }
    expect(covered).toBeCloseTo(dur, 10);
  });

  it("refuses inputs that cannot name a real slice", () => {
    expect(sliceRegionFor(0, 0, 4)).toBeNull();
    expect(sliceRegionFor(-1, 0, 4)).toBeNull();
    expect(sliceRegionFor(Number.NaN, 0, 4)).toBeNull();
    expect(sliceRegionFor(8, 0, 1)).toBeNull();
    expect(sliceRegionFor(8, 0, 65)).toBeNull();
    expect(sliceRegionFor(8, 4, 4)).toBeNull();
    expect(sliceRegionFor(8, -1, 4)).toBeNull();
    expect(sliceRegionFor(8, 1.5, 4)).toBeNull();
  });
});

describe("resolveSliceRegion — a slice binds to its own sound", () => {
  const slice = { soundId: "upload:loop-1", index: 2, count: 8 };

  it("resolves while the track still plays the sliced sound", () => {
    expect(resolveSliceRegion(slice, "upload:loop-1", 16)).toEqual({ offset: 4, duration: 2 });
  });

  it("plays whole when the track's sound changed (no wrong audio, ever)", () => {
    expect(resolveSliceRegion(slice, "upload:other", 16)).toBeNull();
    expect(resolveSliceRegion(slice, "synth:kick", 16)).toBeNull();
    expect(resolveSliceRegion(slice, undefined, 16)).toBeNull();
  });

  it("plays whole with no slice or no known buffer length", () => {
    expect(resolveSliceRegion(null, "upload:loop-1", 16)).toBeNull();
    expect(resolveSliceRegion(undefined, "upload:loop-1", 16)).toBeNull();
    expect(resolveSliceRegion(slice, "upload:loop-1", undefined)).toBeNull();
    expect(resolveSliceRegion(slice, "upload:loop-1", 0)).toBeNull();
  });
});

describe("planSliceSpread — slices stop at the last pad", () => {
  it("spreads in order from the start pad", () => {
    expect(planSliceSpread(0, 4)).toEqual([0, 1, 2, 3]);
    expect(planSliceSpread(2, 8)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("never invents pads past the nine tracks", () => {
    expect(planSliceSpread(6, 8)).toEqual([6, 7, 8]);
    expect(planSliceSpread(8, 16)).toEqual([8]);
    expect(planSliceSpread(0, 16)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("pad velocity — top of the pad hits hardest", () => {
  it("maps hit position linearly from 1.0 (top) to 0.25 (bottom)", () => {
    expect(padVelocityFromHit(0)).toBe(1);
    expect(padVelocityFromHit(1)).toBe(0.25);
    expect(padVelocityFromHit(0.5)).toBeCloseTo(0.625);
  });

  it("clamps stray ratios to the pad edges", () => {
    expect(padVelocityFromHit(-0.4)).toBe(1);
    expect(padVelocityFromHit(1.7)).toBe(0.25);
    expect(padVelocityFromHit(Number.NaN)).toBe(1);
  });

  it("fixed mode uses the clamped control value instead", () => {
    expect(padHitVelocity("fixed", 0.9, 0.5)).toBe(0.5);
    expect(padHitVelocity("fixed", 0.1, 4)).toBe(1);
    expect(padHitVelocity("hit", 1, 0.5)).toBe(0.25);
    expect(clampPadVelocity(0)).toBe(0.1);
    expect(clampPadVelocity(Number.NaN)).toBe(1);
  });
});

describe("classifyPackFile — what may even be attempted", () => {
  const meta = (p: Partial<BeatPackFileMeta>): BeatPackFileMeta => ({
    name: "kick.wav",
    type: "",
    size: 1024,
    ...p,
  });

  it("accepts audio by extension or by MIME, case-insensitively", () => {
    expect(classifyPackFile(meta({}))).toEqual({ ok: true });
    expect(classifyPackFile(meta({ name: "LOOP.WAV" }))).toEqual({ ok: true });
    expect(classifyPackFile(meta({ name: "noext", type: "audio/mpeg" }))).toEqual({ ok: true });
    expect(classifyPackFile(meta({ name: "take.m4a" }))).toEqual({ ok: true });
    expect(classifyPackFile(meta({ name: "take.flac", type: "audio/flac" }))).toEqual({ ok: true });
  });

  it("rejects non-audio, oversized and empty files with their reasons", () => {
    expect(classifyPackFile(meta({ name: "notes.txt", type: "text/plain" }))).toEqual({ ok: false, reason: "format" });
    expect(classifyPackFile(meta({ name: "cover.png", type: "image/png" }))).toEqual({ ok: false, reason: "format" });
    expect(classifyPackFile(meta({ size: BEAT_PACK_MAX_BYTES + 1 }))).toEqual({ ok: false, reason: "size" });
    expect(classifyPackFile(meta({ size: 0 }))).toEqual({ ok: false, reason: "empty" });
  });

  it("a file exactly at the size cap is accepted", () => {
    expect(classifyPackFile(meta({ size: BEAT_PACK_MAX_BYTES }))).toEqual({ ok: true });
  });
});

describe("planPackLoad — one outcome per file, nothing dropped", () => {
  const wav = (name: string): BeatPackFileMeta => ({ name, type: "", size: 2048 });

  it("fills free pads in track order", () => {
    const plan = planPackLoad([wav("a.wav"), wav("b.wav"), wav("c.wav")], defaultTrackSounds(), noSlices);
    expect(plan).toEqual([
      { fileIndex: 0, action: "assign", trackIndex: 0 },
      { fileIndex: 1, action: "assign", trackIndex: 1 },
      { fileIndex: 2, action: "assign", trackIndex: 2 },
    ]);
  });

  it("never overwrites a pad the creator already chose a sound for", () => {
    const sounds = defaultTrackSounds();
    sounds[0] = "upload:mine";
    sounds[2] = "bank:some-kick";
    const plan = planPackLoad([wav("a.wav"), wav("b.wav")], sounds, noSlices);
    expect(plan).toEqual([
      { fileIndex: 0, action: "assign", trackIndex: 1 },
      { fileIndex: 1, action: "assign", trackIndex: 3 },
    ]);
  });

  it("a sliced pad is not free either", () => {
    const slices: unknown[] = [...noSlices];
    slices[0] = { soundId: "synth:kick", index: 0, count: 4 };
    expect(isFreePackTrack(defaultTrackSounds(), slices, 0)).toBe(false);
    expect(isFreePackTrack(defaultTrackSounds(), noSlices, 0)).toBe(true);
    const plan = planPackLoad([wav("a.wav")], defaultTrackSounds(), slices);
    expect(plan[0]).toEqual({ fileIndex: 0, action: "assign", trackIndex: 1 });
  });

  it("overflow files are rejected as no-track — counted, not dropped", () => {
    const files = Array.from({ length: 12 }, (_, i) => wav(`f${i}.wav`));
    const plan = planPackLoad(files, defaultTrackSounds(), noSlices);
    expect(plan).toHaveLength(files.length);
    expect(plan.filter((e) => e.action === "assign")).toHaveLength(BEAT_TRACK_COUNT);
    expect(plan.filter((e) => e.action === "reject")).toEqual([
      { fileIndex: 9, action: "reject", reason: "no-track" },
      { fileIndex: 10, action: "reject", reason: "no-track" },
      { fileIndex: 11, action: "reject", reason: "no-track" },
    ]);
    // Every input file appears exactly once in the plan.
    expect(plan.map((e) => e.fileIndex).sort((a, b) => a - b)).toEqual(files.map((_, i) => i));
  });

  it("mixed packs keep input order with per-file reasons", () => {
    const files: BeatPackFileMeta[] = [
      { name: "readme.txt", type: "text/plain", size: 100 },
      wav("kick.wav"),
      { name: "huge.wav", type: "", size: BEAT_PACK_MAX_BYTES + 5 },
      { name: "ghost.wav", type: "", size: 0 },
      wav("snare.mp3"),
    ];
    const plan = planPackLoad(files, defaultTrackSounds(), noSlices);
    expect(plan).toEqual([
      { fileIndex: 0, action: "reject", reason: "format" },
      { fileIndex: 1, action: "assign", trackIndex: 0 },
      { fileIndex: 2, action: "reject", reason: "size" },
      { fileIndex: 3, action: "reject", reason: "empty" },
      { fileIndex: 4, action: "assign", trackIndex: 1 },
    ]);
  });
});
