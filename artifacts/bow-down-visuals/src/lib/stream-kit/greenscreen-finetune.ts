/**
 * greenscreen-finetune.ts — the creator's fine-tune settings for
 * the Go Live green screen (owner directive, Oct 29, 2026: "there
 * should be extra settings to fine-tune my green screen").
 *
 * WHAT IS HONESTLY ADJUSTABLE (the census behind this module):
 * both matting engines — the Pro RVM worker and the MediaPipe
 * Tasks segmenter — hand their alpha to ONE post pipeline
 * (matte-post.ts MattePostProcessor) in background-changer.ts, so
 * the matte knobs below tune BOTH engines through the same math:
 *
 *   sensitivity → the levels curve, translated. The curve's
 *     [lo, hi] window slides together: up = a stricter cut (faint
 *     edge pixels stop counting as person), down = a looser one
 *     (wispy hair survives). The curve WIDTH never changes — this
 *     is a threshold move, not a contrast change.
 *   edgeShift → matte-post's morphological stage: shrink (erode)
 *     kills the colour halo outside the true edge; grow (dilate)
 *     fills gaps the engine ate. Integer px at matte resolution.
 *   softness → extra feather passes over the base tuning's own
 *     (negative = fewer, down to a hard rim).
 *   smoothing → the temporal blend weight, offset: higher
 *     smoothing = more frame history = calmer edges, slower to
 *     follow motion; lower = snappier, flickerier.
 *   spill → the compositor's despill strength (despillRgba's
 *     retention): how much of the green excess on edge pixels is
 *     pulled down toward the other channels.
 *   blur → the blur backdrop's blur radius (the compositor's own
 *     blurAmount — it existed in the kit with no UI until now).
 *   dim → the photo backdrop's brightness (a compositor filter on
 *     the backdrop draw only; the person is never dimmed).
 *
 * COMPOSITION LAW: the perf ladders own the BASE tuning (the
 * Tasks refinement steps / the Pro near-identity tuning / the
 * processor defaults). These settings are OFFSETS over whatever
 * base is live, re-derived every time either side moves, so a
 * ladder retune never stomps the creator's hand and the creator's
 * hand never freezes the ladder. At the DEFAULTS every offset is
 * neutral and the composed options are the base, value for value —
 * a creator who never opens Fine-tune gets the shipped picture
 * exactly (bench-pinned in greenscreen-finetune.bench.test.ts).
 *
 * Persistence is the house localStorage pattern (guarded
 * try/catch, `bdv-` key): the panel loads once, saves on every
 * change, and Reset returns to these defaults.
 */

import type { MattePostOptions } from "./matte-post";

export interface GreenScreenFineTune {
  /** Cut sensitivity, −50..+50 (0 = the engine's own threshold). */
  sensitivity: number;
  /** Edge shift, −3..+3 px (negative shrinks, positive grows). */
  edgeShift: number;
  /** Extra feather passes over the base tuning, −2..+3. */
  softness: number;
  /** Motion smoothing, 0..100 (50 = the engine's own blend). */
  smoothing: number;
  /** Green-spill cleanup strength, 0..100 (65 = shipped strength). */
  spill: number;
  /** Blur backdrop radius, 0..40 px (18 = shipped default). */
  blur: number;
  /** Photo backdrop dim, 0..85 % (0 = full brightness). */
  dim: number;
}

export const GREENSCREEN_FINETUNE_DEFAULTS: GreenScreenFineTune = {
  sensitivity: 0,
  edgeShift: 0,
  softness: 0,
  smoothing: 50,
  spill: 65,
  blur: 18,
  dim: 0,
};

export const GREENSCREEN_FINETUNE_KEY = "bdv-greenscreen-finetune";

/** Levels shift at full sensitivity deflection (curve units). */
const SENSITIVITY_MAX_SHIFT = 0.2;
/** EMA-weight offset at full smoothing deflection. */
const SMOOTHING_MAX_OFFSET = 0.3;

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Coerce anything (stored JSON, a partial patch, junk) into a
 * complete, in-range settings value. Unknown fields are dropped;
 * missing or non-numeric fields fall back to the defaults.
 */
export function sanitizeFineTune(value: unknown): GreenScreenFineTune {
  const v = (value ?? {}) as Partial<Record<keyof GreenScreenFineTune, unknown>>;
  const d = GREENSCREEN_FINETUNE_DEFAULTS;
  return {
    sensitivity: num(v.sensitivity, d.sensitivity, -50, 50),
    edgeShift: Math.round(num(v.edgeShift, d.edgeShift, -3, 3)),
    softness: Math.round(num(v.softness, d.softness, -2, 3)),
    smoothing: num(v.smoothing, d.smoothing, 0, 100),
    spill: num(v.spill, d.spill, 0, 100),
    blur: num(v.blur, d.blur, 0, 40),
    dim: num(v.dim, d.dim, 0, 85),
  };
}

