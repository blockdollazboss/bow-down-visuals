/* ── Beat Studio feel tools — humanize + quantize (stack1500) ───────────
 * Timing feel for the step sequencer, in the same pure-module shape as
 * the rest of the beat libs (lib/beat-project, lib/beat-melody): data +
 * pure functions only, no charges, no provider calls — manual studio
 * tools are FREE.
 *
 * HUMANIZE lives on the PROJECT next to swing (the precedent: swing is
 * project-level timing feel, so humanize is too — BeatProject.feel, see
 * lib/beat-project). Two amounts, each 0–1 (the UI shows percentages):
 *   • timing   — every step lands a hair early/late. The offset is PER
 *     STEP and shared by everything on that step (drums, 808, melody):
 *     it is the player's internal-clock wobble, not per-hit scatter, so
 *     a step's events stay together exactly as the scheduler schedules
 *     them together.
 *   • velocity — each hit/note plays a hair louder/softer, keyed per
 *     event (drum track+step, bass step, melody note id), multiplying
 *     the gain/velocity the existing rails already compute.
 *
 * DETERMINISM IS LAW: offsets derive from the seed STORED IN THE
 * PROJECT through an integer hash — never Math.random at play/render
 * time — so live playback and the offline bounce (WAV / stems, and the
 * MP3 lane's encodes of the same render) compute the identical offsets
 * for the identical step, and a project renders the same way on every
 * machine, every time. The seed changes only when the creator hits the
 * reroll button (an edit, persisted like any other edit). Amount 0 on
 * a channel returns the identity (offset 0 / factor 1) without hashing,
 * and a project with both amounts at 0 plays and renders BIT-IDENTICAL
 * to the pre-feel build — legacy projects load with exactly that state.
 *
 * QUANTIZE is an edit op on melodic notes (lib/beat-melody notes are
 * the only sequencer events with sub-step positions — drum cells sit
 * ON integer steps by construction, so there is nothing off-grid to
 * pull; the 808 line is per-step too). Grids: 1/16 (one step) and 1/8
 * (two steps), strengths 25/50/75/100% pull toward the nearest grid
 * point, applied through clampBeatNote so the model's half-step
 * resolution and range invariants hold. Scope: note STARTS only —
 * lengths are untouched. HONEST LIMIT: triplet grids are NOT offered —
 * triplet positions fall on third-of-a-step offsets, which the note
 * model's half-step (32nd-note) resolution cannot represent; a triplet
 * quantize would snap its own results back onto binary positions and
 * lie about what it did.
 */

import {
  beatNoteTiming,
  clampBeatNote,
  stepDurationSec,
  type BeatMelodyNote,
} from "@/lib/beat-melody";
import type { MidiRollNote } from "@/lib/arrangement";

/* ─── Feel state ───────────────────────────────────────────────────────── */

export interface BeatFeelState {
  /** Timing wobble amount, 0–1. 0 = every step exactly on the grid. */
  timing: number;
  /** Velocity wobble amount, 0–1. 0 = gains exactly as written. */
  velocity: number;
  /** Project-stored seed (uint32). Offsets hash from this + the event's
   *  identity, so the feel is stable across plays, renders, machines. */
  seed: number;
}

/** The seed every project starts with (and legacy projects normalize
 *  to): a fixed constant, so a project that never rerolls still feels
 *  deterministic — identical to itself everywhere, forever. */
export const BEAT_FEEL_DEFAULT_SEED = 0xbea7;

/** Full timing amount moves a step at most this far (a quarter of a
 *  16th — a 64th note): enough to feel human, never enough to cross a
 *  neighbouring half-step start or collide with the next step. */
export const BEAT_FEEL_TIMING_MAX_STEPS = 0.25;

/** Full velocity amount scales a hit's gain by at most ±30%. */
export const BEAT_FEEL_VELOCITY_MAX_DELTA = 0.3;

const clamp01 = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

export function defaultBeatFeel(): BeatFeelState {
  return { timing: 0, velocity: 0, seed: BEAT_FEEL_DEFAULT_SEED };
}

