/* ── Beat Maker Preset Registry ──────────────────────────────────────────
   The Beat Maker's starting patterns + the AI Beat genre list — the ONE
   home for this data, consumed by components/audio-studio/AiAudio.tsx
   (the Beat Maker / audio-studio module).

   Extracted verbatim from the AiAudio page file (Stack 100 item A11),
   where
   the 5 patterns and the genre list lived inline in the ~5,000-line page
   file, unreachable as data by anything else (the Beat Studio desks, the
   World, a future preset shelf). The extraction changed NO value: every
   grid cell, bass note, melody note, bpm, nameKey and fallback below is
   byte-for-byte the data the page shipped with — pinned note-for-note by
   src/lib/beat-presets.test.ts against a fixture captured from the
   originals before the move.

   A preset is a 1-bar starting pattern for the step sequencer: loading
   one copies its grid/bass/melody into the active pattern slot and sets
   the bpm. Picking a preset is a local edit only — it never charges
   anything (the AI beat generation rail keeps its own price and its own
   submit; the sequencer itself is free, 100% client-side synthesis).

   NOTE — two genre lists exist on purpose: BEAT_GENRES below is the AI
   Beat Maker's generation list. The World BeatsDesk marketplace filter
   (lib/world/money-desks-2.ts) carries its own listing taxonomy; the two
   differ (dancehall/jersey-club here vs rock/latin there) and were NOT
   merged — merging would change what either surface offers.

   Grid values: 0 = off, 1 = hit, 2 = accent.
   Rows: kick,snare,clap,chat,ohat,808,perc,shk,crash.
   Bass: MIDI notes per step (null = rest). */

import type { BeatMelodyLanes } from "./beat-melody";

/** The AI Beat Maker's genre list, in picker order. */
export const BEAT_GENRES = [
  "hip-hop", "trap", "drill", "r&b", "afrobeats", "pop",
  "edm", "lofi", "dancehall", "jersey-club"
] as const;

export type BeatGenre = (typeof BEAT_GENRES)[number];

/** One 1-bar starting pattern for the step sequencer. */
export interface BeatPreset {
  /** Locale key for the preset's picker label. */
  nameKey: string;
  /** English label shown when the locale key is missing. */
  fallback: string;
  /** Starting tempo the sequencer adopts when the preset loads. */
  bpm: number;
  /** 9 drum rows × 16 steps (0 = off, 1 = hit, 2 = accent). */
  grid: number[][];
  /** 808 bass line: one MIDI note (or null rest) per step. */
  bass: (number | null)[];
  /** Optional melodic seed in the roll's step shape. */
  melody?: BeatMelodyLanes;
}

export type BeatPresetId = "trap" | "drill" | "boombap" | "afrobeats" | "house";

/** The starting patterns, in picker order. */
export const BEAT_PRESETS: Record<BeatPresetId, BeatPreset> = {
  trap: {
    nameKey: "beatMaker.presetTrap", fallback: "Trap", bpm: 140,
    grid: [
      [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0],
      [1,0,2,1,0,1,0,1,1,0,1,2,0,1,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0],
      [0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0],
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,null,null,36,null,null,null,34,null,32,null,31,null],
    /* Simple melodic seed in the same step shape the roll edits. */
    melody: {
      keys: [
        { id: "seed-trap-keys-1", pitch: 60, startStep: 0, lengthSteps: 2, velocity: 90 },
        { id: "seed-trap-keys-2", pitch: 63, startStep: 4, lengthSteps: 2, velocity: 85 },
        { id: "seed-trap-keys-3", pitch: 65, startStep: 8, lengthSteps: 2, velocity: 90 },
        { id: "seed-trap-keys-4", pitch: 63, startStep: 12, lengthSteps: 2, velocity: 80 },
      ],
      pluck: [
        { id: "seed-trap-pluck-1", pitch: 72, startStep: 2, lengthSteps: 0.5, velocity: 80 },
        { id: "seed-trap-pluck-2", pitch: 72, startStep: 6, lengthSteps: 0.5, velocity: 80 },
        { id: "seed-trap-pluck-3", pitch: 70, startStep: 10, lengthSteps: 0.5, velocity: 75 },
        { id: "seed-trap-pluck-4", pitch: 72, startStep: 14, lengthSteps: 0.5, velocity: 80 },
      ],
      pad: [],
    },
  },
  drill: {
    nameKey: "beatMaker.presetDrill", fallback: "Drill", bpm: 142,
    grid: [
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,2],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0],
      [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [33,null,null,33,null,null,33,null,31,null,null,29,null,null,null,null],
  },
  boombap: {
    nameKey: "beatMaker.presetBoomBap", fallback: "Boom Bap", bpm: 92,
    grid: [
      [2,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,2,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,1,0,1,0,1,0,1,0,1,0,1,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,null,null,null,null,43,null,null,null,41,null,null,null],
    melody: {
      keys: [
        { id: "seed-boombap-keys-1", pitch: 69, startStep: 0, lengthSteps: 1, velocity: 85 },
        { id: "seed-boombap-keys-2", pitch: 67, startStep: 4, lengthSteps: 1, velocity: 80 },
        { id: "seed-boombap-keys-3", pitch: 65, startStep: 10, lengthSteps: 1, velocity: 80 },
      ],
      pluck: [],
      pad: [
        { id: "seed-boombap-pad-1", pitch: 57, startStep: 0, lengthSteps: 8, velocity: 70 },
        { id: "seed-boombap-pad-2", pitch: 53, startStep: 8, lengthSteps: 8, velocity: 70 },
      ],
    },
  },
  afrobeats: {
    nameKey: "beatMaker.presetAfrobeats", fallback: "Afrobeats", bpm: 102,
    grid: [
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0],
      [1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0],
      [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,36,null,null,null,34,null,null,null,32,null,null,null],
  },
  house: {
    nameKey: "beatMaker.presetHouse", fallback: "House", bpm: 124,
    grid: [
      [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,36,null,null,null,36,null,null,null,39,null,38,null],
  },
};

/** Preset ids in picker order. */
export const BEAT_PRESET_IDS = Object.keys(BEAT_PRESETS) as BeatPresetId[];

/** Look a preset up by id; undefined for an unknown id (the caller no-ops,
 *  exactly as the page's inline lookup did). */
export function beatPresetById(id: string): BeatPreset | undefined {
  return (BEAT_PRESETS as Record<string, BeatPreset>)[id];
}
