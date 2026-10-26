/**
 * N14 Stems Player — FE pins.
 *
 *  - honest absence: no stems → descriptors null → controls render nothing
 *  - partial stems: exactly those stems, canonical order
 *  - playback payload: raw storage refs / junk never become playable stems
 *  - mix logic: mute silences, solo isolates, mute beats solo
 *  - engine sync: all stems start/seek/pause together; mute/solo changes
 *    gains ONLY (never restarts, never moves position); drift beyond the
 *    threshold is re-synced to the leader, drift inside it is left alone
 */
import { describe, it, expect, vi } from "vitest";
import {
  normalizeStemDescriptors,
  normalizePlayableStems,
  stemGain,
  initialStemMix,
  StemPlaybackEngine,
  DRIFT_RESYNC_SEC,
  type StemAudioLike,
} from "./stems-player";

describe("normalizeStemDescriptors (track DTO stems)", () => {
  it("no stems → null (the controls' render-nothing signal)", () => {
    expect(normalizeStemDescriptors(null)).toBeNull();
    expect(normalizeStemDescriptors(undefined)).toBeNull();
    expect(normalizeStemDescriptors([])).toBeNull();
    expect(normalizeStemDescriptors("vocals")).toBeNull();
  });

  it("partial stems → exactly those, canonical order", () => {
    const out = normalizeStemDescriptors([
      { key: "other", label: "Melody / Other" },
      { key: "vocals", label: "Vocals" },
    ]);
    expect(out?.map((s) => s.key)).toEqual(["vocals", "other"]);
  });

  it("drops unknown keys and duplicates", () => {
    const out = normalizeStemDescriptors([
      { key: "kazoo", label: "Kazoo" },
      { key: "bass", label: "Bass" },
      { key: "bass", label: "Bass again" },
    ]);
    expect(out?.map((s) => s.key)).toEqual(["bass"]);
  });
});

describe("normalizePlayableStems (playback payload)", () => {
  it("keeps only known keys with http(s) URLs", () => {
    const out = normalizePlayableStems({
      track_id: "t1",
      stems: [
        { key: "vocals", label: "Vocals", url: "https://signed.example/vocals.wav" },
        { key: "drums", label: "Drums", url: "r2://generated-clips/stems/u/j/drums.wav" },
        { key: "bass", label: "Bass", url: "supabase://generated-clips/stems/u/j/bass.wav" },
        { key: "kazoo", label: "Kazoo", url: "https://signed.example/kazoo.wav" },
      ],
    });
    expect(out.map((s) => s.key)).toEqual(["vocals"]);
  });

  it("empty / malformed payloads → no playable stems", () => {
    expect(normalizePlayableStems(null)).toEqual([]);
    expect(normalizePlayableStems({ stems: [] })).toEqual([]);
    expect(normalizePlayableStems({})).toEqual([]);
  });
});

describe("stemGain — mute/solo mix logic", () => {
  const mix = (over: Record<string, { muted: boolean; solo: boolean }> = {}) => ({
    vocals: { muted: false, solo: false },
    drums: { muted: false, solo: false },
    ...over,
  });

  it("all stems sound at unity with a clean mix", () => {
    expect(stemGain("vocals", mix())).toBe(1);
    expect(stemGain("drums", mix())).toBe(1);
  });

  it("a muted stem is silent", () => {
    expect(stemGain("vocals", mix({ vocals: { muted: true, solo: false } }))).toBe(0);
    expect(stemGain("drums", mix({ vocals: { muted: true, solo: false } }))).toBe(1);
  });

  it("solo isolates: only the soloed stem sounds", () => {
    const m = mix({ drums: { muted: false, solo: true } });
    expect(stemGain("drums", m)).toBe(1);
    expect(stemGain("vocals", m)).toBe(0);
  });

  it("mute beats solo on the same stem", () => {
    const m = mix({ drums: { muted: true, solo: true } });
    expect(stemGain("drums", m)).toBe(0);
    // A muted solo does not count as an active solo for the others.
    expect(stemGain("vocals", m)).toBe(1);
  });

  it("initialStemMix starts clean for exactly the given stems", () => {
    const m = initialStemMix([{ key: "bass", label: "Bass" }]);
    expect(m).toEqual({ bass: { muted: false, solo: false } });
  });
});

