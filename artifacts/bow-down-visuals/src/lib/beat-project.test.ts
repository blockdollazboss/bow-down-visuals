/* W1-L1 — beat project model tests: the sequencer's first unit coverage.
 * Arrangement math, defensive (de)serialization, editing ops, variation
 * cloning, render sequence, and local persistence. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BEAT_ACCENT_GAIN,
  BEAT_PATTERN_IDS,
  BEAT_STEPS,
  BEAT_TRACK_COUNT,
  addArrangementEntry,
  arrangementDurationSec,
  arrangementTotalBars,
  arrangementTotalSteps,
  bassStepGain,
  bassStepGainWithFeel,
  bassStepVelocity,
  clonePatternVariation,
  defaultBeatProject,
  deserializeBeatProject,
  drumStepGain,
  drumStepGainWithFeel,
  emptyBeatPattern,
  expandArrangement,
  isEmptyBeatPattern,
  isSongModeActive,
  loadLocalBeatProject,
  moveArrangementEntry,
  normalizeBeatProject,
  patternStepCount,
  removeArrangementEntry,
  renderPatternSequence,
  resolveArrangementStep,
  saveLocalBeatProject,
  serializeBeatProject,
  setArrangementEntryPattern,
  setArrangementEntryRepeats,
  setBassStepVelocity,
  setPatternBars,
  setStepVelocity,
  stepGain,
  stepVelocity,
  stepsResolverForPatterns,
  type BeatArrangementEntry,
  type BeatProject,
} from "@/lib/beat-project";

function projectWithTrapA(): BeatProject {
  const p = defaultBeatProject();
  p.patterns.A.grid[0]![0] = 2; // kick accent
  p.patterns.A.bass[0] = 36;
  return p;
}

describe("defaults", () => {
  it("a fresh project loops pattern A (today's behavior)", () => {
    const p = defaultBeatProject();
    expect(p.version).toBe(2);
    expect(p.activePattern).toBe("A");
    expect(p.mode).toBe("pattern");
    expect(p.arrangement).toEqual([]);
    expect(Object.keys(p.patterns)).toEqual([...BEAT_PATTERN_IDS]);
    for (const id of BEAT_PATTERN_IDS) {
      expect(p.patterns[id].grid).toHaveLength(BEAT_TRACK_COUNT);
      expect(p.patterns[id].grid[0]).toHaveLength(BEAT_STEPS);
      expect(p.patterns[id].bass).toHaveLength(BEAT_STEPS);
      expect(isEmptyBeatPattern(p.patterns[id])).toBe(true);
    }
    expect(p.mixer.vol).toHaveLength(BEAT_TRACK_COUNT);
    expect(isSongModeActive(p)).toBe(false);
    expect(renderPatternSequence(p)).toBeNull();
  });

  it("the seed lands in pattern A as a deep copy", () => {
    const seed = emptyBeatPattern();
    seed.grid[1]![4] = 1;
    const p = defaultBeatProject(seed);
    expect(p.patterns.A.grid[1]![4]).toBe(1);
    seed.grid[1]![4] = 0;
    expect(p.patterns.A.grid[1]![4]).toBe(1); // project unaffected
  });
});

describe("arrangement math", () => {
  const chain: BeatArrangementEntry[] = [
    { patternId: "A", repeats: 2 },
    { patternId: "B", repeats: 1 },
    { patternId: "A", repeats: 4 },
  ];
  it("totals count every repeat", () => {
    expect(arrangementTotalSteps(chain)).toBe(7 * BEAT_STEPS);
    expect(arrangementTotalBars(chain)).toBe(7);
    expect(arrangementTotalSteps([])).toBe(0);
    expect(arrangementTotalBars([])).toBe(0);
  });
  it("duration follows tempo", () => {
    // 140 BPM: one bar (16 steps) = 16 * 60/140/4 ≈ 1.714s; 7 bars ≈ 12s
    expect(arrangementDurationSec(chain, 140)).toBeCloseTo(12, 5);
    expect(arrangementDurationSec(chain, 70)).toBeCloseTo(24, 5);
  });
  it("expand flattens repeats in order with entry + repeat indices", () => {
    expect(expandArrangement(chain)).toEqual([
      { entryIndex: 0, patternId: "A", repeatIndex: 0 },
      { entryIndex: 0, patternId: "A", repeatIndex: 1 },
      { entryIndex: 1, patternId: "B", repeatIndex: 0 },
      { entryIndex: 2, patternId: "A", repeatIndex: 0 },
      { entryIndex: 2, patternId: "A", repeatIndex: 1 },
      { entryIndex: 2, patternId: "A", repeatIndex: 2 },
      { entryIndex: 2, patternId: "A", repeatIndex: 3 },
    ]);
    expect(expandArrangement([])).toEqual([]);
  });
});

describe("resolveArrangementStep", () => {
  const chain: BeatArrangementEntry[] = [
    { patternId: "A", repeats: 2 }, // steps 0–31
    { patternId: "C", repeats: 1 }, // steps 32–47
  ];
  it("resolves inside the first entry", () => {
    expect(resolveArrangementStep(0, chain)).toMatchObject({
      entryIndex: 0, patternId: "A", repeatIndex: 0, stepInPattern: 0,
    });
    expect(resolveArrangementStep(17, chain)).toMatchObject({
      entryIndex: 0, patternId: "A", repeatIndex: 1, stepInPattern: 1, stepInEntry: 17,
    });
  });
  it("crosses the entry boundary exactly at the repeat seam", () => {
    expect(resolveArrangementStep(31, chain)).toMatchObject({ entryIndex: 0, stepInPattern: 15 });
    expect(resolveArrangementStep(32, chain)).toMatchObject({
      entryIndex: 1, patternId: "C", repeatIndex: 0, stepInPattern: 0,
    });
    expect(resolveArrangementStep(47, chain)).toMatchObject({ entryIndex: 1, stepInPattern: 15 });
  });
  it("out-of-range and empty arrangements resolve to null", () => {
    expect(resolveArrangementStep(48, chain)).toBeNull();
    expect(resolveArrangementStep(-1, chain)).toBeNull();
    expect(resolveArrangementStep(0, [])).toBeNull();
  });
});

describe("song-mode activation + render sequence", () => {
  it("song mode with entries renders the full chain once, in order", () => {
    const p = projectWithTrapA();
    p.mode = "song";
    p.arrangement = [
      { patternId: "A", repeats: 2 },
      { patternId: "B", repeats: 1 },
    ];
    expect(isSongModeActive(p)).toBe(true);
    expect(renderPatternSequence(p)).toEqual(["A", "A", "B"]);
  });
  it("song mode with an EMPTY chain falls back to the pattern loop", () => {
    const p = projectWithTrapA();
    p.mode = "song";
    expect(isSongModeActive(p)).toBe(false);
    expect(renderPatternSequence(p)).toBeNull();
  });
  it("pattern mode ignores the chain for rendering", () => {
    const p = projectWithTrapA();
    p.arrangement = [{ patternId: "B", repeats: 3 }];
    expect(renderPatternSequence(p)).toBeNull();
  });
});

describe("arrangement editing ops", () => {
  const base: BeatArrangementEntry[] = [
    { patternId: "A", repeats: 1 },
    { patternId: "B", repeats: 2 },
  ];
  it("add appends with clamped repeats and does not mutate", () => {
    const next = addArrangementEntry(base, "C", 99);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ patternId: "C", repeats: 32 });
    expect(base).toHaveLength(2);
  });
  it("remove drops only the indexed entry", () => {
    expect(removeArrangementEntry(base, 0)).toEqual([{ patternId: "B", repeats: 2 }]);
    expect(removeArrangementEntry(base, 9)).toEqual(base);
  });
  it("move reorders and clamps the target", () => {
    expect(moveArrangementEntry(base, 1, 0).map((e) => e.patternId)).toEqual(["B", "A"]);
    expect(moveArrangementEntry(base, 0, 99).map((e) => e.patternId)).toEqual(["B", "A"]);
    expect(moveArrangementEntry(base, 7, 0)).toBe(base);
  });
  it("repeats stepper clamps to 1–32", () => {
    expect(setArrangementEntryRepeats(base, 0, 0)[0]!.repeats).toBe(1);
    expect(setArrangementEntryRepeats(base, 0, 100)[0]!.repeats).toBe(32);
    expect(setArrangementEntryRepeats(base, 1, 5)[1]!.repeats).toBe(5);
  });
  it("entry pattern can be re-pointed", () => {
    expect(setArrangementEntryPattern(base, 0, "D")[0]!.patternId).toBe("D");
  });
});

describe("clonePatternVariation", () => {
  it("clones into the first free slot as a deep copy", () => {
    const p = projectWithTrapA();
    const res = clonePatternVariation(p, "A");
    expect(res?.patternId).toBe("B");
    expect(res!.project.patterns.B.grid[0]![0]).toBe(2);
    expect(res!.project.patterns.B.bass[0]).toBe(36);
    res!.project.patterns.B.grid[0]![0] = 0;
    expect(p.patterns.A.grid[0]![0]).toBe(2); // original untouched
    expect(p.patterns.B.grid[0]![0]).toBe(0); // input project untouched
  });
  it("skips occupied slots", () => {
    const p = projectWithTrapA();
    p.patterns.B.grid[2]![0] = 1;
    expect(clonePatternVariation(p, "A")?.patternId).toBe("C");
  });
  it("returns null when every other slot is occupied or source is empty", () => {
    const p = projectWithTrapA();
    p.patterns.B.grid[0]![0] = 1;
    p.patterns.C.grid[0]![0] = 1;
    p.patterns.D.grid[0]![0] = 1;
    expect(clonePatternVariation(p, "A")).toBeNull();
    expect(clonePatternVariation(defaultBeatProject(), "A")).toBeNull();
  });
});

describe("serialize / deserialize", () => {
  it("round-trips a full project byte-for-value", () => {
    const p = projectWithTrapA();
    p.bpm = 97;
    p.swing = 0.35;
    p.mode = "song";
    p.activePattern = "C";
    p.arrangement = [{ patternId: "A", repeats: 3 }, { patternId: "D", repeats: 1 }];
    p.mixer.vol[0] = 1.25;
    p.mixer.mute[3] = true;
    p.mixer.bassVol = 0.5;
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back).toEqual(normalizeBeatProject(p));
    expect(back.patterns.A.grid[0]![0]).toBe(2);
    expect(back.arrangement).toEqual(p.arrangement);
  });
  it("garbage in → a valid default project out, never a throw", () => {
    for (const junk of [null, undefined, 42, "not json{", [], { patterns: "x" }]) {
      const p = deserializeBeatProject(junk as unknown);
      expect(p.version).toBe(2);
      expect(p.patterns.A.grid).toHaveLength(BEAT_TRACK_COUNT);
    }
  });
  it("normalize returns null only when there is no object at all", () => {
    expect(normalizeBeatProject(null)).toBeNull();
    expect(normalizeBeatProject("junk")).toBeNull();
    expect(normalizeBeatProject({})).not.toBeNull();
  });
  it("defensive defaults repair partial + out-of-range data", () => {
    const p = normalizeBeatProject({
      bpm: 9999,
      swing: 7,
      activePattern: "Z",
      mode: "song",
      patterns: {
        A: {
          grid: [[9, 1, 2]], // short row, illegal cell value 9 → 0
          bass: [999, "x", 30.6],
        },
      },
      mixer: { vol: [2, -1], mute: [true], bassVol: 99, bassMute: "yes" },
      arrangement: [
        { patternId: "B", repeats: 0 },
        { patternId: "Q", repeats: 2 },
        { patternId: "C", repeats: 500 },
        "junk",
      ],
    })!;
    expect(p.bpm).toBe(200);
    expect(p.swing).toBe(1);
    expect(p.activePattern).toBe("A");
    expect(p.patterns.A.grid[0]).toHaveLength(BEAT_STEPS);
    expect(p.patterns.A.grid[0]![0]).toBe(0);
    expect(p.patterns.A.grid[0]![1]).toBe(1);
    expect(p.patterns.A.grid[0]![2]).toBe(2);
    expect(p.patterns.A.grid).toHaveLength(BEAT_TRACK_COUNT);
    expect(p.patterns.A.bass[0]).toBe(47); // clamped to range
    expect(p.patterns.A.bass[1]).toBeNull();
    expect(p.patterns.A.bass[2]).toBe(31); // rounded
    expect(p.patterns.B.grid[0]![0]).toBe(0); // missing pattern → empty
    expect(p.mixer.vol[0]).toBe(1.5);
    expect(p.mixer.vol[1]).toBe(0);
    expect(p.mixer.vol[2]).toBe(1); // missing → default
    expect(p.mixer.mute[0]).toBe(true);
    expect(p.mixer.mute[1]).toBe(false);
    expect(p.mixer.bassVol).toBe(1.5);
    expect(p.mixer.bassMute).toBe(false);
    expect(p.arrangement).toEqual([
      { patternId: "B", repeats: 1 },
      { patternId: "C", repeats: 32 },
    ]);
  });
});

/* ─── W2-L1: pattern depth ─────────────────────────────────────────── */

