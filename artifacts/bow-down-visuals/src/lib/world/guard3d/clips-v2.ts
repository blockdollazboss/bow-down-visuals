/**
 * clips-v2.ts — PROOF v2 (branch world-3d-characters; not staging code).
 *
 * The showdown clip set: same house rig, same durations as v1, but the
 * walk actually strides. v1's walk swung the arms and bobbed the hips
 * while the legs hung still — on a flat plane nobody could tell; on a
 * real body it reads as gliding, which the owner banned. v2 adds:
 *  - thigh swing in anti-phase, shin bend timed to the swing-through,
 *    foot compensation so the foot lands flatter (FK foot-planting
 *    approximation: foot pitch cancels most of thigh+shin pitch)
 *  - 8 keys per cycle (smootherstep-spaced) instead of 5 linear keys
 *  - shoulder counter-swing + a touch of chest counter-rotation
 * Bow gains a hips dip (weight into the bow) and a longer arm sweep.
 * Idle gains a slow weight shift. Keys are authored against the same
 * bone names, so both showdown bodies play them identically.
 */
import * as THREE from "three";
import { boneWorldPosition } from "./rig";

interface EulerKey {
  t: number;
  x?: number;
  y?: number;
  z?: number;
}

function quatTrack(bone: string, keys: EulerKey[]): THREE.QuaternionKeyframeTrack {
  const times = keys.map((k) => k.t);
  const values: number[] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const k of keys) {
    e.set(k.x ?? 0, k.y ?? 0, k.z ?? 0);
    q.setFromEuler(e);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function posTrack(bone: string, keys: Array<{ t: number; y?: number; x?: number; z?: number }>): THREE.VectorKeyframeTrack {
  const base = boneWorldPosition(bone);
  const times = keys.map((k) => k.t);
  const values: number[] = [];
  for (const k of keys) values.push(base.x + (k.x ?? 0), base.y + (k.y ?? 0), base.z + (k.z ?? 0));
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, values);
}

/** Sine keys: n samples of amp*sin(2π(t/T)+phase) (+offset), as Euler x-keys. */
function sineKeys(amp: number, period: number, phase = 0, offset = 0, n = 8): EulerKey[] {
  const keys: EulerKey[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (period * i) / n;
    keys.push({ t, x: offset + amp * Math.sin(2 * Math.PI * (t / period) + phase) });
  }
  return keys;
}

/** Idle v2: breath + look-around + a slow weight shift. 4s loop. */
export function idleClipV2(): THREE.AnimationClip {
  return new THREE.AnimationClip("idle", 4, [
    quatTrack("spine", sineKeys(-0.022, 4, 0, 0, 4).map((k) => ({ ...k, x: (k.x ?? 0) + 0 }))),
    quatTrack("chest", [
      { t: 0, x: 0 },
      { t: 2, x: -0.014 },
      { t: 4, x: 0 },
    ]),
    quatTrack("head", [
      { t: 0, y: 0 },
      { t: 1.2, y: 0.16 },
      { t: 2.2, y: 0.1 },
      { t: 3.2, y: -0.13 },
      { t: 4, y: 0 },
    ]),
    quatTrack("upperArm.L", [
      { t: 0, z: 0.02 },
      { t: 2, z: 0.05 },
      { t: 4, z: 0.02 },
    ]),
    quatTrack("upperArm.R", [
      { t: 0, z: -0.02 },
      { t: 2, z: -0.05 },
      { t: 4, z: -0.02 },
    ]),
    posTrack("hips", [
      { t: 0, y: 0, x: 0 },
      { t: 1, y: 0.006, x: 0.006 },
      { t: 2, y: 0, x: 0.008 },
      { t: 3, y: 0.006, x: -0.006 },
      { t: 4, y: 0, x: 0 },
    ]),
  ]);
}

