/**
 * rig.ts — PROOF (branch world-3d-characters; not staging code).
 *
 * The BDV humanoid rig v1: the ONE skeleton every 3D character in
 * the palace wears — guards, the King, and creator vault characters
 * alike. Bone names deliberately mirror the common humanoid naming
 * (hips/spine/chest/neck/head + shoulder/upperArm/foreArm/hand +
 * thigh/shin/foot) so animation clips from any standard source
 * (in-house authored, Mixamo-style libraries, mocap retargets) map
 * onto every body by NAME, and one clip set plays on all of them.
 *
 * A `jaw` bone rides under `head`: lip movement on a 3D body is
 * the jaw opening by the speaker's voice level — the same openness
 * value the flat pipeline already computes (lips.ts) — because the
 * shark faces yield no face landmarks (proven: figure-loop.ts).
 *
 * Pose frame matches the hall: front is -Z, rotation.x NEGATIVE
 * leans forward (actions.ts). Bone local positions are metres,
 * bind pose, relative to the parent bone.
 */
import * as THREE from "three";

export interface RigBones {
  root: THREE.Bone;
  byName: Map<string, THREE.Bone>;
}

/** Bone table: [name, parentName|null, localPosition]. */
const BONE_TABLE: Array<[string, string | null, [number, number, number]]> = [
  ["hips", null, [0, 0.98, 0]],
  ["spine", "hips", [0, 0.18, 0]],
  ["chest", "spine", [0, 0.2, 0]],
  ["neck", "chest", [0, 0.22, 0]],
  ["head", "neck", [0, 0.1, 0]],
  ["jaw", "head", [0, -0.03, -0.04]],
  ["shoulder.L", "chest", [0.1, 0.17, 0]],
  ["upperArm.L", "shoulder.L", [0.12, -0.01, 0]],
  ["foreArm.L", "upperArm.L", [0.07, -0.28, 0]],
  ["hand.L", "foreArm.L", [0.04, -0.26, -0.01]],
  ["shoulder.R", "chest", [-0.1, 0.17, 0]],
  ["upperArm.R", "shoulder.R", [-0.12, -0.01, 0]],
  ["foreArm.R", "upperArm.R", [-0.07, -0.28, 0]],
  ["hand.R", "foreArm.R", [-0.04, -0.26, -0.01]],
  ["thigh.L", "hips", [0.11, -0.06, 0]],
  ["shin.L", "thigh.L", [0, -0.44, 0]],
  ["foot.L", "shin.L", [0, -0.42, -0.03]],
  ["thigh.R", "hips", [-0.11, -0.06, 0]],
  ["shin.R", "thigh.R", [0, -0.44, 0]],
  ["foot.R", "shin.R", [0, -0.42, -0.03]],
];

export const RIG_BONE_NAMES = BONE_TABLE.map(([n]) => n);

/** Build a fresh rig (bones only — geometry binds to it). */
export function buildRig(): RigBones {
  const byName = new Map<string, THREE.Bone>();
  let root: THREE.Bone | null = null;
  for (const [name, parentName, pos] of BONE_TABLE) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(pos[0], pos[1], pos[2]);
    byName.set(name, bone);
    if (parentName) byName.get(parentName)!.add(bone);
    else root = bone;
  }
  return { root: root!, byName };
}

/** World (bind-space) position of a bone, computed from the table —
 *  geometry is authored in this space before binding. */
export function boneWorldPosition(name: string): THREE.Vector3 {
  const parentOf = new Map(BONE_TABLE.map(([n, p]) => [n, p]));
  const posOf = new Map(BONE_TABLE.map(([n, , p]) => [n, new THREE.Vector3(...p)]));
  const out = new THREE.Vector3();
  let cur: string | null = name;
  while (cur) {
    out.add(posOf.get(cur)!);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

/* ── Clip authoring ─────────────────────────────────────────────────
 * Clips are authored as Euler keys per bone and compiled to
 * quaternion tracks. One set of clips, authored ONCE against these
 * bone names, plays on every body wearing the rig. */

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

/** Position track — only ever used on `hips`, the root bone, whose
 *  local position IS its bind-space position. Keys are y-offsets. */
function posTrack(bone: string, keys: Array<{ t: number; y: number }>): THREE.VectorKeyframeTrack {
  const base = boneWorldPosition(bone);
  const times = keys.map((k) => k.t);
  const values: number[] = [];
  for (const k of keys) values.push(base.x, base.y + k.y, base.z);
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, values);
}

/** Idle: breath + a slow look around. 4s loop. */
export function idleClip(): THREE.AnimationClip {
  return new THREE.AnimationClip("idle", 4, [
    quatTrack("spine", [
      { t: 0, x: 0 },
      { t: 2, x: -0.022 },
      { t: 4, x: 0 },
    ]),
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
      { t: 0, y: 0 },
      { t: 2, y: 0.006 },
      { t: 4, y: 0 },
    ]),
  ]);
}

/** Bow: the palace greeting — 1.5s, matching actions.ts' duration. */
export function bowClip(): THREE.AnimationClip {
  return new THREE.AnimationClip("bow", 1.5, [
    quatTrack("spine", [
      { t: 0, x: 0 },
      { t: 0.5, x: -0.32 },
      { t: 0.95, x: -0.36 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("chest", [
      { t: 0, x: 0 },
      { t: 0.5, x: -0.24 },
      { t: 0.95, x: -0.27 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("head", [
      { t: 0, x: 0 },
      { t: 0.5, x: -0.1 },
      { t: 0.95, x: -0.12 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("upperArm.L", [
      { t: 0, x: 0 },
      { t: 0.5, x: 0.18 },
      { t: 0.95, x: 0.18 },
      { t: 1.5, x: 0 },
    ]),
    quatTrack("upperArm.R", [
      { t: 0, x: 0 },
      { t: 0.5, x: 0.18 },
      { t: 0.95, x: 0.18 },
      { t: 1.5, x: 0 },
    ]),
  ]);
}

/** Walk cycle: arm swing + stride bob + robe sway. ~0.86s loop. */
export function walkClip(): THREE.AnimationClip {
  const swing = 0.5;
  return new THREE.AnimationClip("walk", 0.86, [
    quatTrack("upperArm.L", [
      { t: 0, x: -swing },
      { t: 0.215, x: 0 },
      { t: 0.43, x: swing },
      { t: 0.645, x: 0 },
      { t: 0.86, x: -swing },
    ]),
    quatTrack("upperArm.R", [
      { t: 0, x: swing },
      { t: 0.215, x: 0 },
      { t: 0.43, x: -swing },
      { t: 0.645, x: 0 },
      { t: 0.86, x: swing },
    ]),
    quatTrack("foreArm.L", [
      { t: 0, x: -0.25 },
      { t: 0.43, x: -0.45 },
      { t: 0.86, x: -0.25 },
    ]),
    quatTrack("foreArm.R", [
      { t: 0, x: -0.45 },
      { t: 0.43, x: -0.25 },
      { t: 0.86, x: -0.45 },
    ]),
    quatTrack("spine", [
      { t: 0, y: 0.05, z: 0.015 },
      { t: 0.43, y: -0.05, z: -0.015 },
      { t: 0.86, y: 0.05, z: 0.015 },
    ]),
    posTrack("hips", [
      { t: 0, y: 0 },
      { t: 0.215, y: -0.018 },
      { t: 0.43, y: 0 },
      { t: 0.645, y: -0.018 },
      { t: 0.86, y: 0 },
    ]),
  ]);
}

export const PROOF_CLIPS = { idle: idleClip, bow: bowClip, walk: walkClip };
