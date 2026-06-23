/**
 * Browser-only multi-track preview mix engine built on the Web Audio API.
 *
 * It decodes each stem once, then plays every stem together in sync through a
 * per-stem gain + (optional) stereo-pan node into a shared master gain node.
 * Volume / mute / solo / pan / master-volume changes are applied live while
 * playing. Trim and start-offset are applied when (re)starting playback.
 *
 * This is a PREVIEW engine only — no rendering, mastering or export.
 */

const FADE_IN_SEC = 1.5;
const FADE_OUT_SEC = 2.5;

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
}

export interface EngineMaster {
  /** 0–100 */
  volume: number;
  fadeIn: boolean;
  fadeOut: boolean;
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

export class AudioMixEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private panSupported = true;

  private buffers = new Map<string, AudioBuffer>(); // keyed by url
  private loading = new Set<string>(); // urls currently decoding
  private errors = new Map<string, string>(); // stemId -> message

  private active = new Map<string, ActiveNode>(); // stemId -> nodes
  private stems: EngineStem[] = [];
  private master: EngineMaster = { volume: 100, fadeIn: false, fadeOut: false };

  private playState: PlayState = "stopped";
  private startCtxTime = 0; // ctx.currentTime when playback (re)started
  private startOffset = 0; // mix position at that moment
  private pausedPosition = 0;
  private raf = 0;

  /** Structural fingerprint (which stems / trims / offsets) of the running mix. */
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
    if (this.playState === "playing") {
      if (newSig !== this.topologySig) {
        // A stem was added / removed / replaced, or its trim / start offset
        // changed: gain/pan tweaks aren't enough, so seamlessly restart at the
        // current position with the new timeline.
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
      this.masterGain = null;
    }
  }

  // ----- internals -----

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.panSupported = typeof this.ctx.createStereoPanner === "function";
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = clamp(this.master.volume, 0, 100) / 100;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
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

  /** Structural fingerprint: identity, source, trims and timeline offset.
   *  Pure gain / pan / mute / solo / master changes do NOT alter it. */
  private computeTopologySig(stems: EngineStem[]): string {
    return stems.map((s) => `${s.id}:${s.url}:${s.startTime}:${s.trimStart}:${s.trimEnd}`).join("|");
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
    const master = this.masterGain;
    if (!master) return;
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

      const gain = ctx.createGain();
      gain.gain.value = stemGain(s, anySolo);

      let panner: StereoPannerNode | null = null;
      if (this.panSupported) {
        panner = ctx.createStereoPanner();
        panner.pan.value = clamp(s.pan, -100, 100) / 100;
        source.connect(gain).connect(panner).connect(master);
      } else {
        source.connect(gain).connect(master);
      }

      try {
        source.start(when, offset, remaining);
      } catch {
        continue;
      }
      this.active.set(s.id, { source, gain, panner });
    }

    this.startOffset = from;
    this.startCtxTime = now;
    this.playState = "playing";
    this.applyMasterEnvelope();
    this.startTick();
    this.emit();
  }

  private teardownSources(): void {
    for (const { source } of this.active.values()) {
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
    const master = this.masterGain;
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
