/**
 * Browser-only multi-track preview mix engine built on the Web Audio API.
 *
 * It decodes each stem once, then plays every stem together in sync through a
 * per-stem effect chain (EQ, de-esser, compression, saturation, reverb/delay)
 * + gain + (optional) stereo-pan node into a shared mix bus, which then runs
 * through a master-bus chain (compression, EQ tone, bass boost, stereo width,
 * loudness makeup, limiter) before hitting the speakers. This mirrors the
 * server-side FFmpeg render chain (see api-server/src/lib/audioExport.ts) as
 * closely as the Web Audio API allows, so what you hear in the browser is a
 * close approximation of what you get in the downloaded file.
 *
 * Known gap: real-time pitch-quantization ("autotune") isn't available
 * through stock Web Audio nodes (the render uses an offline LADSPA plugin),
 * so autotune is not reproduced in the live preview.
 *
 * This is a PREVIEW engine only — no rendering, mastering or export.
 */

const FADE_IN_SEC = 1.5;
const FADE_OUT_SEC = 2.5;

/** Mirrors the server's ExportStemEffects / frontend StemEffects shape. */
export interface EngineStemEffects {
  eq: string;
  reverb: string;
  delay: string;
  compression: string;
  saturation: string;
  deEsser: boolean;
  noiseReduction: boolean;
  /** Not reproduced live — see module doc. Kept for shape parity / future use. */
  autotune?: string;
}

/* ── Stack 6: parametric FX + automation shapes (mirror lib/arrangement.ts
 *    and the server render in api-server lib/audioExport.ts). ─────────── */
export interface EngineFxBand {
  freq: number;
  gain: number;
  q: number;
}

export interface EngineFxStep {
  type: "eq" | "compressor" | "saturation" | "reverb" | "delay";
  enabled: boolean;
  bands?: EngineFxBand[];
  thresholdDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  drive?: number;
  mix?: number;
  timeMs?: number;
  feedback?: number;
}

export interface EngineAutomationPoint {
  time: number;
  value: number;
}

export interface EngineAutomation {
  volume?: EngineAutomationPoint[];
  pan?: EngineAutomationPoint[];
  reverbMix?: EngineAutomationPoint[];
}

export interface EngineStem {
  id: string;
  url: string;
  /** 0–100 */
  volume: number;
  /** -100 (L) … 100 (R) */
  pan: number;
  muted: boolean;
  solo: boolean;
  /** Timeline alignment offset, seconds. */
  startTime: number;
  /** Seconds trimmed off the start. */
  trimStart: number;
  /** Seconds trimmed off the end. */
  trimEnd: number;
  effects?: EngineStemEffects;
  /** Parametric chain (Stack 6) — when present it replaces `effects`,
   *  exactly like the server render. */
  fxChain?: EngineFxStep[];
  /** Breakpoint automation in ARRANGEMENT timeline seconds (Stack 6). */
  automation?: EngineAutomation;
}

export interface EngineMaster {
  /** 0–100 */
  volume: number;
  fadeIn: boolean;
  fadeOut: boolean;
  /** 0–100 bus compression amount (0 = bypass). */
  compression: number;
  /** 0–100 stereo width (50 = unchanged). */
  stereoWidth: number;
  /** 0–100 low-end boost. */
  bassBoost: number;
  /** "dark" | "balanced" | "bright" */
  eqTone: string;
  /** "demo" | "streaming" | "loud" */
  loudnessTarget: string;
  /** Hard limiter on the master bus. */
  limiter: boolean;
}

export type PlayState = "stopped" | "playing" | "paused";

export interface EngineSnapshot {
  playState: PlayState;
  loading: boolean;
  /** Seconds into the mix. */
  position: number;
  /** Total mix length in seconds (0 until something is decoded). */
  duration: number;
  /** Stems that could not be decoded for preview. */
  errors: { id: string; message: string }[];
  /** True once at least one stem has a usable buffer. */
  ready: boolean;
  panSupported: boolean;
}

