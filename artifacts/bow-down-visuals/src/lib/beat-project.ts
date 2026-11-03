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
 * W2-L2 (additive): each drum track carries a sound assignment —
 * `trackSounds[trackIndex]` is a sound-registry id (lib/beat-sounds.ts)
 * and `trackSoundNames[trackIndex]` its display name at assignment time
 * (so an upload whose bytes live only in this session can still be named
 * honestly after a reload, when playback falls back to the synth voice).
 * Older projects without these fields normalize to the built-in synth
 * voices — exactly the sounds they always played.
 */

import { defaultSoundIdForTrack, normalizeTrackSoundId } from "@/lib/beat-sounds";

export type BeatPatternId = "A" | "B" | "C" | "D";
export const BEAT_PATTERN_IDS: BeatPatternId[] = ["A", "B", "C", "D"];

export const BEAT_STEPS = 16;
/** Drum tracks per pattern — matches TRACKS in pages/ai-audio.tsx. */
export const BEAT_TRACK_COUNT = 9;
/** 808 bass range: C1 (24) .. B2 (47) — same range as the piano roll. */
export const BEAT_BASS_LO = 24;
export const BEAT_BASS_HI = 47;

export const BEAT_BPM_MIN = 60;
export const BEAT_BPM_MAX = 200;
export const BEAT_ENTRY_REPEATS_MIN = 1;
export const BEAT_ENTRY_REPEATS_MAX = 32;
export const BEAT_ARRANGEMENT_MAX_ENTRIES = 64;

export interface BeatPatternData {
  /** [track][step] — 0 = off, 1 = hit, 2 = accent. */
  grid: number[][];
  /** MIDI note per step, null = rest. */
  bass: (number | null)[];
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
  version: 1;
  patterns: Record<BeatPatternId, BeatPatternData>;
  activePattern: BeatPatternId;
  bpm: number;
  /** 0–1 (the UI shows it as a percentage). */
  swing: number;
  mixer: BeatMixerState;
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

export function emptyBeatGrid(): number[][] {
  return Array.from({ length: BEAT_TRACK_COUNT }, () => Array(BEAT_STEPS).fill(0));
}

export function emptyBeatBass(): (number | null)[] {
  return Array(BEAT_STEPS).fill(null);
}

export function emptyBeatPattern(): BeatPatternData {
  return { grid: emptyBeatGrid(), bass: emptyBeatBass() };
}

export function cloneBeatPattern(p: BeatPatternData): BeatPatternData {
  return { grid: p.grid.map((r) => [...r]), bass: [...p.bass] };
}

/** True when a pattern holds no hits and no bass notes (a free slot). */
export function isEmptyBeatPattern(p: BeatPatternData): boolean {
  return (
    p.grid.every((row) => row.every((v) => v === 0)) &&
    p.bass.every((n) => n == null)
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
    version: 1,
    patterns: {
      A: seed ? cloneBeatPattern(seed) : emptyBeatPattern(),
      B: emptyBeatPattern(),
      C: emptyBeatPattern(),
      D: emptyBeatPattern(),
    },
    activePattern: "A",
    bpm: 140,
    swing: 0,
    mixer: defaultBeatMixer(),
    arrangement: [],
    mode: "pattern",
    trackSounds: defaultTrackSounds(),
    trackSoundNames: defaultTrackSoundNames(),
  };
}

/* ─── Defensive normalization / (de)serialization ──────────────────────── */

const clampN = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function normalizeGrid(raw: unknown): number[][] {
  const rows = Array.isArray(raw) ? raw : [];
  return Array.from({ length: BEAT_TRACK_COUNT }, (_, ti) => {
    const row = Array.isArray(rows[ti]) ? (rows[ti] as unknown[]) : [];
    return Array.from({ length: BEAT_STEPS }, (_, s) => {
      const v = row[s];
      return v === 2 ? 2 : v === 1 ? 1 : 0;
    });
  });
}

function normalizeBass(raw: unknown): (number | null)[] {
  const notes = Array.isArray(raw) ? raw : [];
  return Array.from({ length: BEAT_STEPS }, (_, s) => {
    const v = notes[s];
    return typeof v === "number" && Number.isFinite(v)
      ? Math.min(BEAT_BASS_HI, Math.max(BEAT_BASS_LO, Math.round(v)))
      : null;
  });
}

function normalizePattern(raw: unknown): BeatPatternData {
  if (!raw || typeof raw !== "object") return emptyBeatPattern();
  const r = raw as Partial<BeatPatternData>;
  return { grid: normalizeGrid(r.grid), bass: normalizeBass(r.bass) };
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
    version: 1,
    patterns,
    activePattern: BEAT_PATTERN_IDS.includes(r.activePattern as BeatPatternId)
      ? (r.activePattern as BeatPatternId)
      : base.activePattern,
    bpm: Math.round(clampN(r.bpm, BEAT_BPM_MIN, BEAT_BPM_MAX, base.bpm)),
    swing: clampN(r.swing, 0, 1, 0),
    mixer: normalizeMixer(r.mixer),
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

/* ─── Arrangement math (pure) ──────────────────────────────────────────── */

/** Total 16th-note steps in one full pass of the arrangement. */
export function arrangementTotalSteps(
  arrangement: BeatArrangementEntry[],
  stepsPerPattern: number = BEAT_STEPS,
): number {
  return (
    arrangement.reduce((sum, e) => sum + Math.max(0, e.repeats), 0) * stepsPerPattern
  );
}

/** Total bars (one pattern = one bar of 16 steps) in one full pass. */
export function arrangementTotalBars(arrangement: BeatArrangementEntry[]): number {
  return arrangementTotalSteps(arrangement) / BEAT_STEPS;
}

/** Seconds for one full pass at a tempo (swing does not change length). */
export function arrangementDurationSec(
  arrangement: BeatArrangementEntry[],
  bpm: number,
): number {
  const stepDur = 60 / Math.max(1, bpm) / 4;
  return arrangementTotalSteps(arrangement) * stepDur;
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
  /** Step inside the pattern (0 … stepsPerPattern-1). */
  stepInPattern: number;
  /** Step inside the entry across its repeats. */
  stepInEntry: number;
}

/** Resolve a global step (counted from the start of the arrangement)
 *  to the entry / pattern / step that plays there. Null when the step
 *  is outside the arrangement (or the arrangement is empty). */
export function resolveArrangementStep(
  globalStep: number,
  arrangement: BeatArrangementEntry[],
  stepsPerPattern: number = BEAT_STEPS,
): ResolvedArrangementStep | null {
  if (!Number.isFinite(globalStep) || globalStep < 0) return null;
  const total = arrangementTotalSteps(arrangement, stepsPerPattern);
  if (globalStep >= total) return null;
  let remaining = Math.floor(globalStep);
  for (let entryIndex = 0; entryIndex < arrangement.length; entryIndex++) {
    const entry = arrangement[entryIndex]!;
    const entrySteps = Math.max(0, entry.repeats) * stepsPerPattern;
    if (remaining < entrySteps) {
      return {
        entryIndex,
        patternId: entry.patternId,
        repeatIndex: Math.floor(remaining / stepsPerPattern),
        stepInPattern: remaining % stepsPerPattern,
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
