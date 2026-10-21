import { describe, it, expect } from "vitest";
import { curveValueAt, normalizeCurvePoints, computeScopes, SCOPE_BINS } from "./color-pro";

describe("curve math", () => {
  it("identity curve passes levels through", () => {
    const id = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(curveValueAt(id, 0.25)).toBeCloseTo(0.25);
    expect(curveValueAt(id, 0.75)).toBeCloseTo(0.75);
  });
  it("interpolates between control points and clamps outside", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }];
    expect(curveValueAt(pts, 0.25)).toBeCloseTo(0.4);
    expect(curveValueAt(pts, 0.5)).toBeCloseTo(0.8);
    expect(curveValueAt(pts, -1)).toBe(0);
    expect(curveValueAt(pts, 2)).toBe(1);
  });
  it("normalizes unsorted points and pins endpoints", () => {
    const pts = normalizeCurvePoints([{ x: 0.5, y: 0.5 }]);
    expect(pts[0]!.x).toBe(0);
    expect(pts[pts.length - 1]!.x).toBe(1);
    expect(normalizeCurvePoints(null)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
  it("an S-curve lifts highlights and crushes shadows", () => {
    const s = [{ x: 0, y: 0 }, { x: 0.25, y: 0.15 }, { x: 0.75, y: 0.85 }, { x: 1, y: 1 }];
    expect(curveValueAt(s, 0.25)).toBeLessThan(0.25);
    expect(curveValueAt(s, 0.75)).toBeGreaterThan(0.75);
  });
});

describe("computeScopes", () => {
  function solidFrame(r: number, g: number, b: number, w = 8, h = 8): Uint8ClampedArray {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    }
    return data;
  }
  it("a pure red frame peaks in the top red bin and mid-low luma", () => {
    const s = computeScopes(solidFrame(255, 0, 0), 8, 8);
    expect(s.sampledPixels).toBe(64);
    expect(s.histogram.r[SCOPE_BINS - 1]).toBe(1);
    expect(s.histogram.g[0]).toBe(1);
    // luma of pure red ≈ 0.2126 → bin 6
    expect(s.histogram.luma[6]).toBe(1);
  });
  it("waveform of a uniform frame is one row of density", () => {
    const s = computeScopes(solidFrame(128, 128, 128), 8, 8);
    const litCols = s.waveform.map((col) => col.filter((v) => v > 0).length).filter((n) => n > 0);
    expect(litCols.length).toBeGreaterThan(0);
    expect(litCols.every((n) => n === 1)).toBe(true);
  });
  it("grey has a centred vectorscope (no chroma)", () => {
    const s = computeScopes(solidFrame(128, 128, 128), 4, 4);
    let peak = 0, peakV = -1, peakU = -1;
    s.vectorscope.forEach((row, v) => row.forEach((n, u) => { if (n > peak) { peak = n; peakV = v; peakU = u; } }));
    expect(peak).toBe(1);
    expect(Math.abs(peakV - SCOPE_BINS / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(peakU - SCOPE_BINS / 2)).toBeLessThanOrEqual(1);
  });
  it("empty input does not throw and reports zero pixels", () => {
    const s = computeScopes(new Uint8ClampedArray(0), 0, 0);
    expect(s.sampledPixels).toBe(0);
  });
});
