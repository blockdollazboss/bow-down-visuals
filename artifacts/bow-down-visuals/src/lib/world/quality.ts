/**
 * quality.ts — the World quality ladder (Overhaul Stage B, items
 * 22 + 99). Pure data + pure logic (no three.js, no DOM except an
 * injected storage), so the ladder, the frame-time monitor and the
 * persistence are unit-testable anywhere; hall-scene.ts applies a
 * rung to the live renderer.
 *
 * Item 22 — adaptive ladder: the rung used to be guessed ONCE from
 * pointer+cores and never revisited (audit E1). Now an explicit
 * user preference (Auto / High / Medium / Low, persisted like the
 * view mode) rules; in Auto a FrameTimeMonitor watches the rolling
 * frame time and steps the rung down under sustained load and back
 * up when there is comfortable headroom — with separate up/down
 * thresholds (hysteresis), a sustain window on both sides, and a
 * cooldown after every step, so the ladder can never oscillate.
 * The monitor's ceiling is the hardware-detected rung: Auto never
 * climbs above what the device was guessed capable of at boot.
 *
 * Item 99 — meaningful rungs: each rung now differs on reflector
 * size/on-off, shadow map size/on-off, anisotropy, particle scale,
 * LOD draw distance and reflector update cadence — not just the
 * old four variables (audit E7). DELIBERATE rung redefinitions vs
 * the pre-overhaul ladder, documented here as the item requires:
 *   - LOW keeps the brazier point lights (brazierLights: true at
 *     every rung). The old low rung set candleLights=false, which
 *     also killed the courtyard braziers — the night plaza's ONLY
 *     dynamic lights. Low now cuts elsewhere first: no shadow maps,
 *     no reflector, pixel ratio 1.25, anisotropy 4, particle scale
 *     0.3, LOD draw distance 60 m, and the *decorative* candle
 *     extras (sconce points + shell lantern points, candleLights)
 *     go emissive-only.
 *   - MEDIUM reflector updates every 2nd frame while the mirror is
 *     only a glimpse (see visibility.ts reflector gate); inside the
 *     hall it updates every frame at every rung that has one.
 *   - antialias is a CONSTRUCTION-time flag: the table carries it
 *     (a scene built for low gets no MSAA), but stepping the ladder
 *     at runtime cannot toggle MSAA without rebuilding the renderer
 *     — runtime steps apply everything else and the flag takes
 *     effect on the next entry. Recorded here so nobody promises
 *     otherwise.
 * The static-sun frozen shadow map and the phone pixel-ratio rungs
 * (stage 3) are unchanged: pixelRatio stays 2 / 1.5 / 1.25.
 */

export type QualityTier = "high" | "medium" | "low";
export type QualityPreference = "auto" | QualityTier;

export const QUALITY_TIERS: readonly QualityTier[] = ["high", "medium", "low"] as const;

export interface QualityRung {
  tier: QualityTier;
  /** Renderer pixel-ratio cap (stage-3 phone rungs, unchanged). */
  pixelRatio: number;
  /** Planar reflector render-target size; 0 = no reflector. */
  reflectorSize: number;
  /** Reflector update cadence when the mirror is only glimpsed
   *  through the arch (every Nth frame); inside the hall it is 1. */
  reflectorGlimpseEveryN: number;
  shadows: boolean;
  /** Directional shadow map size (0 when shadows are off). */
  shadowMapSize: number;
  /** Construction-time MSAA (see header note). */
  antialias: boolean;
  /** Texture anisotropy cap (further capped by the device max). */
  anisotropy: number;
  /** Fraction of ambient particles (dust motes) drawn, 0..1. */
  particleScale: number;
  /** LOD: dressing beyond this distance (m) is hidden; detail
   *  children simplify from half of it (see visibility.ts). */
  lodDrawDistance: number;
  /** Brazier point lights — the night plaza's key lights. ON at
   *  every rung (item 99 fix); never the first thing cut. */
  brazierLights: boolean;
  /** Decorative candle extras: sconce points + shell lantern
   *  points. Off at low (emissive-only), where braziers carry. */
  candleLights: boolean;
}

