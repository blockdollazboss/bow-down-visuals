/* ── Beat Studio WebMIDI record (W3c) ───────────────────────────────────
 * Play a MIDI controller into the Step Sequencer and, while the
 * transport runs with Record armed, write what was played straight
 * into the pattern — as ordinary pattern data. A recorded hit is
 * indistinguishable from a clicked one: drums land in the grid +
 * sparse velocity map, 808 notes in the bass row + its velocity map,
 * melody in the melodic lanes — all through the SAME pure ops the
 * click editors use (setStepVelocity / setBassStepVelocity /
 * addBeatNote). No parallel format, nothing extra to persist: the
 * recorded project saves, loads, plays and exports exactly like a
 * hand-clicked one, and projects saved before this lane existed are
 * untouched by it (this module only ever ADDS hits to a pattern).
 *
 * The device seam is the house one — lib/web-midi.ts (openWebMidi /
 * webMidiSupported), the same session the Audio Studio piano roll
 * uses. This module owns only the beat-specific pure logic:
 *
 * ROUTING (which lane a note belongs to)
 *   • Channel 10 (index 9, the GM drum channel): the GM drum map
 *     below, nothing else — unmapped pitches are ignored.
 *   • Any other channel: melodic. Pitches 24–35 (C1–B1) play the
 *     808 bass row; pitches 36+ play the selected melodic voice,
 *     octave-folded into the lane's C2–C5 range (36–72).
 *   • Unknown channel (events constructed without one): the drum
 *     map wins first, then the same melodic split. (So pitch 35 is
 *     a kick with no channel, an 808 note on a melodic channel.)
 *
 * QUANTIZE (where a played note lands)
 *   • Drums + 808: the nearest whole step of the pattern being
 *     played, wrapping at the pattern's own length (1/2/4 bars).
 *   • Melody: the start snaps to the lane's half-step grid inside
 *     the bar (melody lanes are one bar and loop); the length is
 *     the held duration snapped to half steps, minimum one half
 *     step. A note held across a loop wrap keeps its full length
 *     (the lane model allows notes to run past the bar end).
 *
 * VELOCITY: a drum/808 hit stores gain = velocity ÷ 127 in the
 * pattern's sparse velocity maps (the 0.1–1.0 house range); a hit
 * played over an existing accent cell keeps the accent and updates
 * the velocity, exactly what the velocity lane editor would store.
 * Melody notes keep the raw 1–127 velocity, like clicked notes.
 *
 * Manual tool = pure UI = FREE. No charges, no provider calls, no
 * sound generation live here — data + pure functions only.
 */

import {
  BEAT_BASS_HI,
  BEAT_BASS_LO,
  BEAT_STEPS,
  BEAT_TRACK_COUNT,
  BEAT_VELOCITY_MAX,
  BEAT_VELOCITY_MIN,
  arrangementTotalSteps,
  cloneBeatPattern,
  isSongModeActive,
  patternStepCount,
  resolveArrangementStep,
  setBassStepVelocity,
  setStepVelocity,
  stepsResolverForPatterns,
  type BeatArrangementEntry,
  type BeatPatternData,
  type BeatPatternId,
  type BeatTransportMode,
} from "@/lib/beat-project";
import {
  BEAT_MELODY_HI,
  BEAT_MELODY_LO,
  BEAT_MELODY_RESOLUTION,
  BEAT_MELODY_STEPS,
  addBeatNote,
  beatMelodyUid,
  clampBeatNote,
  withBeatLane,
  type BeatMelodicVoiceId,
  type BeatMelodyNote,
} from "@/lib/beat-melody";

/* ─── Routing ──────────────────────────────────────────────────────────── */

/** 0-based index of the GM drum channel (channel 10). */
export const BEAT_MIDI_DRUM_CHANNEL = 9;

/** Track indices, aligned with TRACKS in components/audio-studio/AiAudio.tsx:
 *  0 kick · 1 snare · 2 clap · 3 closed hat · 4 open hat · 5 808 hit ·
 *  6 perc · 7 shaker · 8 crash. The 808 HIT track (5) has no GM
 *  equivalent — pitched 808 playing is the bass row (see routing). */
export const BEAT_MIDI_TRACK = {
  kick: 0,
  snare: 1,
  clap: 2,
  closedHat: 3,
  openHat: 4,
  perc: 6,
  shaker: 7,
  crash: 8,
} as const;

/** The General MIDI percussion map, house tracks only: MIDI pitch →
 *  drum track index. Every pitch not listed here is NOT a drum. */
