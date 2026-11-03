/* W3c — Beat Studio WebMIDI record: routing (GM drum map / 808 /
 * melody split by channel), quantization, transport position math,
 * the recorder's on/off pairing, and the pattern writes — all proven
 * with synthetic MIDI events. NO MIDI hardware exists in this
 * environment; the device session itself (lib/web-midi.ts) is the
 * same one the Audio Studio piano roll already ships with. */
import { describe, expect, it } from "vitest";
import {
  BEAT_MIDI_DRUM_MAP,
  BeatMidiRecorder,
  applyRecordedBassNote,
  applyRecordedDrumHit,
  applyRecordedMelodyNote,
  beatMidiPositionAt,
  foldBeatMelodyPitch,
  midiVelocityToStepGain,
  quantizeBeatStep,
  quantizeMelodyStartStep,
  recordedMelodyLengthSteps,
  routeBeatMidiNote,
  transportStepFloat,
  type BeatMidiPosition,
} from "./beat-midi";
import {
  defaultBeatProject,
  deserializeBeatProject,
  drumStepGain,
  emptyBeatPattern,
  normalizeBeatProject,
  serializeBeatProject,
  setPatternBars,
  setStepVelocity,
  type BeatPatternData,
} from "./beat-project";

const pos = (stepFloat: number, patternSteps = 16, patternId: "A" | "B" = "A"): BeatMidiPosition => ({
  patternId,
  stepFloat,
  patternSteps,
});

describe("GM drum map", () => {
  it("maps the standard kit to the house tracks", () => {
    expect(BEAT_MIDI_DRUM_MAP[36]).toBe(0); // kick
    expect(BEAT_MIDI_DRUM_MAP[38]).toBe(1); // snare
    expect(BEAT_MIDI_DRUM_MAP[39]).toBe(2); // clap
    expect(BEAT_MIDI_DRUM_MAP[42]).toBe(3); // closed hat
    expect(BEAT_MIDI_DRUM_MAP[46]).toBe(4); // open hat
    expect(BEAT_MIDI_DRUM_MAP[49]).toBe(8); // crash
    expect(BEAT_MIDI_DRUM_MAP[54]).toBe(7); // tambourine → shaker
    expect(BEAT_MIDI_DRUM_MAP[37]).toBe(6); // side stick → perc
    expect(BEAT_MIDI_DRUM_MAP[45]).toBe(6); // tom → perc
    expect(BEAT_MIDI_DRUM_MAP[51]).toBe(8); // ride → crash track
  });

  it("leaves non-percussion pitches unmapped", () => {
    for (const p of [0, 24, 30, 71, 72, 84, 100, 127]) {
      expect(BEAT_MIDI_DRUM_MAP[p]).toBeUndefined();
    }
  });
});

describe("routeBeatMidiNote", () => {
  it("channel 10 is drums only — unmapped pitches have no home", () => {
    expect(routeBeatMidiNote(36, 9, "keys")).toEqual({ kind: "drum", track: 0 });
    expect(routeBeatMidiNote(60, 9, "keys")).toEqual({ kind: "drum", track: 6 }); // bongo
    expect(routeBeatMidiNote(84, 9, "keys")).toBeNull();
    expect(routeBeatMidiNote(24, 9, "keys")).toBeNull();
  });

  it("melodic channels play the 808 row below C2 and the melody voice above", () => {
    expect(routeBeatMidiNote(24, 0, "keys")).toEqual({ kind: "bass", pitch: 24 });
    expect(routeBeatMidiNote(30, 0, "keys")).toEqual({ kind: "bass", pitch: 30 });
    expect(routeBeatMidiNote(35, 0, "keys")).toEqual({ kind: "bass", pitch: 35 });
    expect(routeBeatMidiNote(36, 0, "keys")).toEqual({ kind: "melody", voice: "keys", pitch: 36 });
    expect(routeBeatMidiNote(60, 0, "pluck")).toEqual({ kind: "melody", voice: "pluck", pitch: 60 });
    expect(routeBeatMidiNote(23, 0, "keys")).toBeNull();
  });

  it("melodic pitches above the lane fold down by octaves", () => {
    expect(routeBeatMidiNote(100, 0, "pad")).toEqual({ kind: "melody", voice: "pad", pitch: 64 });
    expect(routeBeatMidiNote(127, 0, "pad")).toEqual({ kind: "melody", voice: "pad", pitch: 67 });
    expect(foldBeatMelodyPitch(72)).toBe(72);
    expect(foldBeatMelodyPitch(36)).toBe(36);
  });

  it("with no channel, the drum map wins, then the melodic split", () => {
    expect(routeBeatMidiNote(36, undefined, "keys")).toEqual({ kind: "drum", track: 0 });
    expect(routeBeatMidiNote(35, undefined, "keys")).toEqual({ kind: "drum", track: 0 });
    expect(routeBeatMidiNote(30, undefined, "keys")).toEqual({ kind: "bass", pitch: 30 });
    expect(routeBeatMidiNote(72, undefined, "keys")).toEqual({ kind: "melody", voice: "keys", pitch: 72 });
    // a bongo pitch is a drum when no channel says otherwise
    expect(routeBeatMidiNote(60, undefined, "keys")).toEqual({ kind: "drum", track: 6 });
  });

  it("rejects garbage pitches", () => {
    expect(routeBeatMidiNote(-1, 0, "keys")).toBeNull();
    expect(routeBeatMidiNote(128, 0, "keys")).toBeNull();
    expect(routeBeatMidiNote(Number.NaN, 0, "keys")).toBeNull();
  });
});