interface ActiveNode {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  /** Extra nodes created for this stem's effect chain, disconnected on teardown. */
  fxNodes: AudioNode[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Audible gain for a stem given the current solo state. */
function stemGain(s: EngineStem, anySolo: boolean): number {
  if (s.muted) return 0;
  if (anySolo && !s.solo) return 0;
  return clamp(s.volume, 0, 100) / 100;
}

/** Playable length of a stem after trims, given its decoded buffer length. */
function playLength(buffer: AudioBuffer, s: EngineStem): number {
  return Math.max(0, buffer.duration - Math.max(0, s.trimStart) - Math.max(0, s.trimEnd));
}

/**
 * A short feedback-delay ("echo") stage approximating the server's `aecho`
 * based reverb/delay filters. Returns a new summing node carrying the
 * wet+dry mix; the caller should treat it as the new "current" node.
 */
function addEchoStage(
  ctx: AudioContext,
  input: AudioNode,
  delayMs: number,
  decay: number,
  mix: number,
): AudioNode {
  const output = ctx.createGain();
  output.gain.value = 1;

  const dry = ctx.createGain();
  dry.gain.value = 1 - mix * 0.5; // keep some dry presence even at high mix
  input.connect(dry);
  dry.connect(output);

  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = delayMs / 1000;
  const feedback = ctx.createGain();
  feedback.gain.value = Math.min(0.85, decay * 0.6); // capped to avoid runaway feedback
  const wet = ctx.createGain();
  wet.gain.value = mix;

  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(output);

  return output;
}

/** Build the per-stem effect node chain. Always returns at least one
 *  (unity passthrough) node so callers have a stable connection point. */
function buildStemEffectChain(ctx: AudioContext, fx: EngineStemEffects | undefined): { input: AudioNode; output: AudioNode; nodes: AudioNode[] } {
  const entry = ctx.createGain();
  entry.gain.value = 1;
  const nodes: AudioNode[] = [entry];
  let current: AudioNode = entry;

  const append = (node: AudioNode) => {
    current.connect(node);
    current = node;
    nodes.push(node);
  };

  if (!fx) return { input: entry, output: current, nodes };

  /* Noise reduction — approximated as a gentle rumble/hiss high-pass. */
  if (fx.noiseReduction) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 100;
    append(hp);
  }

  /* EQ tone preset. */
  switch (fx.eq) {
    case "Warm": {
      const low = ctx.createBiquadFilter();
      low.type = "peaking"; low.frequency.value = 120; low.Q.value = 1; low.gain.value = 3;
      const high = ctx.createBiquadFilter();
      high.type = "peaking"; high.frequency.value = 8000; high.Q.value = 1; high.gain.value = -2;
      append(low); append(high);
      break;
    }
    case "Bright": {
      const high = ctx.createBiquadFilter();
      high.type = "peaking"; high.frequency.value = 8000; high.Q.value = 1; high.gain.value = 3;
      const low = ctx.createBiquadFilter();
      low.type = "peaking"; low.frequency.value = 120; low.Q.value = 1; low.gain.value = -2;
      append(high); append(low);
      break;
    }
    case "Radio": {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 150;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 6000;
      const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 2500; mid.Q.value = 1.5; mid.gain.value = 4;
      append(hp); append(lp); append(mid);
      break;
    }
    case "Telephone": {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3000;
      append(hp); append(lp);
      break;
    }
    case "Boomy Cut": {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 60;
      const cut = ctx.createBiquadFilter(); cut.type = "peaking"; cut.frequency.value = 250; cut.Q.value = 1; cut.gain.value = -4;
      append(hp); append(cut);
      break;
    }
    case "Air Boost": {
      const shelf = ctx.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 10000; shelf.gain.value = 4;
      append(shelf);
      break;
    }
    default:
      break; // "Off" / unknown
  }

  /* De-esser — approximated as a static sibilance-band cut (not sidechained). */
  if (fx.deEsser) {
    const deess = ctx.createBiquadFilter();
    deess.type = "peaking"; deess.frequency.value = 6500; deess.Q.value = 2; deess.gain.value = -6;
    append(deess);
  }

  /* Compression */
  if (fx.compression === "low" || fx.compression === "medium" || fx.compression === "high") {
    const comp = ctx.createDynamicsCompressor();
    if (fx.compression === "low") { comp.threshold.value = -18; comp.ratio.value = 2; }
    else if (fx.compression === "medium") { comp.threshold.value = -24; comp.ratio.value = 4; }
    else { comp.threshold.value = -30; comp.ratio.value = 6; }
    comp.attack.value = 0.005;
    comp.release.value = 0.12;
    comp.knee.value = 3;
    append(comp);
  }

  /* Saturation — soft-clip waveshaper, driven harder for higher levels. */
  if (fx.saturation === "low" || fx.saturation === "medium" || fx.saturation === "high") {
    const drive = fx.saturation === "low" ? 1.3 : fx.saturation === "medium" ? 1.8 : 2.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = buildSoftClipCurve(drive);
    shaper.oversample = "2x";
    append(shaper);
  }

  /* Reverb — short room echo. */
  if (fx.reverb === "light" || fx.reverb === "medium" || fx.reverb === "heavy") {
    const [ms, decay, mix] = fx.reverb === "light" ? [40, 0.7, 0.2] : fx.reverb === "medium" ? [60, 0.8, 0.35] : [90, 0.9, 0.5];
    current = addEchoStage(ctx, current, ms, decay, mix);
    nodes.push(current);
  }

  /* Delay — longer slap/echo taps, separate from reverb. */
  if (fx.delay === "light" || fx.delay === "medium" || fx.delay === "heavy") {
    const [ms, decay, mix] = fx.delay === "light" ? [120, 0.5, 0.2] : fx.delay === "medium" ? [250, 0.6, 0.3] : [400, 0.7, 0.4];
    current = addEchoStage(ctx, current, ms, decay, mix);
    nodes.push(current);
  }

  return { input: entry, output: current, nodes };
}

/** Lane value at time t (hold ends, lerp between) — mirrors
 *  lib/arrangement.ts automationValueAt and the server expression builder. */
function laneValueAt(points: EngineAutomationPoint[] | undefined, t: number, fallback: number): number {
  if (!points || points.length === 0) return fallback;
  const pts = [...points].sort((a, b) => a.time - b.time);
  if (t <= pts[0]!.time) return pts[0]!.value;
  const last = pts[pts.length - 1]!;
  if (t >= last.time) return last.value;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (t <= b.time) {
      const span = b.time - a.time;
      return span <= 0 ? b.value : a.value + ((b.value - a.value) * (t - a.time)) / span;
    }
  }
  return last.value;
}

