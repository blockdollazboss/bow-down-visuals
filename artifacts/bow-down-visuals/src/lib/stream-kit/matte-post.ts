/**
 * matte-post.ts — matte post-processing for the matting paths: the
 * Go Live studio's segmentation engine (background-changer.ts) and
 * the still-photo matting path (photo-matting.ts). Pure math on
 * Float32Array alpha mattes (values 0..1), no DOM — unit-tested
 * directly.
 *
 * The pipeline, in order:
 *   1. Temporal blend (EMA) — cross-frame smoothing. The studio
 *      engine's mask flickers frame to frame, and blending is what
 *      calms it. (Single-frame callers pass emaWeight 1.) The blend
 *      is MOTION-ADAPTIVE when `motionSnap` is set: a pixel whose
 *      matte barely changed keeps the calming base weight, while a
 *      pixel whose matte swung hard — the subject's boundary just
 *      moved through it — takes the new matte (near-)whole. A plain
 *      EMA cannot tell those apart: it lags a moving subject exactly
 *      as much as it calms a still one, which reads on screen as a
 *      ghost trail where the subject was and a body that takes
 *      frames to be cut out where it now is.
 *   2. Choke — a small constant subtracted from semi-transparent
 *      pixels only. Kills the background-colored fringe that clings
 *      to edges without touching the solid core or true hair detail
 *      (fully transparent / fully opaque pixels are untouched).
 *   3. Levels curve — remap [lo, hi] to [0, 1]. Hardens the core of
 *      the matte while the choke + feather preserve a soft edge.
 *   4. Edge shift — a morphological pass (greenscreen fine-tune,
 *      Oct 29, 2026): a negative shift ERODES the matte (a sliding
 *      minimum — the cutout shrinks, killing colour halos that
 *      cling outside the true edge); a positive shift DILATES it
 *      (a sliding maximum — the cutout grows, filling gaps the
 *      engine ate). Zero (the default) skips the stage entirely,
 *      so an untouched pipeline is byte-for-byte the old one. Runs
 *      after the curve (it moves the hardened edge, not the raw
 *      gradient) and before the feather (which then softens the
 *      shifted rim).
 *   5. Feather — one separable [1,2,1] blur pass (~1-2 px). Runs
 *      AFTER the curve so the hardened core keeps a soft rim instead
 *      of a stair-stepped one.
 */

export interface MattePostOptions {
  /** Weight of the NEW frame in the temporal blend (0..1). Higher =
   *  snappier, lower = smoother. Default 0.55. */
  emaWeight?: number;
  /** Alpha subtracted from semi-transparent pixels (fringe choke).
   *  Default 0.05. */
  choke?: number;
  /** Levels low point: input at or below becomes 0. Default 0.06. */
  curveLo?: number;
  /** Levels high point: input at or above becomes 1. Default 0.94. */
  curveHi?: number;
  /** Feather blur passes after the curve. Default 1. */
  featherPasses?: number;
  /** Edge shift, −3..+3 (px at matte resolution): negative erodes
   *  (shrinks) the matte, positive dilates (grows) it. Default 0 —
   *  the stage is skipped, byte-for-byte the legacy pipeline. */
  edgeShift?: number;
  /** Motion snap, 0..1: how strongly a large per-pixel matte change
   *  overrides the temporal blend (see the header note). 0 (the
   *  default) is the legacy pure-EMA blend, byte-for-byte; 1 makes a
   *  hard matte swing land in a single frame. The studio path opts
   *  in; the still-photo path never sets it. */
  motionSnap?: number;
  /** Matte delta at or below which the blend is untouched (per-pixel
   *  jitter under this is flicker, and keeps the calming weight).
   *  Default 0.08. */
  motionSnapLo?: number;
  /** Matte delta at or above which the snap reaches full strength.
   *  Default 0.35. */
  motionSnapHi?: number;
}

export class MattePostProcessor {
  private _emaWeight: number;
  private _choke: number;
  private _lo: number;
  private _hi: number;
  private _featherPasses: number;
  private _edgeShift: number;
  private _motionSnap: number;
  private _motionLo: number;
  private _motionHi: number;
  private _ema: Float32Array | null = null;
  private _out: Float32Array | null = null;
  private _scratch: Float32Array | null = null;
  private _w = 0;
  private _h = 0;

