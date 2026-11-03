/* W2-L2 — sound registry tests: built-in synth voices, manifest
 * registration (the future bank seam), resolution + honest fallback,
 * session sample buffers, and upload registration. No audio files are
 * involved — buffers are stand-ins, exactly like the registry treats
 * them (opaque AudioBuffer values). */
import { describe, it, expect, beforeEach } from "vitest";
import {
  BEAT_TRACK_KINDS,
  BUILTIN_BEAT_SOUNDS,
  clearRegisteredBeatSounds,
  createUploadSoundId,
  defaultSoundIdForKind,
  defaultSoundIdForTrack,
  ensureBeatSampleBuffer,
  getBeatSound,
  getSampleBuffer,
  hasBankSounds,
  isKnownBeatSoundId,
  isUnavailableSampleAssignment,
  kindForTrack,
  listBeatSounds,
  listBeatSoundsByKind,
  listBeatSoundsBySource,
  normalizeTrackSoundId,
  playSampleBuffer,
  registerBeatSoundManifest,
  registerUploadSound,
  resolveTrackSound,
  setSampleBuffer,
  unregisterBeatSound,
  type BeatSoundEntry,
} from "@/lib/beat-sounds";

const fakeBuffer = (tag: string) => ({ __tag: tag }) as unknown as AudioBuffer;

beforeEach(() => {
  clearRegisteredBeatSounds();
});

describe("built-in synth voices", () => {
  it("registers exactly the nine sequencer voices, by synth key", () => {
    expect(BUILTIN_BEAT_SOUNDS).toHaveLength(9);
    expect(BUILTIN_BEAT_SOUNDS.map((s) => s.kind)).toEqual([...BEAT_TRACK_KINDS]);
    for (const s of BUILTIN_BEAT_SOUNDS) {
      expect(s.source).toBe("synth");
      expect(s.synthKey).toBe(s.kind);
      expect(s.id).toBe(`synth:${s.kind}`);
      expect(s.defaultVolume).toBe(1);
      expect(s.url).toBeUndefined();
    }
    expect(listBeatSounds()).toHaveLength(9);
    expect(listBeatSoundsBySource("synth")).toHaveLength(9);
    expect(listBeatSoundsBySource("bank")).toEqual([]);
    expect(hasBankSounds()).toBe(false);
  });

  it("defaults resolve per track index and per kind", () => {
    expect(defaultSoundIdForTrack(0)).toBe("synth:kick");
    expect(defaultSoundIdForTrack(5)).toBe("synth:b808");
    expect(defaultSoundIdForTrack(99)).toBe("synth:crash"); // clamped
    expect(defaultSoundIdForTrack(-3)).toBe("synth:kick");
    expect(defaultSoundIdForKind("snare")).toBe("synth:snare");
    expect(kindForTrack(3)).toBe("chat");
  });

  it("list by kind returns the built-in for that kind", () => {
    expect(listBeatSoundsByKind("kick").map((s) => s.id)).toEqual(["synth:kick"]);
    expect(listBeatSoundsByKind("crash").map((s) => s.id)).toEqual(["synth:crash"]);
  });
});

describe("manifest registration (the future bank seam)", () => {
  const bankManifest = [
    { id: "bank:royal-kick-1", name: "Royal Kick 1", kind: "kick", source: "bank", url: "https://cdn.example/bank/kick1.wav" },
    { id: "bank:royal-snare-1", name: "Royal Snare 1", kind: "snare", source: "bank", url: "https://cdn.example/bank/snare1.wav", defaultVolume: 0.8 },
  ];

  it("registers bank entries with no consumer code changes", () => {
    expect(registerBeatSoundManifest(bankManifest)).toBe(2);
    expect(hasBankSounds()).toBe(true);
    expect(listBeatSoundsByKind("kick").map((s) => s.id)).toEqual(["synth:kick", "bank:royal-kick-1"]);
    expect(getBeatSound("bank:royal-snare-1")?.defaultVolume).toBe(0.8);
    expect(getBeatSound("bank:royal-kick-1")?.defaultVolume).toBe(1); // defaulted
    expect(isKnownBeatSoundId("bank:royal-kick-1")).toBe(true);
  });

  it("re-registering an id replaces it; unregister removes it", () => {
    registerBeatSoundManifest(bankManifest);
    registerBeatSoundManifest([{ ...bankManifest[0], name: "Royal Kick One" }]);
    expect(listBeatSoundsByKind("kick")).toHaveLength(2);
    expect(getBeatSound("bank:royal-kick-1")?.name).toBe("Royal Kick One");
    expect(unregisterBeatSound("bank:royal-kick-1")).toBe(true);
    expect(getBeatSound("bank:royal-kick-1")).toBeNull();
  });

  it("rejects garbage, synth minting/shadowing, and URL-less bank entries", () => {
    const accepted = registerBeatSoundManifest([
      null, 42, "x", {},
      { id: "bank:no-url", name: "No URL", kind: "kick", source: "bank" },
      { id: "bank:bad-kind", name: "Bad", kind: "tom", source: "bank", url: "https://x/y.wav" },
      { id: "synth:kick", name: "Shadow", kind: "kick", source: "bank", url: "https://x/y.wav" },
      { id: "bank:forged-synth", name: "Forged", kind: "kick", source: "synth", synthKey: "kick" },
      { id: "", name: "Empty id", kind: "kick", source: "bank", url: "https://x/y.wav" },
    ]);
    expect(accepted).toBe(0);
    expect(listBeatSounds()).toHaveLength(9);
    expect(getBeatSound("synth:kick")?.name).toBe("Kick"); // unshadowed
  });

  it("clamps manifest defaultVolume into 0–1.5", () => {
    registerBeatSoundManifest([
      { id: "bank:loud", name: "Loud", kind: "perc", source: "bank", url: "https://x/l.wav", defaultVolume: 99 },
    ]);
    expect(getBeatSound("bank:loud")?.defaultVolume).toBe(1.5);
  });
});

