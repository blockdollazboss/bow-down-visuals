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
      .map((s) => `${s.id}:${s.url}:${s.startTime}:${s.trimStart}:${s.trimEnd}:${JSON.stringify(s.effects ?? null)}`)
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

      const { input: fxInput, output: fxOutput, nodes: fxNodes } = buildStemEffectChain(ctx, s.effects);

      const gain = ctx.createGain();
      gain.gain.value = stemGain(s, anySolo);

      let panner: StereoPannerNode | null = null;
      source.connect(fxInput);
      if (this.panSupported) {
        panner = ctx.createStereoPanner();
        panner.pan.value = clamp(s.pan, -100, 100) / 100;
        fxOutput.connect(gain).connect(panner).connect(sumBus);
      } else {
        fxOutput.connect(gain).connect(sumBus);
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
