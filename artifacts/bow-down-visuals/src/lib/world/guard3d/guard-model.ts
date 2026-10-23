/**
 * guard-model.ts — PROOF (branch world-3d-characters; not staging code).
 *
 * The male palace guard as a TRUE 3D body: procedural geometry
 * (lathe robe, capsule sleeves, sculpted shark head) vertex-skinned
 * onto the house rig (rig.ts), wearing the APPROVED guard look —
 * black-and-gold uniform, gold trim, PLAIN gold medallion. No crown
 * and no bead chain: those are the King's own character lock, and
 * the guards were approved without them (owner ruling, 2026-10-16).
 *
 * This file proves the pipeline mechanics — one skeleton, smooth
 * skinning, accessories riding bones, clips playing on the rig.
 * The production bodies come from generated meshes normalized onto
 * this same rig (see 3D-CHARACTERS.md, route A/C); the skeleton
 * and the integration contract are what this proof exists to pin.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildRig, boneWorldPosition, RIG_BONE_NAMES, type RigBones } from "./rig";

const BONE_INDEX = new Map(RIG_BONE_NAMES.map((n, i) => [n, i]));

type WeightFn = (x: number, y: number, z: number) => Array<[string, number]>;

/** Attach skin attributes: up to two influences per vertex. */
function skin(geo: THREE.BufferGeometry, fn: WeightFn): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const idx = new Uint16Array(pos.count * 4);
  const wgt = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const parts = fn(pos.getX(i), pos.getY(i), pos.getZ(i)).filter(([, w]) => w > 0.001);
    let total = parts.reduce((s, [, w]) => s + w, 0) || 1;
    parts.forEach(([bone, w], j) => {
      if (j > 1) return;
      idx[i * 4 + j] = BONE_INDEX.get(bone)!;
      wgt[i * 4 + j] = w / total;
    });
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wgt, 4));
  return geo;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const span = (y: number, a: number, b: number) => clamp01((y - a) / (b - a));

/** Robe weights: the cloth follows hips → spine → chest by height. */
const robeWeights: WeightFn = (_x, y) => {
  if (y < 0.98) return [["hips", 1]];
  if (y < 1.16) {
    const t = span(y, 0.98, 1.16);
    return [
      ["hips", 1 - t],
      ["spine", t],
    ];
  }
  if (y < 1.36) {
    const t = span(y, 1.16, 1.36);
    return [
      ["spine", 1 - t],
      ["chest", t],
    ];
  }
  return [["chest", 1]];
};

const single =
  (bone: string): WeightFn =>
  () => [[bone, 1]];

/** A capsule spanning joint A→joint B in bind space, weighted along
 *  its length from boneA to boneB. */
function limbSegment(a: THREE.Vector3, b: THREE.Vector3, r: number, boneA: string, boneB: string): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.02, len - r * 0.6), 4, 12);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q).setPosition(mid));
  const axis = dir.clone().normalize();
  return skin(geo, (x, y, z) => {
    const t = clamp01(new THREE.Vector3(x, y, z).sub(a).dot(axis) / len);
    const blend = span(t, 0.35, 0.85);
    return [
      [boneA, 1 - blend],
      [boneB, blend],
    ];
  });
}

