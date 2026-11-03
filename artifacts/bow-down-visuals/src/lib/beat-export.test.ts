/* W2-L3 — beat export pack tests: stem enumeration, render-scope
 * equality (mix vs every stem), solo-isolation mixer math, file
 * naming, and ZIP assembly (bytes/entries) via the repo's store-only
 * ZIP writer. The page render itself needs a real OfflineAudioContext
 * and is not exercised here — scope + gain equality are the provable
 * pure forms of "the stems add up to the mix" (the drum synths use
 * random noise bursts, so sample-exact summation across renders is
 * impossible by design). */
import { describe, it, expect } from "vitest";
import {
  assembleStemsZip,
  beatRenderScope,
  effectiveBassGain,
  effectiveDrumGain,
  enumerateBeatStems,
  isolateStemMixer,
  renderScopesEqual,
  sanitizeFilePart,
  stemFileName,
  stemMixersSumToMix,
  stemRenderScopes,
  stemsZipFileName,
} from "@/lib/beat-export";
import { crc32 } from "@/lib/sfx";
import { defaultBeatMixer, type BeatMixerState } from "@/lib/beat-project";

/* The render's own track enumeration, in page order (TRACKS in
 * pages/ai-audio.tsx) — the page passes this same list at runtime. */
const DRUM_IDS = ["kick", "snare", "clap", "chat", "ohat", "b808", "perc", "shk", "crash"];