export const BEAT_MIDI_DRUM_MAP: Readonly<Record<number, number>> = {
  35: BEAT_MIDI_TRACK.kick, // Acoustic Bass Drum
  36: BEAT_MIDI_TRACK.kick, // Bass Drum 1
  37: BEAT_MIDI_TRACK.perc, // Side Stick
  38: BEAT_MIDI_TRACK.snare, // Acoustic Snare
  39: BEAT_MIDI_TRACK.clap, // Hand Clap
  40: BEAT_MIDI_TRACK.snare, // Electric Snare
  41: BEAT_MIDI_TRACK.perc, // Low Floor Tom
  42: BEAT_MIDI_TRACK.closedHat, // Closed Hi-Hat
  43: BEAT_MIDI_TRACK.perc, // High Floor Tom
  44: BEAT_MIDI_TRACK.closedHat, // Pedal Hi-Hat
  45: BEAT_MIDI_TRACK.perc, // Low Tom
  46: BEAT_MIDI_TRACK.openHat, // Open Hi-Hat
  47: BEAT_MIDI_TRACK.perc, // Low-Mid Tom
  48: BEAT_MIDI_TRACK.perc, // Hi-Mid Tom
  49: BEAT_MIDI_TRACK.crash, // Crash Cymbal 1
  50: BEAT_MIDI_TRACK.perc, // High Tom
  51: BEAT_MIDI_TRACK.crash, // Ride Cymbal 1
  52: BEAT_MIDI_TRACK.crash, // Chinese Cymbal
  53: BEAT_MIDI_TRACK.perc, // Ride Bell
  54: BEAT_MIDI_TRACK.shaker, // Tambourine
  55: BEAT_MIDI_TRACK.crash, // Splash Cymbal
  56: BEAT_MIDI_TRACK.perc, // Cowbell
  57: BEAT_MIDI_TRACK.crash, // Crash Cymbal 2
  58: BEAT_MIDI_TRACK.shaker, // Vibraslap
  59: BEAT_MIDI_TRACK.crash, // Ride Cymbal 2
  60: BEAT_MIDI_TRACK.perc, // Hi Bongo
  61: BEAT_MIDI_TRACK.perc, // Low Bongo
  62: BEAT_MIDI_TRACK.perc, // Mute Hi Conga
  63: BEAT_MIDI_TRACK.perc, // Open Hi Conga
  64: BEAT_MIDI_TRACK.perc, // Low Conga
  65: BEAT_MIDI_TRACK.perc, // High Timbale
  66: BEAT_MIDI_TRACK.perc, // Low Timbale
  67: BEAT_MIDI_TRACK.perc, // High Agogo
  68: BEAT_MIDI_TRACK.perc, // Low Agogo
  69: BEAT_MIDI_TRACK.shaker, // Cabasa
  70: BEAT_MIDI_TRACK.shaker, // Maracas
  73: BEAT_MIDI_TRACK.shaker, // Short Guiro
  74: BEAT_MIDI_TRACK.shaker, // Long Guiro
  75: BEAT_MIDI_TRACK.perc, // Claves
  76: BEAT_MIDI_TRACK.perc, // Hi Wood Block
  77: BEAT_MIDI_TRACK.perc, // Low Wood Block
  78: BEAT_MIDI_TRACK.perc, // Mute Cuica
  79: BEAT_MIDI_TRACK.perc, // Open Cuica
  80: BEAT_MIDI_TRACK.closedHat, // Mute Triangle
  81: BEAT_MIDI_TRACK.openHat, // Open Triangle
  82: BEAT_MIDI_TRACK.shaker, // Shaker
};

/** Where one incoming note belongs. `pitch` on bass/melody targets is
 *  the pitch that will sound (melody pitches are folded into range). */
export type BeatMidiTarget =
  | { kind: "drum"; track: number }
  | { kind: "bass"; pitch: number }
  | { kind: "melody"; voice: BeatMelodicVoiceId; pitch: number };

/** Fold a pitch into the melodic lane's range (C2–C5) by octaves. */
export function foldBeatMelodyPitch(pitch: number): number {
  let p = Math.round(pitch);
  while (p > BEAT_MELODY_HI) p -= 12;
  while (p < BEAT_MELODY_LO) p += 12;
  return p;
}

/** Route one note. `channel` is 0-based (9 = drum channel) or
 *  undefined when the event source carries no channel. Returns null
 *  for notes with no home (e.g. unmapped pitches on the drum
 *  channel, or pitches below the 808 row on a melodic channel). */