function xform(geo: THREE.BufferGeometry, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

export interface GuardModel {
  group: THREE.Group;
  rig: RigBones;
  skeleton: THREE.Skeleton;
  triangleCount: number;
}

export function buildGuardModel(): GuardModel {
  const rig = buildRig();
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a84c, metalness: 0.85, roughness: 0.32 });
  const robeMat = new THREE.MeshStandardMaterial({ color: 0x1a1409, roughness: 0.88, metalness: 0.05 });
  const sharkMat = new THREE.MeshStandardMaterial({ color: 0x77828e, roughness: 0.5, metalness: 0.08 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.25, metalness: 0.2 });

  /* ── Robe (lathe) + sleeves ─────────────────────────────────── */
  const profile: Array<[number, number]> = [
    [0.012, 0.0],
    [0.36, 0.02],
    [0.345, 0.1],
    [0.3, 0.5],
    [0.255, 0.9],
    [0.215, 1.2],
    [0.185, 1.42],
    [0.205, 1.52],
    [0.1, 1.585],
    [0.015, 1.6],
  ];
  const robeGeo = skin(
    new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 28),
    robeWeights,
  );

  const shoulder = (s: number) => boneWorldPosition(s > 0 ? "upperArm.L" : "upperArm.R");
  const elbow = (s: number) => boneWorldPosition(s > 0 ? "foreArm.L" : "foreArm.R");
  const wrist = (s: number) => boneWorldPosition(s > 0 ? "hand.L" : "hand.R");
  const sleeveGeos: THREE.BufferGeometry[] = [];
  const handGeos: THREE.BufferGeometry[] = [];
  for (const s of [1, -1] as const) {
    const tag = s > 0 ? "L" : "R";
    sleeveGeos.push(limbSegment(shoulder(s), elbow(s), 0.082, `upperArm.${tag}`, `foreArm.${tag}`));
    const wristPos = wrist(s);
    const handPos = wristPos.clone().add(new THREE.Vector3(0.015 * s, -0.07, -0.01));
    sleeveGeos.push(limbSegment(elbow(s), handPos, 0.068, `foreArm.${tag}`, `hand.${tag}`));
    handGeos.push(skin(xform(new THREE.SphereGeometry(0.055, 12, 10), handPos.x, handPos.y, handPos.z, 0, 0, 0, 1, 1.25, 1), single(`hand.${tag}`)));
  }
  const robeMesh = new THREE.SkinnedMesh(mergeGeometries([robeGeo, ...sleeveGeos])!, robeMat);

  /* ── Gold trim: hem band, chest band, sleeve cuffs ──────────── */
  const trimGeos: THREE.BufferGeometry[] = [
    skin(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.362, 0.015),
          new THREE.Vector2(0.352, 0.09),
          new THREE.Vector2(0.338, 0.16),
        ],
        28,
      ),
      robeWeights,
    ),
    skin(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.196, 1.4),
          new THREE.Vector2(0.19, 1.44),
          new THREE.Vector2(0.2, 1.48),
        ],
        28,
      ),
      robeWeights,
    ),
  ];
  for (const s of [1, -1] as const) {
    const tag = s > 0 ? "L" : "R";
    const a = elbow(s).clone().lerp(wrist(s), 0.72);
    const b = elbow(s).clone().lerp(wrist(s), 0.94);
    trimGeos.push(limbSegment(a, b, 0.074, `foreArm.${tag}`, `hand.${tag}`));
  }
  const trimMesh = new THREE.SkinnedMesh(mergeGeometries(trimGeos)!, gold);

  /* ── Shark head + jaw + hands (front is -Z) ─────────────────── */
  const headAt = boneWorldPosition("head"); // (0, 1.68, 0)
  const H = (geo: THREE.BufferGeometry) => xform(geo, headAt.x, headAt.y, headAt.z);
  const skullGeos: THREE.BufferGeometry[] = [
    skin(H(xform(new THREE.SphereGeometry(0.155, 24, 18), 0, 0.09, 0.02, 0, 0, 0, 0.95, 1.0, 1.1)), single("head")),
    // snout: tapered cylinder pointing forward (-Z), tip narrower
    skin(H(xform(new THREE.CylinderGeometry(0.05, 0.105, 0.26, 16), 0, 0.045, -0.16, -Math.PI / 2 - 0.1, 0, 0)), single("head")),
    skin(H(xform(new THREE.SphereGeometry(0.052, 14, 10), 0, 0.028, -0.285, 0, 0, 0, 1, 0.68, 1)), single("head")),
    // dorsal fin, swept back
    skin(H(xform(new THREE.ConeGeometry(0.055, 0.17, 10), 0, 0.285, 0.055, 0.38, 0, 0, 0.32, 1, 1)), single("head")),
  ];
  const headMesh = new THREE.SkinnedMesh(mergeGeometries([...skullGeos, ...handGeos])!, sharkMat);

  // The jaw: its own skinned piece, 100% jaw bone — voice level
  // rotates this bone and the mouth opens (rig.ts).
  const jawGeo = skin(
    H(xform(new THREE.SphereGeometry(0.085, 14, 10), 0, -0.005, -0.115, 0, 0, 0, 1.05, 0.42, 1.5)),
    single("jaw"),
  );
  const jawMesh = new THREE.SkinnedMesh(jawGeo, sharkMat);

  const eyeGeos = [
    xform(new THREE.SphereGeometry(0.017, 10, 8), headAt.x + 0.078, headAt.y + 0.115, headAt.z - 0.115),
    xform(new THREE.SphereGeometry(0.017, 10, 8), headAt.x - 0.078, headAt.y + 0.115, headAt.z - 0.115),
  ];
  const eyeMesh = new THREE.SkinnedMesh(skin(mergeGeometries(eyeGeos)!, single("head")), darkMat);

  /* ── Plain medallion + cord, riding the chest bone ──────────── */
  const chest = rig.byName.get("chest")!;
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.007, 8, 24, Math.PI), gold);
  cord.rotation.z = Math.PI; // hang as a U in front of the chest
  cord.position.set(0, 0.04, -0.205);
  cord.rotation.x = 0.35;
  chest.add(cord);
  const medallion = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.012, 20), gold);
  medallion.rotation.x = Math.PI / 2 - 0.2;
  medallion.position.set(0, -0.1, -0.235);
  chest.add(medallion);

  /* ── Assemble + bind ──────────────────────────────────────────── */
  const group = new THREE.Group();
  const meshes = [robeMesh, trimMesh, headMesh, jawMesh, eyeMesh];
  const skeleton = new THREE.Skeleton(RIG_BONE_NAMES.map((n) => rig.byName.get(n)!));
  for (const m of meshes) {
    m.frustumCulled = false;
    group.add(m);
  }
  group.add(rig.root);
  group.updateMatrixWorld(true);
  for (const m of meshes) m.bind(skeleton);

  let triangles = 0;
  for (const m of meshes) {
    const g = m.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  return { group, rig, skeleton, triangleCount: Math.round(triangles) };
}
