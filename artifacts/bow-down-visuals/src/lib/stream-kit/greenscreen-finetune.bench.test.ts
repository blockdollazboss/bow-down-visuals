/**
 * BENCH — green-screen fine-tune (greenscreen-finetune.ts), run
 * against the REAL pipeline modules (matte-post.ts + the
 * composition). For every shipped control: a measured pair (the
 * shipped default vs the control moved) on a synthetic matte with
 * a soft rim, a faint halo ring, and hair strands — the three
 * things fine-tuning exists to move. The numbers print as a table
 * (see the lane report); the assertions pin the direction and a
 * minimum size for each effect, so a control that stops moving
 * the picture fails here. Companion to
 * ~/workspace/stack700-greenscreen-bench (the RVM engine bench).
 */
import { describe, it, expect } from "vitest";
import { MattePostProcessor, despillRgba } from "./matte-post";
import {
  GREENSCREEN_FINETUNE_DEFAULTS,
  MATTE_BASE_DEFAULTS,
  composeMattePostOptions,
  despillRetentionFor,
  type GreenScreenFineTune,
  type MatteBaseTuning,
} from "./greenscreen-finetune";
import { MATTE_REFINEMENT_STEPS, PRO_MATTE_POST } from "./background-changer";

const W = 96;
const H = 64;
const CX = 44;
const CY = 32;
const R = 16;

/** Person blob with a 6px soft rim, a faint halo ring outside it,
 *  and two 1px hair strands at alpha 0.55. */
function fixtureMatte(): Float32Array {
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - CX, y - CY);
      let v = r <= R - 3 ? 1 : r >= R + 3 ? 0 : (R + 3 - r) / 6;
      if (r > R + 3 && r < R + 9) v = Math.max(v, 0.14 * (1 - (r - (R + 3)) / 6));
      a[y * W + x] = v;
    }
  }
  for (const y of [CY - 12, CY + 12]) {
    for (let x = CX + R + 2; x <= CX + R + 10; x++) a[y * W + x] = 0.55;
  }
  return a;
}

const stats = (a: Float32Array) => {
  let mass = 0;
  let semi = 0;
  let halo = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = a[y * W + x];
      mass += v;
      if (v > 0.02 && v < 0.98) semi++;
      if (Math.hypot(x - CX, y - CY) > R + 3.5) halo += v;
    }
  }
  let rim = 0;
  for (let x = 0; x < W; x++) {
    const v = a[CY * W + x];
    if (v > 0.02 && v < 0.98) rim++;
  }
  return { mass, semi, halo, rim };
};

const ft = (patch: Partial<GreenScreenFineTune>): GreenScreenFineTune => ({ ...GREENSCREEN_FINETUNE_DEFAULTS, ...patch });

/** One frame through a processor tuned by base + settings (the
 *  changer's own composition), spatial controls isolated: the
 *  first frame at a size seeds the blend with itself, so the
 *  output is the pure spatial pipeline. */
function runOnce(base: MatteBaseTuning, settings: GreenScreenFineTune, input: Float32Array): Float32Array {
  const p = new MattePostProcessor({ motionSnap: 1 });
  p.configure(composeMattePostOptions(base, settings));
  return p.process(input, W, H).slice();
}

const lines: string[] = [];
const bench = (label: string, a: number, b: number, unit = "") => {
  lines.push(`${label}: default ${a.toFixed(2)}${unit} -> adjusted ${b.toFixed(2)}${unit}`);
};

