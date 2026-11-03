/**
 * Beat mixer tests (W1-L3) against a fake Web Audio graph, following the
 * repo's stream-kit/audio-mixer.test.ts fake-node pattern:
 *  - config defaults / clamping / serialize round-trip
 *  - graph-builder node topology for the fixed chain order
 *  - defaults are sonically identical: a default chain creates no FX
 *    nodes at all — only transparent input → pan(0) → gain(1) into a
 *    unity master gain, exactly the legacy straight-to-destination sound
 *  - live vs offline parity: the same builder on two contexts produces
 *    the identical topology + parameter snapshot
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BEAT_MIXER_CHANNEL_IDS,
  buildBeatMixerGraph,
  buildMasterChain,
  buildTrackChain,
  defaultBeatMixerFxState,
  defaultMasterConfig,
  defaultTrackFx,
  describeBeatMixerGraph,
  effectiveChannelGain,
  generateImpulseResponse,
  isDefaultBeatMixerFxState,
  isDefaultTrackFx,
  normalizeTrackFx,
  parseBeatMixerFxState,
  serializeBeatMixerFxState,
  type BeatMixerFxState,
  type BeatTrackFxConfig,
} from "./beat-mixer";

/* ─── Fake Web Audio graph ─────────────────────────────────────────────── */

class FakeParam {
  constructor(public value: number) {}
}
class FakeNode {
  kind = "node";
  connections: FakeNode[] = [];
  connect(n: FakeNode): void {
    this.connections.push(n);
  }
  disconnect(): void {
    this.connections = [];
  }
}
class FakeGain extends FakeNode {
  override kind = "gain";
  gain = new FakeParam(1);
}
class FakeBiquad extends FakeNode {
  override kind = "biquad";
  type = "peaking";
  frequency = new FakeParam(1000);
  gain = new FakeParam(0);
  Q = new FakeParam(1);
}
class FakeCompressor extends FakeNode {
  override kind = "compressor";
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}
class FakeDelay extends FakeNode {
  override kind = "delay";
  delayTime = new FakeParam(0);
}
class FakeConvolver extends FakeNode {
  override kind = "convolver";
  buffer: FakeBuffer | null = null;
}
class FakePanner extends FakeNode {
  override kind = "panner";
  pan = new FakeParam(0);
}
class FakeBuffer {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  private data: Float32Array[];
  getChannelData(ch: number): Float32Array {
    return this.data[ch]!;
  }
}

