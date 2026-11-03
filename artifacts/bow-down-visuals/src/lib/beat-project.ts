/* ── Beat project model — the Step Sequencer as a song (W1-L1) ──────────
 * The sequencer used to keep everything in useState: four pattern slots
 * that could only loop one at a time, no way to play them in sequence,
 * no save/load, and an export that rendered only the active pattern.
 *
 * This module is the serializable project behind it:
 *   • patterns A/B/C/D — steps + 808 bass + per-track mixer, per slot
 *   • tempo (BPM) + swing
 *   • an arrangement — an ordered chain of { patternId, repeats } entries.
 *     An EMPTY arrangement means the classic behavior: loop the active
 *     pattern. A non-empty arrangement in song mode plays the chain in
 *     sequence, switching patterns at entry boundaries without stopping.
 *
 * Persistence mirrors lib/arrangement.ts (the house workflow-draft
 * pattern): localStorage for the fast same-browser restore + a server
 * draft (POST /api/drafts, workflowType "beat-project"). The drafts rail
 * takes any workflowType string (zod: 1–64 chars, one slot per user per
 * workflow), and the beat project carries no media URLs, so no DB
 * migration and no media mirroring are involved.
 *
 * Editing a beat project is a manual studio tool = pure UI = FREE.
 * No charges, no provider calls, no sound generation live here — this
 * module is data + pure functions only.
 *
 * W2-L1 (pattern depth) — project version 2:
 *   • Per-pattern length: each pattern is 1, 2 or 4 bars (16/32/64
 *     steps); grid/bass arrays are sized by the pattern's own step
 *     count. Version-1 projects (fixed 16 steps, no length field)
 *     migrate by padding with silence — hits are never lost and
 *     normalize never throws.
 *   • Continuous per-step velocity: a SPARSE map per pattern
 *     (drums: "track:step" → 0.1–1.0; 808 bass: "step" → 0.1–1.0),
 *     default 1.0, stored only where it differs from the default.
 *     Composition with the existing 0/1/2 cells: the cell stays the
 *     hit state (0 off / 1 hit / 2 accent) and velocity MULTIPLIES it —
 *     gain = velocity × (accent ? 1.4 : 1.0). A project with no
 *     velocity entries (every v1 project) therefore renders with
 *     EXACTLY the v1 gains (1.0 / 1.4) — legacy-identical by
 *     construction, and proven by test. The 808 bass line has no
 *     accent state, so its gain is the velocity itself (v1: 1.0).
 *
 * W2-L2 (additive): each drum track carries a sound assignment —
 * `trackSounds[trackIndex]` is a sound-registry id (lib/beat-sounds.ts)
 * and `trackSoundNames[trackIndex]` its display name at assignment time
 * (so an upload whose bytes live only in this session can still be named
 * honestly after a reload, when playback falls back to the synth voice).
 * Older projects without these fields normalize to the built-in synth
 * voices — exactly the sounds they always played.
 *
 * Feel (stack1500, additive): the project carries a `feel` slice —
 * humanize timing/velocity amounts + the seed the offsets hash from
 * (lib/beat-feel) — project-level beside swing, normalized with
 * defaults OFF so older projects load and sound exactly as before.
 */

import { defaultSoundIdForTrack, normalizeTrackSoundId } from "@/lib/beat-sounds";
import {
  beatMelodyNoteCount,
  cloneBeatMelody,
  emptyBeatMelody,
  normalizeBeatMelody,
  type BeatMelodyLanes,
} from "@/lib/beat-melody";
import {
  defaultBeatMixerFxState,
  normalizeBeatMixerFxState,
  type BeatMixerFxState,
} from "@/lib/beat-mixer";
import {
  defaultBeatFeel,
  humanizeVelocityFactor,
  normalizeBeatFeel,
  type BeatFeelState,
} from "@/lib/beat-feel";

export type BeatPatternId = "A" | "B" | "C" | "D";
export const BEAT_PATTERN_IDS: BeatPatternId[] = ["A", "B", "C", "D"];

/** Steps in ONE bar. Patterns are 1, 2 or 4 bars long (see below). */
export const BEAT_STEPS = 16;
/** Allowed per-pattern lengths, in bars. */
export const BEAT_PATTERN_BARS_OPTIONS = [1, 2, 4] as const;
export type BeatPatternBars = (typeof BEAT_PATTERN_BARS_OPTIONS)[number];
/** Drum tracks per pattern — matches TRACKS in pages/ai-audio.tsx. */
export const BEAT_TRACK_COUNT = 9;

