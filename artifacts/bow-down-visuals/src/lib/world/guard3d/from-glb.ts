/**
 * from-glb.ts — PROOF v2 (branch world-3d-characters; not staging code).
 *
 * Loads a GLB body — Blender-modeled parts OR a generator's statue —
 * and stands it on the house rig (rig.ts) so the shared clips play.
 *
 * Generators output statues: no skeleton, no skinning. This loader is
 * the free rigging stand-in for the showdown: procedural skin weights
 * from bone-segment distances (the classic auto-skin), with exact
 * part rules where the mesh carries named parts (the Blender body).
 * Production rigging is UniRig's job (see 3D-CHARACTERS.md) — it
 * predicts a real skeleton + weights for non-human shapes; this loader
 * exists so a statue can walk on the PROOF stage today, honestly
 * labeled as an approximation (worst at the shoulders/armpits, where
 * distance alone can't know which limb owns a vertex).
 *
 * Regalia rule: meshes named Medallion/Cord are NOT skinned — they are
 * bone-attached to the chest, exactly like the v1 proof, so locked
 * items ride the body as separate house meshes.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildRig, boneWorldPosition, RIG_BONE_NAMES, type RigBones } from "./rig";

const BONE_INDEX = new Map(RIG_BONE_NAMES.map((n, i) => [n, i]));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Bone segments in bind space: the capsule a bone "owns". */
function boneSegments(): Array<[string, THREE.Vector3, THREE.Vector3]> {
  const p = (n: string) => boneWorldPosition(n);
  const segs: Array<[string, THREE.Vector3, THREE.Vector3]> = [
    ["hips", V(0, 1.1, 0), V(0, 0.86, 0)],
    ["spine", p("spine"), p("chest")],
    ["chest", p("chest"), p("neck")],
    ["neck", p("neck"), p("head")],
    ["head", p("head"), p("head").clone().add(V(0, 0.17, 0.01))],
    ["jaw", p("jaw"), p("jaw").clone().add(V(0, -0.03, -0.11))],
  ];
  for (const s of ["L", "R"] as const) {
    segs.push(
      [`shoulder.${s}`, p(`shoulder.${s}`), p(`upperArm.${s}`)],
      [`upperArm.${s}`, p(`upperArm.${s}`), p(`foreArm.${s}`)],
      [`foreArm.${s}`, p(`foreArm.${s}`), p(`hand.${s}`)],
      [`hand.${s}`, p(`hand.${s}`), p(`hand.${s}`).clone().add(V(0.02, -0.17, -0.01))],
      [`thigh.${s}`, p(`thigh.${s}`), p(`shin.${s}`)],
      [`shin.${s}`, p(`shin.${s}`), p(`foot.${s}`)],
      [`foot.${s}`, p(`foot.${s}`), p(`foot.${s}`).clone().add(V(0, -0.03, -0.15))],
    );
  }
  return segs;
}
const SEGMENTS = boneSegments();

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}

type Weights = Array<[string, number]>;