export const QUALITY_RUNGS: Record<QualityTier, QualityRung> = {
  high: {
    tier: "high",
    pixelRatio: 2,
    reflectorSize: 1024,
    reflectorGlimpseEveryN: 1,
    shadows: true,
    shadowMapSize: 2048,
    antialias: true,
    anisotropy: 16,
    particleScale: 1,
    lodDrawDistance: 120,
    brazierLights: true,
    candleLights: true,
  },
  medium: {
    tier: "medium",
    pixelRatio: 1.5,
    reflectorSize: 512,
    reflectorGlimpseEveryN: 2,
    shadows: true,
    shadowMapSize: 1024,
    antialias: true,
    anisotropy: 8,
    particleScale: 0.6,
    lodDrawDistance: 90,
    brazierLights: true,
    candleLights: true,
  },
  low: {
    tier: "low",
    pixelRatio: 1.25,
    reflectorSize: 0,
    reflectorGlimpseEveryN: 1,
    shadows: false,
    shadowMapSize: 0,
    antialias: false,
    anisotropy: 4,
    particleScale: 0.3,
    lodDrawDistance: 60,
    brazierLights: true,
    candleLights: false,
  },
};

export function rungFor(tier: QualityTier): QualityRung {
  return QUALITY_RUNGS[tier];
}

/** One rung down (toward low); null when already at the floor. */
export function stepDownTier(tier: QualityTier): QualityTier | null {
  return tier === "high" ? "medium" : tier === "medium" ? "low" : null;
}

/** One rung up (toward high); null when already at the ceiling. */
export function stepUpTier(tier: QualityTier): QualityTier | null {
  return tier === "low" ? "medium" : tier === "medium" ? "high" : null;
}

/**
 * The boot-time hardware guess — the same heuristic the world has
 * always used (coarse pointer starts a rung lower; core count
 * breaks the tie), now pure so it is testable and reusable as the
 * Auto monitor's ceiling.
 */
export function detectInitialTier(coarsePointer: boolean, cores: number): QualityTier {
  const c = Number.isFinite(cores) && cores > 0 ? cores : 4;
  if (coarsePointer) return c >= 6 ? "medium" : "low";
  return c >= 4 ? "high" : "medium";
}

/** An explicit preference pins the rung; Auto defers to the
 *  detected/monitored rung. */
export function resolveTier(pref: QualityPreference, autoTier: QualityTier): QualityTier {
  return pref === "auto" ? autoTier : pref;
}

/* ── Persistence (view-mode.ts pattern) ─────────────────────────── */

export const WORLD_QUALITY_STORAGE_KEY = "bdv.worldQuality";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Anything unrecognized is Auto — the ladder as it should be. */
export function normalizeQualityPreference(value: string | null | undefined): QualityPreference {
  return value === "high" || value === "medium" || value === "low" ? value : "auto";
}