export function isDefaultFineTune(ft: GreenScreenFineTune): boolean {
  const d = GREENSCREEN_FINETUNE_DEFAULTS;
  return (
    ft.sensitivity === d.sensitivity &&
    ft.edgeShift === d.edgeShift &&
    ft.softness === d.softness &&
    ft.smoothing === d.smoothing &&
    ft.spill === d.spill &&
    ft.blur === d.blur &&
    ft.dim === d.dim
  );
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Load the saved settings (defaults when nothing valid is saved). */
export function loadGreenScreenFineTune(storage: StorageLike | null = defaultStorage()): GreenScreenFineTune {
  if (!storage) return { ...GREENSCREEN_FINETUNE_DEFAULTS };
  try {
    const raw = storage.getItem(GREENSCREEN_FINETUNE_KEY);
    if (!raw) return { ...GREENSCREEN_FINETUNE_DEFAULTS };
    return sanitizeFineTune(JSON.parse(raw));
  } catch {
    return { ...GREENSCREEN_FINETUNE_DEFAULTS };
  }
}

/** Save the settings (best-effort — a blocked store never breaks the studio). */
export function saveGreenScreenFineTune(ft: GreenScreenFineTune, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(GREENSCREEN_FINETUNE_KEY, JSON.stringify(sanitizeFineTune(ft)));
  } catch {
    /* storage unavailable — the settings still apply for the session */
  }
}

/** The matte-post base the kit runs under a given engine state —
 *  what composition offsets are applied OVER. */
export interface MatteBaseTuning {
  emaWeight: number;
  choke: number;
  curveLo: number;
  curveHi: number;
  featherPasses: number;
}

/** The MattePostProcessor's own defaults — the base when no
 *  engine tuning has been applied (mirrors matte-post.ts). */
export const MATTE_BASE_DEFAULTS: MatteBaseTuning = {
  emaWeight: 0.55,
  choke: 0.05,
  curveLo: 0.06,
  curveHi: 0.94,
  featherPasses: 1,
};

/**
 * Compose the effective matte-post options: the live base tuning
 * with the creator's offsets applied. At the fine-tune defaults
 * this returns the base value-for-value (plus edgeShift 0) — the
 * identity the whole feature stands on. The motion-snap fields
 * are NOT composed here: they are the studio's motion fix, set at
 * processor construction, and configure() leaves them untouched
 * when absent.
 */
export function composeMattePostOptions(base: MatteBaseTuning, ft: GreenScreenFineTune): MattePostOptions {
  const shift = (ft.sensitivity / 50) * SENSITIVITY_MAX_SHIFT;
  let lo = clamp01(base.curveLo + shift);
  let hi = clamp01(base.curveHi + shift);
  if (hi - lo < 0.1) {
    // A hard deflection against a clamped edge (the Pro base runs
    // [0, 1]): keep a usable curve width around the moved centre.
    const mid = Math.min(0.95, Math.max(0.05, (lo + hi) / 2));
    lo = mid - 0.05;
    hi = mid + 0.05;
  }
  const emaOffset = ((50 - ft.smoothing) / 50) * SMOOTHING_MAX_OFFSET;
  return {
    emaWeight: clamp(base.emaWeight + emaOffset, 0.05, 1),
    choke: base.choke,
    curveLo: lo,
    curveHi: hi,
    featherPasses: Math.min(5, Math.max(0, Math.round(base.featherPasses) + ft.softness)),
    edgeShift: ft.edgeShift,
  };
}

/** The despill retention the compositor runs for these settings.
 *  Spill 65 (the default) maps to the shipped 0.35 exactly; spill
 *  0 keeps all the excess green (retention 1 — no cleanup), spill
 *  100 pulls it all (retention 0). */
export function despillRetentionFor(ft: GreenScreenFineTune): number {
  return clamp(1 - ft.spill / 100, 0, 1);
}

/** The ctx.filter brightness for the photo backdrop at these
 *  settings, or null when no filter should be set at all (dim 0 —
 *  the backdrop draw stays exactly the shipped one). */
export function backdropFilterFor(ft: GreenScreenFineTune): string | null {
  if (ft.dim <= 0) return null;
  return `brightness(${(1 - ft.dim / 100).toFixed(3)})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
