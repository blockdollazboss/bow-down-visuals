/**
 * showdown.ts — PROOF v2 STAGE (branch world-3d-characters).
 *
 * The free-route showdown, same stage and angles as the v1 proof:
 *   LEFT       — today's truth: the approved guard art on a flat plane.
 *   CENTER     — the BLENDER body: modeled in Blender by script (bpy)
 *                from the approved art, our own geometry + regalia,
 *                exported to GLB and skinned onto the house rig by
 *                from-glb.ts.
 *   RIGHT      — the GENERATED male guard (guard-gen.glb): the best
 *                free image-to-3D we could actually run (a statue — no
 *                skeleton) normalized and auto-skinned onto the same
 *                rig by the same loader.
 *   CENTER-LEFT — the GENERATED female guard (guard-gen-female.glb),
 *                at the post mirroring the male's across the center, so
 *                both generated guards stand on the stage at once. She
 *                arrived in her own slot (see RUNBOOK's two-slot rule):
 *                installing her never evicts him. Her current body is
 *                v1, with known faults (fin-arm, ragged tail) — a
 *                regeneration swaps the slot file when it lands.
 * All bodies play the same v2 clips (the walk now strides). Palace
 * lighting: ACES + a PMREM room environment so PBR materials (gold,
 * wet shark skin, polished shoes) read at palace grade — the
 * comparison is about the bodies, not the stage.
 *
 * Deterministic posing (same params as v1):
 *   ?cam=front|side|back|threequarter  ?action=idle|bow|walk
 *   ?t=<seconds>  ?still=1  ?speak=0..1  ?focus=flat|blender|gen
 *   ?genrot=<radians> (male statue front correction, if needed)
 *   ?femrot=<radians> (female front correction; defaults to genrot
 *   minus a quarter turn — her raw statue faces +X where his faces +Z,
 *   per the Blender judging pass, so the offset turns her to face the
 *   same way he does)
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadGlbFigure, type GlbFigure } from "../lib/world/guard3d/from-glb";
import { SHOWDOWN_CLIPS } from "../lib/world/guard3d/clips-v2";

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
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100a);
scene.fog = new THREE.Fog(0x14100a, 9, 20);

/* Palace-grade environment: image-based light for the PBR metals. */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 60);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;

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

/* ── Stage floor + palace light (as v1, plus the env) ──────────── */
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
scene.add(new THREE.HemisphereLight(0xfff1d6, 0x1c1410, 0.7));
const key = new THREE.DirectionalLight(0xffe3ae, 2.2);
key.position.set(3.5, 5.5, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);
const rim = new THREE.DirectionalLight(0xc9a84c, 1.0);
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
  // x=+3.3: one post further out than v2 — the +1.65 post is now the
  // female generated guard's (the mirror of the male's -1.65), and the
  // flat reference keeps the far-LEFT end of the row.
  flat.position.set(3.3, 0.96, 0);
  flat.rotation.y = Math.PI; // textured side toward the front camera (the hall billboards it; from behind it simply stops existing)
  flat.castShadow = true;
  scene.add(flat);
  return flat;
})();

/* ── CENTER + RIGHT: the two free-route bodies ─────────────────── */
interface LiveFigure {
  isGen: boolean;
  fig: GlbFigure;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
}
const live: LiveFigure[] = [];
let desiredAction = params.get("action") ?? "idle";
let desiredT = Number(params.get("t") ?? "0");
const speak = Number(params.get("speak") ?? "0");

