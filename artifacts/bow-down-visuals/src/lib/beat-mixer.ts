/* ── Beat mixer — channel strips for the step sequencer (W1-L3) ──────────
 * One shared graph builder for the beat sequencer's mixer, used by BOTH
 * the live AudioContext playback path and the OfflineAudioContext WAV
 * render in pages/ai-audio.tsx (SequencerTab), so the two can never drift:
 * the render is built by the exact same functions as what you hear.
 *
 * Per-track graph order (fixed, do not reorder):
 *   source → EQ → filter → compressor → delay → reverb → pan → track gain
 *   → master gain → master limiter (when enabled) → destination
 *
 * FX vocabulary mirrors lib/arrangement.ts (the ArrangementStudio model)
 * instead of forking a new one: EQ bands are arrangement `EqBand`s
 * ({ freq, gain, q } — here typed lowshelf / peaking / highshelf for the
 * 3-band strip), and the compressor / delay / reverb fields reuse the
 * arrangement `FxStep` names and ranges (thresholdDb, ratio, attackMs,
 * releaseMs, mix %, timeMs, feedback %). Saturation is arrangement-only
 * and intentionally not part of this strip.
 *
 * Defaults are regression-critical: every effect starts bypassed, EQ flat,
 * pan centred, gains at unity — a chain built from defaults creates NO
 * EQ / filter / compressor / delay / reverb nodes at all, only the
 * transparent input → pan (0) → gain (1) path into a unity master gain.
 * An untouched beat therefore sounds identical to the pre-FX mixer, whose
 * per-track gains connected straight to the destination.
 *
 * Pure UI / editing is free — nothing in this module charges anything.
 */

import type { EqBand } from "@/lib/arrangement";

/* ─── Config types (serializable — they live inside sequencer state) ──── */

export interface BeatEqBand extends EqBand {
  type: "lowshelf" | "peaking" | "highshelf";
}

export interface BeatEqConfig {
  enabled: boolean;
  /** Exactly 3 bands: lowshelf, peaking, highshelf. Gain −24…+24 dB. */
  bands: BeatEqBand[];
}

export interface BeatFilterConfig {
  enabled: boolean;
  /** High-pass cutoff, Hz (20…20,000). Default 20 = effectively open. */
  highpassFreq: number;
  /** Low-pass cutoff, Hz (20…20,000). Default 20,000 = effectively open. */
  lowpassFreq: number;
  /** Resonance Q (0.3…12). */
  q: number;
}

export interface BeatCompressorConfig {
  enabled: boolean;
  /** −60…0 dB (arrangement FxStep field). */
  thresholdDb: number;
  /** 1…20 (arrangement FxStep field). */
  ratio: number;
  /** 0.1…500 ms (arrangement FxStep field). */
  attackMs: number;
  /** 10…1000 ms (arrangement FxStep field). */
  releaseMs: number;
  /** Knee, dB. */
  kneeDb: number;
}

export interface BeatDelayConfig {
  enabled: boolean;
  /** Delay time, ms (arrangement FxStep field). */
  timeMs: number;
  /** Feedback, % 0…80 (arrangement FxStep field). */
  feedback: number;
  /** Wet mix, % 0…100 (arrangement FxStep field). */
  mix: number;
}

export interface BeatReverbConfig {
  enabled: boolean;
  /** Wet mix, % 0…100 (arrangement FxStep field). */
  mix: number;
  /** Generated impulse length, seconds (0.1…5). */
  durationSec: number;
  /** Generated impulse decay exponent (0.5…8): amplitude (1 − t/T)^decay. */
  decay: number;
}

export interface BeatTrackFxConfig {
  /** Stereo pan −1 (full left)…+1 (full right). */
  pan: number;
  eq: BeatEqConfig;
  filter: BeatFilterConfig;
  compressor: BeatCompressorConfig;
  delay: BeatDelayConfig;
  reverb: BeatReverbConfig;
}