describe("resolution + honest fallback", () => {
  it("a synth assignment resolves to itself, no fallback", () => {
    const r = resolveTrackSound("synth:snare", 0);
    expect(r.fellBack).toBe(false);
    expect(r.entry.id).toBe("synth:snare"); // cross-kind synth is allowed
  });

  it("an unknown id falls back to the TRACK's synth default", () => {
    const r = resolveTrackSound("bank:not-registered", 1);
    expect(r).toMatchObject({ fellBack: true, reason: "unknown-sound" });
    expect(r.entry.id).toBe("synth:snare"); // track 1's own voice, not kick
    expect(resolveTrackSound(null, 4).entry.id).toBe("synth:ohat");
    expect(resolveTrackSound(undefined, 8).entry.id).toBe("synth:crash");
  });

  it("a sample entry with no decoded buffer falls back as missing-buffer", () => {
    registerBeatSoundManifest([
      { id: "bank:k1", name: "K1", kind: "kick", source: "bank", url: "https://x/k.wav" },
    ]);
    const r = resolveTrackSound("bank:k1", 0);
    expect(r).toMatchObject({ fellBack: true, reason: "missing-buffer", entry: { id: "synth:kick" } });
    expect(isUnavailableSampleAssignment("bank:k1", 0)).toBe(true);
  });

  it("a sample entry WITH a buffer resolves to the sample itself", () => {
    registerBeatSoundManifest([
      { id: "bank:k1", name: "K1", kind: "kick", source: "bank", url: "https://x/k.wav" },
    ]);
    setSampleBuffer("bank:k1", fakeBuffer("k1"));
    const r = resolveTrackSound("bank:k1", 0);
    expect(r.fellBack).toBe(false);
    expect(r.entry.id).toBe("bank:k1");
    expect(isUnavailableSampleAssignment("bank:k1", 0)).toBe(false);
  });

  it("normalizeTrackSoundId keeps known-looking ids, defaults garbage", () => {
    expect(normalizeTrackSoundId("bank:future-1", 0)).toBe("bank:future-1");
    expect(normalizeTrackSoundId("upload:abc", 2)).toBe("upload:abc");
    expect(normalizeTrackSoundId("", 2)).toBe("synth:clap");
    expect(normalizeTrackSoundId(null, 2)).toBe("synth:clap");
    expect(normalizeTrackSoundId(42, 2)).toBe("synth:clap");
  });
});

describe("session buffers + playback scheduling", () => {
  function fakeCtx() {
    const sources: Array<{ buffer: unknown; rate: number; dest: unknown; startedAt: number | null }> = [];
    const ctx = {
      createBufferSource: () => {
        const rec = { buffer: null as unknown, rate: 0, dest: null as unknown, startedAt: null as number | null };
        const src = {
          set buffer(b: unknown) { rec.buffer = b; },
          get buffer() { return rec.buffer; },
          playbackRate: { set value(v: number) { rec.rate = v; }, get value() { return rec.rate; } },
          connect: (d: unknown) => { rec.dest = d; },
          start: (t: number) => { rec.startedAt = t; },
        };
        sources.push(rec);
        return src;
      },
    };
    return { ctx: ctx as unknown as BaseAudioContext, sources };
  }

  it("playSampleBuffer schedules the buffer at rate 1.0 through dest", () => {
    const entry = registerUploadSound({ name: "Mine", kind: "kick", buffer: fakeBuffer("mine") });
    const { ctx, sources } = fakeCtx();
    const dest = { __dest: true } as unknown as AudioNode;
    expect(playSampleBuffer(ctx, entry, 12.5, dest)).toBe(true);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.rate).toBe(1.0);
    expect(sources[0]!.startedAt).toBe(12.5);
    expect(sources[0]!.dest).toBe(dest);
    expect((sources[0]!.buffer as { __tag: string }).__tag).toBe("mine");
  });

  it("playSampleBuffer returns false (caller falls back) with no buffer", () => {
    registerBeatSoundManifest([
      { id: "bank:nb", name: "NB", kind: "kick", source: "bank", url: "https://x/nb.wav" },
    ]);
    const { ctx, sources } = fakeCtx();
    const entry = getBeatSound("bank:nb")!;
    expect(playSampleBuffer(ctx, entry, 0, {} as AudioNode)).toBe(false);
    expect(sources).toHaveLength(0);
  });

  it("ensureBeatSampleBuffer fetches + decodes once, then caches", async () => {
    registerBeatSoundManifest([
      { id: "bank:lazy", name: "Lazy", kind: "chat", source: "bank", url: "https://x/lazy.wav" },
    ]);
    let fetches = 0;
    const decoded = fakeBuffer("lazy");
    const ctx = {
      decodeAudioData: async (_raw: ArrayBuffer) => decoded,
    } as unknown as BaseAudioContext;
    const fetcher = async (_url: string) => { fetches++; return new ArrayBuffer(8); };
    const entry: BeatSoundEntry = getBeatSound("bank:lazy")!;
    expect(await ensureBeatSampleBuffer(entry, ctx, fetcher)).toBe(decoded);
    expect(await ensureBeatSampleBuffer(entry, ctx, fetcher)).toBe(decoded);
    expect(fetches).toBe(1);
    expect(getSampleBuffer("bank:lazy")).toBe(decoded);
  });

  it("ensureBeatSampleBuffer resolves null on failure (never throws)", async () => {
    registerBeatSoundManifest([
      { id: "bank:gone", name: "Gone", kind: "chat", source: "bank", url: "https://x/gone.wav" },
    ]);
    const ctx = { decodeAudioData: async () => { throw new Error("bad audio"); } } as unknown as BaseAudioContext;
    const entry = getBeatSound("bank:gone")!;
    await expect(ensureBeatSampleBuffer(entry, ctx, async () => new ArrayBuffer(4))).resolves.toBeNull();
  });
});

