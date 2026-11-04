/* Beat MP3 encoding — the REAL encoder runs in these tests (no mock):
 * a synthetic in-memory source (the AudioBuffer shape) is encoded with
 * @breezystack/lamejs and the output is checked at the byte level —
 * MP3 frame sync, MPEG audio/mpeg type, sane size. Plus the page/lib
 * source pins that keep the encoder lazy: the page never names the
 * encoder package (so nothing can statically pull it into the main
 * bundle), and the only import of it in the codebase is the dynamic
 * import() inside lib/beat-mp3. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  audioBufferToMp3,
  floatTo16BitPcm,
  BEAT_MP3_KBPS,
  type BeatMp3Source,
} from "@/lib/beat-mp3";

/** A stereo sine-burst source with the AudioBuffer shape. */
function fakeSource(seconds: number, channels = 2, sampleRate = 44100): BeatMp3Source {
  const length = Math.floor(seconds * sampleRate);
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      ch[i] = 0.5 * Math.sin((2 * Math.PI * (220 + c * 110) * i) / sampleRate);
    }
    data.push(ch);
  }
  return {
    numberOfChannels: channels,
    sampleRate,
    length,
    getChannelData: (c: number) => data[c]!,
  };
}

async function firstBytes(blob: Blob, n: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer()).subarray(0, n);
}

/** MPEG audio frame sync: 0xFF followed by a byte whose top 3 bits
 *  are set. LAME writes no ID3 tag here, so the stream starts with a
 *  frame. */
function startsWithFrameSync(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

describe("floatTo16BitPcm", () => {
  it("clamps and scales exactly like the WAV encoder (0x7fff up, 0x8000 down)", () => {
    const out = floatTo16BitPcm(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 16383, -16384, 32767, -32768]);
  });
});

describe("audioBufferToMp3 (real LAME encode)", () => {
  it("encodes a stereo render to an audio/mpeg blob starting with an MP3 frame", async () => {
    const blob = await audioBufferToMp3(fakeSource(0.5));
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBeGreaterThan(1000);
    expect(startsWithFrameSync(await firstBytes(blob, 2))).toBe(true);
  });

  it("defaults to 192 kbps CBR — a second of stereo lands near 24 KB", async () => {
    expect(BEAT_MP3_KBPS).toBe(192);
    const blob = await audioBufferToMp3(fakeSource(1));
    // 192 kbps = 24,000 bytes/sec of frames, plus a small Xing/LAME
    // header frame. A wide band keeps the test honest without being
    // brittle across encoder micro-versions.
    expect(blob.size).toBeGreaterThan(20_000);
    expect(blob.size).toBeLessThan(30_000);
  });

  it("honors an explicit lower bit rate (smaller output)", async () => {
    const hi = await audioBufferToMp3(fakeSource(1), 192);
    const lo = await audioBufferToMp3(fakeSource(1), 64);
    expect(lo.size).toBeLessThan(hi.size);
    expect(startsWithFrameSync(await firstBytes(lo, 2))).toBe(true);
  });

  it("encodes a mono source as a valid MP3 too", async () => {
    const blob = await audioBufferToMp3(fakeSource(0.5, 1));
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBeGreaterThan(500);
    expect(startsWithFrameSync(await firstBytes(blob, 2))).toBe(true);
  });

  it("encodes a sub-frame-length buffer (shorter than 1152 samples) without throwing", async () => {
    const blob = await audioBufferToMp3(fakeSource(100 / 44100));
    expect(blob.type).toBe("audio/mpeg");
    expect(startsWithFrameSync(await firstBytes(blob, 2))).toBe(true);
  });

  it("caps a >2-channel source at the first two channels, like the WAV encoder", async () => {
    const blob = await audioBufferToMp3(fakeSource(0.25, 4));
    expect(blob.type).toBe("audio/mpeg");
    expect(startsWithFrameSync(await firstBytes(blob, 2))).toBe(true);
  });
});

describe("lazy-encoder source pins", () => {
  const page = readFileSync(
    path.resolve(import.meta.dirname, "../components/audio-studio/AiAudio.tsx"),
    "utf8",
  );
  const lib = readFileSync(
    path.resolve(import.meta.dirname, "./beat-mp3.ts"),
    "utf8",
  );

  it("the page goes through lib/beat-mp3 and never imports the encoder package", () => {
    expect(page).toContain('from "@/lib/beat-mp3"');
    // The package specifier must not appear in the page at all — the
    // only "lamejs" string allowed there is the license-file URL in
    // the attribution link, which imports nothing.
    expect(page).not.toContain("@breezystack/lamejs");
    expect(page).not.toMatch(/import\s*[({][^)]*lamejs/);
  });

  it("the encoder package is pulled in by dynamic import() only — no static import anywhere in the lib", () => {
    expect(lib).toContain('await import("@breezystack/lamejs")');
    expect(lib).not.toMatch(/import\s*\{[^}]*\}\s*from\s*"@breezystack\/lamejs"/);
  });

  it("the page branches the single render on format (wav default, mp3 on request)", () => {
    expect(page).toContain('format === "mp3" ? await audioBufferToMp3(rendered) : audioBufferToWav(rendered)');
  });
});
