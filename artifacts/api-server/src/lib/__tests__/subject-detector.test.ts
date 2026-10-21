/**
 * Subject detector — pure-helper pins (the detector's I/O paths are
 * exercised by the reframe route tests with the module mocked, and
 * end-to-end by an uncommitted fixture harness):
 *  - displayDims: ffprobe reports CODED dims; a ±90°/270° display
 *    rotation (every phone-shot portrait video) means downstream
 *    geometry must use the swapped, DISPLAY dims — before this pin
 *    a rotated source was probed as its coded landscape self, the
 *    matte feed was squished into the wrong aspect, and tracking
 *    silently rejected a perfectly trackable subject;
 *  - samplingFpsForDuration: MAX_SAMPLES is a hard budget — the
 *    rate must never plan more than 90 samples across ANY duration
 *    (the old 0.2 fps floor produced 120 samples for a 10-minute
 *    video and ~1,440 for a 2-hour one).
 */
import { describe, it, expect } from "vitest";
import { displayDims, samplingFpsForDuration } from "../subject-detector";

describe("displayDims — display geometry from coded dims + rotation", () => {
  it("no rotation metadata: dims unchanged", () => {
    expect(displayDims(1280, 720, null)).toEqual({ width: 1280, height: 720 });
    expect(displayDims(1280, 720, undefined)).toEqual({ width: 1280, height: 720 });
    expect(displayDims(1280, 720, NaN)).toEqual({ width: 1280, height: 720 });
  });
  it("0° and 180°: dims unchanged", () => {
    expect(displayDims(1280, 720, 0)).toEqual({ width: 1280, height: 720 });
    expect(displayDims(1280, 720, 180)).toEqual({ width: 1280, height: 720 });
    expect(displayDims(1280, 720, -180)).toEqual({ width: 1280, height: 720 });
  });
  it("±90° and ±270°: dims swap (the phone-portrait case)", () => {
    for (const r of [90, -90, 270, -270]) {
      expect(displayDims(1280, 720, r)).toEqual({ width: 720, height: 1280 });
      expect(displayDims(720, 1280, r)).toEqual({ width: 1280, height: 720 });
    }
  });
  it("a non-quarter rotation does not swap", () => {
    expect(displayDims(1280, 720, 45)).toEqual({ width: 1280, height: 720 });
  });
});

describe("samplingFpsForDuration — the sample budget is a hard cap", () => {
  it("short videos sample at the followable ceiling", () => {
    expect(samplingFpsForDuration(6)).toBe(6); // 90/6 = 15, capped at MAX_FPS
    expect(samplingFpsForDuration(15)).toBe(6); // exactly 90 samples at 6 fps
    expect(samplingFpsForDuration(30)).toBe(3);
    expect(samplingFpsForDuration(90)).toBe(1);
  });
  it("long videos stretch the interval instead of breaking the budget", () => {
    expect(samplingFpsForDuration(450)).toBeCloseTo(0.2, 10);
    expect(samplingFpsForDuration(600)).toBeCloseTo(0.15, 10); // was 0.2 → 120 samples
    expect(samplingFpsForDuration(7200)).toBeCloseTo(90 / 7200, 10); // was 0.2 → 1,440 samples
  });
  it("never plans more than 90 samples, never faster than 6 fps", () => {
    for (const d of [1, 3, 10, 60, 300, 451, 900, 3600, 14400]) {
      const fps = samplingFpsForDuration(d);
      expect(fps).toBeLessThanOrEqual(6);
      expect(fps * d).toBeLessThanOrEqual(90 + 1e-9);
    }
  });
  it("unknown duration falls back to the stand-in rate", () => {
    expect(samplingFpsForDuration(0)).toBe(2);
    expect(samplingFpsForDuration(-5)).toBe(2);
    expect(samplingFpsForDuration(NaN)).toBe(2);
  });
});
