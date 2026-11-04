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
 * several output pixels wide and hair strands (thinner than one
 * low-res pixel) averaged away entirely. Apple's pipeline
 * segments at full sensor resolution; a browser engine cannot,
 * but it CAN put the edge back where the full-res frame says it
 * is. That is what a joint bilateral upsample does: each output
 * pixel takes its alpha from the low-res matte neighbourhood,
 * weighted by how much the GUIDE frame (the exact frame the
 * matte describes) at each tap looks like the guide at the
 * output pixel. Where the guide has a hard edge (hair against
 * wall), only same-side taps contribute, so the alpha edge snaps
 * to the picture's real edge instead of the grid's.
 *
 * COST DISCIPLINE: most of a frame is not edge. A pixel whose
 * whole tap neighbourhood is uniformly 0 or uniformly 1 takes
 * the bilinear value (the taps all agree — guidance cannot
 * change it); only the semi-transparent band pays for the full
 * weighted sum. A call that overruns its time budget twice
 * latches the upsampler off for the rest of the session (the
 * caller falls back to the plain raster), because a refinement
 * that janks the studio is worse than a soft edge.
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
  /** Range (colour) sigma: how different a tap's guide colour
   *  may be before it stops contributing. In 0..1 RGB units.
   *  Default 0.18. */
  rangeSigma?: number;
  /** Per-call time budget (ms). Two consecutive overruns latch
   *  the upsampler off. Default 48. */
  budgetMs?: number;
  /** Clock for the budget governor (tests inject one). */
  now?: () => number;
}

const DEFAULT_RANGE_SIGMA = 0.18;
const DEFAULT_BUDGET_MS = 48;
/** Taps further than this (in low-res px) never contribute. */
const TAP_RADIUS = 1;
/** A neighbourhood whose taps all sit at/below this is "empty";
 *  at/above the complement is "solid". Between them is the band. */
const UNIFORM_LO = 0.002;
const UNIFORM_HI = 0.998;

export class MatteUpsampler {
  private readonly _rangeSigma: number;
  private readonly _budgetMs: number;
  private readonly _now: () => number;
  private _overruns = 0;
  /** True once the budget governor has latched this upsampler
   *  off — the caller should stop asking (plain raster instead). */
  disabled = false;
  /** Duration of the most recent guided call (ms), or null. */
  lastMs: number | null = null;

  constructor(options: MatteUpsampleOptions = {}) {
    this._rangeSigma = Math.max(0.02, options.rangeSigma ?? DEFAULT_RANGE_SIGMA);
    this._budgetMs = Math.max(1, options.budgetMs ?? DEFAULT_BUDGET_MS);
    this._now = options.now ?? (() => performance.now());
  }

  /** Re-arm after a latch-off (engine swap, resize, step change). */
  reset(): void {
    this._overruns = 0;
    this.disabled = false;
    this.lastMs = null;
  }