/** Distance auto-skin over a candidate bone set (top-2, normalized). */
function distanceWeights(candidates: string[]): (p: THREE.Vector3) => Weights {
  const segs = SEGMENTS.filter(([n]) => candidates.includes(n));
  return (p) => {
    const scored = segs
      .map(([n, a, b]) => ({ n, w: 1 / Math.pow(distToSegment(p, a, b) + 0.015, 3) }))
      .sort((x, y) => y.w - x.w)
      .slice(0, 2);
    const total = scored.reduce((s, x) => s + x.w, 0) || 1;
    return scored.map((x) => [x.n, x.w / total] as [string, number]);
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const span = (y: number, a: number, b: number) => clamp01((y - a) / (b - a));

/** Cloth weights by height (same bands as the v1 robe). */
function torsoWeights(p: THREE.Vector3): Weights {
  const y = p.y;
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
}

const single =
  (bone: string) =>
  (): Weights => [[bone, 1]];

/** Weight rule for a mesh name (Blender parts), else null = statue. */
function ruleFor(name: string): ((p: THREE.Vector3) => Weights) | "attach-chest" | null {
  if (name === "Medallion" || name === "Cord") return "attach-chest";
  const side = name.endsWith(".L") ? "L" : name.endsWith(".R") ? "R" : null;
  if (name === "Jaw") return single("jaw");
  if (name === "Head" || name.startsWith("HeadMuzzle") || name.startsWith("HeadFin") ||
      name.startsWith("Eye") || name.startsWith("Nose") || name === "Mouth" || name.startsWith("Tooth"))
    return single("head");
  if (name === "HeadThroat") return distanceWeights(["neck", "head"]);
  if (name === "Neck") return distanceWeights(["chest", "neck", "head"]);
  if (side && (name.startsWith("Sleeve") || name.startsWith("TrimCuff")))
    return distanceWeights([`upperArm.${side}`, `foreArm.${side}`, `hand.${side}`]);
  if (side && name.startsWith("Hand"))
    return distanceWeights([`foreArm.${side}`, `hand.${side}`]);
  if (side && (name.startsWith("Trouser") || name.startsWith("TrimStripe")))
    return distanceWeights([`thigh.${side}`, `shin.${side}`, `foot.${side}`]);
  if (side && name.startsWith("Shoe")) return single(`foot.${side}`);
  if (name.startsWith("Tail")) return single("hips");
  if (name.startsWith("Torso") || name.startsWith("Trim")) return torsoWeights;
  return null;
}

function skinGeometry(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3) => Weights): void {
  const pos = geo.attributes.position;
  const idx = new Uint16Array(pos.count * 4);
  const wgt = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const parts = fn(p).filter(([, w]) => w > 0.001).slice(0, 2);
    const total = parts.reduce((s, [, w]) => s + w, 0) || 1;
    parts.forEach(([bone, w], j) => {
      idx[i * 4 + j] = BONE_INDEX.get(bone)!;
      wgt[i * 4 + j] = w / total;
    });
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wgt, 4));
}

export interface GlbFigure {
  group: THREE.Group;
  rig: RigBones;
  skeleton: THREE.Skeleton;
  triangleCount: number;
  meshCount: number;
}

export interface GlbFigureOpts {
  /** Scale so total height equals this (statues arrive in a unit box). */
  targetHeight?: number | null;
  /** Rotate around Y before skinning (statue front detection fix). */
  rotY?: number;
}

/**
 * Load a GLB and stand it on the house rig. Geometry is expected in
 * three-space (front = -Z, Y up) after optional rotY; statues get
 * auto-normalized to targetHeight with feet on y=0.
 */
export async function loadGlbFigure(url: string, opts: GlbFigureOpts = {}): Promise<GlbFigure> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const rig = buildRig();
  const group = new THREE.Group();
  const skeleton = new THREE.Skeleton(RIG_BONE_NAMES.map((n) => rig.byName.get(n)!));
  const chest = rig.byName.get("chest")!;
  const chestPos = boneWorldPosition("chest");

  gltf.scene.updateWorldMatrix(true, true);
  const srcMeshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) srcMeshes.push(o as THREE.Mesh);
  });

  // Measure for statue normalization.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = opts.targetHeight && size.y > 0 ? opts.targetHeight / size.y : 1;
  const norm = new THREE.Matrix4()
    .makeRotationY(opts.rotY ?? 0)
    .premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  // after scale+rot, recompute ground offset from transformed corners
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(norm));
  const minY = Math.min(...corners.map((c) => c.y));
  norm.premultiply(new THREE.Matrix4().makeTranslation(0, -minY, 0));

  const statueWeights = distanceWeights(SEGMENTS.map(([n]) => n));
  let triangles = 0;
  let meshCount = 0;

  for (const src of srcMeshes) {
    const geo = src.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, src.matrixWorld));
    triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const material = src.material as THREE.Material | THREE.Material[];
    if (!Array.isArray(material)) {
      const std = material as THREE.MeshStandardMaterial;
      if ("envMapIntensity" in std) std.envMapIntensity = 0.9;
    }
    const rule = ruleFor(src.name);
    if (rule === "attach-chest") {
      geo.translate(-chestPos.x, -chestPos.y, -chestPos.z);
      const m = new THREE.Mesh(geo, material);
      m.frustumCulled = false;
      chest.add(m);
      meshCount++;
      continue;
    }
    skinGeometry(geo, rule ?? statueWeights);
    const m = new THREE.SkinnedMesh(geo, material);
    m.frustumCulled = false;
    m.castShadow = true;
    group.add(m);
    meshCount++;
  }

  group.add(rig.root);
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).bind(skeleton);
  });
  return { group, rig, skeleton, triangleCount: Math.round(triangles), meshCount };
}