class FakeCtx {
  sampleRate = 44100;
  destination = new FakeNode();
  created: FakeNode[] = [];
  private track<T extends FakeNode>(n: T): T {
    this.created.push(n);
    return n;
  }
  createGain(): FakeGain {
    return this.track(new FakeGain());
  }
  createBiquadFilter(): FakeBiquad {
    return this.track(new FakeBiquad());
  }
  createDynamicsCompressor(): FakeCompressor {
    return this.track(new FakeCompressor());
  }
  createDelay(): FakeDelay {
    return this.track(new FakeDelay());
  }
  createConvolver(): FakeConvolver {
    return this.track(new FakeConvolver());
  }
  createStereoPanner(): FakePanner {
    return this.track(new FakePanner());
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
}

const asCtx = (c: FakeCtx) => c as unknown as BaseAudioContext;

function fullFx(): BeatTrackFxConfig {
  const fx = defaultTrackFx();
  fx.pan = -0.4;
  fx.eq.enabled = true;
  fx.eq.bands[0]!.gain = 4;
  fx.eq.bands[1]!.gain = -2;
  fx.eq.bands[2]!.gain = 6;
  fx.filter.enabled = true;
  fx.filter.highpassFreq = 80;
  fx.filter.lowpassFreq = 12000;
  fx.compressor.enabled = true;
  fx.delay.enabled = true;
  fx.delay.timeMs = 375;
  fx.delay.feedback = 45;
  fx.delay.mix = 30;
  fx.reverb.enabled = true;
  fx.reverb.mix = 40;
  fx.reverb.durationSec = 2.2;
  return fx;
}

function paramSnapshot(ctx: FakeCtx): unknown {
  return ctx.created.map((n) => {
    const rec: Record<string, unknown> = { kind: n.kind };
    for (const [k, v] of Object.entries(n)) {
      if (v instanceof FakeParam) rec[k] = v.value;
      else if (typeof v === "string") rec[k] = v;
    }
    if (n instanceof FakeConvolver) {
      rec.bufferLength = n.buffer?.length ?? null;
      rec.bufferFirst = n.buffer?.getChannelData(0)[0] ?? null;
    }
    return rec;
  });
}

/* ─── Config ───────────────────────────────────────────────────────────── */

describe("beat mixer config", () => {
  it("defaults are fully bypassed / flat", () => {
    const fx = defaultTrackFx();
    expect(fx.pan).toBe(0);
    expect(fx.eq.enabled).toBe(false);
    expect(fx.eq.bands.map((b) => b.gain)).toEqual([0, 0, 0]);
    expect(fx.eq.bands.map((b) => b.type)).toEqual(["lowshelf", "peaking", "highshelf"]);
    expect(fx.filter.enabled).toBe(false);
    expect(fx.compressor.enabled).toBe(false);
    expect(fx.delay.enabled).toBe(false);
    expect(fx.reverb.enabled).toBe(false);
    expect(isDefaultTrackFx(fx)).toBe(true);
    expect(isDefaultBeatMixerFxState(defaultBeatMixerFxState())).toBe(true);
    const master = defaultMasterConfig();
    expect(master.volume).toBe(1);
    expect(master.limiter.enabled).toBe(false);
  });

  it("serialize → parse round-trips, including a tweaked state", () => {
    const state = defaultBeatMixerFxState();
    state.tracks["kick"] = fullFx();
    state.master.volume = 1.25;
    state.master.limiter.enabled = true;
    const parsed = parseBeatMixerFxState(serializeBeatMixerFxState(state));
    expect(parsed).toEqual(state);
    expect(isDefaultBeatMixerFxState(parsed)).toBe(false);
    expect(parseBeatMixerFxState("not json")).toEqual(defaultBeatMixerFxState());
    expect(parseBeatMixerFxState(null)).toEqual(defaultBeatMixerFxState());
    expect(parseBeatMixerFxState("{}")).toEqual(defaultBeatMixerFxState());
  });

  it("normalization clamps out-of-range values to the documented ranges", () => {
    const fx = normalizeTrackFx({
      pan: 5,
      eq: { enabled: true, bands: [{ freq: 5, gain: 99, q: 99 }, {}, { gain: -99 }] },
      filter: { enabled: true, highpassFreq: 1, lowpassFreq: 999999 },
      compressor: { enabled: true, thresholdDb: -99, ratio: 99 },
      delay: { enabled: true, feedback: 500, mix: -3 },
      reverb: { enabled: true, durationSec: 99, decay: 0 },
    });
    expect(fx.pan).toBe(1);
    expect(fx.eq.bands[0]).toEqual({ type: "lowshelf", freq: 20, gain: 24, q: 12 });
    expect(fx.eq.bands[2]!.gain).toBe(-24);
    expect(fx.filter.highpassFreq).toBe(20);
    expect(fx.filter.lowpassFreq).toBe(20000);
    expect(fx.compressor.thresholdDb).toBe(-60);
    expect(fx.compressor.ratio).toBe(20);
    expect(fx.delay.feedback).toBe(80);
    expect(fx.delay.mix).toBe(0);
    expect(fx.reverb.durationSec).toBe(5);
    expect(fx.reverb.decay).toBe(0.5);
  });

  it("effectiveChannelGain preserves the legacy mute/solo rule", () => {
    expect(effectiveChannelGain(1.2, false, false, false)).toBe(1.2);
    expect(effectiveChannelGain(1.2, true, false, false)).toBe(0);
    expect(effectiveChannelGain(1.2, false, false, true)).toBe(0); // someone else solos
    expect(effectiveChannelGain(1.2, true, true, true)).toBe(1.2); // solo wins over mute, as before
    expect(effectiveChannelGain(9, false, false, false)).toBe(1.5); // fader clamp
  });
});

/* ─── Graph topology ───────────────────────────────────────────────────── */

describe("beat mixer graph builder", () => {
  it("DEFAULTS ARE SONICALLY IDENTICAL: no FX nodes are created at all", () => {
    const ctx = new FakeCtx();
    const chain = buildTrackChain(asCtx(ctx), defaultTrackFx());
    expect(chain.kinds).toEqual(["input", "pan", "track-gain"]);
    // Only gains + one panner exist — no biquad / compressor / delay / convolver.
    expect(ctx.created.map((n) => n.kind)).toEqual(["gain", "panner", "gain"]);
    const [input, pan, gain] = ctx.created as unknown as [FakeGain, FakePanner, FakeGain];
    expect(pan.pan.value).toBe(0); // centred pan is transparent
    expect(gain.gain.value).toBe(1); // unity track gain
    expect(input.connections).toEqual([pan]);
    expect(pan.connections).toEqual([gain]);

    const mctx = new FakeCtx();
    const master = buildMasterChain(asCtx(mctx), defaultMasterConfig());
    expect(master.kinds).toEqual(["master-gain"]);
    expect(mctx.created.map((n) => n.kind)).toEqual(["gain"]); // no limiter node
    expect((master.gain as unknown as FakeGain).gain.value).toBe(1);
  });

  it("full FX chain follows the fixed documented order", () => {
    const ctx = new FakeCtx();
    const chain = buildTrackChain(asCtx(ctx), fullFx());
    expect(chain.kinds).toEqual([
      "input",
      "eq-lowshelf",
      "eq-peaking",
      "eq-highshelf",
      "filter-highpass",
      "filter-lowpass",
      "compressor",
      "delay",
      "reverb",
      "pan",
      "track-gain",
    ]);
    const biquads = ctx.created.filter((n): n is FakeBiquad => n instanceof FakeBiquad);
    expect(biquads.map((b) => b.type)).toEqual(["lowshelf", "peaking", "highshelf", "highpass", "lowpass"]);
    expect(biquads.map((b) => b.gain.value)).toEqual([4, -2, 6, 0, 0]);
    // Main path is wired sequentially input → … → track gain.
    let node: FakeNode = chain.input as unknown as FakeNode;
    for (let i = 0; i < 6; i++) node = node.connections[0]!;
    expect(node).toBe(ctx.created.find((n) => n instanceof FakeCompressor));
    // Delay feedback loop: delay → feedback gain → delay.
    const delay = ctx.created.find((n): n is FakeDelay => n instanceof FakeDelay)!;
    const feedback = delay.connections.find(
      (n): n is FakeGain => n instanceof FakeGain && (n as FakeGain).gain.value === 0.45,
    )!;
    expect(feedback).toBeTruthy();
    expect(feedback.connections).toContain(delay);
    // Reverb convolver carries the generated impulse; wet gain = mix %.
    const conv = ctx.created.find((n): n is FakeConvolver => n instanceof FakeConvolver)!;
    expect(conv.buffer?.length).toBe(Math.floor(44100 * 2.2));
    const panner = ctx.created.find((n): n is FakePanner => n instanceof FakePanner)!;
    expect(panner.pan.value).toBe(-0.4);
  });

  it("update() changes parameters live without creating new nodes", () => {
    const ctx = new FakeCtx();
    const chain = buildTrackChain(asCtx(ctx), fullFx());
    const createdBefore = ctx.created.length;
    const next = fullFx();
    next.pan = 0.75;
    next.eq.bands[1]!.gain = 9;
    next.delay.mix = 65;
    next.delay.timeMs = 500;
    next.reverb.mix = 55;
    chain.update(next);
    expect(ctx.created.length).toBe(createdBefore);
    const panner = ctx.created.find((n): n is FakePanner => n instanceof FakePanner)!;
    expect(panner.pan.value).toBe(0.75);
    const mid = ctx.created.filter((n): n is FakeBiquad => n instanceof FakeBiquad)[1]!;
    expect(mid.gain.value).toBe(9);
    const delay = ctx.created.find((n): n is FakeDelay => n instanceof FakeDelay)!;
    expect(delay.delayTime.value).toBe(0.5);
    const wetGains = ctx.created
      .filter((n): n is FakeGain => n instanceof FakeGain)
      .map((g) => g.gain.value);
    expect(wetGains).toContain(0.65); // delay wet
    expect(wetGains).toContain(0.55); // reverb wet
  });

  it("generated impulse is deterministic, stereo, and decaying", () => {
    const ctx = new FakeCtx();
    const a = generateImpulseResponse(asCtx(ctx), 1.5, 2.5) as unknown as FakeBuffer;
    const b = generateImpulseResponse(asCtx(ctx), 1.5, 2.5) as unknown as FakeBuffer;
    expect(a.numberOfChannels).toBe(2);
    expect(a.length).toBe(Math.floor(44100 * 1.5));
    expect(Array.from(a.getChannelData(0).slice(0, 64))).toEqual(Array.from(b.getChannelData(0).slice(0, 64)));
    const avgAbs = (arr: Float32Array) => arr.reduce((s, v) => s + Math.abs(v), 0) / arr.length;
    const data = a.getChannelData(0);
    const head = avgAbs(data.slice(0, 2000));
    const tail = avgAbs(data.slice(data.length - 2000));
    expect(tail).toBeLessThan(head * 0.2);
  });

  it("master limiter, when enabled, sits after the master gain", () => {
    const ctx = new FakeCtx();
    const master = buildMasterChain(asCtx(ctx), {
      volume: 0.8,
      limiter: { enabled: true, thresholdDb: -3, ratio: 20, attackMs: 2, releaseMs: 50 },
    });
    expect(master.kinds).toEqual(["master-gain", "master-limiter"]);
    const [gain, limiter] = ctx.created as unknown as [FakeGain, FakeCompressor];
    expect(gain.connections).toEqual([limiter]);
    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.knee.value).toBe(0);
    expect(master.output).toBe(limiter as unknown as AudioNode);
  });
});

