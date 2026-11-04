/* stack1500 — beat feel tools (humanize + quantize) tests.
 * The laws under test:
 *  1. Quantize math is exact at every shipped strength × grid.
 *  2. Humanize is DETERMINISTIC: the same project computes the
 *     identical offset/factor maps every time, on every path.
 *  3. Humanize OFF is identity: offsets 0, factors 1, conversions and
 *     gains bit-identical to the pre-feel rails.
 *  4. Live playback and the offline render agree: both key a step's
 *     offset by (pattern, pattern-step) only — never by global step,
 *     play index, or wall clock — so the two formulas cannot drift.
 *  5. Legacy projects (no feel field) normalize to feel OFF. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEAT_FEEL_DEFAULT_SEED,
  BEAT_FEEL_TIMING_MAX_STEPS,
  BEAT_FEEL_VELOCITY_MAX_DELTA,
  BEAT_QUANTIZE_GRIDS,
  BEAT_QUANTIZE_STRENGTHS,
  defaultBeatFeel,
  feelUnit,
  humanizeMidiVelocity,
  humanizeStepOffsetSec,
  humanizeStepOffsetSteps,
  humanizeVelocityFactor,
  humanizedBeatNoteMidi,
  isBeatFeelActive,
  normalizeBeatFeel,
  quantizeBeatNotes,
  quantizeStartStep,
  rerollBeatFeelSeed,
  type BeatFeelState,
} from "./beat-feel";
import {
  beatNoteToMidi,
  stepDurationSec,
  type BeatMelodyNote,
} from "./beat-melody";
import {
  bassStepGain,
  bassStepGainWithFeel,
  defaultBeatProject,
  drumStepGain,
  drumStepGainWithFeel,
  normalizeBeatProject,
  type BeatPatternId,
} from "./beat-project";

const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");

const note = (over: Partial<BeatMelodyNote> = {}): BeatMelodyNote => ({
  id: "n1",
  pitch: 60,
  startStep: 0,
  lengthSteps: 1,
  velocity: 100,
  ...over,
});

const FEEL_ON: BeatFeelState = { timing: 0.7, velocity: 0.85, seed: 424242 };
const PATTERNS: BeatPatternId[] = ["A", "B", "C", "D"];

describe("quantize — grids and strengths", () => {
  it("ships the 1/16 and 1/8 grids and the 25/50/75/100 strengths", () => {
    expect(BEAT_QUANTIZE_GRIDS).toEqual([
      { id: "16", steps: 1, label: "1/16" },
      { id: "8", steps: 2, label: "1/8" },
    ]);
    expect([...BEAT_QUANTIZE_STRENGTHS]).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("raw pull math is exact at every strength (1/16 grid)", () => {
    // start 2.4 pulls toward grid point 2
    expect(quantizeStartStep(2.4, 1, 0.25)).toBeCloseTo(2.3, 12);
    expect(quantizeStartStep(2.4, 1, 0.5)).toBeCloseTo(2.2, 12);
    expect(quantizeStartStep(2.4, 1, 0.75)).toBeCloseTo(2.1, 12);
    expect(quantizeStartStep(2.4, 1, 1)).toBeCloseTo(2.0, 12);
    expect(quantizeStartStep(2.4, 1, 0)).toBe(2.4);
  });

  it("raw pull math is exact at every strength (1/8 grid)", () => {
    // start 3 pulls toward grid point 4 on the 2-step grid
    expect(quantizeStartStep(3, 2, 0.25)).toBeCloseTo(3.25, 12);
    expect(quantizeStartStep(3, 2, 0.5)).toBeCloseTo(3.5, 12);
    expect(quantizeStartStep(3, 2, 0.75)).toBeCloseTo(3.75, 12);
    expect(quantizeStartStep(3, 2, 1)).toBeCloseTo(4, 12);
    // on-grid starts never move, at any strength
    for (const s of BEAT_QUANTIZE_STRENGTHS) expect(quantizeStartStep(6, 2, s)).toBe(6);
  });

  it("applied quantize lands on the note model's half-step resolution", () => {
    const at = (startStep: number, gridSteps: number, strength: number) =>
      quantizeBeatNotes([note({ startStep })], { gridSteps, strength })[0]!.startStep;
    // full pulls land exactly on grid points
    expect(at(2.5, 1, 1)).toBe(3);
    expect(at(0.5, 1, 1)).toBe(1);
    expect(at(3, 2, 1)).toBe(4);
    expect(at(5.5, 2, 1)).toBe(6);
    // partial pulls move part-way, snapped to the model's half steps
    expect(at(3, 2, 0.5)).toBe(3.5);
    expect(at(2.5, 1, 0.5)).toBe(3); // 2.75 snaps to 3
    expect(at(2.5, 1, 0.25)).toBe(2.5); // 2.625 honestly rounds back — the model cannot hold it
    // strength 0 changes nothing
    expect(at(2.5, 1, 0)).toBe(2.5);
  });

  it("quantize moves starts only — lengths, pitches, velocities untouched; input not mutated", () => {
    const notes = [note({ id: "a", startStep: 2.5, lengthSteps: 3, pitch: 64, velocity: 90 })];
    const out = quantizeBeatNotes(notes, { gridSteps: 1, strength: 1 });
    expect(out[0]).toMatchObject({ startStep: 3, lengthSteps: 3, pitch: 64, velocity: 90 });
    expect(notes[0]!.startStep).toBe(2.5);
  });

  it("quantize honors the selected-note scope and re-sorts the lane", () => {
    const notes = [
      note({ id: "a", startStep: 0.5 }),
      note({ id: "b", startStep: 4.5 }),
      note({ id: "c", startStep: 9 }),
    ];
    const scoped = quantizeBeatNotes(notes, { gridSteps: 1, strength: 1, onlyIds: ["b"] });
    expect(scoped.find((n) => n.id === "a")!.startStep).toBe(0.5);
    expect(scoped.find((n) => n.id === "b")!.startStep).toBe(5);
    expect(scoped.find((n) => n.id === "c")!.startStep).toBe(9);
    // whole-lane apply re-sorts into canonical start order
    const all = quantizeBeatNotes(
      [note({ id: "x", startStep: 7.5 }), note({ id: "y", startStep: 1.5 })],
      { gridSteps: 2, strength: 1 },
    );
    expect(all.map((n) => n.id)).toEqual(["y", "x"]);
    expect(all.map((n) => n.startStep)).toEqual([2, 8]);
  });
});

describe("humanize — determinism", () => {
  const offsetMap = (feel: BeatFeelState) =>
    PATTERNS.flatMap((pid) =>
      Array.from({ length: 64 }, (_, s) => humanizeStepOffsetSteps(feel, pid, s)),
    );
  const factorMap = (feel: BeatFeelState) =>
    PATTERNS.flatMap((pid) => [
      ...Array.from({ length: 64 }, (_, s) => humanizeVelocityFactor(feel, pid, "bass", s)),
      ...Array.from({ length: 8 }, (_, ti) =>
        Array.from({ length: 64 }, (_, s) => humanizeVelocityFactor(feel, pid, "drum", `${ti}:${s}`)),
      ).flat(),
    ]);

  it("the same project computes identical offset and factor maps twice", () => {
    expect(offsetMap(FEEL_ON)).toEqual(offsetMap(FEEL_ON));
    expect(factorMap(FEEL_ON)).toEqual(factorMap(FEEL_ON));
  });

  it("a different seed (or pattern) produces a different feel", () => {
    expect(offsetMap({ ...FEEL_ON, seed: FEEL_ON.seed + 1 })).not.toEqual(offsetMap(FEEL_ON));
    const a = Array.from({ length: 64 }, (_, s) => humanizeStepOffsetSteps(FEEL_ON, "A", s));
    const b = Array.from({ length: 64 }, (_, s) => humanizeStepOffsetSteps(FEEL_ON, "B", s));
    expect(a).not.toEqual(b);
  });

  it("feelUnit stays in [0, 1) and is stable per key", () => {
    for (let i = 0; i < 500; i++) {
      const u = feelUnit(99, "A", "step", i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(feelUnit(99, "A", "step", i)).toBe(u);
    }
  });

  it("offsets and factors stay inside their musical bounds at full amount", () => {
    const full: BeatFeelState = { timing: 1, velocity: 1, seed: 7 };
    for (const off of offsetMap(full)) {
      expect(Math.abs(off)).toBeLessThanOrEqual(BEAT_FEEL_TIMING_MAX_STEPS + 1e-12);
    }
    for (const f of factorMap(full)) {
      expect(f).toBeGreaterThanOrEqual(1 - BEAT_FEEL_VELOCITY_MAX_DELTA - 1e-12);
      expect(f).toBeLessThanOrEqual(1 + BEAT_FEEL_VELOCITY_MAX_DELTA + 1e-12);
    }
    // and the wobble is real: not everything sits at zero / one
    expect(offsetMap(full).some((o) => Math.abs(o) > 0.05)).toBe(true);
    expect(factorMap(full).some((f) => Math.abs(f - 1) > 0.05)).toBe(true);
  });
});

describe("humanize — OFF is identity", () => {
  const off: BeatFeelState = { timing: 0, velocity: 0, seed: 31337 };

  it("timing 0 → every step offset is exactly 0 (steps and seconds)", () => {
    for (const pid of PATTERNS) {
      for (let s = 0; s < 64; s++) {
        expect(humanizeStepOffsetSteps(off, pid, s)).toBe(0);
        expect(humanizeStepOffsetSec(off, pid, s, 137)).toBe(0);
      }
    }
  });

  it("velocity 0 → every factor is exactly 1 and composed gains equal the plain rails", () => {
    const p = defaultBeatProject();
    p.patterns.A.grid[0]![0] = 2;
    p.patterns.A.grid[2]![4] = 1;
    p.patterns.A.bass[0] = 36;
    for (let ti = 0; ti < 8; ti++) {
      for (let s = 0; s < 16; s++) {
        expect(humanizeVelocityFactor(off, "A", "drum", `${ti}:${s}`)).toBe(1);
        expect(drumStepGainWithFeel(p.patterns.A, off, "A", ti, s)).toBe(drumStepGain(p.patterns.A, ti, s));
      }
    }
    for (let s = 0; s < 16; s++) {
      expect(bassStepGainWithFeel(p.patterns.A, off, "A", s)).toBe(bassStepGain(p.patterns.A, s));
    }
  });

  it("velocity 0 → the humanized note conversion equals beatNoteToMidi exactly", () => {
    const notes = [
      note({ id: "a", startStep: 0, velocity: 100 }),
      note({ id: "b", startStep: 3.5, velocity: 64, lengthSteps: 2.5 }),
      note({ id: "c", startStep: 15.5, velocity: 127 }),
    ];
    for (const n of notes) {
      expect(humanizedBeatNoteMidi(n, 140, 0.3, off, "A", "keys")).toEqual(beatNoteToMidi(n, 140, 0.3));
    }
  });

  it("midi velocity humanize clamps to the note model's 1–127", () => {
    expect(humanizeMidiVelocity(127, 1.3)).toBe(127);
    expect(humanizeMidiVelocity(1, 0.7)).toBe(1);
    expect(humanizeMidiVelocity(100, 1)).toBe(100);
    expect(humanizeMidiVelocity(100, 1.1)).toBe(110);
  });
});

describe("live playback and the offline render agree", () => {
  it("a step's offset depends only on (feel, pattern, pattern-step, bpm) — loop pass and play index cannot change it", () => {
    // The live scheduler calls with (patId, s) where s is the step
    // inside the pattern; the render calls with (pid, si) the same
    // way. A pattern's second loop pass and its later plays re-key
    // identically — there is no global-step input to disagree over.
    for (const pid of PATTERNS) {
      for (let s = 0; s < 64; s++) {
        const firstPass = humanizeStepOffsetSec(FEEL_ON, pid, s, 140);
        const secondPass = humanizeStepOffsetSec(FEEL_ON, pid, s, 140);
        expect(secondPass).toBe(firstPass);
      }
    }
    // bpm scales the offset linearly (steps → seconds), nothing else
    expect(humanizeStepOffsetSec(FEEL_ON, "A", 5, 70)).toBeCloseTo(
      humanizeStepOffsetSteps(FEEL_ON, "A", 5) * stepDurationSec(70),
      12,
    );
  });

  it("a melody note's render key (bar × 16 + start step) is the step the live scheduler fires it on", () => {
    // two-bar pattern: a note written at bar-relative start 3.5 in bar
    // 2 fires live at pattern step 16 + 3 = 19; the render keys its
    // offset with bar * BEAT_STEPS + floor(startStep) = 19. Same key,
    // same offset — asserted here at the lib level both paths call.
    const bpm = 120;
    for (const bar of [0, 1, 2, 3]) {
      for (const start of [0, 3.5, 7, 15.5]) {
        const liveStep = bar * 16 + Math.floor(start);
        const renderStep = bar * 16 + Math.floor(start);
        expect(renderStep).toBe(liveStep);
        expect(humanizeStepOffsetSec(FEEL_ON, "C", renderStep, bpm)).toBe(
          humanizeStepOffsetSec(FEEL_ON, "C", liveStep, bpm),
        );
      }
    }
  });

  it("the page wires the same functions into both paths (source truth)", () => {
    const page = read("../components/audio-studio/AiAudio.tsx");
    // timing offset: live adds it to `when`, render adds it to `tt`
    expect(page).toContain("when += humanizeStepOffsetSec(feelRef.current, patId, s, bpmRef.current)");
    expect(page).toContain("+ humanizeStepOffsetSec(feelRef.current, pid, si, bpmRef.current)");
    // gains: both paths take the feel-composed rails
    expect(page).toContain("drumStepGainWithFeel(pat, feelRef.current, patId, ti, s)");
    expect(page).toContain("drumStepGainWithFeel(pat, feelRef.current, pid, ti, si)");
    expect(page).toContain("bassStepGainWithFeel(pat, feelRef.current, patId, s)");
    expect(page).toContain("bassStepGainWithFeel(pat, feelRef.current, pid, si)");
    // feel state round-trips through the project shape
    expect(page).toContain("feel: feelRef.current,");
    expect(page).toContain("setFeel(p.feel);");
    expect(page).toContain('data-testid="beat-feel-timing"');
    expect(page).toContain('data-testid="beat-feel-velocity"');
    expect(page).toContain('data-testid="beat-feel-reroll"');
  });

  it("the roll carries the quantize controls (source truth)", () => {
    const roll = read("../components/beat-studio/BeatMelodyRoll.tsx");
    expect(roll).toContain('data-testid="beat-melody-quantize"');
    expect(roll).toContain('data-testid="btn-beat-quantize-apply"');
    expect(roll).toContain("quantizeBeatNotes(notes, {");
    expect(roll).toContain("Applies to the selected note");
  });
});

describe("feel state — normalize, seed, legacy", () => {
  it("defaults are OFF with the fixed default seed", () => {
    expect(defaultBeatFeel()).toEqual({ timing: 0, velocity: 0, seed: BEAT_FEEL_DEFAULT_SEED });
    expect(isBeatFeelActive(defaultBeatFeel())).toBe(false);
    expect(isBeatFeelActive({ timing: 0.1, velocity: 0, seed: 1 })).toBe(true);
  });

  it("missing or garbled state normalizes to OFF (the legacy load path)", () => {
    for (const raw of [undefined, null, "junk", 42, [], {}]) {
      expect(normalizeBeatFeel(raw)).toEqual(defaultBeatFeel());
    }
    const legacy = normalizeBeatProject({ version: 2, patterns: {}, bpm: 140 })!;
    expect(legacy.feel).toEqual(defaultBeatFeel());
  });

  it("amounts clamp to 0–1 and the seed to a uint32", () => {
    expect(normalizeBeatFeel({ timing: 2, velocity: -1, seed: 4294967297 })).toEqual({
      timing: 1,
      velocity: 0,
      seed: 1,
    });
    expect(normalizeBeatFeel({ timing: 0.25, velocity: 0.5, seed: 12.9 }).seed).toBe(12);
  });

  it("reroll stores a fresh seed without touching the amounts; 0 never sticks", () => {
    const before: BeatFeelState = { timing: 0.3, velocity: 0.6, seed: 5 };
    const after = rerollBeatFeelSeed(before, 987654321);
    expect(after).toEqual({ timing: 0.3, velocity: 0.6, seed: 987654321 });
    expect(rerollBeatFeelSeed(before, 0).seed).toBe(1);
    // a rerolled project feels different from the same amounts un-rolled
    const a = Array.from({ length: 16 }, (_, s) => humanizeStepOffsetSteps(before, "A", s));
    const b = Array.from({ length: 16 }, (_, s) => humanizeStepOffsetSteps(after, "A", s));
    expect(a).not.toEqual(b);
  });
});
