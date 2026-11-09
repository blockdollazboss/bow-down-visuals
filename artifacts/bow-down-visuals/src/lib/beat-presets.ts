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

export type BeatPresetId =
  | "trap" | "drill" | "boombap" | "afrobeats" | "house"
  | "rnb" | "jersey-club" | "lofi"
  | "pop" | "edm" | "dancehall"
  | "amapiano" | "phonk";

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
  /* ── Stack 200 upgrade wave (Lane U2): the three BEAT_GENRES that
     shipped with no starting pattern — r&b, jersey-club and lofi were
     pickable AI genres with nothing to load in the sequencer. Each
     pattern below is written in this registry's own format (9 rows ×
     16 steps, bass in the C1..B2 808 range, melody seeds in the
     roll's step shape). Picking one is still a free local edit. ── */
  rnb: {
    nameKey: "beatMaker.presetRnB", fallback: "R&B", bpm: 92,
    /* Slow and swung: off-grid closed hats, an accented backbeat, a
       kick that leans late (steps 7 and 10), chord stabs in the keys
       lane over a warm pad — the slow-jam starting point. */
    grid: [
      [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,1,1,0,1,1,0,1,0,1,1,0,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
      [0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [29,null,null,null,null,null,null,null,32,null,null,null,27,null,null,null],
    melody: {
      keys: [
        { id: "seed-rnb-keys-1", pitch: 65, startStep: 0, lengthSteps: 1, velocity: 80 },
        { id: "seed-rnb-keys-2", pitch: 68, startStep: 4, lengthSteps: 1, velocity: 75 },
        { id: "seed-rnb-keys-3", pitch: 72, startStep: 8, lengthSteps: 1, velocity: 80 },
        { id: "seed-rnb-keys-4", pitch: 67, startStep: 12, lengthSteps: 1, velocity: 75 },
      ],
      pluck: [],
      pad: [
        { id: "seed-rnb-pad-1", pitch: 53, startStep: 0, lengthSteps: 8, velocity: 60 },
        { id: "seed-rnb-pad-2", pitch: 51, startStep: 8, lengthSteps: 8, velocity: 60 },
      ],
    },
  },
  "jersey-club": {
    nameKey: "beatMaker.presetJerseyClub", fallback: "Jersey Club", bpm: 140,
    /* Kick-driven: the kick pulses every three steps (the dotted
       triplet bounce the genre rides), claps stack on the backbeat,
       closed hats run near-16ths and the perc ticks mark the
       off-beats. No melody seed — the pattern is the instrument. */
    grid: [
      [2,0,0,2,0,0,2,0,2,0,0,2,0,0,2,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
      [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      [0,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [31,null,null,31,null,null,31,null,31,null,null,31,null,null,31,null],
  },
  lofi: {
    nameKey: "beatMaker.presetLofi", fallback: "Lo-Fi", bpm: 82,
    /* Dusty and low: lazy kick placement, a ghost snare sneaking in
       on step 15, dense swung closed hats, no crash (dust, not
       sparkle) and a jazzy minor-7th keys seed over a soft pad. */
    grid: [
      [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0],
      [0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,0],
      [0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,null,null,null,null,34,null,null,39,null,null,null,null],
    melody: {
      keys: [
        { id: "seed-lofi-keys-1", pitch: 60, startStep: 0, lengthSteps: 2, velocity: 70 },
        { id: "seed-lofi-keys-2", pitch: 63, startStep: 3, lengthSteps: 1, velocity: 65 },
        { id: "seed-lofi-keys-3", pitch: 58, startStep: 8, lengthSteps: 2, velocity: 68 },
      ],
      pluck: [],
      pad: [
        { id: "seed-lofi-pad-1", pitch: 48, startStep: 0, lengthSteps: 8, velocity: 55 },
        { id: "seed-lofi-pad-2", pitch: 46, startStep: 8, lengthSteps: 8, velocity: 55 },
      ],
    },
  },
  /* ── Stack 300 upgrade wave: the last three BEAT_GENRES with no
     starting pattern — pop, edm and dancehall were pickable AI genres
     with nothing to load in the sequencer, the same gap Stack 200
     closed for r&b/jersey-club/lofi. Each pattern is written in this
     registry's own format (9 rows × 16 steps, bass in the C1..B2 808
     range, melody seeds in the roll's step shape). Picking one is
     still a free local edit. ── */
  pop: {
    nameKey: "beatMaker.presetPop", fallback: "Pop", bpm: 112,
    /* Bright and tidy: four-on-the-floor-light kick with a step-14
       lift, snare/clap stacked on the backbeat, near-16th closed
       hats, major-key chord stabs and a bright pluck hook seed. */
    grid: [
      [2,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0],
      [0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [41,null,null,null,41,null,null,null,36,null,null,null,38,null,34,null],
    melody: {
      keys: [
        { id: "seed-pop-keys-1", pitch: 65, startStep: 0, lengthSteps: 1, velocity: 95 },
        { id: "seed-pop-keys-2", pitch: 69, startStep: 4, lengthSteps: 1, velocity: 90 },
        { id: "seed-pop-keys-3", pitch: 72, startStep: 8, lengthSteps: 1, velocity: 95 },
        { id: "seed-pop-keys-4", pitch: 69, startStep: 12, lengthSteps: 1, velocity: 90 },
      ],
      pluck: [
        { id: "seed-pop-pluck-1", pitch: 77, startStep: 2, lengthSteps: 0.5, velocity: 85 },
        { id: "seed-pop-pluck-2", pitch: 76, startStep: 6, lengthSteps: 0.5, velocity: 80 },
        { id: "seed-pop-pluck-3", pitch: 77, startStep: 10, lengthSteps: 0.5, velocity: 85 },
        { id: "seed-pop-pluck-4", pitch: 81, startStep: 14, lengthSteps: 0.5, velocity: 85 },
      ],
      pad: [],
    },
  },
  edm: {
    nameKey: "beatMaker.presetEdm", fallback: "EDM", bpm: 128,
    /* Festival drive: accented four-floor kick, clap riding the
       backbeat, open hats on the offbeats, a crash on step 0 and a
       two-tick perc build into the next bar; supersaw-style key
       stabs over a wide sustained pad. House does NOT cover this —
       house grooves, this drives. */
    grid: [
      [2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],
      [0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1],
      [0,0,2,0,0,0,2,0,0,0,2,0,0,0,2,0],
      [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1],
      [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
      [2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,36,null,36,null,36,null,36,null,36,null,39,null,38,null],
    melody: {
      keys: [
        { id: "seed-edm-keys-1", pitch: 60, startStep: 0, lengthSteps: 1, velocity: 100 },
        { id: "seed-edm-keys-2", pitch: 63, startStep: 4, lengthSteps: 1, velocity: 95 },
        { id: "seed-edm-keys-3", pitch: 60, startStep: 8, lengthSteps: 1, velocity: 100 },
        { id: "seed-edm-keys-4", pitch: 58, startStep: 12, lengthSteps: 1, velocity: 95 },
      ],
      pluck: [],
      pad: [
        { id: "seed-edm-pad-1", pitch: 48, startStep: 0, lengthSteps: 8, velocity: 70 },
        { id: "seed-edm-pad-2", pitch: 46, startStep: 8, lengthSteps: 8, velocity: 70 },
      ],
    },
  },
  dancehall: {
    nameKey: "beatMaker.presetDancehall", fallback: "Dancehall", bpm: 102,
    /* The genre's signature 3+3+2 kick pulse runs in both halves of
       the bar against a plain backbeat clap, a sparse snare, and a
       shaker driving the 16ths. No melody seed — jersey-club
       precedent: the pattern is the instrument. Afrobeats, at the
       same tempo, runs a different four-beat kick — this is not a
       re-skin of it. */
    grid: [
      [2,0,0,1,0,0,1,0,2,0,0,1,0,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
      [1,0,0,1,0,0,1,0,1,0,0,1,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
      [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      [0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0],
      [2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,36,null,null,43,null,36,null,null,36,null,41,null,null],
  },
  /* ── Stack 400 upgrade wave (shelf-song-beats lane): two shelves
     the census called for that were never AI genres here — like
     boombap and house, these live as sequencer patterns in their
     own right. Amapiano is the log drum's home shelf (the afrobeats
     pattern carries log drums as an ingredient; this one is built
     around them, piano-led). Phonk is the cowbell's. Each pattern
     is written in this registry's own format (9 rows × 16 steps,
     bass in the C1..B2 808 range, melody seeds in the roll's step
     shape). Picking one is still a free local edit. ── */
  amapiano: {
    nameKey: "beatMaker.presetAmapiano", fallback: "Amapiano", bpm: 112,
    /* The log drum IS the bass line: it bounces off the beat
       (steps 3, 6, 11, 14) around a soft four-floor kick while the
       shaker runs the full 16th grid underneath. Piano-led: jazzy
       chord stabs in the keys lane over a soft pad. */
    grid: [
      [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0],
      [0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0],
      [2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,36,null,null,39,null,36,null,null,41,null,null,39,null],
    melody: {
      keys: [
        { id: "seed-amapiano-keys-1", pitch: 60, startStep: 0, lengthSteps: 2, velocity: 85 },
        { id: "seed-amapiano-keys-2", pitch: 65, startStep: 4, lengthSteps: 2, velocity: 80 },
        { id: "seed-amapiano-keys-3", pitch: 63, startStep: 8, lengthSteps: 2, velocity: 85 },
        { id: "seed-amapiano-keys-4", pitch: 67, startStep: 12, lengthSteps: 2, velocity: 80 },
      ],
      pluck: [],
      pad: [
        { id: "seed-amapiano-pad-1", pitch: 48, startStep: 0, lengthSteps: 8, velocity: 55 },
        { id: "seed-amapiano-pad-2", pitch: 46, startStep: 8, lengthSteps: 8, velocity: 55 },
      ],
    },
  },
  phonk: {
    nameKey: "beatMaker.presetPhonk", fallback: "Phonk", bpm: 138,
    /* Cowbell-led: the Memphis cowbell riff rides the keys lane as
       a repeating motif with a two-note turnaround, over a hard
       kick, an accented backbeat and rolling hats. The bass sits
       low and descends — phonk lives in the basement, not the
       bounce. No pad and no shaker: drift, kept dry. */
    grid: [
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      [0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
      [1,0,1,1,0,1,0,1,1,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      [0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [29,null,null,29,null,null,null,null,27,null,null,27,null,null,25,null],
    melody: {
      keys: [
        { id: "seed-phonk-keys-1", pitch: 77, startStep: 0, lengthSteps: 0.5, velocity: 100 },
        { id: "seed-phonk-keys-2", pitch: 77, startStep: 2, lengthSteps: 0.5, velocity: 95 },
        { id: "seed-phonk-keys-3", pitch: 80, startStep: 4, lengthSteps: 0.5, velocity: 100 },
        { id: "seed-phonk-keys-4", pitch: 77, startStep: 6, lengthSteps: 0.5, velocity: 95 },
        { id: "seed-phonk-keys-5", pitch: 75, startStep: 8, lengthSteps: 0.5, velocity: 95 },
        { id: "seed-phonk-keys-6", pitch: 77, startStep: 10, lengthSteps: 0.5, velocity: 100 },
        { id: "seed-phonk-keys-7", pitch: 80, startStep: 12, lengthSteps: 0.5, velocity: 95 },
        { id: "seed-phonk-keys-8", pitch: 82, startStep: 14, lengthSteps: 0.5, velocity: 100 },
      ],
      pluck: [],
      pad: [],
    },
  },
};

/** Preset ids in picker order. */
export const BEAT_PRESET_IDS = Object.keys(BEAT_PRESETS) as BeatPresetId[];

/** Look a preset up by id; undefined for an unknown id (the caller no-ops,
 *  exactly as the page's inline lookup did). */
export function beatPresetById(id: string): BeatPreset | undefined {
  return (BEAT_PRESETS as Record<string, BeatPreset>)[id];
}
