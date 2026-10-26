/* ─── N14 Stems Player — fan playback layer ───────────────────────────────
   A song "carries stems" when its track payload / playback endpoint
   says so (the Stem Splitter's key set: vocals, drums, bass, other,
   plus the Pro tier's guitar + piano). Fans solo/mute those stems
   DURING playback. Playback only: this module fetches stem audio
   solely to play it — it exposes no download URL list UI, no export,
   no save path, and stem URLs are never persisted (not to
   localStorage, not into the queue).

   Sync approach: one HTMLAudioElement per stem (the same element
   class the master player uses), all started together, all seeked
   together, pause/play applied to all. Mute/solo ONLY changes
   per-stem gain — it never touches play state or position, so it
   can never restart playback. Honest drift handling: a periodic
   check re-seeks any stem that drifts more than DRIFT_RESYNC_SEC
   from the leader stem; there is no pretending HTMLAudio elements
   stay sample-locked on their own. */

export const STEM_PLAYER_KEYS = ["vocals", "drums", "bass", "other", "guitar", "piano"] as const;
export type StemPlayerKey = (typeof STEM_PLAYER_KEYS)[number];

export const STEM_PLAYER_LABELS: Record<StemPlayerKey, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Melody / Other",
  guitar: "Guitar",
  piano: "Piano",
};

export interface StemDescriptor {
  key: StemPlayerKey;
  label: string;
}

export interface PlayableStem extends StemDescriptor {
  url: string;
}

export type StemMixState = Record<string, { muted: boolean; solo: boolean }>;

/** Drift beyond this (seconds) triggers a plain re-seek to the leader. */
export const DRIFT_RESYNC_SEC = 0.25;

function isStemKey(v: unknown): v is StemPlayerKey {
  return typeof v === "string" && (STEM_PLAYER_KEYS as readonly string[]).includes(v);
}

function byCanonicalOrder(a: StemDescriptor, b: StemDescriptor): number {
  return STEM_PLAYER_KEYS.indexOf(a.key) - STEM_PLAYER_KEYS.indexOf(b.key);
}

/**
 * Sanitize a track DTO's `stems` field (keys + labels only — the DTO
 * never carries URLs). Returns null when the track carries no stems:
 * callers render NO stem controls (honest absence, no dead buttons).
 * A partial set stays exactly partial.
 */
export function normalizeStemDescriptors(raw: unknown): StemDescriptor[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: StemDescriptor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const key = (item as { key?: unknown }).key;
    if (!isStemKey(key) || seen.has(key)) continue;
    seen.add(key);
    const label = (item as { label?: unknown }).label;
    out.push({ key, label: typeof label === "string" && label ? label : STEM_PLAYER_LABELS[key] });
  }
  if (out.length === 0) return null;
  return out.sort(byCanonicalOrder);
}

/**
 * Sanitize the playback endpoint's payload into playable stems.
 * Only known keys with real http(s) URLs survive — a raw storage ref
 * or junk entry is dropped, never played and never shown.
 */
export function normalizePlayableStems(raw: unknown): PlayableStem[] {
  const list = Array.isArray(raw) ? raw : (raw as { stems?: unknown } | null)?.stems;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: PlayableStem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const key = (item as { key?: unknown }).key;
    const url = (item as { url?: unknown }).url;
    if (!isStemKey(key) || seen.has(key)) continue;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    seen.add(key);
    const label = (item as { label?: unknown }).label;
    out.push({ key, label: typeof label === "string" && label ? label : STEM_PLAYER_LABELS[key], url });
  }
  return out.sort(byCanonicalOrder);
}

/** Fetch the playback-only stem URLs for a track. [] on any failure —
    the caller falls back to the normal master playback, stemless. */