describe("uploads", () => {
  it("registerUploadSound registers entry + buffer, unique ids", () => {
    const a = registerUploadSound({ name: "  My Kick  ", kind: "kick", buffer: fakeBuffer("a") });
    const b = registerUploadSound({ name: "Other", kind: "kick", buffer: fakeBuffer("b") });
    expect(a.source).toBe("upload");
    expect(a.name).toBe("My Kick");
    expect(a.id).toMatch(/^upload:/);
    expect(a.id).not.toBe(b.id);
    expect(getSampleBuffer(a.id)).toBeTruthy();
    expect(listBeatSoundsByKind("kick").map((s) => s.id)).toContain(a.id);
    expect(resolveTrackSound(a.id, 0).fellBack).toBe(false);
  });

  it("after a 'reload' (registry cleared) an upload assignment is honestly unavailable", () => {
    const a = registerUploadSound({ name: "Mine", kind: "snare", buffer: fakeBuffer("a") });
    clearRegisteredBeatSounds(); // buffers + entries are session-only
    expect(getBeatSound(a.id)).toBeNull();
    expect(isUnavailableSampleAssignment(a.id, 1)).toBe(true);
    const r = resolveTrackSound(a.id, 1);
    expect(r.fellBack).toBe(true);
    expect(r.entry.id).toBe("synth:snare"); // the track still plays
    expect(isUnavailableSampleAssignment("synth:snare", 1)).toBe(false);
    expect(createUploadSoundId()).not.toBe(createUploadSoundId());
  });
});

describe("slice regions (W3b)", () => {
  function fakeCtxWithStartArgs() {
    const starts: Array<{ at: number; args: unknown[] }> = [];
    const ctx = {
      createBufferSource: () => ({
        buffer: null as unknown,
        playbackRate: { value: 0 },
        connect: () => {},
        start: (...args: unknown[]) => { starts.push({ at: args[0] as number, args }); },
      }),
    };
    return { ctx: ctx as unknown as BaseAudioContext, starts };
  }

  it("playSampleBuffer with a region starts the buffer at (t, offset, duration)", () => {
    const buf = { duration: 8 } as AudioBuffer;
    const entry = registerUploadSound({ name: "Loop", kind: "perc", buffer: buf });
    const { ctx, starts } = fakeCtxWithStartArgs();
    const dest = {} as AudioNode;
    expect(playSampleBuffer(ctx, entry, 3.25, dest, { offset: 2, duration: 2 })).toBe(true);
    expect(starts).toHaveLength(1);
    expect(starts[0]!.args).toEqual([3.25, 2, 2]);
  });

  it("playSampleBuffer without a region still starts at (t) only — legacy shape", () => {
    const buf = { duration: 8 } as AudioBuffer;
    const entry = registerUploadSound({ name: "Whole", kind: "perc", buffer: buf });
    const { ctx, starts } = fakeCtxWithStartArgs();
    expect(playSampleBuffer(ctx, entry, 1.5, {} as AudioNode)).toBe(true);
    expect(starts[0]!.args).toEqual([1.5]);
  });

  it("an out-of-buffer region is ignored, never scheduled as silence", () => {
    const buf = { duration: 4 } as AudioBuffer;
    const entry = registerUploadSound({ name: "Short", kind: "perc", buffer: buf });
    const { ctx, starts } = fakeCtxWithStartArgs();
    expect(playSampleBuffer(ctx, entry, 0.5, {} as AudioNode, { offset: 9, duration: 1 })).toBe(true);
    expect(starts[0]!.args).toEqual([0.5]);
  });
});