export interface BeatLimiterConfig {
  enabled: boolean;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

export interface BeatMasterConfig {
  /** Master gain multiplier 0…1.5 (same scale as the track faders). */
  volume: number;
  limiter: BeatLimiterConfig;
}

/** The persistable mixer-FX state: one FX config per channel id
 *  (the 9 drum tracks plus the "bass" 808 bassline channel) + master. */
export interface BeatMixerFxState {
  tracks: Record<string, BeatTrackFxConfig>;
  master: BeatMasterConfig;
}

/** Drum channel ids in sequencer order, plus the bassline channel. */
export const BEAT_MIXER_CHANNEL_IDS = [
  "kick", "snare", "clap", "chat", "ohat", "b808", "perc", "shk", "crash", "bass",
] as const;

/* ─── Defaults ─────────────────────────────────────────────────────────── */

export function defaultTrackFx(): BeatTrackFxConfig {
  return {
    pan: 0,
    eq: {
      enabled: false,
      bands: [
        { type: "lowshelf", freq: 100, gain: 0, q: 1 },
        { type: "peaking", freq: 1000, gain: 0, q: 1 },
        { type: "highshelf", freq: 8000, gain: 0, q: 1 },
      ],
    },
    filter: { enabled: false, highpassFreq: 20, lowpassFreq: 20000, q: 0.7071 },
    compressor: { enabled: false, thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150, kneeDb: 3 },
    delay: { enabled: false, timeMs: 250, feedback: 30, mix: 20 },
    reverb: { enabled: false, mix: 25, durationSec: 1.8, decay: 2.5 },
  };
}

export function defaultMasterConfig(): BeatMasterConfig {
  return {
    volume: 1,
    /* Limiter-style settings mirror lib/audio-engine.ts's master limiter
     * (−1 dB, 20:1, 2 ms attack, 50 ms release, hard knee) — but the
     * limiter starts bypassed so default playback is bit-transparent. */
    limiter: { enabled: false, thresholdDb: -1, ratio: 20, attackMs: 2, releaseMs: 50 },
  };
}

export function defaultBeatMixerFxState(ids: readonly string[] = BEAT_MIXER_CHANNEL_IDS): BeatMixerFxState {
  const tracks: Record<string, BeatTrackFxConfig> = {};
  for (const id of ids) tracks[id] = defaultTrackFx();
  return { tracks, master: defaultMasterConfig() };
}

/* ─── Normalization (defensive load + clamping) ────────────────────────── */

const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const clampPan = (v: unknown, fallback = 0): number => num(v, fallback, -1, 1);

export function normalizeTrackFx(raw: unknown): BeatTrackFxConfig {
  const d = defaultTrackFx();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<BeatTrackFxConfig>;
  const bands: BeatEqBand[] = d.eq.bands.map((def, i) => {
    const b = Array.isArray(r.eq?.bands) ? (r.eq.bands[i] as Partial<BeatEqBand> | undefined) : undefined;
    return {
      type: def.type, // band type is fixed by position in the 3-band strip
      freq: num(b?.freq, def.freq, 20, 20000),
      gain: num(b?.gain, def.gain, -24, 24),
      q: num(b?.q, def.q, 0.3, 12),
    };
  });
  return {
    pan: clampPan(r.pan),
    eq: { enabled: bool(r.eq?.enabled, false), bands },
    filter: {
      enabled: bool(r.filter?.enabled, false),
      highpassFreq: num(r.filter?.highpassFreq, d.filter.highpassFreq, 20, 20000),
      lowpassFreq: num(r.filter?.lowpassFreq, d.filter.lowpassFreq, 20, 20000),
      q: num(r.filter?.q, d.filter.q, 0.3, 12),
    },
    compressor: {
      enabled: bool(r.compressor?.enabled, false),
      thresholdDb: num(r.compressor?.thresholdDb, d.compressor.thresholdDb, -60, 0),
      ratio: num(r.compressor?.ratio, d.compressor.ratio, 1, 20),
      attackMs: num(r.compressor?.attackMs, d.compressor.attackMs, 0.1, 500),
      releaseMs: num(r.compressor?.releaseMs, d.compressor.releaseMs, 10, 1000),
      kneeDb: num(r.compressor?.kneeDb, d.compressor.kneeDb, 0, 40),
    },
    delay: {
      enabled: bool(r.delay?.enabled, false),
      timeMs: num(r.delay?.timeMs, d.delay.timeMs, 10, 2000),
      feedback: num(r.delay?.feedback, d.delay.feedback, 0, 80),
      mix: num(r.delay?.mix, d.delay.mix, 0, 100),
    },
    reverb: {
      enabled: bool(r.reverb?.enabled, false),
      mix: num(r.reverb?.mix, d.reverb.mix, 0, 100),
      durationSec: num(r.reverb?.durationSec, d.reverb.durationSec, 0.1, 5),
      decay: num(r.reverb?.decay, d.reverb.decay, 0.5, 8),
    },
  };
}

export function normalizeMasterConfig(raw: unknown): BeatMasterConfig {
  const d = defaultMasterConfig();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<BeatMasterConfig>;
  return {
    volume: num(r.volume, d.volume, 0, 1.5),
    limiter: {
      enabled: bool(r.limiter?.enabled, false),
      thresholdDb: num(r.limiter?.thresholdDb, d.limiter.thresholdDb, -60, 0),
      ratio: num(r.limiter?.ratio, d.limiter.ratio, 1, 20),
      attackMs: num(r.limiter?.attackMs, d.limiter.attackMs, 0.1, 500),
      releaseMs: num(r.limiter?.releaseMs, d.limiter.releaseMs, 10, 1000),
    },
  };
}

export function normalizeBeatMixerFxState(
  raw: unknown,
  ids: readonly string[] = BEAT_MIXER_CHANNEL_IDS,
): BeatMixerFxState {
  const out = defaultBeatMixerFxState(ids);
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<BeatMixerFxState>;
  if (r.tracks && typeof r.tracks === "object") {
    for (const [id, cfg] of Object.entries(r.tracks)) {
      out.tracks[id] = normalizeTrackFx(cfg);
    }
  }
  out.master = normalizeMasterConfig(r.master);
  return out;
}

/* ─── Serialize / parse / identity ─────────────────────────────────────── */

export function serializeBeatMixerFxState(state: BeatMixerFxState): string {
  return JSON.stringify(normalizeBeatMixerFxState(state, Object.keys(state.tracks)));
}

export function parseBeatMixerFxState(
  raw: unknown,
  ids: readonly string[] = BEAT_MIXER_CHANNEL_IDS,
): BeatMixerFxState {
  if (typeof raw === "string") {
    try {
      return normalizeBeatMixerFxState(JSON.parse(raw), ids);
    } catch {
      return defaultBeatMixerFxState(ids);
    }
  }
  return normalizeBeatMixerFxState(raw, ids);
}

export function isDefaultTrackFx(config: unknown): boolean {
  return JSON.stringify(normalizeTrackFx(config)) === JSON.stringify(defaultTrackFx());
}

export function isDefaultBeatMixerFxState(state: unknown, ids: readonly string[] = BEAT_MIXER_CHANNEL_IDS): boolean {
  return (
    JSON.stringify(normalizeBeatMixerFxState(state, ids)) ===
    JSON.stringify(defaultBeatMixerFxState(ids))
  );
}

/** Audible fader gain for a channel — the exact legacy mixer rule:
 *  any solo ⇒ only soloed channels sound; otherwise mute silences. */
export function effectiveChannelGain(volume: number, muted: boolean, solo: boolean, anySolo: boolean): number {
  const v = num(volume, 1, 0, 1.5);
  if (anySolo) return solo ? v : 0;
  return muted ? 0 : v;
}

/* ─── Generated reverb impulse (math only — no audio files) ────────────── */

/** Deterministic PRNG (mulberry32) so the live and offline graphs build
 *  the IDENTICAL impulse for the same parameters — render parity. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesize a stereo noise-decay impulse response in memory. This is
 * engine math (a generated buffer), not a sound-bank asset: no files are
 * shipped or fetched. Amplitude envelope is (1 − t/T)^decay.
 */
export function generateImpulseResponse(
  ctx: BaseAudioContext,
  durationSec: number,
  decay: number,
  seed = 0x2f6e2b1,
): AudioBuffer {
  const dur = num(durationSec, 1.8, 0.1, 5);
  const dec = num(decay, 2.5, 0.5, 8);
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * dur));
  const buffer = ctx.createBuffer(2, length, rate);
  const rand = mulberry32(seed);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (rand() * 2 - 1) * Math.pow(1 - i / length, dec);
    }
  }
  return buffer;
}