/** Schedule a breakpoint lane onto an AudioParam starting at ctx time
 *  `now` for arrangement position `from`. Ramps land exactly on the
 *  breakpoints, so the preview curve matches the render expression. */
function scheduleLane(
  param: AudioParam,
  points: EngineAutomationPoint[] | undefined,
  map: (v: number) => number,
  fallback: number,
  from: number,
  now: number,
): void {
  if (!points || points.length === 0) return;
  const pts = [...points].sort((a, b) => a.time - b.time);
  param.setValueAtTime(map(laneValueAt(pts, from, fallback)), now);
  for (const p of pts) {
    if (p.time > from) param.linearRampToValueAtTime(map(p.value), now + (p.time - from));
  }
}

/**
 * Parametric FX chain (Stack 6) — the preview counterpart of the server's
 * buildParametricFxGraph: same step order, same parameter meanings. The
 * reverb is a wet/dry echo stage whose wet gain node is returned so
 * reverb-mix automation can ride it (the render drives the wet branch of
 * its aecho split with the same lane).
 */
function buildParametricEffectChain(
  ctx: AudioContext,
  chain: EngineFxStep[],
): { input: AudioNode; output: AudioNode; nodes: AudioNode[]; reverbWetGain: GainNode | null } {
  const entry = ctx.createGain();
  entry.gain.value = 1;
  const nodes: AudioNode[] = [entry];
  let current: AudioNode = entry;
  let reverbWetGain: GainNode | null = null;

  const append = (node: AudioNode) => {
    current.connect(node);
    current = node;
    nodes.push(node);
  };

  for (const step of chain) {
    if (!step || step.enabled === false) continue;
    switch (step.type) {
      case "eq": {
        for (const band of step.bands ?? []) {
          if (Math.abs(band.gain) < 0.01) continue;
          const f = ctx.createBiquadFilter();
          f.type = "peaking";
          f.frequency.value = Math.min(20000, Math.max(20, band.freq));
          f.Q.value = Math.min(12, Math.max(0.3, band.q));
          f.gain.value = Math.min(24, Math.max(-24, band.gain));
          append(f);
        }
        break;
      }
      case "compressor": {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = Math.min(0, Math.max(-60, step.thresholdDb ?? -18));
        comp.ratio.value = Math.min(20, Math.max(1, step.ratio ?? 3));
        comp.attack.value = Math.min(0.5, Math.max(0.0001, (step.attackMs ?? 10) / 1000));
        comp.release.value = Math.min(1, Math.max(0.01, (step.releaseMs ?? 150) / 1000));
        comp.knee.value = 3;
        append(comp);
        break;
      }
      case "saturation": {
        const shaper = ctx.createWaveShaper();
        shaper.curve = buildSoftClipCurve(Math.min(3, Math.max(1, step.drive ?? 1.5)));
        shaper.oversample = "2x";
        append(shaper);
        break;
      }
      case "delay": {
        /* addEchoStage scales its decay arg by 0.6 into feedback gain and
         * uses its mix arg as the wet gain — pre-divide to land on the
         * same numbers the server graph uses. */
        const stage = addEchoStage(
          ctx,
          current,
          Math.min(2000, Math.max(10, step.timeMs ?? 250)),
          Math.min(0.85, 0.25 + (step.feedback ?? 30) / 100) / 0.6,
          Math.min(0.6, ((step.mix ?? 20) / 100) * 0.7),
        );
        current = stage;
        nodes.push(stage);
        break;
      }
      case "reverb": {
        /* Wet/dry: dry passes at unity, the echo tail rides a wet gain —
         * the node reverb-mix automation schedules onto. */
        const output = ctx.createGain();
        output.gain.value = 1;
        const dry = ctx.createGain();
        dry.gain.value = 1;
        current.connect(dry);
        dry.connect(output);
        const delay = ctx.createDelay(1.5);
        delay.delayTime.value = 0.06;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.54; // ≈ server aecho decay 0.9 × 0.6 cap
        const wet = ctx.createGain();
        wet.gain.value = Math.min(1, Math.max(0, (step.mix ?? 25) / 100));
        current.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(output);
        nodes.push(output, dry, delay, feedback, wet);
        if (!reverbWetGain) reverbWetGain = wet;
        current = output;
        break;
      }
    }
  }

  return { input: entry, output: current, nodes, reverbWetGain };
}

function buildSoftClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

/** Mid-side stereo widening stage. widthPct: 0–100 (50 = neutral). */
function addStereoWidthStage(ctx: AudioContext, input: AudioNode, widthPct: number): AudioNode {
  const widthFactor = clamp(widthPct, 0, 100) / 50; // 0..2, 1 = neutral

  const splitter = ctx.createChannelSplitter(2);
  input.connect(splitter);

  const midSum = ctx.createGain();
  midSum.gain.value = 0.5;
  const invR = ctx.createGain();
  invR.gain.value = -1;
  const sideSum = ctx.createGain();
  sideSum.gain.value = 0.5 * widthFactor;

  splitter.connect(midSum, 0);
  splitter.connect(midSum, 1);
  splitter.connect(sideSum, 0);
  splitter.connect(invR, 1);
  invR.connect(sideSum);

  const left = ctx.createGain();
  const right = ctx.createGain();
  const invSide = ctx.createGain();
  invSide.gain.value = -1;

  midSum.connect(left);
  sideSum.connect(left);
  midSum.connect(right);
  sideSum.connect(invSide);
  invSide.connect(right);

  const merger = ctx.createChannelMerger(2);
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  return merger;
}

/** Approximate makeup gain for the target integrated loudness, relative to
 *  the "streaming" baseline (matches the LUFS deltas used server-side). */
function loudnessMakeupGain(target: string): number {
  if (target === "demo") return Math.pow(10, -5 / 20); // -14 LUFS vs -9 baseline
  if (target === "loud") return Math.pow(10, 3 / 20); // -6 LUFS vs -9 baseline
  return 1;
}

/** Build the master-bus processing chain (everything after the volume/fade
 *  gain node). Rebuilt whenever the processing settings change. */
