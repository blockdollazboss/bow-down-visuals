/**
 * Lips math tests (lib/world/lips) — the level→openness mapping and
 * the landmark geometry are pinned so the hall's lip motion stays
 * honest: silence shut, speech open, no face → no mouth, ever.
 */
import { describe, it, expect } from "vitest";
import {
  mouthBoxFromLandmarks,
  mouthOpennessForLevel,
  rmsFromTimeDomain,
  SpeechLevelTracker,
  coverTransform,
  normalizedToCanvas,
  SPEECH_LEVEL_FLOOR,
  SPEECH_LEVEL_CEILING,
  type LandmarkPoint,
} from "./lips";

/** A synthetic face: 478 landmarks, mouth corners at (0.42, 0.62) /
 *  (0.58, 0.62), inner lips at y 0.615 / 0.63. */
function fakeFace(): LandmarkPoint[] {
  const pts: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  pts[61] = { x: 0.42, y: 0.62 };
  pts[291] = { x: 0.58, y: 0.62 };
  pts[13] = { x: 0.5, y: 0.615 };
  pts[14] = { x: 0.5, y: 0.63 };
  return pts;
}

describe("mouthBoxFromLandmarks", () => {
  it("finds the mouth between the corners and inner lips", () => {
    const box = mouthBoxFromLandmarks(fakeFace());
    expect(box).not.toBeNull();
    expect(box!.cx).toBeCloseTo(0.5);
    expect(box!.cy).toBeCloseTo(0.6225);
    expect(box!.w).toBeCloseTo(0.16);
  });

  it("refuses anything that isn't an honest mouth", () => {
    expect(mouthBoxFromLandmarks(null)).toBeNull();
    expect(mouthBoxFromLandmarks(undefined)).toBeNull();
    expect(mouthBoxFromLandmarks(fakeFace().slice(0, 100))).toBeNull(); // truncated mesh
    const sliver = fakeFace();
    sliver[291] = { x: 0.425, y: 0.62 }; // 0.005 wide — an artifact, not a mouth
    expect(mouthBoxFromLandmarks(sliver)).toBeNull();
    const offFrame = fakeFace();
    offFrame[61] = { x: -0.4, y: 0.62 };
    offFrame[291] = { x: 0.4, y: 0.62 };
    expect(mouthBoxFromLandmarks(offFrame)).toBeNull(); // center outside the portrait
    const nan = fakeFace();
    nan[13] = { x: Number.NaN, y: 0.6 };
    expect(mouthBoxFromLandmarks(nan)).toBeNull();
  });
});

describe("coverTransform + normalizedToCanvas", () => {
  it("cover-fits a square portrait into the 3:4 stage, cropping top/bottom", () => {
    const t = coverTransform(1000, 1000, 384, 512);
    expect(t.drawnW).toBeCloseTo(512);
    expect(t.drawnH).toBeCloseTo(512);
    expect(t.offsetX).toBeCloseTo(-64);
    expect(t.offsetY).toBeCloseTo(0);
    const p = normalizedToCanvas({ x: 0.5, y: 0.6225 }, 1000, 1000, t);
    expect(p.x).toBeCloseTo(192); // canvas center
    expect(p.y).toBeCloseTo(0.6225 * 512);
  });

  it("a source that already matches the stage maps 1:1", () => {
    const t = coverTransform(384, 512, 384, 512);
    expect(t.scale).toBeCloseTo(1);
    expect(normalizedToCanvas({ x: 0.25, y: 0.75 }, 384, 512, t)).toEqual({ x: 96, y: 384 });
  });
});

describe("mouthOpennessForLevel", () => {
  it("silence and sub-floor noise stay shut; the ceiling is fully open", () => {
    expect(mouthOpennessForLevel(0)).toBe(0);
    expect(mouthOpennessForLevel(SPEECH_LEVEL_FLOOR)).toBe(0);
    expect(mouthOpennessForLevel(SPEECH_LEVEL_FLOOR - 0.01)).toBe(0);
    expect(mouthOpennessForLevel(SPEECH_LEVEL_CEILING)).toBe(1);
    expect(mouthOpennessForLevel(0.95)).toBe(1);
    expect(mouthOpennessForLevel(Number.NaN)).toBe(0);
  });

  it("rises monotonically through the speech range", () => {
    let prev = 0;
    for (let l = SPEECH_LEVEL_FLOOR; l <= SPEECH_LEVEL_CEILING; l += 0.02) {
      const open = mouthOpennessForLevel(l);
      expect(open).toBeGreaterThanOrEqual(prev);
      expect(open).toBeLessThanOrEqual(1);
      prev = open;
    }
    // Ordinary speech RMS (~0.2) already reads as a clearly open mouth.
    expect(mouthOpennessForLevel(0.2)).toBeGreaterThan(0.4);
  });
});

describe("rmsFromTimeDomain", () => {
  it("silence is 0 and a loud wave approaches its amplitude", () => {
    expect(rmsFromTimeDomain(new Uint8Array(256).fill(128))).toBe(0);
    const loud = new Uint8Array(256);
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 === 0 ? 255 : 1;
    expect(rmsFromTimeDomain(loud)).toBeGreaterThan(0.95);
    expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0);
  });
});

describe("SpeechLevelTracker", () => {
  it("attacks fast, releases slow, and settles to true zero", () => {
    const tr = new SpeechLevelTracker();
    const attacked = tr.push(0.5);
    expect(attacked).toBeGreaterThan(0.25); // one sample already moves it
    let v = attacked;
    for (let i = 0; i < 5; i++) v = tr.push(0.5);
    expect(v).toBeCloseTo(0.5, 1);
    const released = tr.push(0);
    expect(released).toBeGreaterThan(0.3); // release lags the attack
    for (let i = 0; i < 60; i++) tr.push(0);
    expect(tr.level).toBe(0);
    tr.push(0.4);
    tr.reset();
    expect(tr.level).toBe(0);
  });
});
