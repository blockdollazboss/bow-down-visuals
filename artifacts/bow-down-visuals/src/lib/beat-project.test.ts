/* W1-L1 — beat project model tests: the sequencer's first unit coverage.
 * Arrangement math, defensive (de)serialization, editing ops, variation
 * cloning, render sequence, and local persistence. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BEAT_PATTERN_IDS,
  BEAT_STEPS,
  BEAT_TRACK_COUNT,
  addArrangementEntry,
  arrangementDurationSec,
  arrangementTotalBars,
  arrangementTotalSteps,
  clonePatternVariation,
  defaultBeatProject,
  deserializeBeatProject,
  emptyBeatPattern,
  expandArrangement,
  isEmptyBeatPattern,
  isSongModeActive,
  loadLocalBeatProject,
  moveArrangementEntry,
  normalizeBeatProject,
  removeArrangementEntry,
  renderPatternSequence,
  resolveArrangementStep,
  saveLocalBeatProject,
  serializeBeatProject,
  setArrangementEntryPattern,
  setArrangementEntryRepeats,
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
    expect(p.version).toBe(1);
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
      expect(p.version).toBe(1);
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