/* ─── Engine sync ─── */

class FakeAudio implements StemAudioLike {
  src = "";
  currentTime = 0;
  duration = 100;
  volume = 1;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  async play() { this.playCalls += 1; this.paused = false; }
  pause() { this.pauseCalls += 1; this.paused = true; }
  addEventListener() {}
  removeEventListener() {}
}

const PLAYABLE = [
  { key: "vocals" as const, label: "Vocals", url: "https://signed.example/vocals.wav" },
  { key: "drums" as const, label: "Drums", url: "https://signed.example/drums.wav" },
  { key: "bass" as const, label: "Bass", url: "https://signed.example/bass.wav" },
];

function makeEngine() {
  const els: FakeAudio[] = [];
  const engine = new StemPlaybackEngine(() => {
    const el = new FakeAudio();
    els.push(el);
    return el;
  });
  engine.load(PLAYABLE, initialStemMix(PLAYABLE));
  return { engine, els };
}

describe("StemPlaybackEngine", () => {
  it("play starts EVERY stem together; pause pauses them all", async () => {
    const { engine, els } = makeEngine();
    await engine.play();
    expect(els.every((e) => e.playCalls === 1 && !e.paused)).toBe(true);
    engine.pause();
    expect(els.every((e) => e.pauseCalls === 1 && e.paused)).toBe(true);
    engine.dispose();
  });

  it("seek moves every stem to the same position", async () => {
    const { engine, els } = makeEngine();
    await engine.play();
    engine.seek(42);
    expect(els.map((e) => e.currentTime)).toEqual([42, 42, 42]);
    engine.dispose();
  });

  it("mute/solo changes gains ONLY — no restart, no position move", async () => {
    const { engine, els } = makeEngine();
    engine.setMasterVolume(0.8, false);
    await engine.play();
    engine.seek(10);
    const playCallsBefore = els.map((e) => e.playCalls);
    engine.applyMix({
      vocals: { muted: true, solo: false },
      drums: { muted: false, solo: true },
      bass: { muted: false, solo: false },
    });
    expect(els.map((e) => e.volume)).toEqual([0, 0.8, 0]);
    expect(els.map((e) => e.playCalls)).toEqual(playCallsBefore);
    expect(els.map((e) => e.currentTime)).toEqual([10, 10, 10]);
    expect(els.every((e) => !e.paused)).toBe(true);
    engine.dispose();
  });

  it("master mute silences every stem via gains", async () => {
    const { engine, els } = makeEngine();
    engine.setMasterVolume(0.8, true);
    expect(els.every((e) => e.volume === 0)).toBe(true);
    engine.dispose();
  });

  it("drift beyond the threshold is re-synced to the leader", async () => {
    const { engine, els } = makeEngine();
    await engine.play();
    els[0]!.currentTime = 30;
    els[1]!.currentTime = 30 + DRIFT_RESYNC_SEC + 0.2; // drums drifted
    els[2]!.currentTime = 30.05; // bass inside the threshold — left alone
    const fixed = engine.checkDrift();
    expect(fixed).toEqual(["drums"]);
    expect(els[1]!.currentTime).toBe(30);
    expect(els[2]!.currentTime).toBe(30.05);
    engine.dispose();
  });

  it("no drift check runs while paused", () => {
    const { engine, els } = makeEngine();
    els[0]!.currentTime = 5;
    els[1]!.currentTime = 9;
    expect(engine.checkDrift()).toEqual([]);
    expect(els[1]!.currentTime).toBe(9);
    engine.dispose();
  });

  it("dispose pauses and clears every stem element", async () => {
    const { engine, els } = makeEngine();
    await engine.play();
    engine.dispose();
    expect(els.every((e) => e.paused && e.src === "")).toBe(true);
    expect(engine.playable).toEqual([]);
  });

  it("loading a partial stem set creates exactly those elements", () => {
    const els: FakeAudio[] = [];
    const engine = new StemPlaybackEngine(() => {
      const el = new FakeAudio();
      els.push(el);
      return el;
    });
    const two = PLAYABLE.slice(0, 2);
    engine.load(two, initialStemMix(two));
    expect(els).toHaveLength(2);
    expect(engine.playable.map((s) => s.key)).toEqual(["vocals", "drums"]);
    engine.dispose();
  });
});
