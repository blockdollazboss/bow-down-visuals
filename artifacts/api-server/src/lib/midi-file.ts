/**
 * midi-file.ts — server-side Standard MIDI File writer + melody service.
 *
 * The writer is a port of the frontend's lib/midi-export.ts (the hum
 * flow's "Export MIDI"): same SMF format-0 container, PPQ 480, tempo
 * meta, piano program change, so a MIDI exported from a finished song
 * or stem is byte-compatible in shape with the hum exports creators
 * already download.
 *
 * The service half (buildMelodyMidi) reuses the ONE house melody
 * analysis — lib/melody-analysis.ts analyzeMelody, the same extraction
 * the hum-to-song and finish-my-song flows run — so songs and stems
 * get melody MIDI without a second, divergent transcription engine.
 * The analysis is monophonic melody (first 60 s window, per the
 * analysis module's own cap) and is surfaced as exactly that.
 */

import { analyzeMelody, type MelodyAnalysis, type MelodyNote } from "./melody-analysis";

export type { MelodyNote };

const PPQ = 480; // ticks per quarter note
const FALLBACK_BPM = 120;
const VELOCITY = 100;

/** Variable-length quantity — MIDI's delta-time encoding. */
function vlq(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function asciiBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0x7f);
  return out;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

/**
 * Build the .mid bytes for a monophonic note list at the given tempo
 * (null/implausible tempo falls back to 120 BPM). Notes are sorted by
 * start; an overlapping tail is clipped to the next note's start so
 * the single track never sounds two notes at once. Mirrors the
 * frontend writer's semantics exactly.
 */
export function buildMidiFile(
  notes: MelodyNote[],
  tempoBpm: number | null,
  title?: string,
): Buffer {
  const bpm = tempoBpm && tempoBpm >= 30 && tempoBpm <= 300 ? tempoBpm : FALLBACK_BPM;
  const microsPerQuarter = Math.round(60_000_000 / bpm);
  const toTicks = (sec: number) => Math.max(0, Math.round(sec * (bpm / 60) * PPQ));

  const sorted = [...notes]
    .filter((n) => Number.isFinite(n.midi) && n.durationSec > 0)
    .sort((a, b) => a.startSec - b.startSec);

  interface Ev {
    tick: number;
    bytes: number[];
    /** At equal ticks, note-offs (0) land before note-ons (1). */
    order: number;
  }
  const events: Ev[] = [];
  sorted.forEach((n, i) => {
    const note = Math.min(127, Math.max(0, Math.round(n.midi)));
    const onTick = toTicks(n.startSec);
    let offTick = toTicks(n.startSec + n.durationSec);
    const next = sorted[i + 1];
    if (next) offTick = Math.min(offTick, toTicks(next.startSec));
    if (offTick <= onTick) offTick = onTick + 1;
    events.push({ tick: onTick, bytes: [0x90, note, VELOCITY], order: 1 });
    events.push({ tick: offTick, bytes: [0x80, note, 0], order: 0 });
  });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  // Tempo meta event at tick 0.
  track.push(
    0x00, 0xff, 0x51, 0x03,
    (microsPerQuarter >> 16) & 0xff,
    (microsPerQuarter >> 8) & 0xff,
    microsPerQuarter & 0xff,
  );
  if (title) {
    const name = asciiBytes(title.slice(0, 60));
    track.push(0x00, 0xff, 0x03, ...vlq(name.length), ...name);
  }
  // Program change: acoustic grand piano, channel 1.
  track.push(0x00, 0xc0, 0x00);
  let lastTick = 0;
  for (const ev of events) {
    track.push(...vlq(ev.tick - lastTick), ...ev.bytes);
    lastTick = ev.tick;
  }
  // End of track.
  track.push(0x00, 0xff, 0x2f, 0x00);

  return Buffer.from([
    ...asciiBytes("MThd"), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ),
    ...asciiBytes("MTrk"), ...u32(track.length), ...track,
  ]);
}

/** Slug a title into a safe filename base ("melody" when untitled). */
export function midiFilenameBase(title: string | null | undefined): string {
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "melody";
}

/**
 * The analysis found no melody to export (silence, drums-only audio,
 * pure noise). Callers answer honestly with this — never an empty or
 * relabeled file.
 */
export class NoMelodyError extends Error {
  readonly code = "no_melody";
  constructor(message = "No clear melody could be heard in that audio — nothing to export as MIDI.") {
    super(message);
    this.name = "NoMelodyError";
  }
}

/**
 * Run the house melody analysis over an audio buffer and build the
 * exportable MIDI. Throws NoMelodyError when the analysis segments
 * zero notes; analyzeMelody's own errors (undecodable audio, too
 * short) propagate for the caller to map.
 */
export async function buildMelodyMidi(
  audio: Buffer,
  title?: string,
): Promise<{ midi: Buffer; analysis: MelodyAnalysis }> {
  const analysis = await analyzeMelody(audio);
  if (analysis.notes.length === 0) {
    throw new NoMelodyError();
  }
  return { midi: buildMidiFile(analysis.notes, analysis.tempoBpm, title), analysis };
}