/** Per-step velocity: a multiplier on the hit's gain. */
export const BEAT_VELOCITY_MIN = 0.1;
export const BEAT_VELOCITY_MAX = 1.0;
export const BEAT_VELOCITY_DEFAULT = 1.0;
/** Accent cells (grid value 2) boost the gain by this factor — the
 *  same 1.4 the sequencer has always used. */
export const BEAT_ACCENT_GAIN = 1.4;
/** 808 bass range: C1 (24) .. B2 (47) — same range as the piano roll. */
export const BEAT_BASS_LO = 24;
export const BEAT_BASS_HI = 47;

export const BEAT_BPM_MIN = 60;
export const BEAT_BPM_MAX = 200;
export const BEAT_ENTRY_REPEATS_MIN = 1;
export const BEAT_ENTRY_REPEATS_MAX = 32;
export const BEAT_ARRANGEMENT_MAX_ENTRIES = 64;

export interface BeatPatternData {
  /** Pattern length in bars (1, 2 or 4). Grid/bass arrays hold
   *  bars × BEAT_STEPS steps. */
  bars: BeatPatternBars;
  /** [track][step] — 0 = off, 1 = hit, 2 = accent. */
  grid: number[][];
  /** MIDI note per step, null = rest. */
  bass: (number | null)[];
  /** Sparse drum velocity: "track:step" → 0.1–1.0. Missing = 1.0. */
  velocity: Record<string, number>;
  /** Sparse 808 velocity: "step" → 0.1–1.0. Missing = 1.0. */
  bassVelocity: Record<string, number>;
  /* Melodic lanes (W1-L2, composed at the beat join): Keys / Pluck / Pad
   * notes for this pattern. The lanes are one bar (16 steps) and loop per
   * bar inside longer patterns — for 1-bar patterns (all legacy projects)
   * playback and render are exactly the pre-join behavior. */
  melody: BeatMelodyLanes;
}

/** Steps in a pattern of the given length. */
export function patternStepCount(p: Pick<BeatPatternData, "bars">): number {
  return p.bars * BEAT_STEPS;
}

export function isBeatPatternBars(v: unknown): v is BeatPatternBars {
  return v === 1 || v === 2 || v === 4;
}

export interface BeatMixerState {
  /** Per-track volume 0–1.5, index-aligned with the drum tracks. */
  vol: number[];
  mute: boolean[];
  solo: boolean[];
  bassVol: number;
  bassMute: boolean;
}

export interface BeatArrangementEntry {
  patternId: BeatPatternId;
  /** How many times the pattern plays before the next entry. */
  repeats: number;
}

export type BeatTransportMode = "pattern" | "song";

export interface BeatProject {
  /** v1 = fixed 16-step patterns; v2 = per-pattern length + velocity.
   *  normalizeBeatProject accepts both and always returns v2. */
  version: 2;
  patterns: Record<BeatPatternId, BeatPatternData>;
  activePattern: BeatPatternId;
  bpm: number;
  /** 0–1 (the UI shows it as a percentage). */
  swing: number;
  /** Feel tools (stack1500, lib/beat-feel): humanize timing + velocity
   *  amounts and the seed the offsets hash from. Project-level, right
   *  beside swing — swing is the precedent for project-wide timing
   *  feel. Older projects without it normalize to both amounts 0,
   *  which plays and renders bit-identical to the pre-feel build. */
  feel: BeatFeelState;
  mixer: BeatMixerState;
  /** W1-L3, composed at the beat join: per-channel FX + pan and the
   *  master bus (lib/beat-mixer). One project shape — the FX state
   *  persists WITH the project (localStorage + server draft) exactly
   *  like the gain mixer above; the page's FX panel edits this field.
   *  Older projects without it normalize to the no-FX defaults, which
   *  build a graph sonically identical to the pre-FX gains-only path. */
  mixerFx: BeatMixerFxState;
  arrangement: BeatArrangementEntry[];
  mode: BeatTransportMode;
  /** W2-L2: sound-registry id per drum track, index-aligned with the
   *  tracks (like the mixer arrays). Defaults to the built-in synth
   *  voice for that track. Project-wide, not per-pattern — the same
   *  composition as the mixer state. */
  trackSounds: string[];
  /** W2-L2: display name captured when a non-synth sound was assigned
   *  (uploads especially), index-aligned with trackSounds; null for
   *  built-in voices / when no name was captured. */
  trackSoundNames: (string | null)[];
}