/* ─── Graph builders (AudioContext AND OfflineAudioContext) ────────────── */

export interface BeatTrackChain {
  /** Connect sound sources here. */
  input: GainNode;
  /** The track gain node — connect this to the master input. */
  output: GainNode;
  trackGain: GainNode;
  panNode: AudioNode;
  /** Every node created for this chain, in creation order. */
  nodes: AudioNode[];
  /** Ordered stage names, e.g. ["input","eq-lowshelf",…,"pan","track-gain"]. */
  kinds: string[];
  /** Live-update parameters on the existing nodes (no rebuild). Only
   *  valid while the enabled-flag signature is unchanged — see
   *  beatMixerGraphSignature. */
  update: (config: BeatTrackFxConfig) => void;
  disconnect: () => void;
}

export interface BeatMasterChain {
  input: GainNode;
  gain: GainNode;
  output: AudioNode;
  limiter: DynamicsCompressorNode | null;
  nodes: AudioNode[];
  kinds: string[];
  update: (config: BeatMasterConfig) => void;
  disconnect: () => void;
}

export interface BeatMixerGraph {
  tracks: Record<string, BeatTrackChain>;
  master: BeatMasterChain;
  update: (state: BeatMixerFxState) => void;
  disconnect: () => void;
}

/** Topology signature: only enable/bypass flags change the node graph;
 *  every other parameter is applied live via update(). */