function buildMasterProcessingChain(ctx: AudioContext, m: EngineMaster): { input: AudioNode; output: AudioNode; nodes: AudioNode[] } {
  const entry = ctx.createGain();
  entry.gain.value = 1;
  const nodes: AudioNode[] = [entry];
  let current: AudioNode = entry;

  const append = (node: AudioNode) => {
    current.connect(node);
    current = node;
    nodes.push(node);
  };

  if (m.compression > 0) {
    const comp = ctx.createDynamicsCompressor();
    comp.ratio.value = 1 + (m.compression / 100) * 9; // 1–10
    comp.threshold.value = -10 - (m.compression / 100) * 20; // -10..-30 dB
    comp.attack.value = 0.005;
    comp.release.value = 0.1;
    comp.knee.value = 3;
    append(comp);
  }

  if (m.eqTone === "dark") {
    const low = ctx.createBiquadFilter(); low.type = "peaking"; low.frequency.value = 120; low.Q.value = 1; low.gain.value = 3;
    const high = ctx.createBiquadFilter(); high.type = "peaking"; high.frequency.value = 8000; high.Q.value = 1; high.gain.value = -2;
    append(low); append(high);
  } else if (m.eqTone === "bright") {
    const high = ctx.createBiquadFilter(); high.type = "peaking"; high.frequency.value = 8000; high.Q.value = 1; high.gain.value = 3;
    const low = ctx.createBiquadFilter(); low.type = "peaking"; low.frequency.value = 120; low.Q.value = 1; low.gain.value = -2;
    append(high); append(low);
  }

  if (m.bassBoost > 0) {
    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowshelf";
    shelf.frequency.value = 100;
    shelf.gain.value = (m.bassBoost / 100) * 10; // 0–10 dB
    append(shelf);
  }

  if (m.stereoWidth !== 50) {
    current = addStereoWidthStage(ctx, current, m.stereoWidth);
    nodes.push(current);
  }

  const makeup = loudnessMakeupGain(m.loudnessTarget);
  if (makeup !== 1) {
    const g = ctx.createGain();
    g.gain.value = makeup;
    append(g);
  }

  if (m.limiter !== false) {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.05;
    lim.knee.value = 0;
    append(lim);
  }

  return { input: entry, output: current, nodes };
}

export class AudioMixEngine {
  private ctx: AudioContext | null = null;
  /** Sums all stem outputs; feeds into the master volume/fade gain. */
  private sumBus: GainNode | null = null;
  /** Volume + fade-in/out envelope automation lives on this node. */
  private masterVolumeGain: GainNode | null = null;
  /** Nodes for the current master processing chain (compression, EQ, etc). */
  private masterChainNodes: AudioNode[] = [];
  private masterChainSig = "";
  private panSupported = true;

  private buffers = new Map<string, AudioBuffer>(); // keyed by url
  private loading = new Set<string>(); // urls currently decoding
  private errors = new Map<string, string>(); // stemId -> message

  private active = new Map<string, ActiveNode>(); // stemId -> nodes
  private stems: EngineStem[] = [];
  private master: EngineMaster = {
    volume: 100,
    fadeIn: false,
    fadeOut: false,
    compression: 0,
    stereoWidth: 50,
    bassBoost: 0,
    eqTone: "balanced",
    loudnessTarget: "streaming",
    limiter: true,
  };

  private playState: PlayState = "stopped";
  private startCtxTime = 0; // ctx.currentTime when playback (re)started
  private startOffset = 0; // mix position at that moment
  private pausedPosition = 0;
  private raf = 0;

  /** Structural fingerprint (which stems / trims / offsets / effects) of the running mix. */
  private topologySig = "";
  /** Bumped on every async start so stale in-flight starts can bail. */
  private startToken = 0;

  private listener: ((snap: EngineSnapshot) => void) | null = null;

  subscribe(cb: (snap: EngineSnapshot) => void): void {
    this.listener = cb;
    this.emit();
  }