function wireFigure(fig: GlbFigure, x: number, isGen = false): LiveFigure {
  fig.group.position.x = x;
  scene.add(fig.group);
  const mixer = new THREE.AnimationMixer(fig.group);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const [name, make] of Object.entries(SHOWDOWN_CLIPS)) {
    const a = mixer.clipAction(make());
    if (name !== "bow") a.setLoop(THREE.LoopRepeat, Infinity);
    actions[name] = a;
  }
  const lf: LiveFigure = { fig, mixer, actions, isGen };
  live.push(lf);
  playOn(lf, desiredAction, desiredT);
  const jaw = fig.rig.byName.get("jaw");
  if (jaw && speak > 0) jaw.rotation.x = -speak * 0.5;
  return lf;
}
function playOn(lf: LiveFigure, name: string, atSeconds = 0) {
  for (const [n, a] of Object.entries(lf.actions)) {
    if (n === name) {
      a.reset().setEffectiveWeight(1).play();
      a.time = atSeconds;
    } else a.stop();
  }
}
function playAll(name: string, atSeconds = 0) {
  desiredAction = name;
  desiredT = atSeconds;
  for (const lf of live) playOn(lf, name, atSeconds);
}

loadGlbFigure("/world/guard-v2-blender.glb")
  .then((fig) => {
    wireFigure(fig, 0);
    say(`BLENDER body: ${fig.triangleCount.toLocaleString()} triangles · ${fig.meshCount} parts · house rig (20 bones)`);
  })
  .catch((e) => say(`BLENDER body FAILED to load: ${e instanceof Error ? e.message : String(e)}`));

const genRot = Number(params.get("genrot") ?? "0");
loadGlbFigure("/world/guard-gen.glb", {
  targetHeight: 1.92,
  rotY: genRot,
})
  .then((fig) => {
    wireFigure(fig, -1.65, true);
    say(`GENERATED body (male): ${fig.triangleCount.toLocaleString()} triangles · statue auto-skinned to the house rig`);
  })
  .catch((e) => say(`GENERATED body (male) not present (${e instanceof Error ? e.message : String(e)}) — center stands alone`));

/* The female generated guard, at the mirrored post (+1.65 — the flat
   plane's old spot; the flat moved one post further out). Same loader,
   same normalization, same clips: she is a second generated-slot
   occupant, not a new kind of figure. Her raw statue faces +X where
   the male's faces +Z (Blender judging pass), so her default rotY is
   his minus a quarter turn; ?femrot= overrides it outright. */
loadGlbFigure("/world/guard-gen-female.glb", {
  targetHeight: 1.92,
  rotY: Number(params.get("femrot") ?? String(genRot - Math.PI / 2)),
})
  .then((fig) => {
    wireFigure(fig, 1.65, true);
    say(`GENERATED body (female): ${fig.triangleCount.toLocaleString()} triangles · statue auto-skinned to the house rig`);
  })
  .catch((e) => say(`GENERATED body (female) not present (${e instanceof Error ? e.message : String(e)}) — her post stands empty`));

/* ── Controls ──────────────────────────────────────────────────── */
document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) =>
  b.addEventListener("click", () => playAll(b.dataset.action!)),
);
document.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((b) =>
  b.addEventListener("click", () => setCam(b.dataset.cam!)),
);
document.getElementById("speakBtn")!.addEventListener("click", () => {
  for (const lf of live) {
    const jaw = lf.fig.rig.byName.get("jaw");
    if (jaw) jaw.rotation.x = jaw.rotation.x < -0.1 ? 0 : -0.28;
  }
});

const focus = params.get("focus");
function applyFocus() {
  if (!focus) return;
  flatFigure.visible = focus === "flat";
  for (const lf of live) {
    lf.fig.group.visible = focus === "gen" ? lf.isGen : focus === "blender" ? !lf.isGen : true;
  }
}

const still = params.get("still") === "1";
const clock = new THREE.Clock();
function tick() {
  applyFocus();
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!still) {
    for (const lf of live) lf.mixer.update(dt);
  } else {
    // still: evaluate at the clip's set time every frame — the figures
    // load async, so a "first N frames only" gate (v1's, whose figures
    // were synchronous) would burn before they arrive and freeze them
    // in bind pose.
    for (const lf of live) lf.mixer.update(0);
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
