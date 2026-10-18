/**
 * main.ts — PROOF STAGE (branch world-3d-characters; not staging code).
 *
 * Three figures on a palace dais:
 *   LEFT   — today's truth: the approved guard art on a flat plane
 *            (the same PNG the live hall billboards).
 *   CENTER — the same guard as a true 3D body on the house rig,
 *            built procedurally (guard-model.ts), clips playing.
 *   RIGHT  — that body exported to GLB and re-imported through
 *            GLTFLoader: the exact path production assets travel.
 * Orbit the camera (or use the angle buttons): from the side and
 * behind, flat stops existing and 3D keeps standing.
 *
 * Deterministic posing for screenshots:
 *   ?cam=front|side|back|threequarter  ?action=idle|bow|walk
 *   ?t=<seconds into the clip>  ?still=1 (freeze at t)
 *   ?speak=0..1 (jaw openness)
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { buildGuardModel } from "../lib/world/guard3d/guard-model";
import { PROOF_CLIPS } from "../lib/world/guard3d/rig";

const params = new URLSearchParams(location.search);
const readout = document.getElementById("readout")!;
const say = (line: string) => {
  readout.textContent += (readout.textContent ? "\n" : "") + line;
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100a);
scene.fog = new THREE.Fog(0x14100a, 9, 20);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 60);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;

/* The figures' front is -Z (the hall's convention), so the FRONT
   camera stands at -Z. Named for what you SEE, not where you stand. */
const CAMS: Record<string, [number, number, number]> = {
  front: [0, 1.35, -4.4],
  side: [4.4, 1.35, 0],
  back: [0, 1.5, 4.4],
  threequarter: [3.1, 1.7, -3.4],
};
function setCam(name: string) {
  const [x, y, z] = CAMS[name] ?? CAMS.threequarter;
  camera.position.set(x, y, z);
  controls.update();
}
setCam(params.get("cam") ?? "threequarter");

/* ── Stage: marble disc, gold rings, warm palace light ─────────── */
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(7, 48),
  new THREE.MeshStandardMaterial({ color: 0x241b0e, roughness: 0.35, metalness: 0.15 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
for (const r of [1.7, 3.4]) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(r, 0.02, 8, 72),
    new THREE.MeshStandardMaterial({ color: 0xc9a84c, emissive: 0x6e5518, emissiveIntensity: 0.4, metalness: 0.85, roughness: 0.3 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.012;
  scene.add(ring);
}
scene.add(new THREE.HemisphereLight(0xfff1d6, 0x1c1410, 0.85));
const key = new THREE.DirectionalLight(0xffe3ae, 2.4);
key.position.set(3.5, 5.5, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);
const rim = new THREE.DirectionalLight(0xc9a84c, 1.1);
rim.position.set(-3, 3.5, -4);
scene.add(rim);

/* ── LEFT: the flat guard, exactly as the live hall stands him ─── */
const flatFigure = (() => {
  const tex = new THREE.TextureLoader().load("/world/default-character.png");
  tex.colorSpace = THREE.SRGBColorSpace;
  const flat = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 1.92),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, metalness: 0.05, alphaTest: 0.02 }),
  );
  flat.position.set(-1.65, 0.96, 0);
  flat.castShadow = true;
  scene.add(flat);
  return flat;
})();

/* ── CENTER: the 3D guard on the house rig ─────────────────────── */
const guard = buildGuardModel();
guard.group.traverse((o) => {
  if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
});
scene.add(guard.group);
say(`3D guard: ${guard.triangleCount.toLocaleString()} triangles · ${guard.skeleton.bones.length} bones · 5 skinned meshes, one skeleton`);

const mixer = new THREE.AnimationMixer(guard.group);
const actions: Record<string, THREE.AnimationAction> = {};
for (const [name, make] of Object.entries(PROOF_CLIPS)) {
  const a = mixer.clipAction(make());
  if (name !== "bow") a.setLoop(THREE.LoopRepeat, Infinity);
  actions[name] = a;
}
function playAction(name: string, atSeconds = 0) {
  for (const [n, a] of Object.entries(actions)) {
    if (n === name) {
      a.reset().setEffectiveWeight(1).play();
      a.time = atSeconds;
    } else a.stop();
  }
}

/* ── RIGHT: GLB round-trip — export, re-import, animate ───────── */
let glbGuard: THREE.Group | null = null;
let glbMixer: THREE.AnimationMixer | null = null;
async function roundTrip() {
  try {
    const exportRoot = skeletonClone(guard.group) as THREE.Group;
    const exporter = new GLTFExporter();
    const buf = (await exporter.parseAsync(exportRoot, { binary: true })) as ArrayBuffer;
    say(`GLB export: ${(buf.byteLength / 1024).toFixed(1)} KB`);
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buf, "");
    glbGuard = gltf.scene;
    glbGuard.position.x = 1.65;
    glbGuard.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    scene.add(glbGuard);
    glbMixer = new THREE.AnimationMixer(glbGuard);
    const idle = glbMixer.clipAction(PROOF_CLIPS.idle());
    idle.setLoop(THREE.LoopRepeat, Infinity).play();
    say("GLB round-trip: OK — re-imported body stands and animates on the same clips");
  } catch (err) {
    say(`GLB round-trip FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}
void roundTrip();

/* ── Jaw: voice level opens the mouth (the 3D lip path) ────────── */
const jaw = guard.rig.byName.get("jaw")!;
const speak = Number(params.get("speak") ?? "0");
if (speak > 0) jaw.rotation.x = speak * 0.5;

/* ── Controls + deterministic posing ───────────────────────────── */
const still = params.get("still") === "1";
playAction(params.get("action") ?? "idle", Number(params.get("t") ?? "0"));
document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) =>
  b.addEventListener("click", () => playAction(b.dataset.action!)),
);
document.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((b) =>
  b.addEventListener("click", () => setCam(b.dataset.cam!)),
);
document.getElementById("speakBtn")!.addEventListener("click", () => {
  jaw.rotation.x = jaw.rotation.x > 0.1 ? 0 : 0.28;
});

/* ?focus=3d|glb|flat isolates one figure (side views otherwise
   stack all three along the camera axis). */
const focus = params.get("focus");
function applyFocus() {
  if (!focus) return;
  flatFigure.visible = focus === "flat";
  guard.group.visible = focus === "3d";
  if (glbGuard) glbGuard.visible = focus === "glb";
}

const clock = new THREE.Clock();
let frames = 0;
function tick() {
  applyFocus();
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!still) {
    mixer.update(dt);
    glbMixer?.update(dt);
  } else if (frames < 3) {
    // pose once at the requested t, then hold for the screenshot
    mixer.update(0);
    frames++;
  }
  controls.update();
  renderer.render(scene, camera);
}
tick();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
