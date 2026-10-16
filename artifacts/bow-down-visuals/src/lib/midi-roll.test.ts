/* Stack 6 #7 — MIDI roll support tests: polyphonic .mid export bytes,
 * synth voice/hash helpers, WebMIDI event pairing. */
import { describe, it, expect } from "vitest";
import { buildMidiFilePolyphonic, buildMidiFile } from "@/lib/midi-export";
import { midiToFreq, midiTrackHash, voiceSpec } from "@/lib/midi-synth";
import { pairRecordedNotes, type WebMidiNoteEvent } from "@/lib/web-midi";

describe("buildMidiFilePolyphonic", () => {
  it("writes a valid SMF header and keeps overlapping notes + velocities", () => {
    const bytes = buildMidiFilePolyphonic(
      [
        { midi: 60, startSec: 0, durationSec: 1, velocity: 90 },
        { midi: 64, startSec: 0.5, durationSec: 1, velocity: 40 },
      ],
      120,
      "Chord",
    );
    /* MThd header */
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
    expect(String.fromCharCode(...bytes.slice(14, 18))).toBe("MTrk");
    const arr = [...bytes];
    /* both note-ons present with their own velocities (overlap kept) */
    const on60 = arr.findIndex((b, i) => b === 0x90 && arr[i + 1] === 60 && arr[i + 2] === 90);
    const on64 = arr.findIndex((b, i) => b === 0x90 && arr[i + 1] === 64 && arr[i + 2] === 40);
    expect(on60).toBeGreaterThan(0);
    expect(on64).toBeGreaterThan(0);
    /* end-of-track meta present */
    const eot = arr.findIndex((b, i) => b === 0xff && arr[i + 1] === 0x2f);
    expect(eot).toBeGreaterThan(0);
  });

  it("monophonic writer still clips overlaps (existing behavior intact)", () => {
    const bytes = buildMidiFile(
      [
        { midi: 60, startSec: 0, durationSec: 2 },
        { midi: 62, startSec: 0.5, durationSec: 0.5 },
      ],
      120,
    );
    expect(bytes.length).toBeGreaterThan(20);
  });

  it("empty note list still produces a valid file", () => {
    const bytes = buildMidiFilePolyphonic([], 120);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
  });
});

describe("midi synth helpers", () => {
  it("A4 is 440Hz, C4 is ~261.63Hz", () => {
    expect(midiToFreq(69)).toBe(440);
    expect(midiToFreq(60)).toBeCloseTo(261.63, 2);
  });
  it("every bundled instrument has a voice spec", () => {
    for (const id of ["keys", "pluck", "bass", "pad"] as const) {
      const spec = voiceSpec(id);
      expect(spec.layers.length).toBeGreaterThan(0);
      expect(spec.attack).toBeGreaterThan(0);
    }
  });
  it("bounce hash changes with notes or instrument, stable otherwise", () => {
    const notes = [{ id: "a", pitch: 60, start: 0, duration: 1, velocity: 100 }];
    const h1 = midiTrackHash(notes, "keys");
    expect(midiTrackHash(notes, "keys")).toBe(h1);
    expect(midiTrackHash(notes, "bass")).not.toBe(h1);
    expect(midiTrackHash([{ ...notes[0]!, pitch: 61 }], "keys")).not.toBe(h1);
    expect(midiTrackHash([], "keys")).not.toBe(h1);
  });
});

describe("pairRecordedNotes", () => {
  const ev = (pitch: number, kind: "on" | "off", timeMs: number, velocity = 100): WebMidiNoteEvent => ({
    pitch,
    kind,
    timeMs,
    velocity: kind === "on" ? velocity : 0,
  });
  it("pairs ons and offs into timed notes relative to record start", () => {
    const notes = pairRecordedNotes(
      [ev(60, "on", 1000, 90), ev(60, "off", 1750), ev(64, "on", 2000, 80), ev(64, "off", 2250)],
      1000,
    );
    expect(notes).toEqual([
      { pitch: 60, start: 0, duration: 0.75, velocity: 90 },
      { pitch: 64, start: 1, duration: 0.25, velocity: 80 },
    ]);
  });
  it("a note still held at stop gets the default length", () => {
    const notes = pairRecordedNotes([ev(60, "on", 500)], 0);
    expect(notes).toEqual([{ pitch: 60, start: 0.5, duration: 0.5, velocity: 100 }]);
  });
  it("stray offs are ignored", () => {
    expect(pairRecordedNotes([ev(60, "off", 100)], 0)).toEqual([]);
  });
});
