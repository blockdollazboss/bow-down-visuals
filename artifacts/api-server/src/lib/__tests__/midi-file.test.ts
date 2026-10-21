/**
 * midi-file.test.ts — the server-side SMF writer + melody service
 * behind song/stem MIDI export.
 *
 * The writer is a port of the frontend hum writer (lib/midi-export.ts
 * in the web app): these tests pin the SMF structure so server exports
 * stay real, parseable Standard MIDI Files. The service tests run the
 * REAL house analysis (lib/melody-analysis, ffmpeg) over synthesized
 * WAV fixtures: a three-note sine melody must produce notes and MIDI
 * bytes; silence must produce the honest NoMelodyError, never a file.
 */
import { describe, it, expect } from "vitest";
import { buildMidiFile, buildMelodyMidi, midiFilenameBase, NoMelodyError } from "../midi-file";

/* ── WAV fixture: mono 16-bit PCM at 16 kHz ─────────────────────────── */
function wavBuffer(segments: Array<{ freq: number; seconds: number }>, sampleRate = 16_000): Buffer {
  const totalSamples = segments.reduce((n, s) => n + Math.round(s.seconds * sampleRate), 0);
  const data = Buffer.alloc(totalSamples * 2);
  let offset = 0;
  for (const seg of segments) {
    const count = Math.round(seg.seconds * sampleRate);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const v = seg.freq > 0 ? Math.sin(2 * Math.PI * seg.freq * t) * 0.5 : 0;
      data.writeInt16LE(Math.round(v * 32767), offset * 2);
      offset++;
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A4 – rest – C5 – rest – E5: a plainly segmentable melody. */
const MELODY_WAV = wavBuffer([
  { freq: 440, seconds: 0.7 },
  { freq: 0, seconds: 0.2 },
  { freq: 523.25, seconds: 0.7 },
  { freq: 0, seconds: 0.2 },
  { freq: 659.25, seconds: 0.8 },
]);
const SILENCE_WAV = wavBuffer([{ freq: 0, seconds: 2.5 }]);

describe("buildMidiFile — SMF structure", () => {
  const midi = buildMidiFile(
    [
      { midi: 69, startSec: 0, durationSec: 0.5 },
      { midi: 72, startSec: 0.5, durationSec: 0.5 },
    ],
    120,
    "Test Song",
  );

  it("writes an MThd header: format 0, one track, PPQ 480", () => {
    expect(midi.subarray(0, 4).toString("ascii")).toBe("MThd");
    expect(midi.readUInt32BE(4)).toBe(6);
    expect(midi.readUInt16BE(8)).toBe(0); // format 0
    expect(midi.readUInt16BE(10)).toBe(1); // one track
    expect(midi.readUInt16BE(12)).toBe(480); // PPQ
  });

  it("writes one MTrk with a tempo meta and an end-of-track meta", () => {
    expect(midi.subarray(14, 18).toString("ascii")).toBe("MTrk");
    // Tempo meta (FF 51 03) at 120 BPM = 500000 µs per quarter.
    const tempoAt = midi.indexOf(Buffer.from([0xff, 0x51, 0x03]));
    expect(tempoAt).toBeGreaterThan(0);
    expect(midi.readUIntBE(tempoAt + 3, 3)).toBe(500_000);
    // End of track is the final event.
    expect([...midi.subarray(midi.length - 4)]).toEqual([0x00, 0xff, 0x2f, 0x00]);
  });

  it("encodes note on/off for every note at velocity 100", () => {
    expect(midi.includes(Buffer.from([0x90, 69, 100]))).toBe(true);
    expect(midi.includes(Buffer.from([0x90, 72, 100]))).toBe(true);
    expect(midi.includes(Buffer.from([0x80, 69, 0]))).toBe(true);
    expect(midi.includes(Buffer.from([0x80, 72, 0]))).toBe(true);
  });

  it("an empty note list still yields a structurally valid file with no notes", () => {
    const empty = buildMidiFile([], 120);
    expect(empty.subarray(0, 4).toString("ascii")).toBe("MThd");
    expect(empty.includes(0x90)).toBe(false);
  });
});

describe("midiFilenameBase", () => {
  it("slugs titles and falls back to 'melody'", () => {
    expect(midiFilenameBase("My Song! (Live)")).toBe("my-song-live");
    expect(midiFilenameBase("")).toBe("melody");
    expect(midiFilenameBase(null)).toBe("melody");
    expect(midiFilenameBase(undefined)).toBe("melody");
  });
});

describe("buildMelodyMidi — real analysis over fixtures", () => {
  it("finds the melody in a melodic song and returns real MIDI bytes", async () => {
    const { midi, analysis } = await buildMelodyMidi(MELODY_WAV, "Fixture Song");
    expect(analysis.notes.length).toBeGreaterThanOrEqual(3);
    const midis = analysis.notes.map((n) => n.midi);
    // A4 / C5 / E5, allowing the tracker's ±1 semitone at edges.
    expect(midis.some((m) => Math.abs(m - 69) <= 1)).toBe(true);
    expect(midis.some((m) => Math.abs(m - 72) <= 1)).toBe(true);
    expect(midis.some((m) => Math.abs(m - 76) <= 1)).toBe(true);
    expect(midi.subarray(0, 4).toString("ascii")).toBe("MThd");
    expect(midi.includes(0x90)).toBe(true); // at least one note-on event
  }, 30_000);

  it("silence is an honest NoMelodyError — never an empty file", async () => {
    await expect(buildMelodyMidi(SILENCE_WAV, "Silent Song")).rejects.toBeInstanceOf(NoMelodyError);
    await expect(buildMelodyMidi(SILENCE_WAV)).rejects.toMatchObject({ code: "no_melody" });
  }, 30_000);
});
