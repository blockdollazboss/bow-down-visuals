/* ── Beat Studio melodic lanes (W1-L2) ───────────────────────────────────
 * Step-based melodic notes for the beat sequencer, riding the site's real
 * piano-roll tech: notes convert to `MidiRollNote` (lib/arrangement.ts)
 * and sound through the bundled voices in lib/midi-synth.ts (keys / pluck
 * / pad) — the same voice definitions drive live playback and the offline
 * WAV render, so a melody sounds identical in both.
 *
 * This module is deliberately self-contained (its own note shape, kept out
 * of the arrangement model) so the beat-project model can compose it at
 * join time without a merge war. Times here are in SEQUENCER STEPS
 * (16 steps per pattern bar, half-step resolution), never seconds — the
 * seconds conversion lives in exactly one place (`beatNoteToMidi` /
 * `beatNoteTiming`).
 */

import type { MidiInstrumentId, MidiRollNote } from "@/lib/arrangement";

/** Melodic voices offered in the sequencer — a subset of the midi-synth
 *  instruments (the 808 keeps its own dedicated synth in ai-audio). */
export type BeatMelodicVoiceId = Extract<MidiInstrumentId, "keys" | "pluck" | "pad">;

export const BEAT_MELODIC_VOICES: Array<{ id: BeatMelodicVoiceId; label: string }> = [
  { id: "keys", label: "Keys" },
  { id: "pluck", label: "Pluck" },
  { id: "pad", label: "Pad" },
];

export const BEAT_MELODY_STEPS = 16;
/** Display / placement range: C2 (36) … C5 (72) — two octaves and a step
 *  beyond the 808 bass roll's C1–B2 (24–47). */
export const BEAT_MELODY_LO = 36;
export const BEAT_MELODY_HI = 72;
/** Smallest start/length unit: a half step (32nd note). */
export const BEAT_MELODY_RESOLUTION = 0.5;

export interface BeatMelodyNote {
  id: string;
  /** MIDI note number, BEAT_MELODY_LO–BEAT_MELODY_HI. */
  pitch: number;
  /** Start within the pattern, in steps (0 … <16), half-step resolution. */
  startStep: number;
  /** Length in steps (>= 0.5); may run past the pattern end (loops cut it). */
  lengthSteps: number;
  /** 1–127. */
  velocity: number;
}

/** All melodic lanes of one sequencer pattern — one note list per voice. */
export interface BeatMelodyLanes {
  keys: BeatMelodyNote[];
  pluck: BeatMelodyNote[];
  pad: BeatMelodyNote[];
}

export function emptyBeatMelody(): BeatMelodyLanes {
  return { keys: [], pluck: [], pad: [] };
}

export function cloneBeatMelody(lanes: BeatMelodyLanes): BeatMelodyLanes {
  return {
    keys: lanes.keys.map((n) => ({ ...n })),
    pluck: lanes.pluck.map((n) => ({ ...n })),
    pad: lanes.pad.map((n) => ({ ...n })),
  };
}

export function beatMelodyNoteCount(lanes: BeatMelodyLanes): number {
  return lanes.keys.length + lanes.pluck.length + lanes.pad.length;
}

let uidCounter = 0;
export function beatMelodyUid(prefix = "mnote"): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const clampNum = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

const snapStep = (v: number) => Math.round(v / BEAT_MELODY_RESOLUTION) * BEAT_MELODY_RESOLUTION;

/** Clamp + snap one note into the model's invariants. */
export function clampBeatNote(n: BeatMelodyNote): BeatMelodyNote {
  return {
    id: n.id,
    pitch: Math.round(clampNum(n.pitch, BEAT_MELODY_LO, BEAT_MELODY_HI)),
    startStep: snapStep(clampNum(n.startStep, 0, BEAT_MELODY_STEPS - BEAT_MELODY_RESOLUTION)),
    lengthSteps: Math.max(BEAT_MELODY_RESOLUTION, snapStep(clampNum(n.lengthSteps, BEAT_MELODY_RESOLUTION, 64))),
    velocity: Math.round(clampNum(n.velocity, 1, 127)),
  };
}

const byStartThenPitch = (a: BeatMelodyNote, b: BeatMelodyNote) =>
  a.startStep - b.startStep || b.pitch - a.pitch || a.id.localeCompare(b.id);

/** Add a note (clamped); returns a fresh, start-sorted list. */
export function addBeatNote(notes: BeatMelodyNote[], note: BeatMelodyNote): BeatMelodyNote[] {
  return [...notes, clampBeatNote(note)].sort(byStartThenPitch);
}

export function removeBeatNote(notes: BeatMelodyNote[], id: string): BeatMelodyNote[] {
  return notes.filter((n) => n.id !== id);
}

/** Move a note to a new start step / pitch (both snapped + clamped). */
export function moveBeatNote(
  notes: BeatMelodyNote[],
  id: string,
  startStep: number,
  pitch: number,
): BeatMelodyNote[] {
  return notes
    .map((n) => (n.id === id ? clampBeatNote({ ...n, startStep, pitch }) : n))
    .sort(byStartThenPitch);
}