export function beatMixerGraphSignature(state: BeatMixerFxState): string {
  const norm = normalizeBeatMixerFxState(state, Object.keys(state.tracks));
  const perTrack = Object.keys(norm.tracks)
    .sort()
    .map((id) => {
      const f = norm.tracks[id]!;
      return `${id}:${f.eq.enabled ? 1 : 0}${f.filter.enabled ? 1 : 0}${f.compressor.enabled ? 1 : 0}${f.delay.enabled ? 1 : 0}${f.reverb.enabled ? 1 : 0}`;
    })
    .join("|");
  return `${perTrack}#limiter:${norm.master.limiter.enabled ? 1 : 0}`;
}

export function buildTrackChain(ctx: BaseAudioContext, rawConfig: unknown): BeatTrackChain {
  const config = normalizeTrackFx(rawConfig);
  const nodes: AudioNode[] = [];
  const kinds: string[] = [];

  const input = ctx.createGain();
  input.gain.value = 1;
  nodes.push(input);
  kinds.push("input");
  let current: AudioNode = input;
  const append = (node: AudioNode, kind: string) => {
    current.connect(node);
    current = node;
    nodes.push(node);
    kinds.push(kind);
  };

  /* EQ — lowshelf → peaking → highshelf. */
  const eqNodes: BiquadFilterNode[] = [];
  if (config.eq.enabled) {
    for (const band of config.eq.bands) {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.freq;
      f.Q.value = band.q;
      f.gain.value = band.gain;
      eqNodes.push(f);
      append(f, `eq-${band.type}`);
    }
  }

  /* Filter — high-pass then low-pass. */
  let hpNode: BiquadFilterNode | null = null;
  let lpNode: BiquadFilterNode | null = null;
  if (config.filter.enabled) {
    hpNode = ctx.createBiquadFilter();
    hpNode.type = "highpass";
    hpNode.frequency.value = config.filter.highpassFreq;
    hpNode.Q.value = config.filter.q;
    append(hpNode, "filter-highpass");
    lpNode = ctx.createBiquadFilter();
    lpNode.type = "lowpass";
    lpNode.frequency.value = config.filter.lowpassFreq;
    lpNode.Q.value = config.filter.q;
    append(lpNode, "filter-lowpass");
  }

  /* Compressor. */
  let compNode: DynamicsCompressorNode | null = null;
  if (config.compressor.enabled) {
    compNode = ctx.createDynamicsCompressor();
    compNode.threshold.value = config.compressor.thresholdDb;
    compNode.ratio.value = config.compressor.ratio;
    compNode.attack.value = config.compressor.attackMs / 1000;
    compNode.release.value = config.compressor.releaseMs / 1000;
    compNode.knee.value = config.compressor.kneeDb;
    append(compNode, "compressor");
  }

  /* Delay — dry path + delayed wet path with a feedback loop, summed. */
  let delayNode: DelayNode | null = null;
  let delayFeedback: GainNode | null = null;
  let delayWet: GainNode | null = null;
  if (config.delay.enabled) {
    const sum = ctx.createGain();
    sum.gain.value = 1;
    const dry = ctx.createGain();
    dry.gain.value = 1;
    current.connect(dry);
    dry.connect(sum);
    delayNode = ctx.createDelay(2);
    delayNode.delayTime.value = config.delay.timeMs / 1000;
    delayFeedback = ctx.createGain();
    delayFeedback.gain.value = config.delay.feedback / 100;
    delayWet = ctx.createGain();
    delayWet.gain.value = config.delay.mix / 100;
    current.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(delayWet);
    delayWet.connect(sum);
    nodes.push(dry, delayNode, delayFeedback, delayWet, sum);
    kinds.push("delay");
    current = sum;
  }

  /* Reverb — dry path + convolver wet path (generated impulse), summed. */
  let reverbNode: ConvolverNode | null = null;
  let reverbWet: GainNode | null = null;
  let irKey = "";
  if (config.reverb.enabled) {
    const sum = ctx.createGain();
    sum.gain.value = 1;
    const dry = ctx.createGain();
    dry.gain.value = 1;
    current.connect(dry);
    dry.connect(sum);
    reverbNode = ctx.createConvolver();
    irKey = `${config.reverb.durationSec}/${config.reverb.decay}`;
    reverbNode.buffer = generateImpulseResponse(ctx, config.reverb.durationSec, config.reverb.decay);
    reverbWet = ctx.createGain();
    reverbWet.gain.value = config.reverb.mix / 100;
    current.connect(reverbNode);
    reverbNode.connect(reverbWet);
    reverbWet.connect(sum);
    nodes.push(dry, reverbNode, reverbWet, sum);
    kinds.push("reverb");
    current = sum;
  }

  /* Pan — always present; pan 0 is transparent. Falls back to a plain
   *  gain on engines without createStereoPanner (mirrors audio-engine). */
  let panner: StereoPannerNode | null = null;
  let panNodeRef: AudioNode;
  if (typeof ctx.createStereoPanner === "function") {
    panner = ctx.createStereoPanner();
    panner.pan.value = config.pan;
    panNodeRef = panner;
    append(panner, "pan");
  } else {
    panNodeRef = ctx.createGain();
    append(panNodeRef, "pan");
  }

  /* Track gain (the mixer fader lands here). */
  const trackGain = ctx.createGain();
  trackGain.gain.value = 1;
  append(trackGain, "track-gain");

  const update = (raw: unknown) => {
    const c = normalizeTrackFx(raw);
    if (panner) panner.pan.value = c.pan;
    eqNodes.forEach((n, i) => {
      const band = c.eq.bands[i]!;
      n.frequency.value = band.freq;
      n.Q.value = band.q;
      n.gain.value = band.gain;
    });
    if (hpNode) hpNode.frequency.value = c.filter.highpassFreq;
    if (lpNode) lpNode.frequency.value = c.filter.lowpassFreq;
    if (hpNode) hpNode.Q.value = c.filter.q;
    if (lpNode) lpNode.Q.value = c.filter.q;
    if (compNode) {
      compNode.threshold.value = c.compressor.thresholdDb;
      compNode.ratio.value = c.compressor.ratio;
      compNode.attack.value = c.compressor.attackMs / 1000;
      compNode.release.value = c.compressor.releaseMs / 1000;
      compNode.knee.value = c.compressor.kneeDb;
    }
    if (delayNode) delayNode.delayTime.value = c.delay.timeMs / 1000;
    if (delayFeedback) delayFeedback.gain.value = c.delay.feedback / 100;
    if (delayWet) delayWet.gain.value = c.delay.mix / 100;
    if (reverbWet) reverbWet.gain.value = c.reverb.mix / 100;
    if (reverbNode) {
      const key = `${c.reverb.durationSec}/${c.reverb.decay}`;
      if (key !== irKey) {
        irKey = key;
        reverbNode.buffer = generateImpulseResponse(ctx, c.reverb.durationSec, c.reverb.decay);
      }
    }
  };

  return {
    input,
    output: trackGain,
    trackGain,
    panNode: panNodeRef,
    nodes,
    kinds,
    update,
    disconnect: () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already torn down */
        }
      }
    },
  };
}

