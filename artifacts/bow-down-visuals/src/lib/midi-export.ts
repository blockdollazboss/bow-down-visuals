/**
 * midi-export.ts — minimal Standard MIDI File writer (format 0, one
 * track, no dependency). Encodes a monophonic note list — e.g. the hum
 * melody analysis — into a real .mid the user can drop into any music
 * app. SMF is a small byte format: an MThd header, then one MTrk of
 * delta-timed events (tempo meta, note on/off, end of track).
 */

export interface MidiNote {
  /** MIDI note number (69 = A4 440 Hz). */
  midi: number;
  /** Seconds from the start of the piece. */
  startSec: number;
  /** Note length in seconds. */
  durationSec: number;
}

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
 * the single track never sounds two notes at once.
 */
export function buildMidiFile(
  notes: MidiNote[],
  tempoBpm: number | null,
  title?: string,
): Uint8Array<ArrayBuffer> {
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

  return new Uint8Array([
    ...asciiBytes("MThd"), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ),
    ...asciiBytes("MTrk"), ...u32(track.length), ...track,
  ]);
}

/* ── Polyphonic piano-roll export (Stack 6 #7) ───────────────────────────
 * The roll is polyphonic with per-note velocity, which the monophonic
 * hum-analysis writer above deliberately clips away. This writer keeps
 * overlaps and velocities: same SMF format-0 container, one event per
 * note on/off, offs before ons at equal ticks. */

export interface PolyMidiNote extends MidiNote {
  /** 0–127 (falls back to the house default when absent). */
  velocity?: number;
}

export function buildMidiFilePolyphonic(
  notes: PolyMidiNote[],
  tempoBpm: number | null,
  title?: string,
): Uint8Array<ArrayBuffer> {
  const bpm = tempoBpm && tempoBpm >= 30 && tempoBpm <= 300 ? tempoBpm : FALLBACK_BPM;
  const microsPerQuarter = Math.round(60_000_000 / bpm);
  const toTicks = (sec: number) => Math.max(0, Math.round(sec * (bpm / 60) * PPQ));

  interface Ev {
    tick: number;
    bytes: number[];
    order: number;
  }
  const events: Ev[] = [];
  for (const n of notes) {
    if (!Number.isFinite(n.midi) || n.durationSec <= 0) continue;
    const note = Math.min(127, Math.max(0, Math.round(n.midi)));
    const vel = Math.min(127, Math.max(1, Math.round(n.velocity ?? VELOCITY)));
    const onTick = toTicks(n.startSec);
    const offTick = Math.max(onTick + 1, toTicks(n.startSec + n.durationSec));
    events.push({ tick: onTick, bytes: [0x90, note, vel], order: 1 });
    events.push({ tick: offTick, bytes: [0x80, note, 0], order: 0 });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
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
  track.push(0x00, 0xc0, 0x00);
  let lastTick = 0;
  for (const ev of events) {
    track.push(...vlq(ev.tick - lastTick), ...ev.bytes);
    lastTick = ev.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  return new Uint8Array([
    ...asciiBytes("MThd"), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ),
    ...asciiBytes("MTrk"), ...u32(track.length), ...track,
  ]);
}

/** Download a piano-roll track as .mid (free — the user's own notes). */
export function downloadMidiPolyphonic(
  notes: PolyMidiNote[],
  tempoBpm: number | null,
  title?: string,
): void {
  const bytes = buildMidiFilePolyphonic(notes, tempoBpm, title);
  const blob = new Blob([bytes as BlobPart], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${midiFilenameBase(title)}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Slug a user title into a safe filename base ("hum" when untitled). */
export function midiFilenameBase(title: string | null | undefined): string {
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "hum";
}

/**
 * Build the .mid and trigger the browser download as "<title>.mid"
 * (or "hum.mid"). Free — it is the user's own analysis data, the same
 * as downloading a finished song file.
 */
export function downloadMidi(
  notes: MidiNote[],
  tempoBpm: number | null,
  title?: string,
): void {
  const bytes = buildMidiFile(notes, tempoBpm, title);
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${midiFilenameBase(title)}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
