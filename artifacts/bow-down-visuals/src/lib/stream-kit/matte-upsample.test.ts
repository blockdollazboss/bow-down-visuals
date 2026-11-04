/**
 * matte-upsample.test.ts — the guided matte upsampler
 * (matte-upsample.ts): joint bilateral upsampling of a low-res
 * alpha matte against the full-res frame it describes.
 *
 * The claim under test, in numbers: when the low-res matte's
 * edge sits off the picture's real edge (the feed grid put it
 * there), the guided upsample moves the alpha transition back
 * onto the guide's edge, while a plain bilinear stretch leaves
 * it smeared where the grid put it. Scenes are synthetic and
 * exact: a hard guide edge + a 1px "hair strand", with the
 * low-res matte derived by box-averaging the true alpha (what
 * a feed-resolution engine can know).
 */
import { describe, expect, it } from "vitest";
import { MatteUpsampler, bilinear } from "./matte-upsample";

const W = 96;
const H = 54;
const MW = 24; // 4x downsample, like a 480px matte under a 1920px composite
const MH = 14;
const EDGE_X = 62; // true edge in output px — deliberately NOT on the 4px feed grid
const STRAND_X = 24; // 1px hair strand in output px

const HAIR: [number, number, number] = [38, 30, 26];
const WALL: [number, number, number] = [203, 192, 172];

function buildScene() {
  const rgb = new Uint8ClampedArray(W * H * 3);
  const trueAlpha = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= EDGE_X || x === STRAND_X;
      const c = inside ? HAIR : WALL;
      const i = (y * W + x) * 3;
      rgb[i] = c[0];
      rgb[i + 1] = c[1];
      rgb[i + 2] = c[2];
      trueAlpha[y * W + x] = inside ? 1 : 0;
    }
  }
  /* The low-res matte an engine at feed resolution produces:
     the true alpha box-averaged onto the feed grid. */
  const low = new Float32Array(MW * MH);
  const sx = W / MW;
  const sy = H / MH;
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      let sum = 0;
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
          sum += trueAlpha[yy * W + xx];
          n++;
        }
      }
      low[y * MW + x] = sum / n;
    }
  }
  return { rgb, trueAlpha, low };
}

/** Sub-pixel position where alpha crosses `level` along a row. */
function crossingAt(alpha: Float32Array, width: number, y: number, fromX: number, level: number): number {
  for (let x = fromX; x < width - 1; x++) {
    const a = alpha[y * width + x];
    const b = alpha[y * width + x + 1];
    if ((a - level) * (b - level) <= 0 && a !== b) return x + (level - a) / (b - a);
  }
  return -1;
}

/** Fringe width: output px between the 0.1 and 0.9 crossings. */
function fringeWidth(alpha: Float32Array, width: number, y: number, nearX: number): number {
  const lo = crossingAt(alpha, width, y, nearX - 14, 0.1);
  const hi = crossingAt(alpha, width, y, nearX - 14, 0.9);
  return Math.abs(hi - lo);
}

function mae(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function bilinearField(alpha: Float32Array, mw: number, mh: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = bilinear(alpha, mw, mh, (x + 0.5) * (mw / w) - 0.5, (y + 0.5) * (mh / h) - 0.5);
    }
  }
  return out;
}

describe("MatteUpsampler", () => {
  it("collapses the fringe: the alpha transition snaps to the guide's edge", () => {
    const { rgb, low } = buildScene();
    const up = new MatteUpsampler().upsample(low, MW, MH, { rgb, width: W, height: H });
    expect(up).not.toBeNull();
    const plain = bilinearField(low, MW, MH, W, H);
    const y = Math.floor(H / 2);
    const guidedFringe = fringeWidth(up!, W, y, EDGE_X);
    const plainFringe = fringeWidth(plain, W, y, EDGE_X);
    /* The plain stretch smears the edge across most of two feed
       cells (a feed cell is 4 output px here). */
    expect(plainFringe).toBeGreaterThan(4);
    /* The guided edge transitions within ~2 output px, centred
       on the picture's real edge. */
    expect(guidedFringe).toBeLessThanOrEqual(2.5);
    expect(guidedFringe).toBeLessThan(plainFringe / 2);
    const guidedCross = crossingAt(up!, W, y, EDGE_X - 14, 0.5);
    expect(Math.abs(guidedCross - EDGE_X)).toBeLessThanOrEqual(1.5);
  });

  it("lowers whole-scene alpha error against the true matte", () => {
    const { rgb, trueAlpha, low } = buildScene();
    const up = new MatteUpsampler().upsample(low, MW, MH, { rgb, width: W, height: H })!;
    const plain = bilinearField(low, MW, MH, W, H);
    expect(mae(up, trueAlpha)).toBeLessThan(mae(plain, trueAlpha));
  });

  it("is exact on uniform mattes (nothing for guidance to move)", () => {
    const rgb = new Uint8ClampedArray(W * H * 3).fill(120);
    const solid = new Float32Array(MW * MH).fill(1);
    const empty = new Float32Array(MW * MH).fill(0);
    const up = new MatteUpsampler();
    const a = up.upsample(solid, MW, MH, { rgb, width: W, height: H })!;
    const b = up.upsample(empty, MW, MH, { rgb, width: W, height: H })!;
    expect(a.every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
    expect(b.every((v) => Math.abs(v) < 1e-6)).toBe(true);
  });

  it("refuses when there is no upsampling to do", () => {
    const { rgb, low } = buildScene();
    const up = new MatteUpsampler();
    expect(up.upsample(low, W, H, { rgb, width: W, height: H })).toBeNull();
    expect(up.upsample(low, MW, MH, { rgb: new Uint8ClampedArray(4), width: W, height: H })).toBeNull();
  });

  it("accepts an RGBA guide (canvas layout) with the same result as RGB", () => {
    const { rgb, low } = buildScene();
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      rgba[j] = rgb[i * 3];
      rgba[j + 1] = rgb[i * 3 + 1];
      rgba[j + 2] = rgb[i * 3 + 2];
      rgba[j + 3] = 255;
    }
    const a = new MatteUpsampler().upsample(low, MW, MH, { rgb, width: W, height: H })!;
    const b = new MatteUpsampler().upsample(low, MW, MH, { rgb: rgba, components: 4, width: W, height: H })!;
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("latches off after two consecutive over-budget calls, and reset re-arms", () => {
    const { rgb, low } = buildScene();
    let t = 0;
    const up = new MatteUpsampler({ budgetMs: 10, now: () => (t += 100) });
    expect(up.upsample(low, MW, MH, { rgb, width: W, height: H })).not.toBeNull();
    expect(up.disabled).toBe(false);
    expect(up.upsample(low, MW, MH, { rgb, width: W, height: H })).not.toBeNull();
    expect(up.disabled).toBe(true);
    expect(up.upsample(low, MW, MH, { rgb, width: W, height: H })).toBeNull();
    up.reset();
    expect(up.disabled).toBe(false);
    expect(up.upsample(low, MW, MH, { rgb, width: W, height: H })).not.toBeNull();
  });
});
