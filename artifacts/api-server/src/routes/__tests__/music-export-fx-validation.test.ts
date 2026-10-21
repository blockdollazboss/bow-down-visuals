/* Wave 3 #16 — the desk's parametric FX chains get an honesty gate at the
 * /music/export boundary: a chain that is present but malformed fails the
 * request (invalid_fx_chain) instead of silently falling back to the
 * stem's preset effects. In-range numbers are not errors — parseFxChain
 * clamps them. These tests pin the validator, the stem-level wrapper,
 * and the graph fragments each desk parameter produces. */
import { describe, it, expect } from "vitest";
import { validateFxChain, findStemFxChainError, parseStemInput } from "../music-export";
import { buildParametricFxGraph } from "../../lib/audioExport";

const deskChain = [
  {
    type: "eq",
    enabled: true,
    bands: [
      { freq: 100, gain: 3, q: 1 },
      { freq: 1000, gain: -2, q: 2 },
      { freq: 8000, gain: 4, q: 0.8 },
    ],
  },
  { type: "compressor", enabled: true, thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 120 },
];

describe("validateFxChain", () => {
  it("absent chain is fine; a well-formed desk chain passes", () => {
    expect(validateFxChain(undefined)).toBeNull();
    expect(validateFxChain(deskChain)).toBeNull();
    expect(validateFxChain([])).toBeNull();
  });

  it("out-of-range numbers are NOT errors — the parser clamps them", () => {
    expect(
      validateFxChain([{ type: "eq", enabled: true, bands: [{ freq: 99999, gain: 99, q: 99 }] }]),
    ).toBeNull();
    expect(
      validateFxChain([{ type: "compressor", enabled: true, thresholdDb: -99, ratio: 99 }]),
    ).toBeNull();
  });

  it("non-array chain fails", () => {
    expect(validateFxChain("eq please")).toMatch(/list of steps/);
    expect(validateFxChain({ type: "eq" })).toMatch(/list of steps/);
    expect(validateFxChain(null)).toMatch(/list of steps/);
  });

  it("unknown step type fails and names it", () => {
    expect(validateFxChain([{ type: "flanger", enabled: true }])).toMatch(/unknown type \(flanger\)/);
    expect(validateFxChain([{ enabled: true }])).toMatch(/unknown type/);
    expect(validateFxChain([42])).toMatch(/not an object/);
  });

  it("malformed bands fail", () => {
    expect(validateFxChain([{ type: "eq", enabled: true, bands: "wide" }])).toMatch(/bands must be a list/);
    expect(
      validateFxChain([{ type: "eq", enabled: true, bands: [{ freq: "100", gain: 0, q: 1 }] }]),
    ).toMatch(/freq must be a number/);
    expect(
      validateFxChain([{ type: "eq", enabled: true, bands: [{ freq: 100, gain: Number.NaN, q: 1 }] }]),
    ).toMatch(/gain must be a number/);
    expect(
      validateFxChain([
        {
          type: "eq",
          enabled: true,
          bands: Array.from({ length: 6 }, () => ({ freq: 100, gain: 0, q: 1 })),
        },
      ]),
    ).toMatch(/too many bands/);
  });

  it("non-numeric step parameters fail", () => {
    expect(
      validateFxChain([{ type: "compressor", enabled: true, thresholdDb: "-18" }]),
    ).toMatch(/thresholdDb must be a number/);
    expect(validateFxChain([{ type: "delay", enabled: true, timeMs: Infinity }])).toMatch(
      /timeMs must be a number/,
    );
  });

  it("caps chain length at the parser's cap", () => {
    const long = Array.from({ length: 13 }, () => ({ type: "reverb", enabled: true, mix: 10 }));
    expect(validateFxChain(long)).toMatch(/too many steps/);
    expect(validateFxChain(long.slice(0, 12))).toBeNull();
  });
});

describe("findStemFxChainError", () => {
  it("stems without chains pass; the bad stem is named", () => {
    expect(
      findStemFxChainError([
        { id: "a", name: "Beat", url: "https://x/b.wav" },
        { id: "b", name: "Lead Vox", url: "https://x/v.wav", fxChain: deskChain },
      ]),
    ).toBeNull();
    expect(
      findStemFxChainError([
        { id: "b", name: "Lead Vox", url: "https://x/v.wav", fxChain: [{ type: "flanger" }] },
      ]),
    ).toMatch(/Stem "Lead Vox": an FX chain step has an unknown type/);
  });

  it("a validated chain survives parseStemInput with values clamped, order intact", () => {
    const stem = parseStemInput({
      id: "s1",
      name: "Lead Vox",
      type: "Lead Vocals",
      url: "https://x/v.wav",
      fxChain: [
        { type: "compressor", enabled: true, thresholdDb: -99, ratio: 4, attackMs: 5, releaseMs: 120 },
        { type: "eq", enabled: true, bands: [{ freq: 99999, gain: 3, q: 1 }] },
      ],
    });
    expect(stem.fxChain).toHaveLength(2);
    expect(stem.fxChain![0]!.type).toBe("compressor");
    expect(stem.fxChain![0]!.thresholdDb).toBe(-60);
    expect(stem.fxChain![1]!.bands![0]!.freq).toBe(20000);
  });
});

describe("desk chain → FFmpeg graph (each parameter lands)", () => {
  const graph = (chain: Parameters<typeof buildParametricFxGraph>[0]["chain"]) =>
    buildParametricFxGraph({ inputLabel: "in", chain, startTime: 0, labelPrefix: "t" }).parts.join(
      ";",
    );

  it("every EQ band renders with its own freq / Q / gain", () => {
    const g = graph([
      {
        type: "eq",
        enabled: true,
        bands: [
          { freq: 100, gain: 3, q: 1 },
          { freq: 8000, gain: -4, q: 2.5 },
        ],
      },
    ]);
    expect(g).toContain("equalizer=f=100:t=q:w=1:g=3");
    expect(g).toContain("equalizer=f=8000:t=q:w=2.5:g=-4");
  });

  it("compressor threshold converts dB to linear; ratio/attack/release land verbatim", () => {
    const g = graph([
      { type: "compressor", enabled: true, thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 120 },
    ]);
    expect(g).toContain("acompressor=threshold=0.1:ratio=4:attack=5:release=120");
  });

  it("saturation drive and delay time/feedback/mix land", () => {
    const g = graph([
      { type: "saturation", enabled: true, drive: 2 },
      { type: "delay", enabled: true, timeMs: 300, feedback: 40, mix: 50 },
    ]);
    expect(g).toContain("volume=2");
    expect(g).toContain("asoftclip=type=tanh");
    /* delay: decay = 0.25 + 40/100 = 0.65; wet = (50/100) * 0.7 = 0.35 */
    expect(g).toContain("aecho=0.8:0.65:300:0.35");
  });

  it("chain order is render order — swapping steps swaps the graph", () => {
    const eq = { type: "eq" as const, enabled: true, bands: [{ freq: 100, gain: 3, q: 1 }] };
    const comp = {
      type: "compressor" as const,
      enabled: true,
      thresholdDb: -18,
      ratio: 3,
      attackMs: 10,
      releaseMs: 150,
    };
    const eqFirst = graph([eq, comp]);
    const compFirst = graph([comp, eq]);
    expect(eqFirst.indexOf("equalizer=")).toBeLessThan(eqFirst.indexOf("acompressor="));
    expect(compFirst.indexOf("acompressor=")).toBeLessThan(compFirst.indexOf("equalizer="));
  });
});