/** Resize a note's length in steps (half-step resolution, min 0.5). */
export function resizeBeatNote(notes: BeatMelodyNote[], id: string, lengthSteps: number): BeatMelodyNote[] {
  return notes.map((n) => (n.id === id ? clampBeatNote({ ...n, lengthSteps }) : n));
}

/** Set a note's velocity (clamped 1–127). */
export function setBeatNoteVelocity(notes: BeatMelodyNote[], id: string, velocity: number): BeatMelodyNote[] {
  return notes.map((n) => (n.id === id ? clampBeatNote({ ...n, velocity }) : n));
}

/** Replace one voice's lane on a lanes object (immutable). */
export function withBeatLane(
  lanes: BeatMelodyLanes,
  voice: BeatMelodicVoiceId,
  notes: BeatMelodyNote[],
): BeatMelodyLanes {
  return { ...lanes, [voice]: notes };
}

/* ─── Timing / scheduling math ────────────────────────────────────────── */

/** Seconds per sequencer step (a 16th note) at `bpm`. */
export function stepDurationSec(bpm: number): number {
  return 60 / Math.max(30, bpm) / 4;
}

/**
 * When a note sounds inside one pattern bar, in seconds, and how long it
 * rings. Swing mirrors the drum grid: notes whose integer step is odd are
 * delayed by `swing` (0–1) of a step — fractional (half-step) starts keep
 * their offset on top of that.
 */
export function beatNoteTiming(
  note: BeatMelodyNote,
  bpm: number,
  swing = 0,
): { startSec: number; durationSec: number } {
  const step = stepDurationSec(bpm);
  const swung = Math.floor(note.startStep) % 2 === 1 ? step * clampNum(swing, 0, 1) : 0;
  return {
    startSec: note.startStep * step + swung,
    durationSec: Math.max(0.05, note.lengthSteps * step),
  };
}

/** Convert a beat note to the arrangement MidiRollNote shape (seconds). */
export function beatNoteToMidi(note: BeatMelodyNote, bpm: number, swing = 0): MidiRollNote {
  const { startSec, durationSec } = beatNoteTiming(note, bpm, swing);
  return { id: note.id, pitch: note.pitch, start: startSec, duration: durationSec, velocity: note.velocity };
}

/** One whole lane converted for the midi-synth voices. */
export function beatLaneToMidi(notes: BeatMelodyNote[], bpm: number, swing = 0): MidiRollNote[] {
  return notes.map((n) => beatNoteToMidi(n, bpm, swing));
}

/**
 * Live-transport helper: the notes that must be scheduled when the
 * transport reaches integer `step`, each with its offset in seconds from
 * that step's (already swing-adjusted) start time. A note starting on a
 * half step fires half a step after the integer step that precedes it.
 */
export function notesStartingAtStep(
  notes: BeatMelodyNote[],
  step: number,
  bpm: number,
): Array<{ note: BeatMelodyNote; offsetSec: number }> {
  const stepSec = stepDurationSec(bpm);
  const out: Array<{ note: BeatMelodyNote; offsetSec: number }> = [];
  for (const note of notes) {
    if (Math.floor(note.startStep) === step) {
      out.push({ note, offsetSec: (note.startStep - step) * stepSec });
    }
  }
  return out.sort((a, b) => a.offsetSec - b.offsetSec || b.note.pitch - a.note.pitch);
}

/* ─── Serialization ─────────────────────────────────────────────────────
 * The lanes object IS the serialized shape (plain JSON, rides inside the
 * pattern data). `normalizeBeatMelody` is the defensive read path: any
 * older/partial/garbled value loads as valid lanes, never throws. */

export function serializeBeatMelody(lanes: BeatMelodyLanes): BeatMelodyLanes {
  return cloneBeatMelody(lanes);
}

function normalizeLane(raw: unknown): BeatMelodyNote[] {
  if (!Array.isArray(raw)) return [];
  const out: BeatMelodyNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const n = item as Partial<BeatMelodyNote>;
    if (typeof n.pitch !== "number" || typeof n.startStep !== "number") continue;
    out.push(
      clampBeatNote({
        id: typeof n.id === "string" && n.id ? n.id : beatMelodyUid(),
        pitch: n.pitch,
        startStep: n.startStep,
        lengthSteps: typeof n.lengthSteps === "number" ? n.lengthSteps : 1,
        velocity: typeof n.velocity === "number" ? n.velocity : 100,
      }),
    );
  }
  return out.sort(byStartThenPitch);
}

export function normalizeBeatMelody(raw: unknown): BeatMelodyLanes {
  if (!raw || typeof raw !== "object") return emptyBeatMelody();
  const r = raw as Partial<Record<BeatMelodicVoiceId, unknown>>;
  return {
    keys: normalizeLane(r.keys),
    pluck: normalizeLane(r.pluck),
    pad: normalizeLane(r.pad),
  };
}