describe("stem enumeration", () => {
  it("covers the 9 drum tracks in render order + the 808 bass line", () => {
    const stems = enumerateBeatStems(DRUM_IDS);
    expect(stems).toHaveLength(10);
    expect(stems.slice(0, 9).map((s) => s.id)).toEqual(DRUM_IDS);
    expect(stems.slice(0, 9).map((s) => s.trackIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stems.every((s, i) => (i < 9 ? s.kind === "drum" : s.kind === "bass"))).toBe(true);
    expect(stems[9]).toMatchObject({ id: "bassline", kind: "bass", trackIndex: null, fileSlug: "808-bass" });
  });

  it("the b808 drum hit and the bass line are distinct stems with distinct file slugs", () => {
    const stems = enumerateBeatStems(DRUM_IDS);
    const hit = stems.find((s) => s.id === "b808")!;
    const bass = stems.find((s) => s.id === "bassline")!;
    expect(hit.fileSlug).toBe("808-hit");
    expect(hit.fileSlug).not.toBe(bass.fileSlug);
  });

  it("accepts track objects (the page's TRACKS shape) as well as ids", () => {
    const stems = enumerateBeatStems(DRUM_IDS.map((id) => ({ id })));
    expect(stems.map((s) => s.id)).toEqual([...DRUM_IDS, "bassline"]);
  });

  it("melodic lanes join by enumeration later — appended, existing stems untouched", () => {
    const base = enumerateBeatStems(DRUM_IDS);
    const withMelody = enumerateBeatStems(DRUM_IDS, [{ id: "keys-main", label: "Keys" }]);
    expect(withMelody).toHaveLength(11);
    expect(withMelody.slice(0, 10)).toEqual(base);
    expect(withMelody[10]).toMatchObject({ id: "keys-main", kind: "melody", fileSlug: "keys-main" });
    // The current render has no rail for a melodic stem yet.
    expect(isolateStemMixer(defaultBeatMixer(), withMelody[10]!)).toBeNull();
  });
});

describe("render scope — mix and stems share one scope", () => {
  it("pattern mode: the active pattern ×4 loop, 64 steps + tail", () => {
    const scope = beatRenderScope({ mode: "pattern", arrangement: [], activePattern: "B", bpm: 120 });
    expect(scope.plays).toEqual(["B", "B", "B", "B"]);
    expect(scope.totalSteps).toBe(64);
    expect(scope.song).toBe(false);
    expect(scope.durationSec).toBeCloseTo(64 * (60 / 120 / 4) + 1.2, 9);
  });

  it("song mode: the whole arrangement chain, in order, once", () => {
    const scope = beatRenderScope({
      mode: "song",
      arrangement: [
        { patternId: "A", repeats: 2 },
        { patternId: "C", repeats: 1 },
        { patternId: "A", repeats: 3 },
      ],
      activePattern: "B",
      bpm: 140,
    });
    expect(scope.plays).toEqual(["A", "A", "C", "A", "A", "A"]);
    expect(scope.totalSteps).toBe(6 * 16);
    expect(scope.song).toBe(true);
  });

  it("song mode with an empty chain falls back to the pattern loop", () => {
    const scope = beatRenderScope({ mode: "song", arrangement: [], activePattern: "A", bpm: 140 });
    expect(scope.song).toBe(false);
    expect(scope.plays).toEqual(["A", "A", "A", "A"]);
  });

  it("every stem's scope is identical to the mix scope (steps, plays, duration)", () => {
    const input = {
      mode: "song" as const,
      arrangement: [
        { patternId: "D", repeats: 2 },
        { patternId: "A", repeats: 1 },
      ],
      activePattern: "A" as const,
      bpm: 97,
    };
    const mix = beatRenderScope(input);
    const perStem = stemRenderScopes(input, enumerateBeatStems(DRUM_IDS));
    expect(perStem).toHaveLength(10);
    for (const { scope } of perStem) {
      expect(renderScopesEqual(scope, mix)).toBe(true);
      expect(scope.totalSteps).toBe(mix.totalSteps);
      expect(scope.durationSec).toBe(mix.durationSec);
    }
  });
});

describe("solo isolation", () => {
  function mixerWith(patch: Partial<BeatMixerState>): BeatMixerState {
    return { ...defaultBeatMixer(), ...patch };
  }

  it("a drum stem keeps only its own effective gain; bass is zeroed", () => {
    const mixer = mixerWith({ vol: [1, 0.8, 0.6, 1, 1, 1, 1, 1, 1] });
    const stems = enumerateBeatStems(DRUM_IDS);
    const snare = isolateStemMixer(mixer, stems[1]!)!;
    expect(snare.vol).toEqual([0, 0.8, 0, 0, 0, 0, 0, 0, 0]);
    expect(snare.bassVol).toBe(0);
    expect(snare.mute.every((m) => !m)).toBe(true);
    expect(snare.solo.every((s) => !s)).toBe(true);
  });

  it("the bass stem keeps only the bass gain; drums are zeroed", () => {
    const mixer = mixerWith({ bassVol: 0.7 });
    const bass = enumerateBeatStems(DRUM_IDS)[9]!;
    const iso = isolateStemMixer(mixer, bass)!;
    expect(iso.vol.every((v) => v === 0)).toBe(true);
    expect(iso.bassVol).toBe(0.7);
  });

  it("a track muted in the mix contributes a silent stem", () => {
    const mixer = mixerWith({ mute: [true, false, false, false, false, false, false, false, false] });
    expect(effectiveDrumGain(mixer, 0)).toBe(0);
    const kick = isolateStemMixer(mixer, enumerateBeatStems(DRUM_IDS)[0]!)!;
    expect(kick.vol[0]).toBe(0);
  });

  it("solo in the mix gates non-solo stems to silence — exactly like the mix", () => {
    const mixer = mixerWith({ solo: [false, false, true, false, false, false, false, false, false] });
    expect(effectiveDrumGain(mixer, 0)).toBe(0); // kick not solo → silent in mix
    expect(effectiveDrumGain(mixer, 2)).toBe(1); // clap solo → sounds
    const stems = enumerateBeatStems(DRUM_IDS);
    expect(isolateStemMixer(mixer, stems[0]!)!.vol[0]).toBe(0);
    expect(isolateStemMixer(mixer, stems[2]!)!.vol[2]).toBe(1);
  });

  it("bass mute silences the bass stem; bass ignores solo (the mix graph's own rule)", () => {
    expect(effectiveBassGain(mixerWith({ bassMute: true }))).toBe(0);
    const soloMixer = mixerWith({ solo: [true, false, false, false, false, false, false, false, false] });
    expect(effectiveBassGain(soloMixer)).toBe(0.9);
  });

  it("the isolated stem gains sum back to the mix gains on every rail", () => {
    const cases: BeatMixerState[] = [
      defaultBeatMixer(),
      mixerWith({ vol: [1.2, 0.5, 0, 1, 1, 0.3, 1, 1, 1], mute: [false, false, true, false, false, false, false, false, false], bassVol: 1.1 }),
      mixerWith({ solo: [false, true, false, false, true, false, false, false, false], bassMute: true }),
      mixerWith({ mute: [true, true, true, true, true, true, true, true, true], bassMute: true }),
    ];
    const stems = enumerateBeatStems(DRUM_IDS);
    for (const mixer of cases) expect(stemMixersSumToMix(mixer, stems)).toBe(true);
  });
});

describe("file naming", () => {
  it("stems are <title>-<bpm>bpm-<track>.wav and the ZIP is <title>-<bpm>bpm-stems.zip", () => {
    const stems = enumerateBeatStems(DRUM_IDS);
    expect(stemFileName("beat", 140, stems[0]!)).toBe("beat-140bpm-kick.wav");
    expect(stemFileName("beat", 140, stems[5]!)).toBe("beat-140bpm-808-hit.wav");
    expect(stemFileName("beat", 140, stems[9]!)).toBe("beat-140bpm-808-bass.wav");
    expect(stemsZipFileName("beat", 140)).toBe("beat-140bpm-stems.zip");
  });

  it("titles are slugified so names are always safe file names", () => {
    expect(sanitizeFilePart("My Beat!! Vol. 2")).toBe("my-beat-vol-2");
    expect(sanitizeFilePart("")).toBe("beat");
    expect(stemFileName("My Beat", 97.6, enumerateBeatStems(DRUM_IDS)[1]!)).toBe("my-beat-98bpm-snare.wav");
  });
});

/* Minimal central-directory reader for the assembly test — reads the
 * ZIP the way an unzipper would, from the end-of-central-directory. */
function readCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: { name: string; size: number; crc: number; localOffset: number }[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, size, crc, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractStored(bytes: Uint8Array, localOffset: number, size: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLen + extraLen;
  return bytes.subarray(start, start + size);
}

describe("ZIP assembly", () => {
  it("packs every stem file as a stored entry an unzipper can read back byte-exact", () => {
    const stems = enumerateBeatStems(DRUM_IDS);
    const files = stems.map((stem, i) => ({
      name: stemFileName("beat", 140, stem),
      // Deterministic stand-in bytes (a real bounce's WAV bytes).
      data: new Uint8Array(100 + i * 17).map((_, j) => (j * 31 + i) & 0xff),
    }));
    const zip = assembleStemsZip(files);
    expect(zip.subarray(0, 2)).toEqual(new Uint8Array([0x50, 0x4b])); // "PK"
    const entries = readCentralDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((entry, i) => {
      expect(entry.size).toBe(files[i]!.data.length);
      expect(entry.crc).toBe(crc32(files[i]!.data));
      expect(extractStored(zip, entry.localOffset, entry.size)).toEqual(files[i]!.data);
    });
  });

  it("an empty file list still produces a valid empty ZIP", () => {
    const zip = assembleStemsZip([]);
    expect(readCentralDirectory(zip)).toEqual([]);
    expect(zip.length).toBe(22);
  });
});
