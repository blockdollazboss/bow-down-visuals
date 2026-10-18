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
 *      calms it. (Single-frame callers pass emaWeight 1.)
 *   2. Choke — a small constant subtracted from semi-transparent
 *      pixels only. Kills the background-colored fringe that clings
 *      to edges without touching the solid core or true hair detail
 *      (fully transparent / fully opaque pixels are untouched).
 *   3. Levels curve — remap [lo, hi] to [0, 1]. Hardens the core of
 *      the matte while the choke + feather preserve a soft edge.
 *   4. Feather — one separable [1,2,1] blur pass (~1-2 px). Runs
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
}

export class MattePostProcessor {
  private _emaWeight: number;
  private _choke: number;
  private _lo: number;
  private _hi: number;
  private _featherPasses: number;
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
 * Green despill on a composited person layer, in place. Only the
 * edge band (alpha strictly between the bounds) is touched: where
 * green dominates both other channels — the signature of background
 * spill — it is pulled most of the way down toward the stronger of
 * red/blue. Interior pixels (solid person) and fully transparent
 * pixels are never touched, so green clothing and green screens in
 * the scene keep their color.
 */
export function despillRgba(data: Uint8ClampedArray, bandLo = 10, bandHi = 245): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= bandLo || a >= bandHi) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const m = r > b ? r : b;
    if (g > m) data[i + 1] = Math.round(m + (g - m) * 0.35);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
