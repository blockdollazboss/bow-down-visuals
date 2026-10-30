/**
 * Green-screen fine-tune settings (greenscreen-finetune.ts):
 * sanitizing, persistence, and the composition law — at the
 * defaults the composed matte tuning IS the base, value for
 * value, for every base the kit runs (processor defaults, all
 * three Tasks refinement steps, the Pro tuning).
 */
import { describe, it, expect } from "vitest";
import {
  GREENSCREEN_FINETUNE_DEFAULTS,
  GREENSCREEN_FINETUNE_KEY,
  MATTE_BASE_DEFAULTS,
  sanitizeFineTune,
  isDefaultFineTune,
  loadGreenScreenFineTune,
  saveGreenScreenFineTune,
  composeMattePostOptions,
  despillRetentionFor,
  backdropFilterFor,
  type GreenScreenFineTune,
  type MatteBaseTuning,
} from "./greenscreen-finetune";
import { MATTE_REFINEMENT_STEPS, PRO_MATTE_POST } from "./background-changer";

const BASES: Array<[string, MatteBaseTuning]> = [
  ["processor defaults", { ...MATTE_BASE_DEFAULTS }],
  ...MATTE_REFINEMENT_STEPS.map(
    (s, i) =>
      [
        `tasks step ${i}`,
        { emaWeight: s.emaWeight, choke: s.choke, curveLo: s.curveLo, curveHi: s.curveHi, featherPasses: s.featherPasses },
      ] as [string, MatteBaseTuning],
  ),
  ["pro tuning", { ...PRO_MATTE_POST }],
];

const ft = (patch: Partial<GreenScreenFineTune>): GreenScreenFineTune => ({ ...GREENSCREEN_FINETUNE_DEFAULTS, ...patch });

describe("sanitizeFineTune", () => {
  it("round-trips the defaults", () => {
    expect(sanitizeFineTune(GREENSCREEN_FINETUNE_DEFAULTS)).toEqual(GREENSCREEN_FINETUNE_DEFAULTS);
    expect(isDefaultFineTune(sanitizeFineTune({}))).toBe(true);
  });

  it("clamps every field to its range and rounds the integer fields", () => {
    const out = sanitizeFineTune({ sensitivity: 999, edgeShift: -99, softness: 2.6, smoothing: -5, spill: 140, blur: 90, dim: 100 });
    expect(out).toEqual({ sensitivity: 50, edgeShift: -3, softness: 3, smoothing: 0, spill: 100, blur: 40, dim: 85 });
  });

  it("junk in, defaults out (never NaN, never a partial shape)", () => {
    for (const junk of [null, undefined, 42, "nope", [], { sensitivity: "high" }, { blur: Number.NaN }]) {
      const out = sanitizeFineTune(junk);
      expect(out).toEqual(GREENSCREEN_FINETUNE_DEFAULTS);
      for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("drops unknown fields", () => {
    const out = sanitizeFineTune({ sensitivity: 10, hacker: 1 } as unknown);
    expect(out.sensitivity).toBe(10);
    expect("hacker" in out).toBe(false);
  });
});

describe("persistence (house localStorage pattern)", () => {
  const fakeStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      map,
    };
  };

  it("save → load round-trips the settings under the bdv- key", () => {
    const s = fakeStorage();
    const mine = ft({ sensitivity: 20, edgeShift: -1, spill: 80, dim: 30 });
    saveGreenScreenFineTune(mine, s);
    expect(s.map.has(GREENSCREEN_FINETUNE_KEY)).toBe(true);
    expect(loadGreenScreenFineTune(s)).toEqual(mine);
  });

  it("nothing saved → defaults; corrupt saved → defaults (never a crash)", () => {
    const s = fakeStorage();
    expect(loadGreenScreenFineTune(s)).toEqual(GREENSCREEN_FINETUNE_DEFAULTS);
    s.map.set(GREENSCREEN_FINETUNE_KEY, "{not json");
    expect(loadGreenScreenFineTune(s)).toEqual(GREENSCREEN_FINETUNE_DEFAULTS);
    s.map.set(GREENSCREEN_FINETUNE_KEY, JSON.stringify({ sensitivity: 5000 }));
    expect(loadGreenScreenFineTune(s).sensitivity).toBe(50); // clamped, not trusted
  });

  it("a throwing store reads as defaults and writes are swallowed", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadGreenScreenFineTune(hostile)).toEqual(GREENSCREEN_FINETUNE_DEFAULTS);
    expect(() => saveGreenScreenFineTune(ft({ blur: 5 }), hostile)).not.toThrow();
    expect(loadGreenScreenFineTune(null)).toEqual(GREENSCREEN_FINETUNE_DEFAULTS);
  });
});