/* ─── Factories ────────────────────────────────────────────────────────── */

export function emptyBeatGrid(steps: number = BEAT_STEPS): number[][] {
  return Array.from({ length: BEAT_TRACK_COUNT }, () => Array(steps).fill(0));
}

export function emptyBeatBass(steps: number = BEAT_STEPS): (number | null)[] {
  return Array(steps).fill(null);
}

export function emptyBeatPattern(bars: BeatPatternBars = 1): BeatPatternData {
  const steps = bars * BEAT_STEPS;
  return {
    bars,
    grid: emptyBeatGrid(steps),
    bass: emptyBeatBass(steps),
    velocity: {},
    bassVelocity: {},
    melody: emptyBeatMelody(),
  };
}

export function cloneBeatPattern(p: BeatPatternData): BeatPatternData {
  return {
    bars: p.bars,
    grid: p.grid.map((r) => [...r]),
    bass: [...p.bass],
    velocity: { ...p.velocity },
    bassVelocity: { ...p.bassVelocity },
    melody: cloneBeatMelody(p.melody),
  };
}

/** Resize a pattern to a new bar length (pure — returns a new pattern).
 *  Growing pads grid/bass with silence; shrinking truncates the tail
 *  (hits inside the kept bars are untouched, velocity entries past the
 *  new end are dropped). */
export function setPatternBars(p: BeatPatternData, bars: BeatPatternBars): BeatPatternData {
  const steps = bars * BEAT_STEPS;
  const fitRow = (row: number[]): number[] =>
    Array.from({ length: steps }, (_, s) => row[s] ?? 0);
  const velocity: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.velocity)) {
    const step = Number(k.split(":")[1]);
    if (Number.isFinite(step) && step < steps) velocity[k] = v;
  }
  const bassVelocity: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.bassVelocity)) {
    const step = Number(k);
    if (Number.isFinite(step) && step < steps) bassVelocity[k] = v;
  }
  return {
    bars,
    grid: p.grid.map(fitRow),
    bass: Array.from({ length: steps }, (_, s) => p.bass[s] ?? null),
    velocity,
    bassVelocity,
    /* Melody lanes are one bar and loop per bar, so a bars change keeps
     * them whole (no truncation, no padding). */
    melody: cloneBeatMelody(p.melody),
  };
}

/* ─── Per-step velocity ──────────────────────────────────────────────────
 * Composition (see the header): the grid cell is the hit state and the
 * velocity multiplies it. gain(cell, vel) = 0 when the cell is off,
 * vel for a plain hit, vel × 1.4 for an accent. With no velocity entry
 * (vel = 1.0) the gains are exactly the v1 constants 1.0 / 1.4. */

const velocityKey = (track: number, step: number): string => `${track}:${step}`;

const clampVelocity = (v: number): number =>
  Math.min(BEAT_VELOCITY_MAX, Math.max(BEAT_VELOCITY_MIN, v));

/** The stored velocity for a drum step (1.0 when unset/invalid). */
export function stepVelocity(p: BeatPatternData, track: number, step: number): number {
  const v = p.velocity[velocityKey(track, step)];
  return typeof v === "number" && Number.isFinite(v) ? clampVelocity(v) : BEAT_VELOCITY_DEFAULT;
}

/** Pure gain math for one cell + velocity — the single formula the
 *  live transport and the offline render both use. */
export function stepGain(cell: number, velocity: number): number {
  if (cell <= 0) return 0;
  const vel =
    typeof velocity === "number" && Number.isFinite(velocity)
      ? clampVelocity(velocity)
      : BEAT_VELOCITY_DEFAULT;
  return cell === 2 ? vel * BEAT_ACCENT_GAIN : vel;
}

/** The gain a drum step plays at (0 = silent/off). */
export function drumStepGain(p: BeatPatternData, track: number, step: number): number {
  return stepGain(p.grid[track]?.[step] ?? 0, stepVelocity(p, track, step));
}

/** Set a drum step's velocity (pure — returns a new pattern). Setting
 *  the default (1.0) removes the sparse entry. Out-of-range steps and
 *  tracks are ignored. */