export function buildMasterChain(ctx: BaseAudioContext, rawConfig: unknown): BeatMasterChain {
  const config = normalizeMasterConfig(rawConfig);
  const nodes: AudioNode[] = [];
  const kinds: string[] = [];

  const gain = ctx.createGain();
  gain.gain.value = config.volume;
  nodes.push(gain);
  kinds.push("master-gain");
  let current: AudioNode = gain;

  let limiter: DynamicsCompressorNode | null = null;
  if (config.limiter.enabled) {
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = config.limiter.thresholdDb;
    limiter.ratio.value = config.limiter.ratio;
    limiter.attack.value = config.limiter.attackMs / 1000;
    limiter.release.value = config.limiter.releaseMs / 1000;
    limiter.knee.value = 0;
    gain.connect(limiter);
    current = limiter;
    nodes.push(limiter);
    kinds.push("master-limiter");
  }

  const update = (raw: unknown) => {
    const c = normalizeMasterConfig(raw);
    gain.gain.value = c.volume;
    if (limiter) {
      limiter.threshold.value = c.limiter.thresholdDb;
      limiter.ratio.value = c.limiter.ratio;
      limiter.attack.value = c.limiter.attackMs / 1000;
      limiter.release.value = c.limiter.releaseMs / 1000;
    }
  };

  return {
    input: gain,
    gain,
    output: current,
    limiter,
    nodes,
    kinds,
    update,
    disconnect: () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already torn down */
        }
      }
    },
  };
}