/** Bow v2: weight dips into the bow; arms sweep back further. 1.5s. */
export function bowClipV2(): THREE.AnimationClip {
  return new THREE.AnimationClip("bow", 1.5, [
    quatTrack("spine", [
      { t: 0, x: 0 },
      { t: 0.45, x: -0.30 },
      { t: 0.7, x: -0.35 },
      { t: 0.95, x: -0.36 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("chest", [
      { t: 0, x: 0 },
      { t: 0.45, x: -0.22 },
      { t: 0.7, x: -0.26 },
      { t: 0.95, x: -0.27 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("head", [
      { t: 0, x: 0 },
      { t: 0.45, x: -0.10 },
      { t: 0.95, x: -0.13 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("upperArm.L", [
      { t: 0, x: 0 },
      { t: 0.5, x: 0.30 },
      { t: 0.95, x: 0.30 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("upperArm.R", [
      { t: 0, x: 0 },
      { t: 0.5, x: 0.30 },
      { t: 0.95, x: 0.30 },
      { t: 1.5, x: 0 },
    ]),
    posTrack("hips", [
      { t: 0, y: 0 },
      { t: 0.5, y: -0.028 },
      { t: 0.95, y: -0.03 },
      { t: 1.5, y: 0 },
    ]),
  ]);
}

/**
 * Walk v2: a full stride. 0.86s loop (same cadence as v1 + movement.ts).
 * thigh.x > 0 swings the leg FORWARD (front is -Z); shin.x < 0 folds the
 * heel back during swing-through; foot cancels most of the sum at plant.
 */
export function walkClipV2(): THREE.AnimationClip {
  const T = 0.86;
  const HPI = Math.PI;
  // shin bend: peaks shortly after the thigh passes neutral going forward
  const shinKeys = (phase: number): EulerKey[] => {
    const keys: EulerKey[] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = (T * i) / n;
      const a = 2 * Math.PI * (t / T) + phase;
      // bend is one-sided: max when sin(a - 0.9) > 0
      const bend = -0.10 - 0.48 * Math.max(0, Math.sin(a - 0.9)) ** 1.5;
      keys.push({ t, x: bend });
    }
    return keys;
  };
  const footKeys = (phase: number): EulerKey[] => {
    const keys: EulerKey[] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = (T * i) / n;
      const a = 2 * Math.PI * (t / T) + phase;
      const thigh = 0.50 * Math.sin(a);
      const shin = -0.10 - 0.48 * Math.max(0, Math.sin(a - 0.9)) ** 1.5;
      keys.push({ t, x: -(thigh + shin) * 0.62 });
    }
    return keys;
  };
  return new THREE.AnimationClip("walk", T, [
    quatTrack("thigh.L", sineKeys(0.5, T, 0)),
    quatTrack("thigh.R", sineKeys(0.5, T, HPI)),
    quatTrack("shin.L", shinKeys(0)),
    quatTrack("shin.R", shinKeys(HPI)),
    quatTrack("foot.L", footKeys(0)),
    quatTrack("foot.R", footKeys(HPI)),
    // arms counter-swing against the same-side leg
    quatTrack("upperArm.L", sineKeys(0.46, T, HPI)),
    quatTrack("upperArm.R", sineKeys(0.46, T, 0)),
    quatTrack("foreArm.L", sineKeys(0.12, T, HPI, -0.32)),
    quatTrack("foreArm.R", sineKeys(0.12, T, 0, -0.32)),
    quatTrack("shoulder.L", sineKeys(0.05, T, HPI)),
    quatTrack("shoulder.R", sineKeys(0.05, T, 0)),
    quatTrack("spine", [
      { t: 0, y: 0.055, z: 0.016 },
      { t: T / 2, y: -0.055, z: -0.016 },
      { t: T, y: 0.055, z: 0.016 },
    ]),
    quatTrack("chest", [
      { t: 0, y: -0.035 },
      { t: T / 2, y: 0.035 },
      { t: T, y: -0.035 },
    ]),
    posTrack("hips", [
      { t: 0, y: -0.004 },
      { t: T * 0.25, y: -0.022 },
      { t: T * 0.5, y: -0.004 },
      { t: T * 0.75, y: -0.022 },
      { t: T, y: -0.004 },
    ]),
  ]);
}

export const SHOWDOWN_CLIPS = { idle: idleClipV2, bow: bowClipV2, walk: walkClipV2 };
