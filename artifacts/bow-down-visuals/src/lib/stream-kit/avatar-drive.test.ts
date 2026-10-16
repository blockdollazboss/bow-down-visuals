/**
 * Avatar drive tests (avatar-drive.ts): the pure math between a face
 * and a character — matrix → pose round-trips, blendshape mapping,
 * smoothing, the mic mouth shaper, the deterministic blink schedule,
 * sensitivity, and the full drive ladder.
 */
import { describe, it, expect } from "vitest";
import {
  NEUTRAL_DRIVE,
  BlinkScheduler,
  DriveSmoother,
  MouthShaper,
  applySensitivity,
  driveFromFace,
  eulerFromMatrix,
  idleDriveAt,
  micRmsFromByteData,
  poseToDrive,
  resolveDrive,
} from "./avatar-drive";

/** Column-major 4x4 for R = Ry(yaw)·Rx(pitch)· Rz(roll). */
function matYXZ(yaw: number, pitch: number, roll: number): number[] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const R = [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
  return [
    R[0]![0], R[1]![0], R[2]![0], 0,
    R[0]![1], R[1]![1], R[2]![1], 0,
    R[0]![2], R[1]![2], R[2]![2], 0,
    0, 0, 0, 1,
  ];
}

const cats = (m: Record<string, number>) =>
  Object.entries(m).map(([categoryName, score]) => ({ categoryName, score }));

describe("eulerFromMatrix", () => {
  it("identity matrix is a neutral pose", () => {
    const e = eulerFromMatrix(matYXZ(0, 0, 0));
    expect(e.yaw).toBeCloseTo(0, 6);
    expect(e.pitch).toBeCloseTo(0, 6);
    expect(e.roll).toBeCloseTo(0, 6);
  });

  it("round-trips pure-axis rotations", () => {
    const cases: Array<[number, number, number]> = [
      [0.4, 0, 0],
      [-0.35, 0, 0],
      [0, 0.3, 0],
      [0, -0.25, 0],
      [0, 0, 0.45],
      [0, 0, -0.5],
    ];
    for (const [y, p, r] of cases) {
      const e = eulerFromMatrix(matYXZ(y, p, r));
      expect(e.yaw).toBeCloseTo(y, 5);
      expect(e.pitch).toBeCloseTo(p, 5);
      expect(e.roll).toBeCloseTo(r, 5);
    }
  });

  it("round-trips a combined pose", () => {
    const e = eulerFromMatrix(matYXZ(0.3, 0.2, -0.15));
    expect(e.yaw).toBeCloseTo(0.3, 4);
    expect(e.pitch).toBeCloseTo(0.2, 4);
    expect(e.roll).toBeCloseTo(-0.15, 4);
  });

  it("short/garbage input is neutral, never NaN", () => {
    expect(eulerFromMatrix([])).toEqual({ yaw: 0, pitch: 0, roll: 0 });
    expect(eulerFromMatrix([NaN, 1, 2])).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });

  it("poseToDrive normalises by the caps and clamps beyond them", () => {
    const d = poseToDrive({ yaw: 0.325, pitch: -0.25, roll: 2 });
    expect(d.yaw).toBeCloseTo(0.5, 6);
    expect(d.pitch).toBeCloseTo(-0.5, 6);
    expect(d.roll).toBe(1);
  });
});

describe("driveFromFace", () => {
  it("no inputs → neutral drive", () => {
    expect(driveFromFace(undefined, undefined)).toEqual(NEUTRAL_DRIVE);
  });

  it("maps blink, jaw and brow blendshapes", () => {
    const d = driveFromFace(
      cats({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2, jawOpen: 0.5, browInnerUp: 0.6 }),
      undefined,
    );
    expect(d.blinkL).toBeCloseTo(0.9);
    expect(d.blinkR).toBeCloseTo(0.2);
    expect(d.mouthOpen).toBeGreaterThan(0.5); // jaw curve opens up small movements
    expect(d.mouthOpen).toBeLessThanOrEqual(1);
    expect(d.brow).toBeGreaterThan(0.3);
    expect(d.talk).toBeGreaterThan(0.5);
  });

  it("gaze combines both eyes and clamps", () => {
    const d = driveFromFace(
      cats({ eyeLookInLeft: 1, eyeLookOutRight: 1, eyeLookDownLeft: 0.4, eyeLookDownRight: 0.4 }),
      undefined,
    );
    expect(d.lookX).toBeCloseTo(1);
    expect(d.lookY).toBeCloseTo(0.4);
  });

  it("scores above 1 or missing channels never break the drive", () => {
    const d = driveFromFace(cats({ eyeBlinkLeft: 7, jawOpen: -2 }), matYXZ(0.1, 0, 0));
    expect(d.blinkL).toBe(1);
    expect(d.mouthOpen).toBe(0);
    expect(d.yaw).toBeGreaterThan(0);
  });
});