export async function fetchTrackStemPlayback(trackId: string): Promise<PlayableStem[]> {
  try {
    const r = await fetch(`/api/media/track/${encodeURIComponent(trackId)}/stems/playback`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return [];
    return normalizePlayableStems(await r.json().catch(() => null));
  } catch {
    return [];
  }
}

/**
 * Audible gain (0 or 1) for one stem under a mix state. Solo wins as
 * a filter (when anything is soloed, only soloed stems sound), and a
 * stem's own mute always silences it. Pure — the mix logic's pin.
 */
export function stemGain(key: string, mix: StemMixState): number {
  const anySolo = Object.values(mix).some((s) => s?.solo && !s?.muted);
  const mine = mix[key];
  if (mine?.muted) return 0;
  if (anySolo) return mine?.solo ? 1 : 0;
  return 1;
}

export function initialStemMix(stems: readonly StemDescriptor[]): StemMixState {
  const out: StemMixState = {};
  for (const s of stems) out[s.key] = { muted: false, solo: false };
  return out;
}

/* ─── Synchronized multi-stem playback engine ─────────────────────────── */

export interface StemAudioLike {
  src: string;
  currentTime: number;
  duration: number;
  volume: number;
  paused: boolean;
  play: () => Promise<void> | void;
  pause: () => void;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
}

export interface StemEngineCallbacks {
  onTime?: (t: number) => void;
  onDuration?: (d: number) => void;
  onEnded?: () => void;
  onPlayState?: (playing: boolean) => void;
}

export class StemPlaybackEngine {
  private stems: Array<PlayableStem & { el: StemAudioLike }> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private masterVolume = 0.8;
  private masterMuted = false;
  private mix: StemMixState = {};
  /** Stems corrected by the last drift check (observable, testable). */
  lastResync: string[] = [];

  constructor(
    private createAudio: () => StemAudioLike = () => new Audio() as unknown as StemAudioLike,
    private callbacks: StemEngineCallbacks = {},
  ) {}

  get playable(): PlayableStem[] {
    return this.stems.map(({ key, label, url }) => ({ key, label, url }));
  }

  get leader(): StemAudioLike | null {
    return this.stems[0]?.el ?? null;
  }

  get currentTime(): number {
    return this.leader?.currentTime ?? 0;
  }

  get duration(): number {
    const d = this.leader?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  get playing(): boolean {
    const l = this.leader;
    return !!l && !l.paused;
  }

  load(stems: PlayableStem[], mix: StemMixState): void {
    this.dispose(false);
    this.mix = { ...mix };
    this.stems = stems.map((s) => {
      const el = this.createAudio();
      el.src = s.url;
      return { ...s, el };
    });
    const leader = this.leader;
    if (leader?.addEventListener) {
      leader.addEventListener("timeupdate", this.handleTime);
      leader.addEventListener("loadedmetadata", this.handleDuration);
      leader.addEventListener("durationchange", this.handleDuration);
      leader.addEventListener("ended", this.handleEnded);
      leader.addEventListener("play", this.handlePlayState);
      leader.addEventListener("pause", this.handlePlayState);
    }
    this.applyMix();
  }

  private handleTime = () => {
    this.callbacks.onTime?.(this.currentTime);
    this.checkDrift();
  };
  private handleDuration = () => this.callbacks.onDuration?.(this.duration);
  private handleEnded = () => {
    this.stopTimer();
    this.callbacks.onEnded?.();
  };
  private handlePlayState = () => this.callbacks.onPlayState?.(this.playing);

  setMasterVolume(volume: number, muted: boolean): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.masterMuted = muted;
    this.applyMix();
  }

  /** Mute/solo changes gains ONLY — play state and positions are
      never touched here, so a mix change can never restart a stem. */
  applyMix(mix?: StemMixState): void {
    if (mix) this.mix = { ...mix };
    for (const s of this.stems) {
      s.el.volume = this.masterMuted ? 0 : this.masterVolume * stemGain(s.key, this.mix);
    }
  }

  async play(): Promise<void> {
    await Promise.all(this.stems.map((s) => {
      try { return s.el.play(); } catch { return undefined; }
    })).catch(() => {});
    this.startTimer();
    this.callbacks.onPlayState?.(this.playing);
  }

  pause(): void {
    for (const s of this.stems) s.el.pause();
    this.stopTimer();
    this.callbacks.onPlayState?.(false);
  }

  /** Seek EVERY stem to the same position — they move together. */
  seek(t: number): void {
    const max = this.duration || t;
    const target = Math.max(0, Math.min(t, max));
    for (const s of this.stems) s.el.currentTime = target;
    this.callbacks.onTime?.(target);
  }

  /**
   * The honest drift pass: any stem more than DRIFT_RESYNC_SEC away
   * from the leader is re-seeked to the leader's position. Returns
   * the keys corrected on this pass.
   */
  checkDrift(): string[] {
    const leader = this.leader;
    this.lastResync = [];
    if (!leader || leader.paused) return this.lastResync;
    const t = leader.currentTime;
    for (const s of this.stems.slice(1)) {
      if (Math.abs(s.el.currentTime - t) > DRIFT_RESYNC_SEC) {
        s.el.currentTime = t;
        this.lastResync.push(s.key);
      }
    }
    return this.lastResync;
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      this.checkDrift();
      this.callbacks.onTime?.(this.currentTime);
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  dispose(notify = true): void {
    this.stopTimer();
    const leader = this.leader;
    if (leader?.removeEventListener) {
      leader.removeEventListener("timeupdate", this.handleTime);
      leader.removeEventListener("loadedmetadata", this.handleDuration);
      leader.removeEventListener("durationchange", this.handleDuration);
      leader.removeEventListener("ended", this.handleEnded);
      leader.removeEventListener("play", this.handlePlayState);
      leader.removeEventListener("pause", this.handlePlayState);
    }
    for (const s of this.stems) {
      try { s.el.pause(); } catch { /* noop */ }
      s.el.src = "";
    }
    this.stems = [];
    if (notify) this.callbacks.onPlayState?.(false);
  }
}
