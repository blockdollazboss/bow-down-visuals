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

describe("configure() — live retune (refinement steps)", () => {
  it("a retuned EMA weight applies to the very next frame", () => {
    const p = new MattePostProcessor({ emaWeight: 0.5, featherPasses: 0 });
    expect(p.process(filled(1), 8, 8)[0]).toBe(1);
    p.configure({ emaWeight: 1 });
    // Weight 1 = no history: the new frame lands whole (0), where
    // the old weight would have blended to ~0.443.
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
  });

  it("retunes choke + curve without touching the other settings", () => {
    const p = new MattePostProcessor({ featherPasses: 0 });
    p.configure({ choke: 0.2, curveLo: 0, curveHi: 1 });
    // Identity curve + choke 0.2: a mid pixel loses exactly the choke.
    expect(p.process(filled(0.5), 8, 8)[0]).toBeCloseTo(0.3, 5);
    p.reset();
    // The EMA weight was NOT in the configure call: still the 0.55
    // default, so a 0 -> 1 jump blends (0.55) instead of landing
    // whole, then loses the choke: 0.55 - 0.2 = 0.35.
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
    expect(p.process(filled(1), 8, 8)[0]).toBeCloseTo(0.35, 5);
  });

  it("feather passes can be raised live (softer rim on the next frame)", () => {
    const w = 16;
    const h = 4;
    const edge = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 8; x < w; x++) edge[y * w + x] = 1;
    const p = new MattePostProcessor({ emaWeight: 1, choke: 0, curveLo: 0, curveHi: 1, featherPasses: 0 });
    const hard = p.process(edge, w, h);
    expect(hard[1 * w + 7]).toBe(0); // no feather: the edge stays a cliff
    p.configure({ featherPasses: 1 });
    const soft = p.process(edge, w, h);
    expect(soft[1 * w + 7]).toBeGreaterThan(0); // feathered: spill across the edge
    expect(soft[1 * w + 7]).toBeLessThan(0.5);
  });
});

describe("motion snap (motion-adaptive blend)", () => {
  const snapOpts = { emaWeight: 0.45, choke: 0, curveLo: 0, curveHi: 1, featherPasses: 0, motionSnap: 1 } as const;

  it("a hard matte swing lands in ONE frame — no ghost where the subject was", () => {
    const p = new MattePostProcessor({ ...snapOpts });
    expect(p.process(filled(1), 8, 8)[0]).toBe(1);
    // The subject vacates the pixel: the new matte is 0. The legacy
    // blend would leave 0.55, 0.30, 0.17… — a ghost for frames.
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
  });

  it("a newly occupied pixel is solid in ONE frame — no eaten body", () => {
    const p = new MattePostProcessor({ ...snapOpts });
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
    expect(p.process(filled(1), 8, 8)[0]).toBe(1);
  });

  it("small per-pixel jitter keeps the calming base blend (no flicker returns)", () => {
    const p = new MattePostProcessor({
      emaWeight: 0.5,
      choke: 0,
      curveLo: 0,
      curveHi: 1,
      featherPasses: 0,
      motionSnap: 1,
    });
    // Deltas of 0.06 sit under the snap's jitter band (0.08): every
    // output must equal the plain-EMA path exactly.
    expect(p.process(filled(0.5), 8, 8)[0]).toBeCloseTo(0.5, 6);
    expect(p.process(filled(0.56), 8, 8)[0]).toBeCloseTo(0.53, 6);
    expect(p.process(filled(0.5), 8, 8)[0]).toBeCloseTo(0.515, 6);
    expect(p.process(filled(0.56), 8, 8)[0]).toBeCloseTo(0.5375, 6);
  });

  it("a mid-band swing (hair edge in motion) blends faster than base but does not jump whole", () => {
    const p = new MattePostProcessor({ ...snapOpts });
    p.process(filled(0), 8, 8);
    // Delta 0.2 sits mid-ramp (band 0.08..0.35): the result lands
    // between the pure-EMA value (0.45 * 0.2 = 0.09) and the full
    // new value (0.2).
    const out = p.process(filled(0.2), 8, 8)[0];
    expect(out).toBeGreaterThan(0.09);
    expect(out).toBeLessThan(0.2);
  });

  it("motionSnap 0 (the default) IS the legacy blend, byte for byte", () => {
    const legacy = new MattePostProcessor({ emaWeight: 0.5, featherPasses: 0 });
    const snapped = new MattePostProcessor({ emaWeight: 0.5, featherPasses: 0, motionSnap: 0 });
    for (const v of [1, 0, 0, 1, 0.3]) {
      expect(snapped.process(filled(v), 8, 8)[0]).toBe(legacy.process(filled(v), 8, 8)[0]);
    }
  });

  it("configure() can raise the snap live without touching the base weight", () => {
    const p = new MattePostProcessor({ emaWeight: 0.5, choke: 0, curveLo: 0, curveHi: 1, featherPasses: 0 });
    p.process(filled(1), 8, 8);
    // Still legacy: the vacated pixel blends to 0.5, not 0.
    expect(p.process(filled(0), 8, 8)[0]).toBeCloseTo(0.5, 6);
    p.configure({ motionSnap: 1 });
    p.process(filled(1), 8, 8);
    expect(p.process(filled(0), 8, 8)[0]).toBe(0);
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