export function setStepVelocity(
  p: BeatPatternData,
  track: number,
  step: number,
  velocity: number,
): BeatPatternData {
  if (track < 0 || track >= BEAT_TRACK_COUNT || step < 0 || step >= patternStepCount(p)) {
    return p;
  }
  const next = cloneBeatPattern(p);
  const v = typeof velocity === "number" && Number.isFinite(velocity) ? clampVelocity(velocity) : BEAT_VELOCITY_DEFAULT;
  if (v >= BEAT_VELOCITY_MAX) delete next.velocity[velocityKey(track, step)];
  else next.velocity[velocityKey(track, step)] = v;
  return next;
}

/** The stored velocity for an 808 bass step (1.0 when unset/invalid). */
export function bassStepVelocity(p: BeatPatternData, step: number): number {
  const v = p.bassVelocity[String(step)];
  return typeof v === "number" && Number.isFinite(v) ? clampVelocity(v) : BEAT_VELOCITY_DEFAULT;
}

/** The gain an 808 step plays at — velocity alone (no accent state;
 *  v1 projects: exactly 1.0, as before). */
export function bassStepGain(p: BeatPatternData, step: number): number {
  return p.bass[step] == null ? 0 : bassStepVelocity(p, step);
}

/* ─── Feel-composed gains (stack1500, lib/beat-feel) ─────────────────────
 * The single gain formula the live transport and the offline render
 * both use when humanize is on: the written gain (drumStepGain /
 * bassStepGain, untouched above) times the step's deterministic
 * velocity factor. Silent steps stay silent (the factor never
 * resurrects an off cell), and at velocity amount 0 the factor is
 * exactly 1 — these return the plain gains bit-for-bit. */

export function drumStepGainWithFeel(
  p: BeatPatternData,
  feel: BeatFeelState,
  patternId: BeatPatternId,
  track: number,
  step: number,
): number {
  const gain = drumStepGain(p, track, step);
  return gain > 0 ? gain * humanizeVelocityFactor(feel, patternId, "drum", `${track}:${step}`) : 0;
}

export function bassStepGainWithFeel(
  p: BeatPatternData,
  feel: BeatFeelState,
  patternId: BeatPatternId,
  step: number,
): number {
  const gain = bassStepGain(p, step);
  return gain > 0 ? gain * humanizeVelocityFactor(feel, patternId, "bass", step) : 0;
}

/** Set an 808 step's velocity (pure — returns a new pattern). */
export function setBassStepVelocity(
  p: BeatPatternData,
  step: number,
  velocity: number,
): BeatPatternData {
  if (step < 0 || step >= patternStepCount(p)) return p;
  const next = cloneBeatPattern(p);
  const v = typeof velocity === "number" && Number.isFinite(velocity) ? clampVelocity(velocity) : BEAT_VELOCITY_DEFAULT;
  if (v >= BEAT_VELOCITY_MAX) delete next.bassVelocity[String(step)];
  else next.bassVelocity[String(step)] = v;
  return next;
}

/** True when a pattern holds no hits and no bass notes (a free slot). */
export function isEmptyBeatPattern(p: BeatPatternData): boolean {
  return (
    p.grid.every((row) => row.every((v) => v === 0)) &&
    p.bass.every((n) => n == null) &&
    beatMelodyNoteCount(p.melody) === 0
  );
}

export function defaultBeatMixer(): BeatMixerState {
  return {
    vol: Array(BEAT_TRACK_COUNT).fill(1),
    mute: Array(BEAT_TRACK_COUNT).fill(false),
    solo: Array(BEAT_TRACK_COUNT).fill(false),
    bassVol: 0.9,
    bassMute: false,
  };
}

/** The default per-track sound assignments: the built-in synth voices. */
export function defaultTrackSounds(): string[] {
  return Array.from({ length: BEAT_TRACK_COUNT }, (_, i) => defaultSoundIdForTrack(i));
}

export function defaultTrackSoundNames(): (string | null)[] {
  return Array(BEAT_TRACK_COUNT).fill(null);
}

/** A fresh project: empty patterns, classic pattern-loop behavior.
 *  `seed` optionally supplies pattern A (the page seeds its preset). */