/* ─── Live / offline parity ────────────────────────────────────────────── */

describe("live vs offline render parity", () => {
  it("the same builder on two contexts yields identical topology + params", () => {
    const state: BeatMixerFxState = defaultBeatMixerFxState();
    state.tracks["kick"] = fullFx();
    state.tracks["bass"] = fullFx();
    state.master.limiter.enabled = true;
    state.master.volume = 1.1;

    const liveCtx = new FakeCtx();
    const offlineCtx = new FakeCtx();
    const live = buildBeatMixerGraph(asCtx(liveCtx), state);
    const offline = buildBeatMixerGraph(asCtx(offlineCtx), state);

    expect(describeBeatMixerGraph(offline)).toEqual(describeBeatMixerGraph(live));
    expect(paramSnapshot(offlineCtx)).toEqual(paramSnapshot(liveCtx));
    // Every track routes through the master, and only the master touches
    // the destination — nothing connects straight to destination anymore.
    for (const chain of Object.values(live.tracks)) {
      expect((chain.output as unknown as FakeNode).connections).toEqual([
        live.master.input as unknown as FakeNode,
      ]);
    }
    // The master output — and only the master output — connects to destination.
    expect((live.master.output as unknown as FakeNode).connections).toEqual([liveCtx.destination]);
    expect(liveCtx.created.length).toBeGreaterThan(0);
    expect(describeBeatMixerGraph(live).tracks["kick"]).toContain("reverb");
    expect(Object.keys(describeBeatMixerGraph(live).tracks).sort()).toEqual(
      [...BEAT_MIXER_CHANNEL_IDS].sort(),
    );
  });

  it("ai-audio.tsx builds BOTH playback and the offline render from this one builder", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../pages/ai-audio.tsx"), "utf8");
    const seqStart = src.indexOf("function SequencerTab");
    const seqEnd = src.indexOf("const bassRows", seqStart);
    expect(seqStart).toBeGreaterThan(-1);
    expect(seqEnd).toBeGreaterThan(seqStart);
    const seq = src.slice(seqStart, seqEnd);
    // One shared ensure-path used for the live ctx and the offline ctx.
    expect(seq).toContain("buildBeatMixerGraph");
    expect(seq).toContain("ensureMixerGraph(ctx)"); // live scheduleStep path
    expect(seq).toContain("ensureMixerGraph(off"); // offline render path
    expect(seq).toContain("new OfflineAudioContext");
    // The legacy straight-to-destination wiring is gone from the sequencer.
    expect(seq).not.toContain("gn.connect(ctx.destination)");
    expect(seq).not.toContain(".connect(ctx.destination)");
  });
});
