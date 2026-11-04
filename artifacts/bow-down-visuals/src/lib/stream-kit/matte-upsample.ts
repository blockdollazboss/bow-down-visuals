/**
 * matte-upsample.ts — edge-aware upsampling of a low-resolution
 * alpha matte to the compositor's output size, guided by the
 * full-resolution frame the matte was computed from.
 *
 * WHY THIS EXISTS (green-screen step-up, Nov 4, 2026): the Pro
 * engine's matte is computed at its feed resolution (hundreds of
 * px wide) and the compositor used to stretch it over a 1080p
 * canvas with a plain bilinear drawImage. Bilinear knows nothing
 * about the picture: every edge lands wherever the low-res grid
 * puts it, smeared across the ×2–×3 scale factor — a soft fringe
 * several output pixels wide. Apple's pipeline segments at full
 * sensor resolution; a browser engine cannot, but it CAN put
 * the edge back where the full-res frame says it is.
 *
 * HOW — a GUIDED FILTER (He, Sun & Tang 2010) used as the
 * upsampler, in its joint-upsampling form: in every small
 * window on the FEED grid, alpha is fitted as a linear function
 * of the guide's brightness (alpha ≈ a·I + b, least squares —
 * at feed resolution the matte's own transition is still steep,
 * so the fit is tight); the coefficient fields a and b are
 * smooth, so they are bilinearly upsampled; the output is the
 * fit evaluated on the FULL-RES guide. Where a window straddles
 * a real two-colour edge (hair against a wall), the two colour
 * clusters determine the line almost exactly, so the output
 * alpha transitions where the GUIDE transitions — within a
 * pixel or two — instead of where the feed grid put it. Where
 * the guide is flat, the fit degenerates to the window's mean
 * alpha (a ≈ 0), i.e. the plain smooth value: the filter can
 * only sharpen, never invent structure the guide doesn't have.
 * Closed-form math on typed arrays — no learned model, no new
 * assets, no licence surface.
 *
 * THE HONEST LIMIT: guidance redistributes only what the
 * low-res matte knows. A hair strand thinner than one feed cell
 * is averaged into that cell's alpha before any upsampler sees
 * it — no upsampling recovers it. That is why this module pairs
 * with the higher feed steps in rvm-engine.ts (a smaller cell
 * loses fewer strands), and why both together still do not
 * equal a sensor-resolution segmentation.
 *
 * COST DISCIPLINE: the filter is O(1) per pixel (separable box
 * sums), but at 1080p that is still real main-thread work per
 * landed matte. A call that overruns its time budget twice in a
 * row latches the upsampler OFF for the session (the caller
 * falls back to the plain raster), because a refinement that
 * janks the studio is worse than a soft edge.
 *
 * Pure math on typed arrays, no DOM — unit-tested directly. The
 * caller (background-changer.ts) rasterises the guide frame.
 */

export interface GuideImage {
  /** Pixel bytes, row-major, at the OUTPUT size — RGB (3 bytes
   *  per pixel) or RGBA (4, the canvas ImageData layout; the
   *  alpha byte is ignored). */
  rgb: Uint8ClampedArray | Uint8Array;
  /** Bytes per pixel in `rgb`: 3 or 4. Default 3. */
  components?: 3 | 4;
  width: number;
  height: number;
}

export interface MatteUpsampleOptions {
  /** Regularisation for the linear fit (guide-brightness units,
   *  squared). Larger = the fit trusts local alpha means more
   *  and the guide's edges less. Default 0.002. */
  eps?: number;
  /** Time budget per call in ms; two consecutive overruns latch
   *  the upsampler off until reset(). Default 48. */
  budgetMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

/** Bilinear sample of a row-major field at fractional coords. */
export function bilinear(field: Float32Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const a = field[y0 * w + x0];
  const b = field[y0 * w + x1];
  const c = field[y1 * w + x0];
  const d = field[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Separable box blur (edge-clamped, sliding sums), src → dst. */
function boxBlur(src: Float32Array, w: number, h: number, r: number, dst: Float32Array, scratch: Float32Array): void {
  /* Horizontal pass into scratch. */
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      scratch[row + x] = sum / (2 * r + 1);
      const outX = Math.max(0, Math.min(w - 1, x - r));
      const inX = Math.max(0, Math.min(w - 1, x + r + 1));
      sum += src[row + inX] - src[row + outX];
    }
  }
  /* Vertical pass into dst. */
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += scratch[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / (2 * r + 1);
      const outY = Math.max(0, Math.min(h - 1, y - r));
      const inY = Math.max(0, Math.min(h - 1, y + r + 1));
      sum += scratch[inY * w + x] - scratch[outY * w + x];
    }
  }
}