describe("v1 → v2 migration", () => {
  /** A literal v1 payload: version 1, no bars, no velocity, 16 steps. */
  const v1Json = JSON.stringify({
    version: 1,
    patterns: {
      A: {
        grid: [
          [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
          [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
          ...Array.from({ length: 7 }, () => Array(16).fill(0)),
        ],
        bass: [36, null, null, null, null, null, null, null, 34, null, null, null, null, null, null, null],
      },
    },
    activePattern: "A",
    bpm: 128,
    swing: 0.1,
    arrangement: [{ patternId: "A", repeats: 2 }],
    mode: "song",
  });

  it("migrates without throwing and never loses a hit", () => {
    const p = deserializeBeatProject(v1Json);
    expect(p.version).toBe(2);
    const a = p.patterns.A;
    expect(a.bars).toBe(1);
    expect(patternStepCount(a)).toBe(16);
    expect(a.grid[0]).toEqual([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    expect(a.grid[1]![4]).toBe(2);
    expect(a.bass[0]).toBe(36);
    expect(a.bass[8]).toBe(34);
    expect(a.velocity).toEqual({});
    expect(a.bassVelocity).toEqual({});
    expect(p.patterns.B.grid[0]).toHaveLength(16); // missing patterns padded in
    expect(p.arrangement).toEqual([{ patternId: "A", repeats: 2 }]);
    expect(p.mode).toBe("song");
  });

  it("a migrated v1 project renders with EXACTLY the v1 gains (legacy-identical)", () => {
    const p = deserializeBeatProject(v1Json);
    for (const id of BEAT_PATTERN_IDS) {
      const pat = p.patterns[id];
      for (let ti = 0; ti < BEAT_TRACK_COUNT; ti++) {
        for (let s = 0; s < patternStepCount(pat); s++) {
          const cell = pat.grid[ti]![s]!;
          const legacy = cell === 2 ? 1.4 : cell === 1 ? 1 : 0;
          expect(drumStepGain(pat, ti, s)).toBe(legacy);
        }
      }
      for (let s = 0; s < patternStepCount(pat); s++) {
        expect(bassStepGain(pat, s)).toBe(pat.bass[s] == null ? 0 : 1);
      }
    }
  });

  it("a v1 project with LONGER stored rows keeps the first bar only (bars defaults to 1)", () => {
    const p = normalizeBeatProject({
      patterns: { A: { grid: [Array(32).fill(1)], bass: Array(32).fill(36) } },
    })!;
    expect(p.patterns.A.grid[0]).toHaveLength(16);
    expect(p.patterns.A.bass).toHaveLength(16);
  });
});

describe("pattern length (bars)", () => {
  it("grow pads with silence, shrink truncates, kept hits untouched", () => {
    const p = projectWithTrapA(); // kick accent at step 0, bass 36 at step 0
    const grown = setPatternBars(p.patterns.A, 4);
    expect(grown.bars).toBe(4);
    expect(patternStepCount(grown)).toBe(64);
    expect(grown.grid).toHaveLength(BEAT_TRACK_COUNT);
    expect(grown.grid[0]).toHaveLength(64);
    expect(grown.grid[0]![0]).toBe(2);
    expect(grown.grid[0]!.slice(16).every((v) => v === 0)).toBe(true);
    expect(grown.bass).toHaveLength(64);
    expect(grown.bass[0]).toBe(36);
    expect(grown.bass.slice(16).every((n) => n == null)).toBe(true);
    expect(p.patterns.A.bars).toBe(1); // input untouched

    const two = setPatternBars(grown, 2);
    two.grid[3]![40] = 1; // a hit in bar 3 (steps 32–47)
    const shrunk = setPatternBars(two, 1);
    expect(shrunk.grid[0]).toHaveLength(16);
    expect(shrunk.grid[0]![0]).toBe(2);
  });

  it("velocity entries past the new end are dropped on shrink", () => {
    let pat = setPatternBars(emptyBeatPattern(), 2);
    pat = setStepVelocity(pat, 0, 20, 0.5);
    pat = setStepVelocity(pat, 0, 4, 0.5);
    const shrunk = setPatternBars(pat, 1);
    expect(shrunk.velocity).toEqual({ "0:4": 0.5 });
    expect(stepVelocity(shrunk, 0, 20)).toBe(1); // out of range → default
  });

  it("garbage bar counts normalize to 1 bar", () => {
    for (const bars of [3, 0, "4", null, 2.5]) {
      const p = normalizeBeatProject({ patterns: { A: { bars } } })!;
      expect(p.patterns.A.bars).toBe(1);
      expect(p.patterns.A.grid[0]).toHaveLength(16);
    }
    const ok = normalizeBeatProject({ patterns: { A: { bars: 4 } } })!;
    expect(ok.patterns.A.bars).toBe(4);
    expect(ok.patterns.A.grid[0]).toHaveLength(64);
    expect(ok.patterns.A.bass).toHaveLength(64);
  });

  it("round-trips a mixed-length project byte-for-value", () => {
    const p = defaultBeatProject();
    p.patterns.A = setPatternBars(p.patterns.A, 2);
    p.patterns.A.grid[0]![31] = 2;
    p.patterns.C = setPatternBars(p.patterns.C, 4);
    p.patterns.C.bass[63] = 24;
    p.patterns.C = setStepVelocity(p.patterns.C, 8, 63, 0.25);
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back).toEqual(normalizeBeatProject(p));
    expect(back.patterns.A.bars).toBe(2);
    expect(back.patterns.A.grid[0]![31]).toBe(2);
    expect(back.patterns.C.bars).toBe(4);
    expect(back.patterns.C.bass[63]).toBe(24);
    expect(back.patterns.C.velocity).toEqual({ "8:63": 0.25 });
  });
});

describe("mixed-length arrangement math", () => {
  // A = 2 bars (32 steps), B = 1 bar (16), C = 4 bars (64)
  const project = (() => {
    const p = defaultBeatProject();
    p.patterns.A = setPatternBars(p.patterns.A, 2);
    p.patterns.C = setPatternBars(p.patterns.C, 4);
    return p;
  })();
  const resolve = stepsResolverForPatterns(project.patterns);
  const chain: BeatArrangementEntry[] = [
    { patternId: "A", repeats: 1 }, // steps 0–31
    { patternId: "B", repeats: 2 }, // steps 32–63
    { patternId: "C", repeats: 1 }, // steps 64–127
  ];

  it("totals sum each pattern's own length × repeats", () => {
    expect(arrangementTotalSteps(chain, resolve)).toBe(32 + 2 * 16 + 64);
    expect(arrangementTotalBars(chain, resolve)).toBe(8);
    // uniform resolver keeps the v1 semantics
    expect(arrangementTotalSteps(chain)).toBe(4 * BEAT_STEPS);
    expect(arrangementTotalBars(chain)).toBe(4);
  });

  it("duration follows the mixed total", () => {
    // 128 steps at 120 BPM: 128 × 60/120/4 = 16s
    expect(arrangementDurationSec(chain, 120, resolve)).toBeCloseTo(16, 5);
    expect(arrangementDurationSec(chain, 120)).toBeCloseTo(8, 5);
  });

  it("resolution lands on each pattern's own boundaries", () => {
    expect(resolveArrangementStep(0, chain, resolve)).toMatchObject({
      entryIndex: 0, patternId: "A", repeatIndex: 0, stepInPattern: 0,
    });
    expect(resolveArrangementStep(31, chain, resolve)).toMatchObject({
      entryIndex: 0, patternId: "A", stepInPattern: 31,
    });
    expect(resolveArrangementStep(32, chain, resolve)).toMatchObject({
      entryIndex: 1, patternId: "B", repeatIndex: 0, stepInPattern: 0,
    });
    expect(resolveArrangementStep(48, chain, resolve)).toMatchObject({
      entryIndex: 1, patternId: "B", repeatIndex: 1, stepInPattern: 0, stepInEntry: 16,
    });
    expect(resolveArrangementStep(64, chain, resolve)).toMatchObject({
      entryIndex: 2, patternId: "C", repeatIndex: 0, stepInPattern: 0,
    });
    expect(resolveArrangementStep(127, chain, resolve)).toMatchObject({
      entryIndex: 2, patternId: "C", stepInPattern: 63,
    });
    expect(resolveArrangementStep(128, chain, resolve)).toBeNull();
  });
});

describe("per-step velocity", () => {
  it("gain math: velocity multiplies the cell, accent multiplies on top", () => {
    expect(stepGain(0, 0.5)).toBe(0);
    expect(stepGain(1, 1)).toBe(1);
    expect(stepGain(2, 1)).toBe(BEAT_ACCENT_GAIN);
    expect(stepGain(1, 0.5)).toBe(0.5);
    expect(stepGain(2, 0.5)).toBeCloseTo(0.7, 10);
    expect(stepGain(1, 0)).toBe(0.1); // clamped to the floor
    expect(stepGain(1, 9)).toBe(1); // clamped to the ceiling
  });

  it("set/get round-trips, clamps, and removes the entry at the default", () => {
    const base = projectWithTrapA().patterns.A;
    const soft = setStepVelocity(base, 0, 0, 0.3);
    expect(stepVelocity(soft, 0, 0)).toBe(0.3);
    expect(drumStepGain(soft, 0, 0)).toBeCloseTo(0.3 * BEAT_ACCENT_GAIN, 10); // accent × velocity
    expect(base.velocity).toEqual({}); // input untouched
    const floored = setStepVelocity(base, 1, 2, 0.01);
    expect(stepVelocity(floored, 1, 2)).toBe(0.1);
    const backToDefault = setStepVelocity(soft, 0, 0, 1);
    expect(backToDefault.velocity).toEqual({});
    expect(stepVelocity(backToDefault, 0, 0)).toBe(1);
    expect(setStepVelocity(base, 0, 99, 0.5)).toBe(base); // out of range: no-op
    expect(setStepVelocity(base, 99, 0, 0.5)).toBe(base);
  });

  it("bass velocity composes the same way, with no accent state", () => {
    const base = projectWithTrapA().patterns.A;
    expect(bassStepGain(base, 0)).toBe(1); // v1 gain
    const soft = setBassStepVelocity(base, 0, 0.4);
    expect(bassStepVelocity(soft, 0)).toBe(0.4);
    expect(bassStepGain(soft, 0)).toBe(0.4);
    expect(bassStepGain(soft, 5)).toBe(0); // rest stays silent at any velocity
    expect(setBassStepVelocity(soft, 0, 1).bassVelocity).toEqual({});
  });

  it("normalize repairs velocity maps: bad keys/values dropped, defaults canonicalized", () => {
    const p = normalizeBeatProject({
      patterns: {
        A: {
          bars: 2,
          velocity: { "0:20": 0.5, "0:99": 0.5, "9:0": 0.5, "x": 0.5, "1:1": 1, "2:2": 7, "3:3": "loud" },
          bassVelocity: { "31": 0.25, "32": 0.25, "-1": 0.25, "4": 0 },
        },
      },
    })!;
    // "2:2": 7 clamps to 1.0 → dropped as the default; "1:1": 1 → dropped too
    expect(p.patterns.A.velocity).toEqual({ "0:20": 0.5 });
    expect(p.patterns.A.bassVelocity).toEqual({ "31": 0.25, "4": 0.1 }); // 0 clamps to the 0.1 floor
  });

  it("serialize round-trips velocity maps", () => {
    const p = projectWithTrapA();
    p.patterns.A = setStepVelocity(p.patterns.A, 4, 8, 0.62);
    p.patterns.A = setBassStepVelocity(p.patterns.A, 0, 0.85);
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back.patterns.A.velocity).toEqual({ "4:8": 0.62 });
    expect(back.patterns.A.bassVelocity).toEqual({ "0": 0.85 });
    expect(drumStepGain(back.patterns.A, 4, 8)).toBe(0); // velocity stored even on an empty cell
  });
});

describe("local persistence", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  it("save → load restores the project", () => {
    const p = projectWithTrapA();
    p.arrangement = [{ patternId: "A", repeats: 2 }];
    p.mode = "song";
    saveLocalBeatProject(p);
    const back = loadLocalBeatProject();
    expect(back?.patterns.A.grid[0]![0]).toBe(2);
    expect(back?.arrangement).toEqual([{ patternId: "A", repeats: 2 }]);
    expect(back?.mode).toBe("song");
  });
  it("nothing saved → null; corrupt saved → null (caller falls back)", () => {
    expect(loadLocalBeatProject()).toBeNull();
    store.set("bdv-beat-project-v1", "{oops");
    expect(loadLocalBeatProject()).toBeNull();
  });
});

/* ─── Beat join composition ──────────────────────────────────────────────
 * The seven lanes' state lives in ONE project shape: melody rides each
 * pattern, mixerFx rides the project. Legacy projects (written before
 * the join: no melody, no mixerFx, no sound fields) must load with the
 * new slices defaulted and their audible gains EXACTLY as before. */
describe("beat join composition — one project shape", () => {
  const legacyProjectJson = () =>
    JSON.stringify({
      version: 1,
      patterns: {
        A: {
          grid: [
            [2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
            ...Array.from({ length: 8 }, () => Array(16).fill(0)),
          ],
          bass: [36, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        },
      },
      activePattern: "A",
      bpm: 140,
      swing: 0,
      mixer: {
        vol: Array(9).fill(1),
        mute: Array(9).fill(false),
        solo: Array(9).fill(false),
        bassVol: 0.9,
        bassMute: false,
      },
      arrangement: [],
      mode: "pattern",
    });

  it("a legacy project loads with melody + mixerFx defaulted, gains untouched", async () => {
    const { emptyBeatMelody } = await import("@/lib/beat-melody");
    const { defaultBeatMixerFxState } = await import("@/lib/beat-mixer");
    const p = deserializeBeatProject(legacyProjectJson());
    // new slices present and defaulted
    expect(p.patterns.A.melody).toEqual(emptyBeatMelody());
    expect(p.mixerFx).toEqual(defaultBeatMixerFxState());
    // legacy gains EXACTLY: accent cell (2) = accent gain, plain hit = 1,
    // bass note = 1 — the v1 render math, unchanged by the join
    expect(drumStepGain(p.patterns.A, 0, 0)).toBe(BEAT_ACCENT_GAIN);
    expect(drumStepGain(p.patterns.A, 0, 4)).toBe(1);
    expect(bassStepGain(p.patterns.A, 0)).toBe(1);
    expect(patternStepCount(p.patterns.A)).toBe(16);
  });

  it("melody notes round-trip through serialize/deserialize and survive a bars change", async () => {
    const { addBeatNote, emptyBeatMelody, withBeatLane } = await import("@/lib/beat-melody");
    const p = defaultBeatProject();
    const lanes = withBeatLane(emptyBeatMelody(), "keys", addBeatNote([], {
      id: "n1", pitch: 60, startStep: 0, lengthSteps: 2, velocity: 96,
    }));
    p.patterns.A = { ...p.patterns.A, melody: lanes };
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back.patterns.A.melody.keys).toHaveLength(1);
    expect(back.patterns.A.melody.keys[0]).toMatchObject({ pitch: 60, velocity: 96 });
    // melody is bar-sized and loops: growing the pattern keeps it whole
    const grown = setPatternBars(back.patterns.A, 4);
    expect(grown.melody.keys).toHaveLength(1);
    // a pattern with ONLY melody notes is not "empty"
    const melodyOnly = { ...emptyBeatPattern(), melody: lanes };
    expect(isEmptyBeatPattern(melodyOnly)).toBe(false);
  });

  it("mixerFx round-trips through serialize/deserialize", () => {
    const p = defaultBeatProject();
    p.mixerFx.tracks["kick"]!.pan = -0.5;
    p.mixerFx.master.volume = 0.7;
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back.mixerFx.tracks["kick"]!.pan).toBe(-0.5);
    expect(back.mixerFx.master.volume).toBe(0.7);
  });
});

describe("feel slice (stack1500)", () => {
  it("a fresh project carries feel OFF with the default seed", async () => {
    const { BEAT_FEEL_DEFAULT_SEED } = await import("@/lib/beat-feel");
    const p = defaultBeatProject();
    expect(p.feel).toEqual({ timing: 0, velocity: 0, seed: BEAT_FEEL_DEFAULT_SEED });
  });

  it("feel round-trips through serialize/deserialize", () => {
    const p = defaultBeatProject();
    p.feel = { timing: 0.4, velocity: 0.65, seed: 123456789 };
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back.feel).toEqual({ timing: 0.4, velocity: 0.65, seed: 123456789 });
  });

  it("a legacy project JSON (no feel field) loads with feel OFF — unchanged sound", async () => {
    const { BEAT_FEEL_DEFAULT_SEED } = await import("@/lib/beat-feel");
    const legacy = JSON.parse(serializeBeatProject(defaultBeatProject())) as Record<string, unknown>;
    delete legacy.feel;
    const p = normalizeBeatProject(legacy)!;
    expect(p.feel).toEqual({ timing: 0, velocity: 0, seed: BEAT_FEEL_DEFAULT_SEED });
  });

  it("garbled feel values clamp instead of throwing", async () => {
    const { BEAT_FEEL_DEFAULT_SEED } = await import("@/lib/beat-feel");
    const p = normalizeBeatProject({ feel: { timing: 5, velocity: -2, seed: "nope" } })!;
    expect(p.feel).toEqual({ timing: 1, velocity: 0, seed: BEAT_FEEL_DEFAULT_SEED });
    const q = normalizeBeatProject({ feel: "junk" })!;
    expect(q.feel).toEqual({ timing: 0, velocity: 0, seed: BEAT_FEEL_DEFAULT_SEED });
  });

  it("feel-composed gains equal the plain gains at velocity 0, and scale by the factor when on", async () => {
    const { humanizeVelocityFactor } = await import("@/lib/beat-feel");
    const p = projectWithTrapA();
    const off = { timing: 0, velocity: 0, seed: 777 };
    const on = { timing: 0, velocity: 0.8, seed: 777 };
    for (let ti = 0; ti < BEAT_TRACK_COUNT; ti++) {
      for (let s = 0; s < BEAT_STEPS; s++) {
        expect(drumStepGainWithFeel(p.patterns.A, off, "A", ti, s)).toBe(drumStepGain(p.patterns.A, ti, s));
        const plain = drumStepGain(p.patterns.A, ti, s);
        const felt = drumStepGainWithFeel(p.patterns.A, on, "A", ti, s);
        if (plain === 0) expect(felt).toBe(0); // silence is never resurrected
        else expect(felt).toBeCloseTo(plain * humanizeVelocityFactor(on, "A", "drum", `${ti}:${s}`), 12);
      }
    }
    for (let s = 0; s < BEAT_STEPS; s++) {
      expect(bassStepGainWithFeel(p.patterns.A, off, "A", s)).toBe(bassStepGain(p.patterns.A, s));
      const plain = bassStepGain(p.patterns.A, s);
      const felt = bassStepGainWithFeel(p.patterns.A, on, "A", s);
      if (plain === 0) expect(felt).toBe(0);
      else expect(felt).toBeCloseTo(plain * humanizeVelocityFactor(on, "A", "bass", s), 12);
    }
  });
});