  constructor(options: MattePostOptions = {}) {
    this._emaWeight = clamp01(options.emaWeight ?? 0.55);
    this._choke = Math.max(0, options.choke ?? 0.05);
    this._lo = clamp01(options.curveLo ?? 0.06);
    this._hi = clamp01(options.curveHi ?? 0.94);
    this._featherPasses = Math.max(0, Math.floor(options.featherPasses ?? 1));
    this._edgeShift = clampEdgeShift(options.edgeShift ?? 0);
    this._motionSnap = clamp01(options.motionSnap ?? 0);
    this._motionLo = clamp01(options.motionSnapLo ?? 0.08);
    this._motionHi = clamp01(options.motionSnapHi ?? 0.35);
  }

  /**
   * Retune the pipeline live (the studio's matte-refinement steps —
   * background-changer.ts MATTE_REFINEMENT_STEPS). Only the fields
   * present in `options` change; the temporal-blend state is kept
   * (a geometry change still reseeds it inside process(), as
   * before), so a step change never ghosts the previous matte.
   */
  configure(options: MattePostOptions): void {
    if (options.emaWeight !== undefined) this._emaWeight = clamp01(options.emaWeight);
    if (options.choke !== undefined) this._choke = Math.max(0, options.choke);
    if (options.curveLo !== undefined) this._lo = clamp01(options.curveLo);
    if (options.curveHi !== undefined) this._hi = clamp01(options.curveHi);
    if (options.featherPasses !== undefined) this._featherPasses = Math.max(0, Math.floor(options.featherPasses));
    if (options.edgeShift !== undefined) this._edgeShift = clampEdgeShift(options.edgeShift);
    if (options.motionSnap !== undefined) this._motionSnap = clamp01(options.motionSnap);
    if (options.motionSnapLo !== undefined) this._motionLo = clamp01(options.motionSnapLo);
    if (options.motionSnapHi !== undefined) this._motionHi = clamp01(options.motionSnapHi);
  }

  /** Forget all temporal state (camera switch, resize, engine swap). */
  reset(): void {
    this._ema = null;
    this._w = 0;
    this._h = 0;
  }

  /**
   * Process one matte. `alpha` is read, never retained; the returned
   * array is an internal buffer reused across calls (consume it
   * before the next call).
   */
  process(alpha: Float32Array, width: number, height: number): Float32Array {
    const n = width * height;
    if (this._w !== width || this._h !== height || !this._ema || !this._out || !this._scratch) {
      this._ema = new Float32Array(n);
      this._out = new Float32Array(n);
      this._scratch = new Float32Array(n);
      this._w = width;
      this._h = height;
      // First frame at this size: no history to blend against.
      this._ema.set(alpha.subarray(0, n));
    } else if (this._motionSnap > 0) {
      // Motion-adaptive blend: the per-pixel weight rises from the
      // calming base toward 1 as the matte's swing at that pixel
      // grows past the jitter band — a boundary that MOVED lands
      // this frame (no ghost where the subject was, no eaten body
      // where it now is), while a still pixel's small flicker keeps
      // the base weight and stays calm.
      const wNew = this._emaWeight;
      const snap = this._motionSnap;
      const lo = this._motionLo;
      const span = Math.max(1e-6, this._motionHi - lo);
      const ema = this._ema;
      for (let i = 0; i < n; i++) {
        const prev = ema[i];
        const cur = alpha[i];
        const d = cur >= prev ? cur - prev : prev - cur;
        let w = wNew;
        if (d > lo) {
          const t = Math.min(1, (d - lo) / span);
          const s = t * t * (3 - 2 * t); // smoothstep: no hard knee at the band edge
          w = wNew + (1 - wNew) * snap * s;
        }
        ema[i] = w * cur + (1 - w) * prev;
      }
    } else {
      const wNew = this._emaWeight;
      const wOld = 1 - wNew;
      const ema = this._ema;
      for (let i = 0; i < n; i++) ema[i] = wNew * alpha[i] + wOld * ema[i];
    }

    const out = this._out;
    const ema = this._ema;
    const { _choke: choke, _lo: lo, _hi: hi } = this;
    const range = Math.max(1e-6, hi - lo);
    for (let i = 0; i < n; i++) {
      let a = ema[i];
      if (a > 0 && a < 1) a -= choke; // fringe choke — semi-transparent only
      if (a <= lo) a = 0;
      else if (a >= hi) a = 1;
      else a = (a - lo) / range;
      out[i] = a;
    }

    if (this._edgeShift !== 0) {
      edgeShiftPass(out, this._scratch, width, height, Math.abs(this._edgeShift), this._edgeShift > 0);
    }

    for (let p = 0; p < this._featherPasses; p++) featherPass(out, this._scratch, width, height);
    return out;
  }
}