export function loadQualityPreference(storage: StorageLike | null = defaultStorage()): QualityPreference {
  if (!storage) return "auto";
  try {
    return normalizeQualityPreference(storage.getItem(WORLD_QUALITY_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function storeQualityPreference(
  pref: QualityPreference,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (pref === "auto") storage.removeItem(WORLD_QUALITY_STORAGE_KEY);
    else storage.setItem(WORLD_QUALITY_STORAGE_KEY, pref);
  } catch {
    /* private mode etc. — the choice still applies this visit */
  }
}

/** The footer control's cycle: Auto → High → Medium → Low → Auto. */
export function nextQualityPreference(pref: QualityPreference): QualityPreference {
  return pref === "auto" ? "high" : pref === "high" ? "medium" : pref === "medium" ? "low" : "auto";
}

export function qualityPreferenceLabel(pref: QualityPreference): string {
  return pref === "auto" ? "Auto" : pref === "high" ? "High" : pref === "medium" ? "Medium" : "Low";
}

/* ── Frame-time monitor (item 22) ─────────────────────────────────
 * Rolling average over a sliding window of recent frame times.
 * Step DOWN when the average sits above DOWN_MS for DOWN_SUSTAIN
 * consecutive samples; step UP only when it sits below UP_MS for
 * UP_SUSTAIN samples. DOWN_MS (20 ms ≈ 50 fps) and UP_MS
 * (12.5 ms ≈ 80 fps) leave a wide dead band between them — a
 * device hovering at 60 fps triggers neither — and after any step
 * a COOLDOWN_MS lockout ignores further steps while the new rung
 * settles. Samples are fed with an explicit clock (ms) so tests
 * drive time deterministically; the scene feeds performance.now().
 */
export const FRAME_MONITOR = {
  /** Window of frame times kept for the rolling average. */
  windowSize: 60,
  downMs: 20,
  upMs: 12.5,
  /** ~1.5 s of sustained overload at 60 fps before stepping down. */
  downSustainSamples: 90,
  /** ~8 s of sustained headroom before stepping back up — climbing
   *  back is deliberately much more reluctant than dropping. */
  upSustainSamples: 480,
  cooldownMs: 5000,
  /** Samples above this are hitches (tab switch, GC pause), not
   *  load: they are dropped so one stall can't drag the rung. */
  maxSampleMs: 100,
} as const;

export class FrameTimeMonitor {
  private samples: number[] = [];
  private overStreak = 0;
  private underStreak = 0;
  private lastStepAtMs = Number.NEGATIVE_INFINITY;
  /** The rung Auto is currently running (starts at the ceiling). */
  current: QualityTier;
  /** Auto never climbs above this rung (the boot hardware guess). */
  readonly ceiling: QualityTier;

  constructor(ceiling: QualityTier) {
    this.ceiling = ceiling;
    this.current = ceiling;
  }

  /** The rolling average frame time (ms), or null before samples. */
  get averageMs(): number | null {
    if (this.samples.length === 0) return null;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  /** Reset after an external rung change (user pin, scene rebuild):
   *  streaks and the window clear, and the cooldown restarts so an
   *  explicit choice is never instantly overridden. */
  reset(tier: QualityTier, nowMs: number): void {
    this.current = tier;
    this.samples = [];
    this.overStreak = 0;
    this.underStreak = 0;
    this.lastStepAtMs = nowMs;
  }

  /**
   * Feed one frame. Returns the new tier when the ladder steps,
   * null otherwise. `nowMs` is the caller's monotonic clock.
   */
  sample(frameMs: number, nowMs: number): QualityTier | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > FRAME_MONITOR.maxSampleMs) {
      return null;
    }
    this.samples.push(frameMs);
    if (this.samples.length > FRAME_MONITOR.windowSize) this.samples.shift();
    // Need a reasonably full window before judging — the first
    // frames of a scene (shader compiles, texture uploads) are not
    // the device's steady state.
    if (this.samples.length < FRAME_MONITOR.windowSize / 2) return null;
    const avg = this.averageMs!;
    if (avg > FRAME_MONITOR.downMs) {
      this.overStreak++;
      this.underStreak = 0;
    } else if (avg < FRAME_MONITOR.upMs) {
      this.underStreak++;
      this.overStreak = 0;
    } else {
      this.overStreak = 0;
      this.underStreak = 0;
    }
    if (nowMs - this.lastStepAtMs < FRAME_MONITOR.cooldownMs) return null;
    if (this.overStreak >= FRAME_MONITOR.downSustainSamples) {
      const next = stepDownTier(this.current);
      if (!next) {
        this.overStreak = 0;
        return null;
      }
      this.current = next;
      this.overStreak = 0;
      this.underStreak = 0;
      this.lastStepAtMs = nowMs;
      return next;
    }
    if (this.underStreak >= FRAME_MONITOR.upSustainSamples) {
      const next = stepUpTier(this.current);
      // QUALITY_TIERS is ordered best-first, so a smaller index is
      // a better rung: Auto may step up only while the result is
      // no better than the ceiling (index >= the ceiling's).
      if (!next || QUALITY_TIERS.indexOf(next) < QUALITY_TIERS.indexOf(this.ceiling)) {
        this.underStreak = 0;
        return null;
      }
      this.current = next;
      this.overStreak = 0;
      this.underStreak = 0;
      this.lastStepAtMs = nowMs;
      return next;
    }
    return null;
  }
}