describe("velocity + quantize", () => {
  it("maps MIDI velocity into the pattern gain space", () => {
    expect(midiVelocityToStepGain(127)).toBe(1);
    expect(midiVelocityToStepGain(64)).toBeCloseTo(64 / 127, 5);
    expect(midiVelocityToStepGain(1)).toBe(0.1); // house floor
  });

  it("quantizes drum steps to the nearest whole step, wrapping at the pattern length", () => {
    expect(quantizeBeatStep(4.4, 16)).toBe(4);
    expect(quantizeBeatStep(4.6, 16)).toBe(5);
    expect(quantizeBeatStep(15.6, 16)).toBe(0);
    expect(quantizeBeatStep(31.6, 32)).toBe(0);
    expect(quantizeBeatStep(20.2, 32)).toBe(20);
    expect(quantizeBeatStep(-0.4, 16)).toBe(0);
  });

  it("quantizes melody starts to the half-step grid inside the bar", () => {
    expect(quantizeMelodyStartStep(3.24)).toBe(3);
    expect(quantizeMelodyStartStep(3.26)).toBe(3.5);
    expect(quantizeMelodyStartStep(15.9)).toBe(0);
    expect(quantizeMelodyStartStep(17.3)).toBe(1.5); // bar 2 of a long pattern
  });

  it("measures held lengths on the half-step grid, across the loop wrap", () => {
    expect(recordedMelodyLengthSteps(2, 3.1, 16)).toBe(1);
    expect(recordedMelodyLengthSteps(2, 2.1, 16)).toBe(0.5); // minimum
    expect(recordedMelodyLengthSteps(15, 1, 16)).toBe(2); // held across the wrap
    expect(recordedMelodyLengthSteps(0, 40, 16)).toBe(40);
  });
});

describe("transport position", () => {
  it("interpolates the fractional global step from the scheduler's next step", () => {
    const base = { nextStep: 8, nextStepTime: 2.0, stepDurSec: 0.1 };
    expect(transportStepFloat({ ...base, atTime: 2.0 })).toBeCloseTo(8, 6);
    expect(transportStepFloat({ ...base, atTime: 1.95 })).toBeCloseTo(7.5, 6);
    expect(transportStepFloat({ ...base, atTime: 2.3 })).toBeCloseTo(11, 6);
  });

  it("pattern mode loops the active pattern at its own length", () => {
    const project = defaultBeatProject();
    expect(
      beatMidiPositionAt({
        globalStepFloat: 20.5, mode: "pattern", activePattern: "A",
        patterns: project.patterns, arrangement: [],
      }),
    ).toEqual({ patternId: "A", stepFloat: 4.5, patternSteps: 16 });

    const twoBar = setPatternBars(emptyBeatPattern(), 2);
    expect(
      beatMidiPositionAt({
        globalStepFloat: 40.25, mode: "pattern", activePattern: "B",
        patterns: { ...project.patterns, B: twoBar }, arrangement: [],
      }),
    ).toEqual({ patternId: "B", stepFloat: 8.25, patternSteps: 32 });
  });

  it("song mode resolves through the chain with per-pattern lengths", () => {
    const project = defaultBeatProject();
    const patterns = { ...project.patterns, B: setPatternBars(emptyBeatPattern(), 2) };
    const arrangement = [
      { patternId: "A" as const, repeats: 1 },
      { patternId: "B" as const, repeats: 1 },
    ];
    // A covers steps 0–15, B covers 16–47 (32 steps)
    expect(
      beatMidiPositionAt({
        globalStepFloat: 20.5, mode: "song", activePattern: "A", patterns, arrangement,
      }),
    ).toEqual({ patternId: "B", stepFloat: 4.5, patternSteps: 32 });
    // past the chain end it wraps to the top, like the transport
    expect(
      beatMidiPositionAt({
        globalStepFloat: 50, mode: "song", activePattern: "A", patterns, arrangement,
      }),
    ).toEqual({ patternId: "A", stepFloat: 2, patternSteps: 16 });
  });

  it("returns null before the transport starts (count-in)", () => {
    const project = defaultBeatProject();
    expect(
      beatMidiPositionAt({
        globalStepFloat: -4, mode: "pattern", activePattern: "A",
        patterns: project.patterns, arrangement: [],
      }),
    ).toBeNull();
  });
});

