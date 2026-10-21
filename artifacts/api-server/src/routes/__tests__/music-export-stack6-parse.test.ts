/* Stack 6 — /music/export payload parsing: arrangement fields are clamped
 * and validated before they reach the render graph; legacy payloads pass
 * through unchanged. */
import { describe, it, expect } from "vitest";
import { parseStemInput, parseFxChain, parseAutomation, parseDuck } from "../music-export";

describe("parseStemInput — legacy payload", () => {
  it("maps the classic stem shape with no arrangement extras", () => {
    const stem = parseStemInput({
      id: "s1", name: "Beat", type: "Beat", url: "https://x/beat.wav",
      volume: 80, muted: false, solo: false, pan: -20,
      trimStart: 1, trimEnd: 2, durationSec: 30,
      effects: { eq: "Warm", autotune: "off", reverb: "light", delay: "none", compression: "low", saturation: "off", deEsser: false, noiseReduction: false },
    });
    expect(stem).toMatchObject({ id: "s1", volume: 80, pan: -20, trimStart: 1, trimEnd: 2, durationSec: 30 });
    expect(stem.startTime).toBeUndefined();
    expect(stem.fxChain).toBeUndefined();
    expect(stem.automation).toBeUndefined();
    expect(stem.duck).toBeUndefined();
    expect(stem.effects?.eq).toBe("Warm");
  });
});

describe("parseStemInput — arrangement payload", () => {
  it("carries placement, fades, chain, automation and ducking", () => {
    const stem = parseStemInput({
      id: "stem-trk-0", name: "Music", type: "Beat", url: "https://x/m.wav",
      volume: 90, muted: false, solo: false, pan: 0, trimStart: 0, trimEnd: 0,
      startTime: 2.5, fadeInSec: 0.015, fadeOutSec: 0.015,
      fxChain: [{ type: "eq", enabled: true, bands: [{ freq: 100, gain: 3, q: 1 }] }],
      automation: { volume: [{ time: 0, value: 100 }, { time: 8, value: 40 }] },
      duck: { sourceStemIds: ["stem-vox-0"], amount: 70, sensitivity: 40 },
    });
    expect(stem.startTime).toBe(2.5);
    expect(stem.fadeInSec).toBe(0.015);
    expect(stem.fxChain).toHaveLength(1);
    expect(stem.automation?.volume).toHaveLength(2);
    expect(stem.duck).toEqual({ sourceStemIds: ["stem-vox-0"], amount: 70, sensitivity: 40 });
  });
  it("negative placement and oversized fades clamp to safe values", () => {
    const stem = parseStemInput({
      id: "s", name: "S", type: "", url: "https://x/a.wav", volume: 100,
      startTime: -4, fadeInSec: 99,
    });
    expect(stem.startTime).toBe(0);
    expect(stem.fadeInSec).toBe(5);
  });
});

describe("parseFxChain", () => {
  it("rejects unknown step types and caps the chain length", () => {
    const chain = parseFxChain([
      { type: "flanger", enabled: true },
      { type: "eq", enabled: true, bands: [{ freq: 99999, gain: 99, q: 99 }] },
    ]);
    expect(chain).toHaveLength(1);
    expect(chain![0]!.bands![0]).toEqual({ freq: 20000, gain: 24, q: 12 });
  });
  it("non-array / empty → undefined", () => {
    expect(parseFxChain(undefined)).toBeUndefined();
    expect(parseFxChain([])).toBeUndefined();
    expect(parseFxChain("eq")).toBeUndefined();
  });
});

describe("parseAutomation", () => {
  it("clamps lane values to their ranges", () => {
    const auto = parseAutomation({
      volume: [{ time: 1, value: 999 }],
      pan: [{ time: 2, value: -999 }],
      reverbMix: [{ time: 3, value: 50 }],
    });
    expect(auto?.volume![0]!.value).toBe(150);
    expect(auto?.pan![0]!.value).toBe(-100);
    expect(auto?.reverbMix![0]!.value).toBe(50);
  });
  it("empty lanes are dropped; all-empty → undefined", () => {
    expect(parseAutomation({ volume: [] })).toBeUndefined();
    expect(parseAutomation(null)).toBeUndefined();
  });
});

describe("parseDuck", () => {
  it("requires at least one source id and clamps the simple terms", () => {
    expect(parseDuck({ sourceStemIds: [], amount: 50, sensitivity: 50 })).toBeUndefined();
    expect(parseDuck({ sourceStemIds: ["a"], amount: 400, sensitivity: -3 })).toEqual({
      sourceStemIds: ["a"], amount: 100, sensitivity: 0,
    });
    expect(parseDuck(null)).toBeUndefined();
    expect(parseDuck({ sourceStemIds: [42, "ok"] })).toEqual({
      sourceStemIds: ["ok"], amount: 60, sensitivity: 50,
    });
  });
});