  /** Reconcile the engine with the latest stems/master. Loads new audio,
   *  prunes removed audio, and applies live param changes during playback. */
  sync(stems: EngineStem[], master: EngineMaster): void {
    const newSig = this.computeTopologySig(stems);
    this.stems = stems;
    this.master = master;

    const urls = new Set(stems.filter((s) => s.url).map((s) => s.url));
    // Prune cached buffers no longer referenced.
    for (const url of [...this.buffers.keys()]) {
      if (!urls.has(url)) this.buffers.delete(url);
    }
    // Clear stale errors for stems that are gone.
    const ids = new Set(stems.map((s) => s.id));
    for (const id of [...this.errors.keys()]) {
      if (!ids.has(id)) this.errors.delete(id);
    }
    // Kick off decoding for any new urls.
    for (const s of stems) {
      if (s.url && !this.buffers.has(s.url) && !this.loading.has(s.url)) {
        void this.loadBuffer(s.id, s.url);
      }
    }

    if (this.ctx) this.rebuildMasterChainIfNeeded();

    if (this.playState === "playing") {
      if (newSig !== this.topologySig) {
        // A stem was added / removed / replaced, its trim / start offset
        // changed, or its effect chain changed: gain/pan tweaks aren't
        // enough, so seamlessly restart at the current position with the
        // new topology.
        void this.restartAt(this.currentPosition());
      } else {
        this.applyLiveParams();
      }
    }
    this.topologySig = newSig;
    this.emit();
  }

  async play(): Promise<void> {
    if (this.playState === "playing") return;
    const token = ++this.startToken;
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    // Make sure everything decodable is decoded before we start, so tracks stay synced.
    await this.ensureLoaded();
    if (token !== this.startToken) return; // superseded by another start / stop / pause
    const from = this.playState === "paused" ? this.pausedPosition : 0;
    this.startSources(from);
  }

  pause(): void {
    if (this.playState !== "playing") return;
    this.startToken++; // cancel any in-flight start/restart
    this.pausedPosition = this.currentPosition();
    this.teardownSources();
    this.playState = "paused";
    this.stopTick();
    this.emit();
  }

  stop(): void {
    this.startToken++; // cancel any in-flight start/restart
    this.teardownSources();
    this.pausedPosition = 0;
    this.startOffset = 0;
    this.playState = "stopped";
    this.stopTick();
    this.emit();
  }

  /** Move the playhead (used by the arrangement ruler). While playing this
   *  restarts sources at the new position; while paused/stopped it arms
   *  the position the next play() starts from. */
  seek(position: number): void {
    const pos = Math.max(0, position);
    if (this.playState === "playing") {
      void this.restartAt(pos);
    } else {
      this.pausedPosition = pos;
      if (this.playState === "stopped") this.playState = "paused";
      this.emit();
    }
  }