/** Defensive read path (same discipline as the other beat models):
 *  amounts clamp to 0–1, a missing/garbled seed falls back to the
 *  default, and missing state entirely = feel OFF = legacy behavior. */
export function normalizeBeatFeel(raw: unknown): BeatFeelState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultBeatFeel();
  const r = raw as Partial<BeatFeelState>;
  return {
    timing: clamp01(r.timing),
    velocity: clamp01(r.velocity),
    seed:
      typeof r.seed === "number" && Number.isFinite(r.seed)
        ? Math.floor(Math.abs(r.seed)) % 4294967296
        : BEAT_FEEL_DEFAULT_SEED,
  };
}

/** Reroll the seed (pure): the caller supplies the fresh uint32 — the
 *  ONE place randomness enters, at edit time, and the result is stored
 *  in the project like any other edit. 0 is remapped to 1 so the hash
 *  never degenerates. */
export function rerollBeatFeelSeed(feel: BeatFeelState, nextUint32: number): BeatFeelState {
  const seed = (typeof nextUint32 === "number" && Number.isFinite(nextUint32) ? Math.floor(Math.abs(nextUint32)) : 0) >>> 0;
  return { ...feel, seed: seed === 0 ? 1 : seed };
}

/** True when either channel is audibly on. */
export function isBeatFeelActive(feel: BeatFeelState): boolean {
  return feel.timing > 0 || feel.velocity > 0;
}

/* ─── Deterministic hashing ──────────────────────────────────────────────
 * Integer-only mixing (Math.imul + shifts), so results are identical
 * on every JS engine. feelUnit(seed, ...parts) hashes the seed with the
 * event's identity parts into a stable value in [0, 1). */

function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function feelUnit(seed: number, ...parts: Array<string | number>): number {
  let h = (typeof seed === "number" && Number.isFinite(seed) ? Math.floor(Math.abs(seed)) >>> 0 : 0) || 0x9e3779b9;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    }
    h = mix32(h ^ 0x85ebca6b);
  }
  return mix32(h) / 4294967296;
}

/* ─── Humanize — timing ──────────────────────────────────────────────────
 * One offset per (pattern, step), shared by drums / bass / melody on
 * that step. Steps are PATTERN steps (0 … the pattern's own step
 * count − 1); a melody note rides the offset of the pattern step its
 * integer start lands in (bar × 16 + floor(startStep)) — the same key
 * the live scheduler uses when it reaches that step, so the two paths
 * cannot drift apart. Loop repeats re-key identically: a pattern feels
 * the same on its fourth pass as on its first, in playback and bounce
 * alike (both resolve per pattern-step). */

export function humanizeStepOffsetSteps(
  feel: BeatFeelState,
  patternId: string,
  step: number,
): number {
  const amount = clamp01(feel?.timing);
  if (amount <= 0) return 0;
  const unit = feelUnit(feel.seed, patternId, "step", step);
  return (unit * 2 - 1) * amount * BEAT_FEEL_TIMING_MAX_STEPS;
}

export function humanizeStepOffsetSec(
  feel: BeatFeelState,
  patternId: string,
  step: number,
  bpm: number,
): number {
  return humanizeStepOffsetSteps(feel, patternId, step) * stepDurationSec(bpm);
}

/* ─── Humanize — velocity ────────────────────────────────────────────────
 * A multiplier around 1, keyed per event so neighbouring hits vary
 * independently. Callers compose it with the gain their rail already
 * computes (drumStepGain / bassStepGain / a melody note's velocity) —
 * this module never re-derives a gain on its own. */

export function humanizeVelocityFactor(
  feel: BeatFeelState,
  patternId: string,
  salt: string,
  index: string | number,
): number {
  const amount = clamp01(feel?.velocity);
  if (amount <= 0) return 1;
  const unit = feelUnit(feel.seed, patternId, salt, index);
  return 1 + (unit * 2 - 1) * amount * BEAT_FEEL_VELOCITY_MAX_DELTA;
}

/** A melody note's humanized velocity (1–127, the note model's own
 *  range): its written velocity scaled by the note's factor. */