describe("pattern writes", () => {
  it("a recorded drum hit is byte-identical to a clicked hit at the same velocity", () => {
    const clicked = setStepVelocity(
      (() => { const p = emptyBeatPattern(); p.grid[0]![4] = 1; return p; })(),
      0, 4, midiVelocityToStepGain(80),
    );
    const recorded = applyRecordedDrumHit(emptyBeatPattern(), 0, 4, 80);
    expect(recorded).toEqual(clicked);
    expect(recorded.grid[0]![4]).toBe(1);
    expect(drumStepGain(recorded, 0, 4)).toBeCloseTo(80 / 127, 5);
  });

  it("a full-velocity hit stores the canonical default (no sparse entry)", () => {
    const p = applyRecordedDrumHit(emptyBeatPattern(), 1, 0, 127);
    expect(p.grid[1]![0]).toBe(1);
    expect(p.velocity).toEqual({});
    expect(drumStepGain(p, 1, 0)).toBe(1);
  });

  it("a hit over an accent cell keeps the accent and updates the velocity", () => {
    const base = emptyBeatPattern();
    base.grid[2]![8] = 2;
    const p = applyRecordedDrumHit(base, 2, 8, 100);
    expect(p.grid[2]![8]).toBe(2);
    expect(drumStepGain(p, 2, 8)).toBeCloseTo((100 / 127) * 1.4, 5);
    // the source pattern was not mutated
    expect(base.velocity).toEqual({});
  });

  it("a recorded 808 note lands in the bass row with its velocity, clamped to the row's range", () => {
    const p = applyRecordedBassNote(emptyBeatPattern(), 3, 30, 127);
    expect(p.bass[3]).toBe(30);
    expect(applyRecordedBassNote(emptyBeatPattern(), 3, 55, 127).bass[3]).toBe(47);
    const soft = applyRecordedBassNote(emptyBeatPattern(), 3, 30, 64);
    expect(soft.bassVelocity["3"]).toBeCloseTo(64 / 127, 5);
  });

  it("out-of-range writes are ignored", () => {
    const base = emptyBeatPattern();
    expect(applyRecordedDrumHit(base, 9, 0, 100)).toBe(base);
    expect(applyRecordedDrumHit(base, 0, 16, 100)).toBe(base);
    expect(applyRecordedBassNote(base, 64, 30, 100)).toBe(base);
  });
});