export function routeBeatMidiNote(
  pitch: number,
  channel: number | undefined,
  voice: BeatMelodicVoiceId,
): BeatMidiTarget | null {
  if (!Number.isFinite(pitch)) return null;
  const p = Math.round(pitch);
  if (p < 0 || p > 127) return null;
  const drumTrack = BEAT_MIDI_DRUM_MAP[p];
  if (channel === BEAT_MIDI_DRUM_CHANNEL) {
    return drumTrack != null ? { kind: "drum", track: drumTrack } : null;
  }
  if (channel == null && drumTrack != null) {
    return { kind: "drum", track: drumTrack };
  }
  if (p >= BEAT_BASS_LO && p < BEAT_MELODY_LO) return { kind: "bass", pitch: p };
  if (p >= BEAT_MELODY_LO) return { kind: "melody", voice, pitch: foldBeatMelodyPitch(p) };
  return null;
}

/* ─── Velocity + quantize ──────────────────────────────────────────────── */

/** MIDI velocity (1–127) → the pattern velocity maps' gain space
 *  (0.1–1.0, the house clamp in lib/beat-project). */
export function midiVelocityToStepGain(velocity127: number): number {
  const v = Number.isFinite(velocity127) ? Math.round(velocity127) : 100;
  const gain = Math.min(127, Math.max(1, v)) / 127;
  return Math.min(BEAT_VELOCITY_MAX, Math.max(BEAT_VELOCITY_MIN, gain));
}

/** The nearest whole step for a fractional position inside a pattern,
 *  wrapped into the pattern's own length. */
export function quantizeBeatStep(stepFloat: number, patternSteps: number): number {
  const n =
    Number.isFinite(patternSteps) && patternSteps > 0
      ? Math.floor(patternSteps)
      : BEAT_STEPS;
  if (!Number.isFinite(stepFloat)) return 0;
  const r = Math.round(stepFloat);
  return ((r % n) + n) % n;
}

/** The nearest half-step start inside the melody bar (lanes are one
 *  bar and loop; a start snapped onto the bar line wraps to 0). */
export function quantizeMelodyStartStep(stepFloat: number): number {
  if (!Number.isFinite(stepFloat)) return 0;
  const inBar =
    ((stepFloat % BEAT_MELODY_STEPS) + BEAT_MELODY_STEPS) % BEAT_MELODY_STEPS;
  const snapped =
    Math.round(inBar / BEAT_MELODY_RESOLUTION) * BEAT_MELODY_RESOLUTION;
  return snapped >= BEAT_MELODY_STEPS ? 0 : snapped;
}

/** Held duration in steps, snapped to the half-step grid with the
 *  lane's half-step minimum. A note held across the pattern loop
 *  (end before start on the local clock) unwraps by the pattern's
 *  length, so long holds keep their length (capped by the lane
 *  model's own 64-step clamp when the note is built). */
export function recordedMelodyLengthSteps(
  startFloat: number,
  endFloat: number,
  patternSteps: number,
): number {
  const span =
    Number.isFinite(patternSteps) && patternSteps > 0
      ? patternSteps
      : BEAT_MELODY_STEPS;
  let delta = endFloat - startFloat;
  let guard = 0;
  while (delta <= 0 && guard++ < 8) delta += span;
  const snapped =
    Math.round(delta / BEAT_MELODY_RESOLUTION) * BEAT_MELODY_RESOLUTION;
  return Math.min(64, Math.max(BEAT_MELODY_RESOLUTION, snapped));
}

/* ─── Transport position ─────────────────────────────────────────────────
 * The live scheduler (components/audio-studio/AiAudio.tsx) holds `nextStep` — the next
 * global step it will schedule — and the audio time it sounds at.
 * A MIDI event stamped on the same audio clock resolves to a
 * fractional global step by linear interpolation; from there the
 * position inside the pattern being played resolves with the same
 * arrangement math the scheduler itself uses. */

/** Fractional global step at audio time `atTime`, given that global
 *  step `nextStep` sounds at `nextStepTime`. */
export function transportStepFloat(args: {
  nextStep: number;
  nextStepTime: number;
  atTime: number;
  stepDurSec: number;
}): number {
  if (!(args.stepDurSec > 0) || !Number.isFinite(args.atTime)) return args.nextStep;
  return args.nextStep + (args.atTime - args.nextStepTime) / args.stepDurSec;
}

/** A position inside the pattern the transport is playing. */
export interface BeatMidiPosition {
  patternId: BeatPatternId;
  /** Fractional step inside that pattern (0 … its step count). */
  stepFloat: number;
  /** The pattern's own step count (16/32/64). */
  patternSteps: number;
}