export function humanizeMidiVelocity(
  velocity: number,
  factor: number,
): number {
  const v = typeof velocity === "number" && Number.isFinite(velocity) ? velocity : 100;
  const f = typeof factor === "number" && Number.isFinite(factor) ? factor : 1;
  return Math.min(127, Math.max(1, Math.round(v * f)));
}

/**
 * A melody note converted for the midi-synth voices WITH feel applied:
 * the same conversion as beatNoteToMidi (start/duration from the one
 * timing place, swing included) with the note's velocity humanized.
 * Timing humanize is NOT in here on purpose: a note's start rides the
 * offset of the step it lands in, which the scheduler/render adds from
 * humanizeStepOffsetSec with the pattern-step key — one place for step
 * time in each path, so the paths agree. With velocity amount 0 the
 * result is exactly beatNoteToMidi's output.
 */
export function humanizedBeatNoteMidi(
  note: BeatMelodyNote,
  bpm: number,
  swing: number,
  feel: BeatFeelState,
  patternId: string,
  voiceId: string,
): MidiRollNote {
  const { startSec, durationSec } = beatNoteTiming(note, bpm, swing);
  const factor = humanizeVelocityFactor(feel, patternId, `melody:${voiceId}`, note.id);
  return {
    id: note.id,
    pitch: note.pitch,
    start: startSec,
    duration: durationSec,
    velocity: humanizeMidiVelocity(note.velocity, factor),
  };
}

/* ─── Quantize ───────────────────────────────────────────────────────────
 * Pull note starts toward a grid by a strength. The raw pull is exact
 * math; applying it runs through clampBeatNote, so the result keeps
 * the note model's half-step resolution (a 25% pull on a half-step-off
 * note can honestly round back — the grid it lands on is the model's
 * own). */

export type BeatQuantizeGridId = "16" | "8";

export const BEAT_QUANTIZE_GRIDS: Array<{
  id: BeatQuantizeGridId;
  /** Grid spacing in sequencer steps. */
  steps: number;
  label: string;
}> = [
  { id: "16", steps: 1, label: "1/16" },
  { id: "8", steps: 2, label: "1/8" },
];

export const BEAT_QUANTIZE_STRENGTHS = [0.25, 0.5, 0.75, 1] as const;

/** The pulled start (pre-snap) for one note start: nearest grid point,
 *  moved `strength` of the way there. Strength clamps to 0–1; a
 *  non-finite strength means a full quantize (the caller asked). */
export function quantizeStartStep(
  startStep: number,
  gridSteps: number,
  strength: number,
): number {
  const g = typeof gridSteps === "number" && Number.isFinite(gridSteps) && gridSteps > 0 ? gridSteps : 1;
  const s =
    typeof strength === "number" && Number.isFinite(strength)
      ? Math.min(1, Math.max(0, strength))
      : 1;
  if (s <= 0) return startStep;
  const target = Math.round(startStep / g) * g;
  return startStep + (target - startStep) * s;
}

const byStartThenPitch = (a: BeatMelodyNote, b: BeatMelodyNote) =>
  a.startStep - b.startStep || b.pitch - a.pitch || a.id.localeCompare(b.id);

/**
 * Apply quantize to a lane's notes (pure — inputs untouched). With
 * `onlyIds`, just those notes move (the roll's selected note); without
 * it, the whole lane moves. Results re-sort into the lane's canonical
 * start order, exactly as the other note ops return them.
 */
export function quantizeBeatNotes(
  notes: BeatMelodyNote[],
  opts: {
    gridSteps: number;
    strength: number;
    onlyIds?: ReadonlySet<string> | readonly string[] | null;
  },
): BeatMelodyNote[] {
  const only = opts.onlyIds ? new Set(opts.onlyIds) : null;
  return notes
    .map((n) =>
      only && !only.has(n.id)
        ? n
        : clampBeatNote({
            ...n,
            startStep: quantizeStartStep(n.startStep, opts.gridSteps, opts.strength),
          }),
    )
    .sort(byStartThenPitch);
}