describe("the composition law", () => {
  it("at the defaults the composition IS the base, for every base the kit runs", () => {
    for (const [name, base] of BASES) {
      const out = composeMattePostOptions(base, GREENSCREEN_FINETUNE_DEFAULTS);
      expect(out.emaWeight, name).toBe(base.emaWeight);
      expect(out.choke, name).toBe(base.choke);
      expect(out.curveLo, name).toBe(base.curveLo);
      expect(out.curveHi, name).toBe(base.curveHi);
      expect(out.featherPasses, name).toBe(base.featherPasses);
      expect(out.edgeShift, name).toBe(0);
    }
  });

  it("sensitivity TRANSLATES the levels window (width preserved away from the clamps)", () => {
    const mid = { ...MATTE_BASE_DEFAULTS, curveLo: 0.2, curveHi: 0.8 };
    const up = composeMattePostOptions(mid, ft({ sensitivity: 25 }));
    expect(up.curveLo).toBeCloseTo(0.3, 6);
    expect(up.curveHi).toBeCloseTo(0.9, 6);
    expect(up.curveHi! - up.curveLo!).toBeCloseTo(0.6, 6);
    const down = composeMattePostOptions(mid, ft({ sensitivity: -50 }));
    expect(down.curveLo).toBeCloseTo(0, 6);
    expect(down.curveHi).toBeCloseTo(0.6, 6);
    // At the shipped defaults the high end sits near 1 already: a
    // positive shift moves lo the full amount and hi clamps at 1 —
    // the cut still hardens, the window just narrows from the top.
    const shipped = composeMattePostOptions({ ...MATTE_BASE_DEFAULTS }, ft({ sensitivity: 25 }));
    expect(shipped.curveLo).toBeCloseTo(0.16, 6);
    expect(shipped.curveHi).toBe(1);
  });

  it("full sensitivity against the Pro [0,1] base keeps a usable curve (never inverted)", () => {
    const pro = { ...PRO_MATTE_POST };
    for (const s of [-50, 50]) {
      const out = composeMattePostOptions(pro, ft({ sensitivity: s }));
      expect(out.curveHi!).toBeGreaterThan(out.curveLo!);
      expect(out.curveLo!).toBeGreaterThanOrEqual(0);
      expect(out.curveHi!).toBeLessThanOrEqual(1);
    }
  });

  it("smoothing offsets the blend weight around the base (50 = no offset)", () => {
    const base = { ...MATTE_BASE_DEFAULTS }; // emaWeight 0.55
    expect(composeMattePostOptions(base, ft({ smoothing: 100 })).emaWeight).toBeCloseTo(0.25, 6);
    expect(composeMattePostOptions(base, ft({ smoothing: 0 })).emaWeight).toBeCloseTo(0.85, 6);
    // The Pro base already runs at weight 1 — extra snap clamps there, smoothing can only add calm.
    const pro = { ...PRO_MATTE_POST };
    expect(composeMattePostOptions(pro, ft({ smoothing: 0 })).emaWeight).toBe(1);
    expect(composeMattePostOptions(pro, ft({ smoothing: 100 })).emaWeight).toBeCloseTo(0.7, 6);
    // And the floor never reaches 0 (a frozen matte is not smoothing).
    expect(composeMattePostOptions({ ...base, emaWeight: 0.1 }, ft({ smoothing: 100 })).emaWeight).toBe(0.05);
  });

  it("softness adds/removes feather passes over the base, clamped to [0, 5]", () => {
    const step0 = BASES[1][1]; // tasks step 0: 2 passes
    expect(composeMattePostOptions(step0, ft({ softness: 2 })).featherPasses).toBe(4);
    expect(composeMattePostOptions(step0, ft({ softness: -2 })).featherPasses).toBe(0);
    expect(composeMattePostOptions(step0, ft({ softness: 3 })).featherPasses).toBe(5);
    const pro = { ...PRO_MATTE_POST }; // 0 passes
    expect(composeMattePostOptions(pro, ft({ softness: -2 })).featherPasses).toBe(0);
  });

  it("edgeShift passes straight through; choke is the governor's, untouched", () => {
    const base = { ...MATTE_BASE_DEFAULTS };
    const out = composeMattePostOptions(base, ft({ edgeShift: -2, sensitivity: 30 }));
    expect(out.edgeShift).toBe(-2);
    expect(out.choke).toBe(base.choke);
  });
});

describe("despill + backdrop mappings", () => {
  it("spill 65 (the default) IS the shipped retention 0.35", () => {
    expect(despillRetentionFor(GREENSCREEN_FINETUNE_DEFAULTS)).toBeCloseTo(0.35, 10);
    expect(despillRetentionFor(ft({ spill: 0 }))).toBe(1);
    expect(despillRetentionFor(ft({ spill: 100 }))).toBe(0);
  });

  it("dim 0 sets NO filter (the shipped backdrop draw); dim > 0 darkens the backdrop only", () => {
    expect(backdropFilterFor(GREENSCREEN_FINETUNE_DEFAULTS)).toBeNull();
    expect(backdropFilterFor(ft({ dim: 40 }))).toBe("brightness(0.600)");
    expect(backdropFilterFor(ft({ dim: 85 }))).toBe("brightness(0.150)");
  });
});
