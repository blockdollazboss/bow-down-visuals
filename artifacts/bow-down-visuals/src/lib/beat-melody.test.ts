import { describe, expect, it } from "vitest";
import {
  BEAT_MELODY_HI,
  BEAT_MELODY_LO,
  addBeatNote,
  beatLaneToMidi,
  beatMelodyNoteCount,
  beatNoteTiming,
  beatNoteToMidi,
  clampBeatNote,
  cloneBeatMelody,
  emptyBeatMelody,
  moveBeatNote,
  normalizeBeatMelody,
  notesStartingAtStep,
  removeBeatNote,
  resizeBeatNote,
  serializeBeatMelody,
  setBeatNoteVelocity,
  stepDurationSec,
  withBeatLane,
  type BeatMelodyNote,
} from "./beat-melody";

const note = (over: Partial<BeatMelodyNote> = {}): BeatMelodyNote => ({
  id: "n1",
  pitch: 60,
  startStep: 0,
  lengthSteps: 1,
  velocity: 100,
  ...over,
});

describe("beat-melody note ops", () => {
  it("clamps pitch into the C2–C5 display range", () => {
    expect(clampBeatNote(note({ pitch: 10 })).pitch).toBe(BEAT_MELODY_LO);
    expect(clampBeatNote(note({ pitch: 120 })).pitch).toBe(BEAT_MELODY_HI);
    expect(clampBeatNote(note({ pitch: 60.4 })).pitch).toBe(60);
  });

  it("snaps starts and lengths to half-step resolution and floors length at a half step", () => {
    const c = clampBeatNote(note({ startStep: 2.3, lengthSteps: 0.1 }));
    expect(c.startStep).toBe(2.5);
    expect(c.lengthSteps).toBe(0.5);
    expect(clampBeatNote(note({ startStep: 99 })).startStep).toBe(15.5);
    expect(clampBeatNote(note({ startStep: -4 })).startStep).toBe(0);
  });

  it("clamps velocity to 1–127", () => {
    expect(clampBeatNote(note({ velocity: 0 })).velocity).toBe(1);
    expect(clampBeatNote(note({ velocity: 999 })).velocity).toBe(127);
    expect(setBeatNoteVelocity([note()], "n1", 64)[0]!.velocity).toBe(64);
    expect(setBeatNoteVelocity([note()], "n1", 500)[0]!.velocity).toBe(127);
  });

  it("adds notes sorted by start then pitch, without mutating the input", () => {
    const before: BeatMelodyNote[] = [];
    const withOne = addBeatNote(before, note({ id: "b", startStep: 4 }));
    const withTwo = addBeatNote(withOne, note({ id: "a", startStep: 0, pitch: 64 }));
    expect(before).toHaveLength(0);
    expect(withTwo.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("moves a note with snapping and clamping, leaving others untouched", () => {
    const notes = [note({ id: "a" }), note({ id: "b", startStep: 8, pitch: 48 })];
    const moved = moveBeatNote(notes, "a", 3.24, 200);
    expect(moved.find((n) => n.id === "a")).toMatchObject({ startStep: 3, pitch: BEAT_MELODY_HI });
    expect(moved.find((n) => n.id === "b")).toMatchObject({ startStep: 8, pitch: 48 });
    expect(notes[0]).toMatchObject({ startStep: 0, pitch: 60 });
  });

  it("resizes with the half-step floor and removes by id", () => {
    const notes = [note({ id: "a" }), note({ id: "b", startStep: 4 })];
    expect(resizeBeatNote(notes, "a", 2.6)[0]!.lengthSteps).toBe(2.5);
    expect(resizeBeatNote(notes, "a", 0)[0]!.lengthSteps).toBe(0.5);
    expect(removeBeatNote(notes, "a").map((n) => n.id)).toEqual(["b"]);
  });

  it("replaces one lane immutably and counts notes across lanes", () => {
    const lanes = emptyBeatMelody();
    const next = withBeatLane(lanes, "pluck", [note()]);
    expect(lanes.pluck).toHaveLength(0);
    expect(next.pluck).toHaveLength(1);
    expect(beatMelodyNoteCount(next)).toBe(1);
    expect(cloneBeatMelody(next)).toEqual(next);
    expect(cloneBeatMelody(next).pluck[0]).not.toBe(next.pluck[0]);
  });
});

describe("beat-melody timing + scheduling math", () => {
  it("step duration is a 16th note at the bpm", () => {
    expect(stepDurationSec(120)).toBeCloseTo(0.125);
    expect(stepDurationSec(140)).toBeCloseTo(60 / 140 / 4);
  });

  it("converts steps to seconds, applying swing only to odd integer steps", () => {
    expect(beatNoteTiming(note({ startStep: 0, lengthSteps: 2 }), 120)).toEqual({
      startSec: 0,
      durationSec: 0.25,
    });
    // step 3 is odd → +swing of one step (0.125 * 0.5)
    expect(beatNoteTiming(note({ startStep: 3 }), 120, 0.5).startSec).toBeCloseTo(3 * 0.125 + 0.0625);
    // step 4 is even → no swing even at full swing
    expect(beatNoteTiming(note({ startStep: 4 }), 120, 1).startSec).toBeCloseTo(0.5);
    // half-step start on an even floor keeps just its half offset
    expect(beatNoteTiming(note({ startStep: 2.5 }), 120, 1).startSec).toBeCloseTo(2.5 * 0.125);
    // half-step start on an odd floor swings as that odd step
    expect(beatNoteTiming(note({ startStep: 3.5 }), 120, 1).startSec).toBeCloseTo(3.5 * 0.125 + 0.125);
  });

  it("floors sounding duration so very short notes still speak", () => {
    expect(beatNoteTiming(note({ lengthSteps: 0.5 }), 300).durationSec).toBeGreaterThanOrEqual(0.05);
  });

  it("maps to the arrangement MidiRollNote shape with velocity intact", () => {
    const midi = beatNoteToMidi(note({ pitch: 69, startStep: 4, lengthSteps: 4, velocity: 77 }), 120);
    expect(midi).toEqual({ id: "n1", pitch: 69, start: 0.5, duration: 0.5, velocity: 77 });
    const lane = beatLaneToMidi([note({ id: "x" }), note({ id: "y", startStep: 8 })], 120);
    expect(lane.map((n) => n.id)).toEqual(["x", "y"]);
    expect(lane[1]!.start).toBeCloseTo(1);
  });

  it("live scheduling: notes fire on their integer step, half-step notes offset by half a step", () => {
    const notes = [
      note({ id: "a", startStep: 2 }),
      note({ id: "b", startStep: 2.5 }),
      note({ id: "c", startStep: 3 }),
      note({ id: "d", startStep: 15.5 }),
    ];
    const at2 = notesStartingAtStep(notes, 2, 120);
    expect(at2.map((x) => x.note.id)).toEqual(["a", "b"]);
    expect(at2[0]!.offsetSec).toBe(0);
    expect(at2[1]!.offsetSec).toBeCloseTo(0.0625);
    expect(notesStartingAtStep(notes, 3, 120).map((x) => x.note.id)).toEqual(["c"]);
    expect(notesStartingAtStep(notes, 15, 120)[0]!.offsetSec).toBeCloseTo(0.0625);
    expect(notesStartingAtStep(notes, 0, 120)).toEqual([]);
  });
});

describe("beat-melody serialization", () => {
  it("round-trips through JSON via serialize/normalize", () => {
    const lanes = withBeatLane(
      withBeatLane(emptyBeatMelody(), "keys", [note({ id: "k1", pitch: 65, startStep: 2.5, velocity: 90 })]),
      "pad",
      [note({ id: "p1", pitch: 48, startStep: 0, lengthSteps: 8, velocity: 70 })],
    );
    const round = normalizeBeatMelody(JSON.parse(JSON.stringify(serializeBeatMelody(lanes))));
    expect(round).toEqual(lanes);
  });

  it("normalizes garbled/partial data into valid lanes instead of throwing", () => {
    expect(normalizeBeatMelody(null)).toEqual(emptyBeatMelody());
    expect(normalizeBeatMelody("nope")).toEqual(emptyBeatMelody());
    expect(normalizeBeatMelody({ keys: "nope", pluck: [null, { pitch: "x" }] })).toEqual(emptyBeatMelody());
    const partial = normalizeBeatMelody({ keys: [{ pitch: 60, startStep: 1 }] });
    expect(partial.keys).toHaveLength(1);
    expect(partial.keys[0]).toMatchObject({ pitch: 60, startStep: 1, lengthSteps: 1, velocity: 100 });
    expect(typeof partial.keys[0]!.id).toBe("string");
  });

  it("normalization clamps out-of-range saved notes", () => {
    const lanes = normalizeBeatMelody({
      keys: [{ id: "z", pitch: 999, startStep: 42, lengthSteps: 0, velocity: 0 }],
    });
    expect(lanes.keys[0]).toMatchObject({ pitch: BEAT_MELODY_HI, startStep: 15.5, lengthSteps: 0.5, velocity: 1 });
  });
});