describe("DriveSmoother", () => {
  it("moves toward the target and converges", () => {
    const s = new DriveSmoother();
    let out = s.step({ ...NEUTRAL_DRIVE, yaw: 1 }, 16);
    expect(out.yaw).toBeGreaterThan(0);
    expect(out.yaw).toBeLessThan(1);
    for (let i = 0; i < 200; i++) out = s.step({ ...NEUTRAL_DRIVE, yaw: 1 }, 16);
    expect(out.yaw).toBeCloseTo(1, 3);
  });

  it("a huge dt (tab stall) is clamped — no teleporting", () => {
    const s = new DriveSmoother();
    const out = s.step({ ...NEUTRAL_DRIVE, yaw: 1 }, 60_000);
    expect(out.yaw).toBeLessThan(0.95);
  });

  it("blink channels settle faster than pose channels", () => {
    const s = new DriveSmoother();
    const out = s.step({ ...NEUTRAL_DRIVE, yaw: 1, blinkL: 1 }, 16);
    expect(out.blinkL).toBeGreaterThan(out.yaw);
  });
});

describe("mic level + MouthShaper", () => {
  it("RMS of silence is 0, of a loud square wave is high", () => {
    expect(micRmsFromByteData(new Uint8Array(512).fill(128))).toBe(0);
    const loud = new Uint8Array(512);
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 ? 255 : 0;
    expect(micRmsFromByteData(loud)).toBeGreaterThan(0.9);
  });

  it("speech-level input opens the mouth fast and releases it slowly", () => {
    const m = new MouthShaper();
    let out = m.step(0.12, 16);
    out = m.step(0.12, 16);
    out = m.step(0.12, 16);
    expect(out.mouthOpen).toBeGreaterThan(0.35);
    expect(out.talk).toBeGreaterThan(0.3);
    const afterOneSilent = m.step(0, 16);
    expect(afterOneSilent.mouthOpen).toBeGreaterThan(out.mouthOpen * 0.6); // release is gradual
    let last = afterOneSilent;
    for (let i = 0; i < 120; i++) last = m.step(0, 16);
    expect(last.mouthOpen).toBeLessThan(0.02);
    expect(last.talk).toBeLessThan(0.05);
  });

  it("room noise below the floor doesn't flap the mouth", () => {
    const m = new MouthShaper();
    let out = m.step(0.004, 16);
    for (let i = 0; i < 30; i++) out = m.step(0.004, 16);
    expect(out.mouthOpen).toBe(0);
  });
});

describe("BlinkScheduler + idle", () => {
  it("is deterministic for a given seed", () => {
    const a = new BlinkScheduler(42);
    const b = new BlinkScheduler(42);
    for (const t of [0, 1.5, 3.2, 5.9, 9.4, 20]) {
      expect(a.closureAt(t)).toBe(b.closureAt(t));
    }
  });

  it("blinks are brief bumps: closed mid-blink, open between", () => {
    const s = new BlinkScheduler(7);
    let sawClosed = false;
    let closedTime = 0;
    for (let t = 0; t < 30; t += 0.01) {
      const c = s.closureAt(t);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      if (c > 0.9) sawClosed = true;
      if (c > 0.05) closedTime += 0.01;
    }
    expect(sawClosed).toBe(true);
    expect(closedTime).toBeLessThan(2.5); // eyes are open the overwhelming majority of 30s
    expect(closedTime).toBeGreaterThan(0.3); // but it does blink several times
  });

  it("idle pose breathes gently and stays near neutral", () => {
    const d = idleDriveAt(3.7, 0);
    expect(Math.abs(d.yaw)).toBeLessThan(0.06);
    expect(Math.abs(d.pitch)).toBeLessThan(0.03);
    expect(d.mouthOpen).toBe(0);
    const blinked = idleDriveAt(3.7, 1);
    expect(blinked.blinkL).toBe(1);
    expect(blinked.blinkR).toBe(1);
  });
});

describe("applySensitivity", () => {
  it("scales pose and gaze, clamps at the caps", () => {
    const d = applySensitivity({ ...NEUTRAL_DRIVE, yaw: 0.4, lookX: -0.9 }, 1.5);
    expect(d.yaw).toBeCloseTo(0.6);
    expect(d.lookX).toBe(-1);
    const calm = applySensitivity({ ...NEUTRAL_DRIVE, yaw: 0.4 }, 0.5);
    expect(calm.yaw).toBeCloseTo(0.2);
  });
});

describe("resolveDrive — the ladder", () => {
  it("face requested + tracking live = face", () => {
    expect(resolveDrive("face", { faceReady: true, micAvailable: false })).toEqual({
      mode: "face",
      fellBack: false,
      reason: null,
    });
  });

  it("face requested, tracking down, mic live = voice with a reason", () => {
    const r = resolveDrive("face", { faceReady: false, micAvailable: true });
    expect(r.mode).toBe("voice");
    expect(r.fellBack).toBe(true);
    expect(r.reason).toMatch(/voice/i);
  });

  it("face requested, nothing available = idle with a reason", () => {
    const r = resolveDrive("face", { faceReady: false, micAvailable: false });
    expect(r.mode).toBe("idle");
    expect(r.fellBack).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  it("voice requested without a mic = idle; idle never 'falls back'", () => {
    expect(resolveDrive("voice", { faceReady: true, micAvailable: false }).mode).toBe("idle");
    expect(resolveDrive("voice", { faceReady: false, micAvailable: true })).toEqual({
      mode: "voice",
      fellBack: false,
      reason: null,
    });
    expect(resolveDrive("idle", { faceReady: false, micAvailable: false })).toEqual({
      mode: "idle",
      fellBack: false,
      reason: null,
    });
  });
});