describe("BeatMidiRecorder (synthetic events)", () => {
  it("records a drum hit immediately, quantized to the nearest step", () => {
    const rec = new BeatMidiRecorder();
    const { target, recorded } = rec.noteOn({
      pitch: 36, velocity: 96, channel: 9, voice: "keys", position: pos(4.4),
    });
    expect(target).toEqual({ kind: "drum", track: 0 });
    expect(recorded?.patternId).toBe("A");
    expect(recorded?.step).toBe(4);
    const pattern = recorded!.apply(emptyBeatPattern());
    expect(pattern.grid[0]![4]).toBe(1);
    expect(drumStepGain(pattern, 0, 4)).toBeCloseTo(96 / 127, 5);
  });

  it("monitors without recording when there is no position (transport stopped / not armed)", () => {
    const rec = new BeatMidiRecorder();
    const { target, recorded } = rec.noteOn({
      pitch: 38, velocity: 100, channel: 9, voice: "keys", position: null,
    });
    expect(target).toEqual({ kind: "drum", track: 1 });
    expect(recorded).toBeNull();
  });

  it("records an 808 note from a melodic channel", () => {
    const rec = new BeatMidiRecorder();
    const { target, recorded } = rec.noteOn({
      pitch: 29, velocity: 127, channel: 0, voice: "keys", position: pos(5.6),
    });
    expect(target).toEqual({ kind: "bass", pitch: 29 });
    expect(recorded?.step).toBe(6);
    expect(recorded!.apply(emptyBeatPattern()).bass[6]).toBe(29);
  });

  it("pairs melody note on/off into a lane note with quantized start + held length", () => {
    const rec = new BeatMidiRecorder();
    const on = rec.noteOn({
      pitch: 60, velocity: 100, channel: 0, voice: "keys", position: pos(2.2),
    });
    expect(on.target).toEqual({ kind: "melody", voice: "keys", pitch: 60 });
    expect(on.recorded).toBeNull(); // melody lands on note-off
    expect(rec.openCount).toBe(1);
    const done = rec.noteOff({
      pitch: 60, channel: 0, voice: "keys", position: pos(4.3),
    });
    expect(rec.openCount).toBe(0);
    expect(done?.patternId).toBe("A");
    expect(done?.voice).toBe("keys");
    expect(done?.note.pitch).toBe(60);
    expect(done?.note.startStep).toBe(2);
    expect(done?.note.lengthSteps).toBe(2);
    expect(done?.note.velocity).toBe(100);
    // and it lands in the pattern exactly like a placed note
    const pattern = applyRecordedMelodyNote(emptyBeatPattern(), done!.voice, done!.note);
    expect(pattern.melody.keys).toHaveLength(1);
    expect(pattern.melody.keys[0]).toMatchObject({ pitch: 60, startStep: 2, lengthSteps: 2, velocity: 100 });
  });

  it("flush closes held notes at the stop position", () => {
    const rec = new BeatMidiRecorder();
    rec.noteOn({ pitch: 64, velocity: 90, channel: 0, voice: "pluck", position: pos(1.1) });
    const done = rec.flush(pos(3.1));
    expect(done).toHaveLength(1);
    expect(done[0]?.note).toMatchObject({ pitch: 64, startStep: 1, lengthSteps: 2, velocity: 90 });
    expect(rec.openCount).toBe(0);
  });

  it("a retriggered pitch restarts its start; stray note-offs are ignored", () => {
    const rec = new BeatMidiRecorder();
    expect(rec.noteOff({ pitch: 60, channel: 0, voice: "keys", position: pos(1) })).toBeNull();
    rec.noteOn({ pitch: 60, velocity: 80, channel: 0, voice: "keys", position: pos(1) });
    rec.noteOn({ pitch: 60, velocity: 80, channel: 0, voice: "keys", position: pos(5) });
    const done = rec.noteOff({ pitch: 60, channel: 0, voice: "keys", position: pos(6) });
    expect(done?.note.startStep).toBe(5);
    expect(done?.note.lengthSteps).toBe(1);
  });

  it("drum note-offs never produce melody notes", () => {
    const rec = new BeatMidiRecorder();
    rec.noteOn({ pitch: 36, velocity: 100, channel: 9, voice: "keys", position: pos(0) });
    expect(rec.noteOff({ pitch: 36, channel: 9, voice: "keys", position: pos(1) })).toBeNull();
  });
});

describe("project compatibility", () => {
  it("a recorded project round-trips through serialize/deserialize unchanged", () => {
    const rec = new BeatMidiRecorder();
    let pattern: BeatPatternData = emptyBeatPattern();
    const hit = rec.noteOn({ pitch: 42, velocity: 70, channel: 9, voice: "keys", position: pos(2) });
    pattern = hit.recorded!.apply(pattern);
    rec.noteOn({ pitch: 67, velocity: 88, channel: 0, voice: "pad", position: pos(0.2) });
    const melody = rec.noteOff({ pitch: 67, channel: 0, voice: "pad", position: pos(1.8) });
    pattern = applyRecordedMelodyNote(pattern, melody!.voice, melody!.note);

    const project = defaultBeatProject();
    project.patterns.A = pattern;
    const restored = deserializeBeatProject(serializeBeatProject(project));
    expect(restored.patterns.A).toEqual(normalizeBeatProject(project)?.patterns.A);
    expect(restored.patterns.A.grid[3]![2]).toBe(1); // the recorded closed hat
    expect(restored.patterns.A.melody.pad).toHaveLength(1);
  });

  it("projects saved before MIDI recording existed load untouched", () => {
    const legacy = deserializeBeatProject(
      JSON.stringify({ patterns: { A: { grid: [[1, 0, 0, 0]], bass: [24] } } }),
    );
    expect(legacy.patterns.A.grid[0]![0]).toBe(1);
    expect(legacy.patterns.A.bass[0]).toBe(24);
    expect(legacy.patterns.A.melody).toEqual({ keys: [], pluck: [], pad: [] });
    expect(legacy.patterns.A.velocity).toEqual({});
  });
});