/** Resolve a fractional global step to the pattern position the
 *  transport is playing there — pattern mode loops the active
 *  pattern at its own length; song mode resolves through the chain
 *  (each pattern at its own length), mirroring scheduleStep. Null
 *  before the transport starts (count-in: negative steps) or when a
 *  song position falls outside the chain. */
export function beatMidiPositionAt(args: {
  globalStepFloat: number;
  mode: BeatTransportMode;
  activePattern: BeatPatternId;
  patterns: Record<BeatPatternId, BeatPatternData>;
  arrangement: BeatArrangementEntry[];
}): BeatMidiPosition | null {
  const g = args.globalStepFloat;
  if (!Number.isFinite(g) || g < 0) return null;
  const resolver = stepsResolverForPatterns(args.patterns);
  if (isSongModeActive({ mode: args.mode, arrangement: args.arrangement })) {
    const total = arrangementTotalSteps(args.arrangement, resolver);
    if (total <= 0) return null;
    const wrapped = ((g % total) + total) % total;
    const resolved = resolveArrangementStep(Math.floor(wrapped), args.arrangement, resolver);
    if (!resolved) return null;
    const pat = args.patterns[resolved.patternId];
    if (!pat) return null;
    return {
      patternId: resolved.patternId,
      stepFloat: resolved.stepInPattern + (wrapped - Math.floor(wrapped)),
      patternSteps: patternStepCount(pat),
    };
  }
  const pat = args.patterns[args.activePattern];
  if (!pat) return null;
  const steps = patternStepCount(pat);
  return {
    patternId: args.activePattern,
    stepFloat: ((g % steps) + steps) % steps,
    patternSteps: steps,
  };
}

/* ─── Pattern writes (pure — the click editors' own ops) ──────────────── */

/** Record a drum hit: set the cell (an existing accent survives) and
 *  store the played velocity in the sparse velocity map — the exact
 *  shape the grid + velocity lane editors produce. */
export function applyRecordedDrumHit(
  pattern: BeatPatternData,
  track: number,
  step: number,
  velocity127: number,
): BeatPatternData {
  if (track < 0 || track >= BEAT_TRACK_COUNT) return pattern;
  if (step < 0 || step >= patternStepCount(pattern)) return pattern;
  const next = cloneBeatPattern(pattern);
  if ((next.grid[track]![step] ?? 0) === 0) next.grid[track]![step] = 1;
  return setStepVelocity(next, track, step, midiVelocityToStepGain(velocity127));
}

/** Record an 808 note: the bass row is monophonic per step, so the
 *  latest note played on a step wins — same as clicking the row. */
export function applyRecordedBassNote(
  pattern: BeatPatternData,
  step: number,
  pitch: number,
  velocity127: number,
): BeatPatternData {
  if (step < 0 || step >= patternStepCount(pattern)) return pattern;
  const next = cloneBeatPattern(pattern);
  next.bass[step] = Math.min(BEAT_BASS_HI, Math.max(BEAT_BASS_LO, Math.round(pitch)));
  return setBassStepVelocity(next, step, midiVelocityToStepGain(velocity127));
}

/** Add a finished recorded melody note to a pattern's lane, through
 *  the lane's own add (sort + clamp) — identical to a placed note. */
export function applyRecordedMelodyNote(
  pattern: BeatPatternData,
  voice: BeatMelodicVoiceId,
  note: BeatMelodyNote,
): BeatPatternData {
  const next = cloneBeatPattern(pattern);
  next.melody = withBeatLane(next.melody, voice, addBeatNote(next.melody[voice], note));
  return next;
}

/* ─── Recorder ───────────────────────────────────────────────────────────
 * The streaming half: note-ons for drums/808 resolve immediately to
 * a pattern write PLAN (the caller applies it inside its state
 * updater, against the freshest pattern — two fast hits can never
 * clobber each other through a stale snapshot). Melody notes pair
 * on/off across the stream: the recorder holds the open notes and
 * emits a finished BeatMelodyNote on note-off, or on flush() when
 * the transport stops / record disarms mid-hold. */

export interface BeatMidiRecordPlan {
  patternId: BeatPatternId;
  /** The quantized step the hit landed on. */
  step: number;
  apply: (pattern: BeatPatternData) => BeatPatternData;
}

export interface BeatMidiNoteOnOutcome {
  /** Routing for live monitoring (null = no home for this note). */
  target: BeatMidiTarget | null;
  /** The pattern write for drum/808 hits; null for melody (lands on
   *  note-off) and for anything played while not recording. */
  recorded: BeatMidiRecordPlan | null;
}