export class MatteUpsampler {
  private readonly _eps: number;
  private readonly _budgetMs: number;
  private readonly _now: () => number;
  private _overruns = 0;
  /** True once the cost governor has latched the upsampler off. */
  disabled = false;
  /** Duration of the most recent completed call, ms. */
  lastMs = 0;

  constructor(opts: MatteUpsampleOptions = {}) {
    this._eps = opts.eps ?? 0.002;
    this._budgetMs = opts.budgetMs ?? 48;
    this._now = opts.now ?? (() => performance.now());
  }

  /** Re-arm after a latch-off (engine swap, camera switch). */
  reset(): void {
    this.disabled = false;
    this._overruns = 0;
  }

  /**
   * Upsample `alpha` (mw×mh, 0..1) to the guide's size.
   * Returns a new Float32Array at guide resolution, or null when
   * there is nothing to gain (matte already at/above output
   * size), the inputs are malformed, or the governor has
   * latched off — the caller then keeps its plain raster path.
   */
  upsample(alpha: Float32Array, mw: number, mh: number, guide: GuideImage): Float32Array | null {
    if (this.disabled) return null;
    const W = guide.width;
    const H = guide.height;
    const comp = guide.components ?? 3;
    if (mw >= W || mw <= 0 || mh <= 0 || W <= 0 || H <= 0) return null;
    if (alpha.length < mw * mh || guide.rgb.length < W * H * comp) return null;

    const t0 = this._now();
    const N = W * H;
    const rgb = guide.rgb;

    /* Guide brightness at output size (the evaluation target)
       and sampled onto the feed grid (the fit's input). */
    const Ifull = new Float32Array(N);
    for (let i = 0, j = 0; i < N; i++, j += comp) {
      Ifull[i] = (rgb[j] * 0.299 + rgb[j + 1] * 0.587 + rgb[j + 2] * 0.114) / 255;
    }
    const MN = mw * mh;
    const Ilow = new Float32Array(MN);
    for (let y = 0; y < mh; y++) {
      const gy = ((y + 0.5) / mh) * H - 0.5;
      for (let x = 0; x < mw; x++) {
        Ilow[y * mw + x] = bilinear(Ifull, W, H, ((x + 0.5) / mw) * W - 0.5, gy);
      }
    }

    /* Per-window linear fit ON THE FEED GRID: means via box
       blurs at feed resolution (cheap — the feed is small). */
    const r = 2;
    const scratch = new Float32Array(MN);
    const meanI = new Float32Array(MN);
    const meanA = new Float32Array(MN);
    const meanIA = new Float32Array(MN);
    const meanI2 = new Float32Array(MN);
    const prod = new Float32Array(MN);
    boxBlur(Ilow, mw, mh, r, meanI, scratch);
    boxBlur(alpha, mw, mh, r, meanA, scratch);
    for (let i = 0; i < MN; i++) prod[i] = Ilow[i] * alpha[i];
    boxBlur(prod, mw, mh, r, meanIA, scratch);
    for (let i = 0; i < MN; i++) prod[i] = Ilow[i] * Ilow[i];
    boxBlur(prod, mw, mh, r, meanI2, scratch);
    const aLow = new Float32Array(MN);
    const bLow = new Float32Array(MN);
    for (let i = 0; i < MN; i++) {
      const cov = meanIA[i] - meanI[i] * meanA[i];
      const varI = meanI2[i] - meanI[i] * meanI[i];
      aLow[i] = cov / (varI + this._eps);
      bLow[i] = meanA[i] - aLow[i] * meanI[i];
    }

    /* Coefficients are smooth fields — bilinear upsampling is
       the correct interpolation for them — then evaluate the
       fit on the full-res guide. */
    const out = new Float32Array(N);
    const scaleX = mw / W;
    const scaleY = mh / H;
    for (let y = 0; y < H; y++) {
      const cy = (y + 0.5) * scaleY - 0.5;
      const rowOut = y * W;
      for (let x = 0; x < W; x++) {
        const cx = (x + 0.5) * scaleX - 0.5;
        const a = bilinear(aLow, mw, mh, cx, cy);
        const b = bilinear(bLow, mw, mh, cx, cy);
        const v = a * Ifull[rowOut + x] + b;
        out[rowOut + x] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }

    this.lastMs = this._now() - t0;
    if (this.lastMs > this._budgetMs) {
      this._overruns++;
      if (this._overruns >= 2) this.disabled = true;
    } else {
      this._overruns = 0;
    }
    return out;
  }
}