describe("bench: every fine-tune control measurably moves the picture", () => {
  const base: MatteBaseTuning = { ...MATTE_BASE_DEFAULTS };
  const input = fixtureMatte();
  const dflt = stats(runOnce(base, GREENSCREEN_FINETUNE_DEFAULTS, input));

  it("sensitivity: a stricter cut eats the halo and the strands; a looser one keeps them", () => {
    const strict = stats(runOnce(base, ft({ sensitivity: 50 }), input));
    const loose = stats(runOnce(base, ft({ sensitivity: -50 }), input));
    bench("sensitivity halo mass (+50)", dflt.halo, strict.halo);
    bench("sensitivity halo mass (-50)", dflt.halo, loose.halo);
    // −43% measured: the halo ring (≤0.14) dies under the raised
    // floor, while the rim's upper gradient (also past the halo
    // radius) hardens — the net is a large cut, not a total one.
    expect(strict.halo).toBeLessThan(dflt.halo * 0.65);
    expect(loose.halo).toBeGreaterThan(dflt.halo * 1.3);
    expect(strict.mass).toBeLessThan(dflt.mass);
    expect(loose.mass).toBeGreaterThan(dflt.mass);
  });

  it("edge size: shrink removes halo mass, grow adds matte mass, the core stays put", () => {
    const shrunk = stats(runOnce(base, ft({ edgeShift: -2 }), input));
    const grown = stats(runOnce(base, ft({ edgeShift: 2 }), input));
    bench("edgeShift halo mass (-2)", dflt.halo, shrunk.halo);
    bench("edgeShift matte mass (+2)", dflt.mass, grown.mass);
    expect(shrunk.halo).toBeLessThan(dflt.halo * 0.6);
    expect(shrunk.mass).toBeLessThan(dflt.mass);
    expect(grown.mass).toBeGreaterThan(dflt.mass * 1.05);
  });

  it("softness: more feather passes widen the semi-transparent rim", () => {
    const softer = stats(runOnce(base, ft({ softness: 3 }), input));
    const crisper = stats(runOnce(base, ft({ softness: -1 }), input));
    bench("softness rim width (+3 passes)", dflt.rim, softer.rim, "px");
    bench("softness rim width (-1 pass)", dflt.rim, crisper.rim, "px");
    expect(softer.rim).toBeGreaterThan(dflt.rim);
    expect(crisper.rim).toBeLessThan(dflt.rim);
    expect(softer.semi).toBeGreaterThan(dflt.semi);
  });

  it("smoothing: the temporal flicker of a noisy still matte falls as smoothing rises", () => {
    // A constant mid matte with alternating ±0.06 sensor noise,
    // through a purely temporal tuning (identity curve, no
    // feather) — frame-to-frame output movement IS the flicker.
    const flicker = (settings: GreenScreenFineTune): number => {
      const cleanBase: MatteBaseTuning = { emaWeight: 0.55, choke: 0, curveLo: 0, curveHi: 1, featherPasses: 0 };
      const p = new MattePostProcessor({});
      p.configure(composeMattePostOptions(cleanBase, settings));
      let prev: Float32Array | null = null;
      let total = 0;
      let frames = 0;
      for (let t = 0; t < 8; t++) {
        const frame = new Float32Array(W * H).fill(t % 2 === 0 ? 0.56 : 0.44);
        const out = p.process(frame, W, H).slice();
        if (prev) {
          let d = 0;
          for (let i = 0; i < out.length; i++) d += Math.abs(out[i] - prev[i]);
          total += d / out.length;
          frames++;
        }
        prev = out;
      }
      return total / frames;
    };
    const calm = flicker(ft({ smoothing: 100 }));
    const mid = flicker(GREENSCREEN_FINETUNE_DEFAULTS);
    const snap = flicker(ft({ smoothing: 0 }));
    bench("smoothing flicker (100)", mid, calm);
    bench("smoothing flicker (0)", mid, snap);
    expect(calm).toBeLessThan(mid * 0.75);
    expect(snap).toBeGreaterThan(mid * 1.25);
  });

  it("spill: the green excess on edge pixels scales with the strength", () => {
    const excess = (settings: GreenScreenFineTune): number => {
      // A person-edge strip: green-lit skin tones at band alphas.
      const data = new Uint8ClampedArray(4 * 4);
      const px: Array<[number, number, number, number]> = [
        [90, 180, 70, 128],
        [60, 160, 80, 90],
        [110, 190, 60, 200],
        [80, 150, 90, 40],
      ];
      px.forEach((p, i) => data.set(p, i * 4));
      despillRgba(data, 10, 245, despillRetentionFor(settings));
      let total = 0;
      for (let i = 0; i < data.length; i += 4) total += Math.max(0, data[i + 1] - Math.max(data[i], data[i + 2]));
      return total / 4;
    };
    const off = excess(ft({ spill: 0 }));
    const shipped = excess(GREENSCREEN_FINETUNE_DEFAULTS);
    const full = excess(ft({ spill: 100 }));
    bench("spill green excess (default 65)", off, shipped);
    bench("spill green excess (100)", off, full);
    expect(shipped).toBeCloseTo(off * 0.35, 0);
    expect(full).toBe(0);
    expect(off).toBeGreaterThan(50);
  });
});

describe("bench: defaults are the shipped picture, bitwise, on every base", () => {
  const bases: Array<[string, MatteBaseTuning & { featherPasses: number }]> = [
    ["tasks step 0", MATTE_REFINEMENT_STEPS[0]],
    ["tasks step 1", MATTE_REFINEMENT_STEPS[1]],
    ["tasks step 2", MATTE_REFINEMENT_STEPS[2]],
    ["pro tuning", { ...PRO_MATTE_POST }],
  ];

  it("composed-at-defaults output == raw-base output across a moving sequence", () => {
    for (const [name, base] of bases) {
      const raw = new MattePostProcessor({ motionSnap: 1 });
      raw.configure({
        emaWeight: base.emaWeight,
        choke: base.choke,
        curveLo: base.curveLo,
        curveHi: base.curveHi,
        featherPasses: base.featherPasses,
      });
      const tuned = new MattePostProcessor({ motionSnap: 1 });
      tuned.configure(composeMattePostOptions(base, GREENSCREEN_FINETUNE_DEFAULTS));
      // A moving sequence: the blob slides right 3px per frame.
      for (let t = 0; t < 5; t++) {
        const frame = fixtureMatte();
        const shifted = new Float32Array(W * H);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const sx = Math.max(0, x - t * 3);
            shifted[y * W + x] = frame[y * W + sx];
          }
        }
        const a = raw.process(shifted, W, H).slice();
        const b = tuned.process(shifted, W, H).slice();
        expect(Array.from(b), `${name} frame ${t}`).toEqual(Array.from(a));
      }
    }
  });

  it("the untouched processor (no configure at all) also matches defaults composition", () => {
    const bare = new MattePostProcessor({ motionSnap: 1 });
    const tuned = new MattePostProcessor({ motionSnap: 1 });
    tuned.configure(composeMattePostOptions({ ...MATTE_BASE_DEFAULTS }, GREENSCREEN_FINETUNE_DEFAULTS));
    const input = fixtureMatte();
    expect(Array.from(tuned.process(input, W, H).slice())).toEqual(Array.from(bare.process(input, W, H).slice()));
  });

  it("prints the bench table", () => {
    // eslint-disable-next-line no-console
    console.log(`\n[fine-tune bench]\n${lines.join("\n")}`);
    expect(lines.length).toBeGreaterThanOrEqual(7);
  });
});