export function defaultBeatProject(seed?: BeatPatternData): BeatProject {
  return {
    version: 2,
    patterns: {
      A: seed ? cloneBeatPattern(seed) : emptyBeatPattern(),
      B: emptyBeatPattern(),
      C: emptyBeatPattern(),
      D: emptyBeatPattern(),
    },
    activePattern: "A",
    bpm: 140,
    swing: 0,
    feel: defaultBeatFeel(),
    mixer: defaultBeatMixer(),
    mixerFx: defaultBeatMixerFxState(),
    arrangement: [],
    mode: "pattern",
    trackSounds: defaultTrackSounds(),
    trackSoundNames: defaultTrackSoundNames(),
  };
}

/* ─── Defensive normalization / (de)serialization ──────────────────────── */

const clampN = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function normalizeGrid(raw: unknown, steps: number): number[][] {
  const rows = Array.isArray(raw) ? raw : [];
  return Array.from({ length: BEAT_TRACK_COUNT }, (_, ti) => {
    const row = Array.isArray(rows[ti]) ? (rows[ti] as unknown[]) : [];
    return Array.from({ length: steps }, (_, s) => {
      const v = row[s];
      return v === 2 ? 2 : v === 1 ? 1 : 0;
    });
  });
}

function normalizeBass(raw: unknown, steps: number): (number | null)[] {
  const notes = Array.isArray(raw) ? raw : [];
  return Array.from({ length: steps }, (_, s) => {
    const v = notes[s];
    return typeof v === "number" && Number.isFinite(v)
      ? Math.min(BEAT_BASS_HI, Math.max(BEAT_BASS_LO, Math.round(v)))
      : null;
  });
}

/** Sparse velocity maps: keep only well-formed, in-range entries whose
 *  value differs from the default (a stored 1.0 is the default, so it
 *  is dropped — the canonical form stays small and round-trips equal). */
function normalizeVelocityMap(raw: unknown, steps: number): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const m = /^(\d+):(\d+)$/.exec(k);
    if (!m) continue;
    const track = Number(m[1]);
    const step = Number(m[2]);
    if (track >= BEAT_TRACK_COUNT || step >= steps) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const clamped = clampVelocity(v);
    if (clamped < BEAT_VELOCITY_MAX) out[`${track}:${step}`] = clamped;
  }
  return out;
}

function normalizeBassVelocityMap(raw: unknown, steps: number): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(k)) continue;
    const step = Number(k);
    if (step >= steps) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const clamped = clampVelocity(v);
    if (clamped < BEAT_VELOCITY_MAX) out[String(step)] = clamped;
  }
  return out;
}

function normalizePattern(raw: unknown): BeatPatternData {
  if (!raw || typeof raw !== "object") return emptyBeatPattern();
  const r = raw as Partial<BeatPatternData>;
  /* v1 patterns carry no `bars` — they are 1 bar by definition, and
   * their 16 steps land verbatim at the head of the migrated arrays. */
  const bars: BeatPatternBars = isBeatPatternBars(r.bars) ? r.bars : 1;
  const steps = bars * BEAT_STEPS;
  return {
    bars,
    grid: normalizeGrid(r.grid, steps),
    bass: normalizeBass(r.bass, steps),
    velocity: normalizeVelocityMap(r.velocity, steps),
    bassVelocity: normalizeBassVelocityMap(r.bassVelocity, steps),
    melody: normalizeBeatMelody(r.melody),
  };
}

function normalizeMixer(raw: unknown): BeatMixerState {
  const base = defaultBeatMixer();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<BeatMixerState>;
  const bools = (v: unknown): boolean[] =>
    Array.from({ length: BEAT_TRACK_COUNT }, (_, i) =>
      Array.isArray(v) ? v[i] === true : false,
    );
  return {
    vol: Array.from({ length: BEAT_TRACK_COUNT }, (_, i) =>
      clampN(Array.isArray(r.vol) ? r.vol[i] : undefined, 0, 1.5, 1),
    ),
    mute: bools(r.mute),
    solo: bools(r.solo),
    bassVol: clampN(r.bassVol, 0, 1.5, base.bassVol),
    bassMute: r.bassMute === true,
  };
}

function normalizeTrackSounds(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: BEAT_TRACK_COUNT }, (_, i) =>
    normalizeTrackSoundId(arr[i], i),
  );
}

function normalizeTrackSoundNames(
  raw: unknown,
  trackSounds: string[],
): (string | null)[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: BEAT_TRACK_COUNT }, (_, i) => {
    const v = arr[i];
    // A built-in synth assignment never carries a captured name.
    if (trackSounds[i] === defaultSoundIdForTrack(i)) return null;
    return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 120) : null;
  });
}