/**
 * Build the full mixer graph for one context: every channel chain routes
 * through the master chain, and the master output connects to the
 * context destination. THE builder for both live playback and the
 * offline WAV render — there is no second wiring anywhere.
 */
export function buildBeatMixerGraph(ctx: BaseAudioContext, rawState: unknown): BeatMixerGraph {
  const rawIds = Object.keys((rawState as BeatMixerFxState)?.tracks ?? {});
  const state = normalizeBeatMixerFxState(rawState, rawIds.length > 0 ? rawIds : BEAT_MIXER_CHANNEL_IDS);
  const master = buildMasterChain(ctx, state.master);
  const tracks: Record<string, BeatTrackChain> = {};
  for (const [id, cfg] of Object.entries(state.tracks)) {
    const chain = buildTrackChain(ctx, cfg);
    chain.output.connect(master.input);
    tracks[id] = chain;
  }
  master.output.connect(ctx.destination);

  return {
    tracks,
    master,
    update: (next: BeatMixerFxState) => {
      const norm = normalizeBeatMixerFxState(next, Object.keys(next.tracks));
      for (const [id, chain] of Object.entries(tracks)) {
        const cfg = norm.tracks[id];
        if (cfg) chain.update(cfg);
      }
      master.update(norm.master);
    },
    disconnect: () => {
      for (const chain of Object.values(tracks)) chain.disconnect();
      master.disconnect();
    },
  };
}

/** Serializable topology description — the render-parity proof surface:
 *  two graphs built from the same state must describe identically. */
export function describeBeatMixerGraph(graph: BeatMixerGraph): {
  master: string[];
  tracks: Record<string, string[]>;
} {
  const tracks: Record<string, string[]> = {};
  for (const [id, chain] of Object.entries(graph.tracks)) tracks[id] = [...chain.kinds];
  return { master: [...graph.master.kinds], tracks };
}