  /**
   * Upsample `alpha` (mw×mh) to the guide's size (W×H), guided
   * by `guide`. Returns a W×H Float32Array, or null when the
   * caller should use its plain path instead (latched off, or
   * the matte already matches/exceeds the guide size — guidance
   * adds nothing when there is no upsampling to do).
   */
  upsample(alpha: Float32Array, mw: number, mh: number, guide: GuideImage): Float32Array | null {
    if (this.disabled) return null;
    const W = guide.width;
    const H = guide.height;
    const comp = guide.components ?? 3;
    if (mw >= W || mw <= 0 || mh <= 0 || W <= 0 || H <= 0) return null;
    if (alpha.length < mw * mh || guide.rgb.length < W * H * comp) return null;

    const t0 = this._now();
    const out = new Float32Array(W * H);
    const rgb = guide.rgb;
    const scaleX = mw / W;
    const scaleY = mh / H;
    const rangeDenom = 2 * this._rangeSigma * this._rangeSigma;
    const taps: number[] = [];

    for (let y = 0; y < H; y++) {
      /* Low-res centre of this output row, and its tap rows. */
      const cy = (y + 0.5) * scaleY - 0.5;
      const y0 = Math.floor(cy);
      const fy = cy - y0;
      const rowOut = y * W;
      const guideRow = y * W * comp;
      for (let x = 0; x < W; x++) {
        const cx = (x + 0.5) * scaleX - 0.5;
        const x0 = Math.floor(cx);
        const fx = cx - x0;

        /* Pass 1 — the tap alphas and their spread. A
           neighbourhood that is uniformly empty or uniformly
           solid cannot be moved by guidance: take the bilinear
           value and skip the weighted sum entirely. */
        taps.length = 0;
        let minA = 1;
        let maxA = 0;
        for (let dy = -TAP_RADIUS; dy <= TAP_RADIUS; dy++) {
          const ty = Math.min(mh - 1, Math.max(0, y0 + dy));
          const tapRow = ty * mw;
          for (let dx = -TAP_RADIUS; dx <= TAP_RADIUS; dx++) {
            const tx = Math.min(mw - 1, Math.max(0, x0 + dx));
            const a = alpha[tapRow + tx];
            taps.push(a);
            if (a < minA) minA = a;
            if (a > maxA) maxA = a;
          }
        }
        if (maxA <= UNIFORM_LO || minA >= UNIFORM_HI) {
          out[rowOut + x] = bilinear(alpha, mw, mh, cx, cy);
          continue;
        }

        /* Pass 2 — the guided sum over the same taps: spatial
           falloff × guide-colour similarity to THIS output
           pixel's guide colour. */
        const gr = rgb[guideRow + x * comp];
        const gg = rgb[guideRow + x * comp + 1];
        const gb = rgb[guideRow + x * comp + 2];
        let wSum = 0;
        let aSum = 0;
        let ti = 0;
        for (let dy = -TAP_RADIUS; dy <= TAP_RADIUS; dy++) {
          const ty = Math.min(mh - 1, Math.max(0, y0 + dy));
          const wy = 1 - Math.abs(fy - dy) / (TAP_RADIUS + 1);
          const gy = Math.min(H - 1, Math.max(0, Math.round((ty + 0.5) / scaleY - 0.5)));
          const guideTapRow = gy * W * comp;
          for (let dx = -TAP_RADIUS; dx <= TAP_RADIUS; dx++, ti++) {
            const tx = Math.min(mw - 1, Math.max(0, x0 + dx));
            const wx = 1 - Math.abs(fx - dx) / (TAP_RADIUS + 1);
            const gx = Math.min(W - 1, Math.max(0, Math.round((tx + 0.5) / scaleX - 0.5)));
            const gi = guideTapRow + gx * comp;
            const dr = (rgb[gi] - gr) / 255;
            const dg = (rgb[gi + 1] - gg) / 255;
            const db = (rgb[gi + 2] - gb) / 255;
            const dist2 = dr * dr + dg * dg + db * db;
            const w = wx * wy * Math.exp(-dist2 / rangeDenom);
            wSum += w;
            aSum += w * taps[ti];
          }
        }
        out[rowOut + x] = wSum > 1e-9 ? aSum / wSum : bilinear(alpha, mw, mh, cx, cy);
      }
    }

    const ms = this._now() - t0;
    this.lastMs = ms;
    if (ms > this._budgetMs) {
      this._overruns++;
      if (this._overruns >= 2) this.disabled = true;
    } else {
      this._overruns = 0;
    }
    return out;
  }
}

/** Plain bilinear sample of `alpha` at low-res coords (cx, cy). */
export function bilinear(alpha: Float32Array, mw: number, mh: number, cx: number, cy: number): number {
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const xa = Math.min(mw - 1, Math.max(0, x0));
  const xb = Math.min(mw - 1, Math.max(0, x0 + 1));
  const ya = Math.min(mh - 1, Math.max(0, y0));
  const yb = Math.min(mh - 1, Math.max(0, y0 + 1));
  const top = alpha[ya * mw + xa] * (1 - fx) + alpha[ya * mw + xb] * fx;
  const bot = alpha[yb * mw + xa] * (1 - fx) + alpha[yb * mw + xb] * fx;
  return top * (1 - fy) + bot * fy;
}