/** Pure op: assign a registry sound to one track (immutable). */
export function setTrackSound(
  project: BeatProject,
  trackIndex: number,
  soundId: string,
  soundName?: string | null,
): BeatProject {
  if (trackIndex < 0 || trackIndex >= BEAT_TRACK_COUNT) return project;
  const trackSounds = project.trackSounds.map((s, i) =>
    i === trackIndex ? normalizeTrackSoundId(soundId, trackIndex) : s,
  );
  const trackSoundNames = project.trackSoundNames.map((n, i) =>
    i === trackIndex
      ? trackSounds[i] === defaultSoundIdForTrack(i)
        ? null
        : (soundName?.trim().slice(0, 120) || null)
      : n,
  );
  return { ...project, trackSounds, trackSoundNames };
}

export function normalizeArrangement(raw: unknown): BeatArrangementEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BeatArrangementEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const entry = e as Partial<BeatArrangementEntry>;
    if (!BEAT_PATTERN_IDS.includes(entry.patternId as BeatPatternId)) continue;
    out.push({
      patternId: entry.patternId as BeatPatternId,
      repeats: Math.round(
        clampN(entry.repeats, BEAT_ENTRY_REPEATS_MIN, BEAT_ENTRY_REPEATS_MAX, 1),
      ),
    });
    if (out.length >= BEAT_ARRANGEMENT_MAX_ENTRIES) break;
  }
  return out;
}

/** Any older/partial/garbage JSON loads as a valid project (or null when
 *  there is no object to salvage at all) so saved beats never hard-fail. */
export function normalizeBeatProject(raw: unknown): BeatProject | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BeatProject> & { patterns?: Record<string, unknown> };
  const base = defaultBeatProject();
  const patterns = {} as Record<BeatPatternId, BeatPatternData>;
  for (const id of BEAT_PATTERN_IDS) {
    patterns[id] = normalizePattern(r.patterns?.[id]);
  }
  const trackSounds = normalizeTrackSounds(
    (r as { trackSounds?: unknown }).trackSounds,
  );
  return {
    version: 2,
    patterns,
    activePattern: BEAT_PATTERN_IDS.includes(r.activePattern as BeatPatternId)
      ? (r.activePattern as BeatPatternId)
      : base.activePattern,
    bpm: Math.round(clampN(r.bpm, BEAT_BPM_MIN, BEAT_BPM_MAX, base.bpm)),
    swing: clampN(r.swing, 0, 1, 0),
    feel: normalizeBeatFeel(r.feel),
    mixer: normalizeMixer(r.mixer),
    mixerFx: normalizeBeatMixerFxState(r.mixerFx),
    arrangement: normalizeArrangement(r.arrangement),
    mode: r.mode === "song" ? "song" : "pattern",
    trackSounds,
    trackSoundNames: normalizeTrackSoundNames(
      (r as { trackSoundNames?: unknown }).trackSoundNames,
      trackSounds,
    ),
  };
}

export function serializeBeatProject(p: BeatProject): string {
  return JSON.stringify(normalizeBeatProject(p) ?? p);
}

/** Parse a stored project (JSON string or already-parsed value). Garbage
 *  in → a fresh default project out; this never throws. */
export function deserializeBeatProject(raw: unknown): BeatProject {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return defaultBeatProject();
    }
  }
  return normalizeBeatProject(value) ?? defaultBeatProject();
}

/* ─── Arrangement math (pure) ────────────────────────────────────────────
 * Patterns can differ in length, so totals/resolution take a step
 * resolver: either a uniform step count (the v1 behavior — every
 * pattern the same length) or a function giving each pattern's own
 * step count. `stepsResolverForPatterns` builds the function form
 * from a project's patterns. */

/** Uniform step count, or per-pattern step counts. */
export type BeatStepsResolver = number | ((patternId: BeatPatternId) => number);

/** Build the per-pattern resolver for a project's patterns. */
export function stepsResolverForPatterns(
  patterns: Record<BeatPatternId, BeatPatternData>,
): (patternId: BeatPatternId) => number {
  return (id) => patternStepCount(patterns[id] ?? emptyBeatPattern());
}

function stepsFor(resolver: BeatStepsResolver, patternId: BeatPatternId): number {
  const n = typeof resolver === "number" ? resolver : resolver(patternId);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : BEAT_STEPS;
}

