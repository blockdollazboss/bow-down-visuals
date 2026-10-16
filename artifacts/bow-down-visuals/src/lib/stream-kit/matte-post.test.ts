/**
 * Matte post-processing math (matte-post.ts): levels curve, fringe
 * choke, feather blur, temporal blend, and edge-band despill — all
 * on synthetic mattes with known values.
 */
import { describe, it, expect } from "vitest";
import { MattePostProcessor, featherPass, despillRgba } from "./matte-post";

const filled = (v: number, n = 64) => new Float32Array(n).fill(v);

describe("levels curve + choke", () => {
  it("maps the curve endpoints exactly (0 -> 0, 1 -> 1, lo -> 0, hi -> 1)", () => {
    const p = new MattePostProcessor({ featherPasses: 0 });
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
    p.reset();
    expect(p.process(filled(1), 8, 8)[0]).toBe(1);
    p.reset();
    expect(p.process(filled(0.06), 8, 8)[0]).toBe(0); // curveLo
    p.reset();
    // 0.94 is choked to 0.89 first, which sits below curveHi: (0.89-0.06)/0.88 = 0.9432.
    // Only inputs above hi+choke saturate to a full 1.
    expect(p.process(filled(0.94), 8, 8)[0]).toBeCloseTo(0.9432, 3);
    p.reset();
    expect(p.process(filled(1), 8, 8)[0]).toBe(1);
  });

  it("chokes semi-transparent pixels by the choke amount before the curve", () => {
    const p = new MattePostProcessor({ featherPasses: 0 });
    // 0.5 -> choke 0.45 -> curve (0.45-0.06)/0.88 = 0.4432
    expect(p.process(filled(0.5), 8, 8)[0]).toBeCloseTo(0.4432, 3);
  });

  it("does NOT choke the solid core or the fully transparent surround", () => {
    const p = new MattePostProcessor({ featherPasses: 0, curveLo: 0, curveHi: 1, choke: 0.2 });
    expect(p.process(filled(1), 8, 8)[0]).toBe(1);
    p.reset();
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
    p.reset();
    // With an identity curve, a mid pixel loses exactly the choke.
    expect(p.process(filled(0.5), 8, 8)[0]).toBeCloseTo(0.3, 5);
  });
});

describe("temporal blend (EMA)", () => {
  it("converges toward a changed matte instead of jumping", () => {
    const p = new MattePostProcessor({ emaWeight: 0.5, featherPasses: 0 });
    expect(p.process(filled(1), 8, 8)[0]).toBe(1);
    const second = p.process(filled(0), 8, 8)[0]; // EMA 0.5 -> choke/curve ~0.443
    const third = p.process(filled(0), 8, 8)[0]; // EMA 0.25 -> ~0.159
    expect(second).toBeCloseTo(0.4432, 3);
    expect(third).toBeCloseTo(0.1591, 3);
    expect(third).toBeLessThan(second);
  });

  it("reset() forgets history (no ghost of the previous scene)", () => {
    const p = new MattePostProcessor({ emaWeight: 0.5, featherPasses: 0 });
    p.process(filled(1), 8, 8);
    p.reset();
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
  });

  it("a size change resets the blend instead of reading stale state", () => {
    const p = new MattePostProcessor({ emaWeight: 0.5, featherPasses: 0 });
    p.process(filled(1, 64), 8, 8);
    const out = p.process(filled(0, 16), 4, 4);
    expect(out[0]).toBe(0);
  });
});

describe("featherPass", () => {
  it("softens a hard step edge over ~2px and leaves the far field exact", () => {
    const w = 16;
    const h = 4;
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 8; x < w; x++) data[y * w + x] = 1;
    const scratch = new Float32Array(w * h);
    featherPass(data, scratch, w, h);
    const mid = 1 * w; // row 1
    expect(data[mid + 0]).toBe(0); // far left untouched
    expect(data[mid + 15]).toBe(1); // far right untouched
    expect(data[mid + 7]).toBeGreaterThan(0); // left of the edge picked up spill
    expect(data[mid + 7]).toBeLessThan(0.5);
    expect(data[mid + 8]).toBeLessThan(1); // right of the edge softened
    expect(data[mid + 8]).toBeGreaterThan(0.5);
  });
});

describe("despillRgba", () => {
  const px = (r: number, g: number, b: number, a: number) => new Uint8ClampedArray([r, g, b, a]);

  it("pulls dominant green down toward max(r,b) inside the edge band", () => {
    const d = px(40, 200, 60, 128);
    despillRgba(d);
    expect(d[1]).toBe(109); // 60 + (200-60)*0.35
    expect(d[0]).toBe(40);
    expect(d[2]).toBe(60);
    expect(d[3]).toBe(128);
  });

  it("never touches the solid interior (green clothing keeps its color)", () => {
    const d = px(40, 200, 60, 255);
    despillRgba(d);
    expect(d[1]).toBe(200);
  });

  it("never touches fully transparent pixels", () => {
    const d = px(40, 200, 60, 0);
    despillRgba(d);
    expect(d[1]).toBe(200);
  });

  it("leaves edge pixels alone when green does not dominate", () => {
    const d = px(180, 120, 90, 128);
    despillRgba(d);
    expect(d[1]).toBe(120);
  });
});