  dispose(): void {
    this.stopTick();
    this.teardownSources();
    this.buffers.clear();
    this.listener = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.sumBus = null;
      this.masterVolumeGain = null;
      this.masterChainNodes = [];
      this.masterChainSig = "";
    }
  }

  // ----- internals -----

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.panSupported = typeof this.ctx.createStereoPanner === "function";

      this.sumBus = this.ctx.createGain();
      this.sumBus.gain.value = 1;
      this.masterVolumeGain = this.ctx.createGain();
      this.masterVolumeGain.gain.value = clamp(this.master.volume, 0, 100) / 100;
      this.sumBus.connect(this.masterVolumeGain);

      this.rebuildMasterChainIfNeeded(true);
    }
    return this.ctx;
  }

  /** Master processing signature: everything except volume/fade (which are
   *  handled by continuous gain automation on masterVolumeGain). */
  private computeMasterChainSig(m: EngineMaster): string {
    return `${m.compression}:${m.eqTone}:${m.bassBoost}:${m.stereoWidth}:${m.loudnessTarget}:${m.limiter}`;
  }

  private rebuildMasterChainIfNeeded(force = false): void {
    const ctx = this.ctx;
    const volGain = this.masterVolumeGain;
    if (!ctx || !volGain) return;
    const sig = this.computeMasterChainSig(this.master);
    if (!force && sig === this.masterChainSig) return;

    // Tear down the old processing chain.
    volGain.disconnect();
    for (const node of this.masterChainNodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }

    const { input, output, nodes } = buildMasterProcessingChain(ctx, this.master);
    volGain.connect(input);
    output.connect(ctx.destination);
    this.masterChainNodes = nodes;
    this.masterChainSig = sig;
  }

  private async loadBuffer(stemId: string, url: string): Promise<void> {
    this.loading.add(url);
    this.errors.delete(stemId);
    this.emit();
    try {
      const ctx = this.ensureContext();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arr);
      this.buffers.set(url, buffer);
    } catch {
      this.errors.set(stemId, "Couldn't decode this file for browser preview.");
    } finally {
      this.loading.delete(url);
      this.emit();
    }
  }

  /** Structural fingerprint: identity, source, trims, timeline offset and
   *  effect chain. Pure gain / pan / mute / solo / master changes do NOT
   *  alter it (those are applied live without a restart). */
  private computeTopologySig(stems: EngineStem[]): string {
    return stems
      .map((s) => `${s.id}:${s.url}:${s.startTime}:${s.trimStart}:${s.trimEnd}:${JSON.stringify(s.effects ?? null)}:${JSON.stringify(s.fxChain ?? null)}:${JSON.stringify(s.automation ?? null)}`)
      .join("|");
  }

  /** Seamlessly rebuild sources at `pos` after a timeline change, ensuring any
   *  newly-added stems are decoded first so the mix stays in sync. */
  private async restartAt(pos: number): Promise<void> {
    const token = ++this.startToken;
    await this.ensureLoaded();
    if (token !== this.startToken || this.playState !== "playing") return; // superseded / no longer playing
    this.startSources(pos);
  }

  private async ensureLoaded(): Promise<void> {
    await Promise.all(
      this.stems
        .filter((s) => s.url && !this.buffers.has(s.url) && !this.loading.has(s.url))
        .map((s) => this.loadBuffer(s.id, s.url)),
    );
    // Wait out any in-flight loads too.
    while (this.loading.size > 0) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  private startSources(from: number): void {
    const ctx = this.ensureContext();
    const sumBus = this.sumBus;
    if (!sumBus) return;
    this.teardownSources();

    const anySolo = this.stems.some((s) => s.solo);
    const now = ctx.currentTime;

    for (const s of this.stems) {
      const buffer = s.url ? this.buffers.get(s.url) : undefined;
      if (!buffer) continue;
      const len = playLength(buffer, s);
      if (len <= 0) continue;

      // Where this stem sits on the timeline: [startTime, startTime + len].
      const into = Math.max(0, from - s.startTime); // seconds already elapsed within this stem
      if (into >= len) continue; // already finished by `from`

      const when = now + Math.max(0, s.startTime - from);
      const offset = Math.max(0, s.trimStart) + into;
      const remaining = len - into;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      /* Parametric chain replaces the preset chain when present — the
       * same precedence as the server render. */
      let fxInput: AudioNode;
      let fxOutput: AudioNode;
      let fxNodes: AudioNode[];
      let reverbWetGain: GainNode | null = null;
      if (s.fxChain && s.fxChain.length > 0) {
        const built = buildParametricEffectChain(ctx, s.fxChain);
        fxInput = built.input;
        fxOutput = built.output;
        fxNodes = built.nodes;
        reverbWetGain = built.reverbWetGain;
      } else {
        const built = buildStemEffectChain(ctx, s.effects);
        fxInput = built.input;
        fxOutput = built.output;
        fxNodes = built.nodes;
      }

      const gain = ctx.createGain();
      gain.gain.value = stemGain(s, anySolo);

      /* Automation rides its own nodes in series so live fader/pan tweaks
       * never fight the scheduled lanes. */
      const autoGain = ctx.createGain();
      autoGain.gain.value = 1;
      fxNodes.push(autoGain);
      scheduleLane(autoGain.gain, s.automation?.volume, (v) => clamp(v, 0, 150) / 100, 100, from, now);
      if (reverbWetGain) {
        const reverbStep = s.fxChain?.find((st) => st.type === "reverb" && st.enabled !== false);
        scheduleLane(reverbWetGain.gain, s.automation?.reverbMix, (v) => clamp(v, 0, 100) / 100, reverbStep?.mix ?? 25, from, now);
      }

      let panner: StereoPannerNode | null = null;
      let autoPan: StereoPannerNode | null = null;
      source.connect(fxInput);
      if (this.panSupported) {
        panner = ctx.createStereoPanner();
        panner.pan.value = clamp(s.pan, -100, 100) / 100;
        if (s.automation?.pan && s.automation.pan.length > 0) {
          autoPan = ctx.createStereoPanner();
          autoPan.pan.value = 0;
          fxNodes.push(autoPan);
          scheduleLane(autoPan.pan, s.automation.pan, (v) => clamp(v, -100, 100) / 100, s.pan, from, now);
          /* The lane IS the pan when it exists (render precedence) — the
           * static panner stays centered so the two don't stack. */
          panner.pan.value = 0;
        }
        if (autoPan) fxOutput.connect(gain).connect(panner).connect(autoPan).connect(autoGain).connect(sumBus);
        else fxOutput.connect(gain).connect(panner).connect(autoGain).connect(sumBus);
      } else {
        fxOutput.connect(gain).connect(autoGain).connect(sumBus);
      }

      try {
        source.start(when, offset, remaining);
      } catch {
        for (const n of fxNodes) { try { n.disconnect(); } catch { /* noop */ } }
        continue;
      }
      this.active.set(s.id, { source, gain, panner, fxNodes });
    }

    this.startOffset = from;
    this.startCtxTime = now;
    this.playState = "playing";
    this.applyMasterEnvelope();
    this.startTick();
    this.emit();
  }

  private teardownSources(): void {
    for (const { source, fxNodes } of this.active.values()) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
      } catch {
        /* noop */
      }
      for (const n of fxNodes) {
        try { n.disconnect(); } catch { /* noop */ }
      }
    }
    this.active.clear();
  }

  /** Update gain/pan/master live without restarting playback. */
  private applyLiveParams(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const anySolo = this.stems.some((s) => s.solo);
    for (const s of this.stems) {
      const node = this.active.get(s.id);
      if (!node) continue;
      node.gain.gain.setTargetAtTime(stemGain(s, anySolo), now, 0.03);
      if (node.panner) node.panner.pan.setTargetAtTime(clamp(s.pan, -100, 100) / 100, now, 0.03);
    }
    this.applyMasterEnvelope();
  }

  /** (Re)apply master volume plus fade-in / fade-out around the current position. */
  private applyMasterEnvelope(): void {
    const ctx = this.ctx;
    const master = this.masterVolumeGain;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const target = clamp(this.master.volume, 0, 100) / 100;
    const dur = this.duration();
    const p = this.currentPosition();

    master.gain.cancelScheduledValues(now);

    // Current value at `now`, honoring whichever fade window we're inside.
    let v0 = target;
    if (this.master.fadeIn && p < FADE_IN_SEC) {
      v0 = target * clamp(p / FADE_IN_SEC, 0, 1);
    } else if (this.master.fadeOut && dur > 0 && p > dur - FADE_OUT_SEC) {
      v0 = target * clamp((dur - p) / FADE_OUT_SEC, 0, 1);
    }
    master.gain.setValueAtTime(v0, now);

    if (this.master.fadeIn && p < FADE_IN_SEC) {
      master.gain.linearRampToValueAtTime(target, now + (FADE_IN_SEC - p));
    }
    if (this.master.fadeOut && dur > 0) {
      const fadeStart = dur - FADE_OUT_SEC;
      if (p < fadeStart) {
        master.gain.setValueAtTime(target, now + (fadeStart - p));
      }
      master.gain.linearRampToValueAtTime(0, now + Math.max(0.01, dur - p));
    }
  }

  private duration(): number {
    let max = 0;
    for (const s of this.stems) {
      const buffer = s.url ? this.buffers.get(s.url) : undefined;
      if (!buffer) continue;
      max = Math.max(max, Math.max(0, s.startTime) + playLength(buffer, s));
    }
    return max;
  }

  private currentPosition(): number {
    if (this.playState === "playing" && this.ctx) {
      return this.startOffset + (this.ctx.currentTime - this.startCtxTime);
    }
    if (this.playState === "paused") return this.pausedPosition;
    return 0;
  }

  private startTick(): void {
    this.stopTick();
    const tick = () => {
      const dur = this.duration();
      if (dur > 0 && this.currentPosition() >= dur) {
        this.stop();
        return;
      }
      this.emit();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopTick(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private emit(): void {
    if (!this.listener) return;
    this.listener({
      playState: this.playState,
      loading: this.loading.size > 0,
      position: this.currentPosition(),
      duration: this.duration(),
      errors: [...this.errors.entries()].map(([id, message]) => ({ id, message })),
      ready: this.buffers.size > 0,
      panSupported: this.panSupported,
    });
  }
}