/** Total 16th-note steps in one full pass of the arrangement. With a
 *  per-pattern resolver, each entry contributes repeats × its own
 *  pattern's step count. */
export function arrangementTotalSteps(
  arrangement: BeatArrangementEntry[],
  stepsPerPattern: BeatStepsResolver = BEAT_STEPS,
): number {
  return arrangement.reduce(
    (sum, e) => sum + Math.max(0, e.repeats) * stepsFor(stepsPerPattern, e.patternId),
    0,
  );
}

/** Total bars in one full pass (a bar is always 16 steps, whatever a
 *  pattern's length). */
export function arrangementTotalBars(
  arrangement: BeatArrangementEntry[],
  stepsPerPattern: BeatStepsResolver = BEAT_STEPS,
): number {
  return arrangementTotalSteps(arrangement, stepsPerPattern) / BEAT_STEPS;
}

/** Seconds for one full pass at a tempo (swing does not change length). */
export function arrangementDurationSec(
  arrangement: BeatArrangementEntry[],
  bpm: number,
  stepsPerPattern: BeatStepsResolver = BEAT_STEPS,
): number {
  const stepDur = 60 / Math.max(1, bpm) / 4;
  return arrangementTotalSteps(arrangement, stepsPerPattern) * stepDur;
}

export interface ArrangementPlay {
  entryIndex: number;
  patternId: BeatPatternId;
  /** 0-based repeat of the entry this play belongs to. */
  repeatIndex: number;
}

/** Flatten the chain into one pattern-play per repeat, in play order. */
export function expandArrangement(arrangement: BeatArrangementEntry[]): ArrangementPlay[] {
  const out: ArrangementPlay[] = [];
  arrangement.forEach((entry, entryIndex) => {
    for (let r = 0; r < Math.max(0, entry.repeats); r++) {
      out.push({ entryIndex, patternId: entry.patternId, repeatIndex: r });
    }
  });
  return out;
}

export interface ResolvedArrangementStep {
  entryIndex: number;
  patternId: BeatPatternId;
  repeatIndex: number;
  /** Step inside the pattern (0 … that pattern's step count − 1). */
  stepInPattern: number;
  /** Step inside the entry across its repeats. */
  stepInEntry: number;
}

/** Resolve a global step (counted from the start of the arrangement)
 *  to the entry / pattern / step that plays there. Null when the step
 *  is outside the arrangement (or the arrangement is empty). With a
 *  per-pattern resolver, entry boundaries land on each pattern's own
 *  length, so repeats of differing lengths chain correctly. */
export function resolveArrangementStep(
  globalStep: number,
  arrangement: BeatArrangementEntry[],
  stepsPerPattern: BeatStepsResolver = BEAT_STEPS,
): ResolvedArrangementStep | null {
  if (!Number.isFinite(globalStep) || globalStep < 0) return null;
  const total = arrangementTotalSteps(arrangement, stepsPerPattern);
  if (globalStep >= total) return null;
  let remaining = Math.floor(globalStep);
  for (let entryIndex = 0; entryIndex < arrangement.length; entryIndex++) {
    const entry = arrangement[entryIndex]!;
    const spp = stepsFor(stepsPerPattern, entry.patternId);
    const entrySteps = Math.max(0, entry.repeats) * spp;
    if (remaining < entrySteps) {
      return {
        entryIndex,
        patternId: entry.patternId,
        repeatIndex: Math.floor(remaining / spp),
        stepInPattern: remaining % spp,
        stepInEntry: remaining,
      };
    }
    remaining -= entrySteps;
  }
  return null;
}

/** Song mode only actually drives the transport/render when the project
 *  is in song mode AND the chain has entries — otherwise the classic
 *  pattern loop is the behavior (empty arrangement = today's behavior). */
export function isSongModeActive(p: Pick<BeatProject, "mode" | "arrangement">): boolean {
  return p.mode === "song" && p.arrangement.length > 0;
}

/** The pattern sequence a bounce renders: the expanded arrangement in
 *  song mode, or null for pattern mode (caller renders its loop count
 *  of the active pattern, exactly as before). */
export function renderPatternSequence(
  p: Pick<BeatProject, "mode" | "arrangement">,
): BeatPatternId[] | null {
  if (!isSongModeActive(p)) return null;
  return expandArrangement(p.arrangement).map((play) => play.patternId);
}