export interface BeatMidiRecordedMelody {
  patternId: BeatPatternId;
  voice: BeatMelodicVoiceId;
  note: BeatMelodyNote;
}

interface BeatMidiOpenNote {
  voice: BeatMelodicVoiceId;
  pitch: number;
  patternId: BeatPatternId;
  startFloat: number;
  startPatternSteps: number;
  velocity: number;
}

export class BeatMidiRecorder {
  private open = new Map<string, BeatMidiOpenNote>();

  private key(voice: BeatMelodicVoiceId, pitch: number): string {
    return `${voice}:${pitch}`;
  }

  /** Melody notes currently held open (for stop/disarm flushing). */
  get openCount(): number {
    return this.open.size;
  }

  /** Forget every open note without emitting (a fresh take). */
  reset(): void {
    this.open.clear();
  }

  noteOn(input: {
    pitch: number;
    velocity: number;
    channel?: number;
    voice: BeatMelodicVoiceId;
    /** Where the transport is; null = not recording (monitor only). */
    position: BeatMidiPosition | null;
  }): BeatMidiNoteOnOutcome {
    const target = routeBeatMidiNote(input.pitch, input.channel, input.voice);
    if (!target) return { target: null, recorded: null };
    const pos = input.position;
    if (!pos) return { target, recorded: null };
    if (target.kind === "drum") {
      const step = quantizeBeatStep(pos.stepFloat, pos.patternSteps);
      const track = target.track;
      const velocity = input.velocity;
      return {
        target,
        recorded: {
          patternId: pos.patternId,
          step,
          apply: (pattern) => applyRecordedDrumHit(pattern, track, step, velocity),
        },
      };
    }
    if (target.kind === "bass") {
      const step = quantizeBeatStep(pos.stepFloat, pos.patternSteps);
      const pitch = target.pitch;
      const velocity = input.velocity;
      return {
        target,
        recorded: {
          patternId: pos.patternId,
          step,
          apply: (pattern) => applyRecordedBassNote(pattern, step, pitch, velocity),
        },
      };
    }
    /* Melody: open the note — a retrigger of a held pitch restarts
     * its start, like every other recorder. */
    this.open.set(this.key(target.voice, target.pitch), {
      voice: target.voice,
      pitch: target.pitch,
      patternId: pos.patternId,
      startFloat: pos.stepFloat,
      startPatternSteps: pos.patternSteps,
      velocity: Math.min(127, Math.max(1, Math.round(input.velocity) || 100)),
    });
    return { target, recorded: null };
  }

  noteOff(input: {
    pitch: number;
    channel?: number;
    voice: BeatMelodicVoiceId;
    position: BeatMidiPosition | null;
  }): BeatMidiRecordedMelody | null {
    const target = routeBeatMidiNote(input.pitch, input.channel, input.voice);
    if (!target || target.kind !== "melody") return null;
    const key = this.key(target.voice, target.pitch);
    const openNote = this.open.get(key);
    if (!openNote) return null;
    this.open.delete(key);
    if (!input.position) return null;
    return this.closeNote(openNote, input.position);
  }

  /** Close every held note at `position` (transport stop / disarm). */
  flush(position: BeatMidiPosition): BeatMidiRecordedMelody[] {
    const out: BeatMidiRecordedMelody[] = [];
    for (const openNote of this.open.values()) {
      out.push(this.closeNote(openNote, position));
    }
    this.open.clear();
    return out;
  }

  private closeNote(
    openNote: BeatMidiOpenNote,
    endPos: BeatMidiPosition,
  ): BeatMidiRecordedMelody {
    /* A note held across a pattern switch (song mode) measures its
     * length to the end of its own pattern plus the position reached
     * in the new one — an approximation, stated honestly: the note
     * still lands whole in the pattern where it started. */
    const endFloat =
      endPos.patternId === openNote.patternId
        ? endPos.stepFloat
        : openNote.startPatternSteps + endPos.stepFloat;
    const note = clampBeatNote({
      id: beatMelodyUid(),
      pitch: openNote.pitch,
      startStep: quantizeMelodyStartStep(openNote.startFloat),
      lengthSteps: recordedMelodyLengthSteps(
        openNote.startFloat,
        endFloat,
        openNote.startPatternSteps,
      ),
      velocity: openNote.velocity,
    });
    return { patternId: openNote.patternId, voice: openNote.voice, note };
  }
}
