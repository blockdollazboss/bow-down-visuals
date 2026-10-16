/* ── MIDI synth voices (Stack 6 #7) ──────────────────────────────────────
 * A small set of bundled instruments built purely from Web Audio
 * oscillators + envelopes — synthesized voices, no samples, nothing to
 * license. The SAME voice definitions drive:
 *   • piano-roll audition (single notes, live)
 *   • the arrangement preview bounce (OfflineAudioContext → WAV)
 *   • the export bounce (same OfflineAudioContext render, uploaded as a
 *     stem and mixed by the server render)
 * so a MIDI track sounds the same in preview and in the exported mix. */

import type { MidiInstrumentId, MidiRollNote } from "@/lib/arrangement";

export function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

interface VoiceSpec {
  /** Oscillator layers: [type, detuneCents, gainScale]. */
  layers: Array<{ type: OscillatorType; detune: number; gain: number }>;
  /** Lowpass cutoff, Hz (Infinity-ish = open). */
  cutoff: number;
  attack: number;
  /** Time to decay to sustain. */
  decay: number;
  /** Sustain level 0–1 (of peak). */
  sustain: number;
  release: number;
}

const VOICES: Record<MidiInstrumentId, VoiceSpec> = {
  /* Warm electric-keys: triangle body + sine octave sheen, quick settle. */
  keys: {
    layers: [
      { type: "triangle", detune: 0, gain: 0.9 },
      { type: "sine", detune: 1200, gain: 0.25 },
    ],
    cutoff: 6000,
    attack: 0.005,
    decay: 0.35,
    sustain: 0.55,
    release: 0.25,
  },
  /* Plucked string: square bite through a closing lowpass, no sustain. */
  pluck: {
    layers: [{ type: "square", detune: 0, gain: 0.55 }],
    cutoff: 2800,
    attack: 0.002,
    decay: 0.28,
    sustain: 0.0,
    release: 0.08,
  },
  /* Round bass: saw weight tamed by a low cutoff, holds its level. */
  bass: {
    layers: [
      { type: "sawtooth", detune: 0, gain: 0.7 },
      { type: "sine", detune: -1200, gain: 0.5 },
    ],
    cutoff: 700,
    attack: 0.008,
    decay: 0.2,
    sustain: 0.8,
    release: 0.15,
  },
  /* Soft pad: two detuned triangles breathing in slowly. */
  pad: {
    layers: [
      { type: "triangle", detune: -6, gain: 0.5 },
      { type: "triangle", detune: 6, gain: 0.5 },
    ],
    cutoff: 2400,
    attack: 0.4,
    decay: 0.8,
    sustain: 0.7,
    release: 0.9,
  },
};

export function voiceSpec(instrument: MidiInstrumentId): VoiceSpec {
  return VOICES[instrument];
}

/** Schedule one note on any BaseAudioContext (live or offline). */
export function scheduleSynthNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  instrument: MidiInstrumentId,
  note: MidiRollNote,
  when: number,
): void {
  const spec = VOICES[instrument];
  const peak = Math.max(0.05, Math.min(1, note.velocity / 127)) * 0.5;
  const start = Math.max(0, when);
  const dur = Math.max(0.05, note.duration);
  const end = start + dur;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(peak, start + spec.attack);
  amp.gain.linearRampToValueAtTime(
    Math.max(0.0001, peak * spec.sustain),
    Math.min(end, start + spec.attack + spec.decay),
  );
  amp.gain.setValueAtTime(Math.max(0.0001, peak * spec.sustain), Math.max(start + spec.attack + spec.decay, end - 0.01));
  amp.gain.exponentialRampToValueAtTime(0.0001, end + spec.release);

  let head: AudioNode = amp;
  if (spec.cutoff < 20000) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = spec.cutoff;
    amp.connect(filter);
    head = filter;
  }
  head.connect(dest);

  for (const layer of spec.layers) {
    const osc = ctx.createOscillator();
    osc.type = layer.type;
    osc.frequency.value = midiToFreq(note.pitch);
    osc.detune.value = layer.detune;
    const layerGain = ctx.createGain();
    layerGain.gain.value = layer.gain;
    osc.connect(layerGain);
    layerGain.connect(amp);
    osc.start(start);
    osc.stop(end + spec.release + 0.1);
  }
}

/* ── Audition (live single notes from the piano roll) ─────────────────── */

let auditionCtx: AudioContext | null = null;

export function auditionNote(instrument: MidiInstrumentId, pitch: number, velocity = 100): void {
  try {
    if (!auditionCtx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      auditionCtx = new Ctor();
    }
    if (auditionCtx.state === "suspended") void auditionCtx.resume();
    scheduleSynthNote(
      auditionCtx,
      auditionCtx.destination,
      instrument,
      { id: "audition", pitch, start: 0, duration: 0.7, velocity },
      auditionCtx.currentTime + 0.01,
    );
  } catch {
    /* no audio available — audition is best-effort */
  }
}

/* ── Offline bounce: notes → WAV (preview stem + export stem) ─────────── */

export const BOUNCE_SAMPLE_RATE = 44100;

export async function bounceMidiNotesToWav(
  notes: MidiRollNote[],
  instrument: MidiInstrumentId,
  durationSec: number,
): Promise<Blob> {
  const length = Math.max(1, Math.ceil(durationSec));
  const ctx = new OfflineAudioContext(2, length * BOUNCE_SAMPLE_RATE, BOUNCE_SAMPLE_RATE);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  for (const note of notes) scheduleSynthNote(ctx, master, instrument, note, note.start);
  const buffer = await ctx.startRendering();
  return audioBufferToWavBlob(buffer);
}

/** Encode an AudioBuffer as a 16-bit PCM WAV blob. */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, channelData[c]![i] ?? 0));
      view.setInt16(offset, Math.round(v * 32767), true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Stable hash of a MIDI track's sound (notes + instrument) — the bounce
 *  cache key, so preview/export re-render only when the music changed. */
export function midiTrackHash(notes: MidiRollNote[], instrument: MidiInstrumentId): string {
  const body = notes
    .map((n) => `${n.pitch}:${n.start}:${n.duration}:${n.velocity}`)
    .sort()
    .join("|");
  let h = 0;
  const s = `${instrument}#${body}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${instrument}-${(h >>> 0).toString(36)}-${notes.length}`;
}