/** One separable [1,2,1]/4 blur pass over `data` (in place), using
 *  `scratch` as the intermediate buffer. Exported for tests. */
export function featherPass(data: Float32Array, scratch: Float32Array, width: number, height: number): void {
  // Horizontal.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < width - 1 ? x + 1 : width - 1;
      scratch[row + x] = (data[row + xm] + 2 * data[row + x] + data[row + xp]) * 0.25;
    }
  }
  // Vertical.
  for (let y = 0; y < height; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < height - 1 ? y + 1 : height - 1;
    const row = y * width;
    const rowM = ym * width;
    const rowP = yp * width;
    for (let x = 0; x < width; x++) {
      data[row + x] = (scratch[rowM + x] + 2 * scratch[row + x] + scratch[rowP + x]) * 0.25;
    }
  }
}

/**
 * One morphological pass over `data` (in place), using `scratch`
 * as the intermediate buffer: the horizontal sliding window runs
 * into `scratch`, the vertical one back into `data`. With
 * `grow = false` every pixel takes the window MINIMUM (erosion —
 * the matte shrinks by `radius` px on every side); with
 * `grow = true` the window MAXIMUM (dilation — it grows by
 * `radius`). Windows clamp at the frame edges, matching
 * featherPass. Exported for tests.
 */
export function edgeShiftPass(
  data: Float32Array,
  scratch: Float32Array,
  width: number,
  height: number,
  radius: number,
  grow: boolean,
): void {
  const r = Math.max(1, Math.floor(radius));
  // Horizontal.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let best = data[row + x];
      for (let k = 1; k <= r; k++) {
        const xm = data[row + (x - k > 0 ? x - k : 0)];
        const xp = data[row + (x + k < width - 1 ? x + k : width - 1)];
        if (grow ? xm > best : xm < best) best = xm;
        if (grow ? xp > best : xp < best) best = xp;
      }
      scratch[row + x] = best;
    }
  }
  // Vertical.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const ym = y - r > 0 ? y - r : 0;
    const yp = y + r < height - 1 ? y + r : height - 1;
    for (let x = 0; x < width; x++) {
      let best = scratch[row + x];
      for (let yy = ym; yy <= yp; yy++) {
        if (yy === y) continue;
        const v = scratch[yy * width + x];
        if (grow ? v > best : v < best) best = v;
      }
      data[row + x] = best;
    }
  }
}

/**
 * Green despill on a composited person layer, in place. Only the
 * edge band (alpha strictly between the bounds) is touched: where
 * green dominates both other channels — the signature of background
 * spill — it is pulled down toward the stronger of red/blue,
 * keeping the `retention` fraction of the excess (0.35 shipped —
 * "most of the way down"). The fine-tune's spill control moves
 * retention: 1 keeps all the excess (no cleanup), 0 pulls green
 * all the way to the stronger channel. Interior pixels (solid
 * person) and fully transparent pixels are never touched, so
 * green clothing and green screens in the scene keep their color.
 */
export function despillRgba(data: Uint8ClampedArray, bandLo = 10, bandHi = 245, retention = 0.35): void {
  const keep = retention < 0 ? 0 : retention > 1 ? 1 : retention;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= bandLo || a >= bandHi) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const m = r > b ? r : b;
    if (g > m) data[i + 1] = Math.round(m + (g - m) * keep);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampEdgeShift(v: number): number {
  const n = Math.round(Number.isFinite(v) ? v : 0);
  return n < -3 ? -3 : n > 3 ? 3 : n;
}
