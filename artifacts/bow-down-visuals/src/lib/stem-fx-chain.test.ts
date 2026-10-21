/* Wave 3 #16 — per-stem parametric FX chains for the Music Studio desk:
 * normalization (stored projects always load, values clamped to the
 * server's render bounds) and the pure editing ops the chain editor is
 * built from. Chain order in these arrays IS render order. */
import { describe, it, expect } from "vitest";
import {
  addEqBand,
  addFxStep,
  moveStemFxStep,
  normalizeStemFxChain,
  patchFxBand,
  patchFxStep,
  removeEqBand,
  removeFxStep,
  FX_CHAIN_MAX_STEPS,
  FX_EQ_MAX_BANDS,
} from "@/lib/stem-fx-chain";
import { normalizeStem } from "@/lib/editor-settings";
import type { FxStep } from "@/lib/arrangement";

const eqStep = (id: string): FxStep => ({
  id,
  type: "eq",
  enabled: true,
  bands: [{ freq: 100, gain: 0, q: 1 }],
});
const compStep = (id: string): FxStep => ({
  id,
  type: "compressor",
  enabled: true,
  thresholdDb: -18,
  ratio: 3,
  attackMs: 10,
  releaseMs: 150,
});

describe("normalizeStemFxChain", () => {
  it("non-array / missing → empty chain (presets apply)", () => {
    expect(normalizeStemFxChain(undefined)).toEqual([]);
    expect(normalizeStemFxChain(null)).toEqual([]);
    expect(normalizeStemFxChain("eq")).toEqual([]);
    expect(normalizeStemFxChain([])).toEqual([]);
  });

  it("keeps well-formed steps with their ids and order", () => {
    const out = normalizeStemFxChain([compStep("c1"), eqStep("e1")]);
    expect(out.map((s) => s.id)).toEqual(["c1", "e1"]);
    expect(out[0]!.thresholdDb).toBe(-18);
  });

  it("drops unknown step types and non-objects, keeps the rest", () => {
    const out = normalizeStemFxChain([{ type: "flanger", enabled: true }, 42, eqStep("e1")]);
    expect(out.map((s) => s.id)).toEqual(["e1"]);
  });

  it("clamps every numeric to the server's render bounds", () => {
    const out = normalizeStemFxChain([
      { id: "e", type: "eq", enabled: true, bands: [{ freq: 99999, gain: -99, q: 99 }] },
      { id: "c", type: "compressor", enabled: true, thresholdDb: -99, ratio: 99, attackMs: 0, releaseMs: 5 },
      { id: "s", type: "saturation", enabled: true, drive: 9 },
      { id: "d", type: "delay", enabled: true, mix: 150, timeMs: 99999, feedback: 99 },
      { id: "r", type: "reverb", enabled: true, mix: -5 },
    ]);
    expect(out[0]!.bands![0]).toEqual({ freq: 20000, gain: -24, q: 12 });
    expect(out[1]).toMatchObject({ thresholdDb: -60, ratio: 20, attackMs: 0.1, releaseMs: 10 });
    expect(out[2]!.drive).toBe(3);
    expect(out[3]).toMatchObject({ mix: 100, timeMs: 2000, feedback: 80 });
    expect(out[4]!.mix).toBe(0);
  });

  it("caps steps at 12 and bands at 5; an EQ with no bands gets the default 3", () => {
    const many = Array.from({ length: 14 }, (_, i) => eqStep(`e${i}`));
    expect(normalizeStemFxChain(many)).toHaveLength(FX_CHAIN_MAX_STEPS);
    const wide = normalizeStemFxChain([
      {
        id: "e",
        type: "eq",
        enabled: true,
        bands: Array.from({ length: 8 }, () => ({ freq: 100, gain: 0, q: 1 })),
      },
    ]);
    expect(wide[0]!.bands).toHaveLength(FX_EQ_MAX_BANDS);
    const bare = normalizeStemFxChain([{ id: "e", type: "eq", enabled: true }]);
    expect(bare[0]!.bands).toHaveLength(3);
  });

  it("regenerates a missing id and preserves enabled=false", () => {
    const out = normalizeStemFxChain([{ type: "reverb", enabled: false, mix: 30 }]);
    expect(out[0]!.id.length).toBeGreaterThan(0);
    expect(out[0]!.enabled).toBe(false);
  });
});

describe("chain editing ops", () => {
  it("addFxStep appends a defaulted step and respects the max", () => {
    const one = addFxStep([], "compressor");
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ type: "compressor", thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150, enabled: true });
    const full = Array.from({ length: FX_CHAIN_MAX_STEPS }, (_, i) => eqStep(`e${i}`));
    expect(addFxStep(full, "eq")).toBe(full);
  });

  it("moveStemFxStep reorders — order is render order", () => {
    const chain = [eqStep("e1"), compStep("c1"), eqStep("e2")];
    expect(moveStemFxStep(chain, "e2", 0).map((s) => s.id)).toEqual(["e2", "e1", "c1"]);
    expect(moveStemFxStep(chain, "e1", 2).map((s) => s.id)).toEqual(["c1", "e2", "e1"]);
    expect(moveStemFxStep(chain, "nope", 0)).toEqual(chain);
  });

  it("removeFxStep and patchFxStep (toggle + parameter) hit only the target step", () => {
    const chain = [eqStep("e1"), compStep("c1")];
    expect(removeFxStep(chain, "e1").map((s) => s.id)).toEqual(["c1"]);
    const patched = patchFxStep(chain, "c1", { enabled: false, thresholdDb: -24 });
    expect(patched[1]).toMatchObject({ enabled: false, thresholdDb: -24 });
    expect(patched[0]).toBe(chain[0]);
  });

  it("band ops: patch one band, add up to the cap, remove", () => {
    let chain = [eqStep("e1")];
    chain = patchFxBand(chain, "e1", 0, { gain: 6, freq: 250 });
    expect(chain[0]!.bands![0]).toEqual({ freq: 250, gain: 6, q: 1 });
    for (let i = 0; i < 6; i++) chain = addEqBand(chain, "e1");
    expect(chain[0]!.bands).toHaveLength(FX_EQ_MAX_BANDS);
    chain = removeEqBand(chain, "e1", 0);
    expect(chain[0]!.bands).toHaveLength(FX_EQ_MAX_BANDS - 1);
    expect(chain[0]!.bands![0]!.freq).toBe(1000);
  });
});

describe("normalizeStem — persistence through project load", () => {
  it("a legacy stem (no fxChain field) loads with an empty chain", () => {
    const stem = normalizeStem({ id: "s1", name: "Beat" });
    expect(stem.fxChain).toEqual([]);
    expect(stem.effects.eq).toBe("Off");
  });

  it("a stored chain survives the load, clamped and in order", () => {
    const stem = normalizeStem({
      id: "s2",
      fxChain: [
        { id: "c1", type: "compressor", enabled: true, thresholdDb: -12, ratio: 2, attackMs: 20, releaseMs: 200 },
        { id: "e1", type: "eq", enabled: true, bands: [{ freq: 5000, gain: 2, q: 1 }] },
      ] as FxStep[],
    });
    expect(stem.fxChain.map((s) => s.id)).toEqual(["c1", "e1"]);
    expect(stem.fxChain[0]!.thresholdDb).toBe(-12);
  });
});