/* ─── Arrangement editing ops (pure, immutable) ────────────────────────── */

export function addArrangementEntry(
  arrangement: BeatArrangementEntry[],
  patternId: BeatPatternId,
  repeats = 1,
): BeatArrangementEntry[] {
  if (arrangement.length >= BEAT_ARRANGEMENT_MAX_ENTRIES) return arrangement;
  return [
    ...arrangement,
    {
      patternId,
      repeats: Math.round(
        clampN(repeats, BEAT_ENTRY_REPEATS_MIN, BEAT_ENTRY_REPEATS_MAX, 1),
      ),
    },
  ];
}

export function removeArrangementEntry(
  arrangement: BeatArrangementEntry[],
  index: number,
): BeatArrangementEntry[] {
  return arrangement.filter((_, i) => i !== index);
}

export function moveArrangementEntry(
  arrangement: BeatArrangementEntry[],
  from: number,
  to: number,
): BeatArrangementEntry[] {
  if (from < 0 || from >= arrangement.length) return arrangement;
  const next = [...arrangement];
  const [entry] = next.splice(from, 1);
  const clamped = Math.max(0, Math.min(next.length, to));
  next.splice(clamped, 0, entry!);
  return next;
}

export function setArrangementEntryRepeats(
  arrangement: BeatArrangementEntry[],
  index: number,
  repeats: number,
): BeatArrangementEntry[] {
  return arrangement.map((e, i) =>
    i === index
      ? {
          ...e,
          repeats: Math.round(
            clampN(repeats, BEAT_ENTRY_REPEATS_MIN, BEAT_ENTRY_REPEATS_MAX, e.repeats),
          ),
        }
      : e,
  );
}

export function setArrangementEntryPattern(
  arrangement: BeatArrangementEntry[],
  index: number,
  patternId: BeatPatternId,
): BeatArrangementEntry[] {
  return arrangement.map((e, i) => (i === index ? { ...e, patternId } : e));
}

/** Clone a pattern into the first free (empty) slot so an arrangement
 *  entry can become a variation without touching the original. Returns
 *  the next project + the new slot, or null when no slot is free (or
 *  the source is already empty). The clone is a deep copy — same data
 *  the sequencer's copy/paste clipboard carries. */
export function clonePatternVariation(
  project: BeatProject,
  sourceId: BeatPatternId,
): { project: BeatProject; patternId: BeatPatternId } | null {
  const source = project.patterns[sourceId];
  if (!source || isEmptyBeatPattern(source)) return null;
  const target = BEAT_PATTERN_IDS.find(
    (id) => id !== sourceId && isEmptyBeatPattern(project.patterns[id]),
  );
  if (!target) return null;
  return {
    patternId: target,
    project: {
      ...project,
      patterns: { ...project.patterns, [target]: cloneBeatPattern(source) },
    },
  };
}

/* ─── Persistence (house pattern: localStorage + /api/drafts) ──────────── */

export const BEAT_PROJECT_WORKFLOW = "beat-project";
export const BEAT_PROJECT_LOCAL_KEY = "bdv-beat-project-v1";

export function saveLocalBeatProject(p: BeatProject): void {
  try {
    localStorage.setItem(BEAT_PROJECT_LOCAL_KEY, serializeBeatProject(p));
  } catch {
    /* storage full/blocked — server draft still covers restore */
  }
}

export function loadLocalBeatProject(): BeatProject | null {
  try {
    const raw = localStorage.getItem(BEAT_PROJECT_LOCAL_KEY);
    if (!raw) return null;
    return normalizeBeatProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function fetchServerBeatProject(
  token: string | null,
): Promise<BeatProject | null> {
  try {
    const res = await fetch(`/api/drafts?workflow=${BEAT_PROJECT_WORKFLOW}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { drafts?: Array<{ draft_data?: unknown }> };
    const draft = data.drafts?.[0]?.draft_data;
    if (!draft || typeof draft !== "object") return null;
    return normalizeBeatProject(draft);
  } catch {
    return null;
  }
}

export async function saveServerBeatProject(
  token: string | null,
  p: BeatProject,
): Promise<void> {
  try {
    await fetch("/api/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        workflowType: BEAT_PROJECT_WORKFLOW,
        title: "Beat project",
        draftData: normalizeBeatProject(p) ?? p,
      }),
    });
  } catch {
    /* best-effort — local copy remains */
  }
}
