/**
 * guard-fixtures-scene.ts — builds the palace fixtures' three.js
 * groups (decisions: guard-fixtures.ts).
 *
 * Shape of the build, per fixture post:
 *   - The FALLBACK stands first, synchronously: the guard's approved
 *     matte on a plane (the presence figures' own material recipe),
 *     or the King's portrait on the gold-framed easel (the presence
 *     system's portrait figure, never the bare capsule). A post is
 *     never empty, and never a placeholder shape if a figure of the
 *     person exists.
 *   - The body's GLB loads ONCE per body (three bodies total), is
 *     normalized with the proof loader's math, and a clone swaps into
 *     every post of that body. Any failure — network, parse,
 *     degenerate bounds — leaves the fallback standing and reports
 *     through onError; nothing here can throw into the scene.
 *   - A failed load is NOT final: when the fast retry plan runs out,
 *     the heal loop (guard-fixtures FixtureHealLoop) keeps re-walking
 *     the plan on a slow ring — minutes apart, visible tab only — so
 *     a transient failure swaps the real body in mid-session without
 *     a reload, and onRecovered fires so the failure record clears.
 *     The exhaustion also fires the failure beacon: one small report
 *     per post per session to the api-server, which logs it — the
 *     next failure on the owner's machine is diagnosable from the
 *     server logs, not from a console nobody opens.
 *   - Static bodies: no skinning, no per-frame work beyond a whisper
 *     of sway (guard-fixtures.fixtureSway). The two posts of one body
 *     share geometry/materials through the clone.
 *
 * The groups live on the SCENE ROOT (never inside a look group —
 * applyLook disposes look-group children on a theme change, and the
 * bodies must survive it). hall-scene syncs each area group's
 * visibility to the room verdicts it already computes.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mediaUrl } from "../media-cdn";
import {
  FIXTURE_ATTEMPT_TIMEOUT_MS,
  FIXTURE_BODIES,
  FixtureBeaconLedger,
  FixtureHealLoop,
  WORLD_FIXTURES,
  attemptLoadPlan,
  bodyTexturesLanded,
  buildFixtureFailureReport,
  fixtureBodyLoadOrder,
  fixtureFallbackFor,
  fixtureLoadPlan,
  fixtureNormalization,
  fixturePortraitPanelSize,
  fixtureRotY,
  fixtureSway,
  fixtureTextureRepairPlan,
  withFixtureAttemptTimeout,
  type FixtureBodyDef,
  type FixtureBodyId,
  type FixtureFailureReport,
  type FixtureTextureRepairStep,
  type GlbJsonLike,
  type GlbSamplerLike,
  type WorldFixtureDef,
} from "./guard-fixtures";
import { figureWidthForHeight } from "./figure";

export interface WorldFixtures {
  /** Scene-root groups, one per area — add both to the scene. */
  hall: THREE.Group;
  plaza: THREE.Group;
  /** Per-frame: idle sway + fallback billboarding toward the camera. */
  update(nowMs: number, camX: number, camZ: number): void;
  /** Which posts are standing on the real 3D body (proof + tests). */
  bodyLive(body: FixtureBodyId): boolean;
  dispose(): void;
}

interface FixtureSlot {
  def: WorldFixtureDef;
  /** Post group: position + facing. */
  group: THREE.Group;
  /** The fallback stand-in (removed from the group once 3D lands). */
  standin: THREE.Group;
  live: boolean;
}

function softShadowTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, "rgba(0,0,0,0.42)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── Texture repair: the texture step's second mechanism ──────────
   When a parse lands texture-less (three's loader resolves a dead
   texture decode to null instead of failing — mechanism in
   guard-fixtures.ts), the textures are rebuilt from the parsed
   file's own bytes through TextureLoader — the <img> decode path,
   governed by img-src and independent of the fetch policy that
   killed the bitmap path inside GLTFLoader. Repairs are
   SERIALISED across bodies: a burst-wide texture failure must not
   answer itself with three simultaneous re-decodes of 2048²
   images on top of the entry burst. Initial parses stay fully
   concurrent; only this second mechanism queues. */

let textureRepairGate: Promise<unknown> = Promise.resolve();
function runTextureRepair<T>(fn: () => Promise<T>): Promise<T> {
  const run = textureRepairGate.then(fn, fn);
  textureRepairGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const repairTextureLoader = new THREE.TextureLoader();

/** The parser surface the repair reads — GLTFLoader's parser is
 *  not part of three's public types, so it is read loosely, the
 *  same way the body loader already reaches parser.json. */
interface GltfParserLike {
  json?: GlbJsonLike;
  getDependency?: (type: string, index: number) => Promise<unknown>;
  associations?: Map<unknown, { materials?: number }>;
}

/** Mirror a glTF sampler onto a rebuilt texture (spec defaults:
 *  wrap Repeat, magFilter Linear, minFilter LinearMipmapLinear). */
function applyGlbSampler(tex: THREE.Texture, sampler?: GlbSamplerLike): void {
  const wrap = (v?: number): THREE.Wrapping =>
    v === 33071
      ? THREE.ClampToEdgeWrapping
      : v === 33648
        ? THREE.MirroredRepeatWrapping
        : THREE.RepeatWrapping;
  tex.wrapS = wrap(sampler?.wrapS);
  tex.wrapT = wrap(sampler?.wrapT);
  tex.magFilter = sampler?.magFilter === 9728 ? THREE.NearestFilter : THREE.LinearFilter;
  const min = sampler?.minFilter;
  tex.minFilter =
    min === 9728
      ? THREE.NearestFilter
      : min === 9729
        ? THREE.LinearFilter
        : min === 9984
          ? THREE.NearestMipmapNearestFilter
          : min === 9985
            ? THREE.LinearMipmapNearestFilter
            : min === 9986
              ? THREE.NearestMipmapLinearFilter
              : THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps =
    tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter;
}

/**
 * Rebuild a texture-less parse's missing textures in place.
 * Returns true when at least one slot was filled; any failure —
 * no parser, no plan, a decode that dies too — answers false and
 * the caller judges the body by what actually landed.
 */
async function repairBodyTextures(gltf: {
  parser?: unknown;
  scene: THREE.Object3D;
}): Promise<boolean> {
  try {
    const parser = gltf.parser as GltfParserLike | undefined;
    const getDependency = parser?.getDependency;
    if (!parser?.json || typeof getDependency !== "function") return false;
    const steps = fixtureTextureRepairPlan(parser.json);
    if (steps.length === 0) return false;
    const getDep = getDependency.bind(parser);
    const textureByKey = new Map<string, Promise<THREE.Texture | null>>();
    const loadRepaired = (step: FixtureTextureRepairStep): Promise<THREE.Texture | null> => {
      /* One decode per (texture, colour space): metalnessMap and
         roughnessMap share the metallicRoughness texture instance,
         exactly as the loader itself assigns it. */
      const key = `${step.textureIndex}:${step.colorSpace}`;
      let pending = textureByKey.get(key);
      if (!pending) {
        pending = (async () => {
          const bytes = (await getDep("bufferView", step.bufferView)) as ArrayBuffer;
          const url = URL.createObjectURL(new Blob([bytes], { type: step.mimeType }));
          try {
            const tex = await repairTextureLoader.loadAsync(url);
            tex.flipY = false; /* glTF UVs: no flip, as GLTFLoader sets */
            if (step.colorSpace === "srgb") tex.colorSpace = THREE.SRGBColorSpace;
            applyGlbSampler(tex, step.sampler);
            return tex;
          } finally {
            URL.revokeObjectURL(url);
          }
        })().catch(() => null);
        textureByKey.set(key, pending);
      }
      return pending;
    };
    /* Target the materials ON the scene meshes, found through the
       parser's associations — never parser.getDependency("material"):
       GLTFLoader CLONES a material onto the mesh whenever the mesh
       needs vertex colours, flat shading or derivative tangents
       (all three bodies qualify), so the parser's own instance is
       a sibling the renderer never sees. Writing the repair onto
       it lands nothing (proven on the bench: identity false, scene
       untouched). The clone carries the same association, which is
       the reliable road from a scene material back to its glTF
       material index and therefore to its repair steps. */
    const stepsByMaterial = new Map<number, FixtureTextureRepairStep[]>();
    for (const step of steps) {
      const list = stepsByMaterial.get(step.materialIndex) ?? [];
      list.push(step);
      stepsByMaterial.set(step.materialIndex, list);
    }
    const sceneMaterials = new Set<THREE.MeshStandardMaterial>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const m = mesh.material;
        if (Array.isArray(m)) {
          for (const item of m) sceneMaterials.add(item as THREE.MeshStandardMaterial);
        } else if (m) {
          sceneMaterials.add(m as THREE.MeshStandardMaterial);
        }
      }
    });
    let assigned = 0;
    for (const material of sceneMaterials) {
      const materialIndex = parser.associations?.get(material)?.materials;
      if (materialIndex === undefined) continue;
      for (const step of stepsByMaterial.get(materialIndex) ?? []) {
        const current = material[step.slot] as THREE.Texture | null | undefined;
        const currentImage = current?.image as { width?: unknown } | undefined;
        if (current && typeof currentImage?.width === "number" && currentImage.width > 0) {
          continue; /* this slot landed on its own — leave it alone */
        }
        const tex = await loadRepaired(step);
        if (!tex) continue;
        material[step.slot] = tex;
        material.needsUpdate = true;
        assigned += 1;
      }
    }
    return assigned > 0;
  } catch {
    return false;
  }
}

function buildStandin(def: WorldFixtureDef, shadowTex: THREE.Texture): THREE.Group {
  const body = FIXTURE_BODIES[def.body];
  const fallback = fixtureFallbackFor(def.body);
  const group = new THREE.Group();

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  shadow.renderOrder = 1;
  group.add(shadow);

  if (fallback.kind === "matte") {
    /* Sized from the matte's real aspect once it lands — the exact
     * recipe the presence figures use (hall-scene buildFigure). */
    const mat = new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 0.6,
      metalness: 0.05,
      alphaTest: 0.02,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, body.height), mat);
    mesh.position.y = body.height / 2;
    group.add(mesh);
    new THREE.TextureLoader().load(
      mediaUrl(fallback.src),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const img = tex.image as { width?: number; height?: number } | undefined;
        const aspect = img?.width && img?.height ? img.width / img.height : 0.45;
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(
          figureWidthForHeight(body.height, aspect),
          body.height,
        );
        mat.map = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {
        /* Matte failed too: the gold capsule stands instead — a post
         * is never empty. */
        mesh.visible = false;
        group.add(buildCapsule(body.height, 0xc9a227));
      },
    );
  } else if (fallback.kind === "portrait") {
    buildPortraitStandin(group, body.height, fallback.src);
  } else {
    group.add(buildCapsule(body.height, fallback.color));
  }
  return group;
}

/** The easel's base height — the presence portrait figure's own
 *  (hall-scene PORTRAIT_BASE_Y): the panel's bottom edge. */
const FIXTURE_PORTRAIT_BASE_Y = 0.5;

/**
 * The King's dignified fallback: his portrait on the gold-framed
 * easel — the presence system's portrait-figure recipe (hall-scene
 * buildPortraitFigure): a gold frame box, the portrait plane proud
 * of its front face, an easel post to the floor. The panel is sized
 * from the art's aspect inside the fixture panel box, corrected
 * when the texture lands, so the portrait is never stretched. If
 * the portrait art itself cannot load, the gold capsule stands as
 * the last resort — a post is never empty — but the capsule is no
 * longer any post's PLANNED face.
 */
function buildPortraitStandin(group: THREE.Group, bodyHeight: number, src: string): void {
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    emissive: 0x8a6a1c,
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.9,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), goldMat);
  const panelMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), panelMat);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, FIXTURE_PORTRAIT_BASE_Y - 0.02, 10),
    goldMat,
  );
  post.position.y = (FIXTURE_PORTRAIT_BASE_Y - 0.02) / 2 + 0.02;
  const layout = (size: { w: number; h: number }) => {
    const centerY = FIXTURE_PORTRAIT_BASE_Y + size.h / 2;
    frame.geometry.dispose();
    frame.geometry = new THREE.BoxGeometry(size.w + 0.1, size.h + 0.1, 0.05);
    frame.position.set(0, centerY, 0);
    panel.geometry.dispose();
    panel.geometry = new THREE.PlaneGeometry(size.w, size.h);
    panel.position.set(0, centerY, 0.028);
  };
  /* Provisional layout from the King portrait's known aspect
   * (938×841); the load callback re-fits from the real pixels. */
  layout(fixturePortraitPanelSize(938 / 841));
  group.add(frame);
  group.add(panel);
  group.add(post);
  new THREE.TextureLoader().load(
    mediaUrl(src),
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const img = tex.image as { width?: number; height?: number } | undefined;
      if (img?.width && img?.height) {
        layout(fixturePortraitPanelSize(img.width / img.height));
      }
      panelMat.map = tex;
      panelMat.needsUpdate = true;
    },
    undefined,
    () => {
      /* Portrait art failed too: the gold capsule stands instead —
       * the last resort, never the plan. */
      frame.visible = false;
      panel.visible = false;
      post.visible = false;
      group.add(buildCapsule(bodyHeight, 0xc9a227));
    },
  );
}

function buildCapsule(height: number, color: number): THREE.Mesh {
  const radius = 0.34;
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.1, height - radius * 2), 6, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 }),
  );
  mesh.position.y = height / 2;
  return mesh;
}

/** Normalize a loaded GLB scene into a post-ready template group. */
function normalizeBody(scene: THREE.Object3D, targetHeight: number): THREE.Group | null {
  const bounds = new THREE.Box3().setFromObject(scene);
  const norm = fixtureNormalization(
    { min: bounds.min, max: bounds.max },
    targetHeight,
  );
  if (!norm) return null;
  const inner = new THREE.Group();
  inner.position.set(norm.offset.x, norm.offset.y, norm.offset.z);
  inner.add(scene);
  const outer = new THREE.Group();
  outer.scale.setScalar(norm.scale);
  outer.add(inner);
  outer.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
    }
  });
  return outer;
}

export function buildWorldFixtures(opts?: {
  onError?: (body: FixtureBodyId, err: unknown) => void;
  /** A body whose fast plan failed later landed via the heal loop —
   *  the caller clears its recorded failure. */
  onRecovered?: (body: FixtureBodyId) => void;
  /** The failure beacon's transport. Default: the site's own API
   *  (fixture-beacon.ts, dynamically imported so the sender's
   *  session machinery stays out of this module's static graph).
   *  Injected in tests. */
  reportFailure?: (report: FixtureFailureReport) => void;
}): WorldFixtures {
  const hall = new THREE.Group();
  hall.name = "world-fixtures-hall";
  const plaza = new THREE.Group();
  plaza.name = "world-fixtures-plaza";
  const shadowTex = softShadowTexture();
  const slots: FixtureSlot[] = [];
  const liveBodies = new Set<FixtureBodyId>();

  for (const def of WORLD_FIXTURES) {
    const group = new THREE.Group();
    group.name = `fixture-${def.id}`;
    group.position.set(def.position.x, def.position.y, def.position.z);
    group.rotation.y = fixtureRotY(def);
    const standin = buildStandin(def, shadowTex);
    group.add(standin);
    /* Key light per post (Oct 24 readability lift — owner: "the
     * dark theme too dark", the King and guards near-silhouettes):
     * a warm spot standing in front of and above the body, aimed
     * at its chest — the sconce the post never had. The bodies
     * otherwise live off the look's ambient wash alone. No shadow
     * pass (the posts are figures, not set), and the light rides
     * the post group, so area visibility and the idle sway take it
     * with the body. The King's key burns stronger — he is the
     * King. Local +Z is the post's facing, so the spot stands
     * where a visitor stands: in front of the figure. */
    const bodyHeight = FIXTURE_BODIES[def.body].height;
    const key = new THREE.SpotLight(
      0xffd9a3,
      def.body === "king" ? 95 : 60,
      11,
      0.55,
      0.9,
      1.6,
    );
    key.position.set(0, bodyHeight + 1.7, 2.7);
    key.target.position.set(0, bodyHeight * 0.55, 0);
    group.add(key);
    group.add(key.target);
    (def.area === "hall" ? hall : plaza).add(group);
    slots.push({ def, group, standin, live: false });
  }

  /* One load per body; a clone lands at each of its posts. Every
   * failure path keeps the fallback standing. The URL policy mirrors
   * the hall's own texture loader — the media CDN first, the same
   * asset on the site origin second (the public/ copy ships with
   * the app whether or not the bucket carries the body yet) — walked
   * as a bounded retry plan (guard-fixtures.fixtureLoadPlan): the
   * sources alternate with backoff, because a single transient shed
   * or severed transfer must not strand the post on its stand-in
   * all session.
   *
   * START ORDER (stack300, Oct 27): the loads initiate in
   * guard-fixtures.fixtureBodyLoadOrder — plaza bodies first, the
   * King's greeter body ahead of the guards' — and hall-scene now
   * builds the fixtures at the TOP of applyLook, ahead of the look's
   * own texture burst. Until then the bodies were requested in
   * FIXTURE_BODIES record order (guards, King last) at the END of
   * the entry burst, and an arrival watched the flat stand-ins for
   * the whole ~13 MB. The loads still run CONCURRENTLY — the order
   * is initiation priority, never a queue. */
  const loader = new GLTFLoader();
  /* A parse that "succeeds" without its textures is a failure: the
   * body materials carry no baseColorFactor, so a texture-less parse
   * stands a flat-white statue on the post (the owner's Oct 25
   * walk). Validate before accepting a source, so the fallback
   * chain — and ultimately the stand-in — wins over a white body.
   *
   * Two reinforcements ride inside the attempt now (Oct 29,
   * stack600/world-textures — the owner's Oct 28 session, where
   * all six posts exhausted all four attempts on exactly this
   * error while the bodies' bytes fetched fine):
   *
   * 1. REPAIR BEFORE FAILURE. three resolves a dead embedded-
   *    texture decode to null instead of failing, and the decode
   *    dies identically on every source (it is a fetch of a blob:
   *    URL inside ImageBitmapLoader — refused by any policy or
   *    pressure that blocks it), so walking sources alone can
   *    never fix it. A texture-less parse is therefore repaired in
   *    place first (repairBodyTextures) and re-judged; the attempt
   *    fails only when the repair also leaves the body bare.
   * 2. A CEILING. Nothing timed a load out before: a texture
   *    promise that never settles hung the attempt, the plan, the
   *    beacon and the heal ring with it. Each attempt now races
   *    FIXTURE_ATTEMPT_TIMEOUT_MS. */
  const loadBody = async (path: string) => {
    const attempt = async (url: string) => {
      return withFixtureAttemptTimeout(
        async () => {
          const gltf = await loader.loadAsync(url);
          const declared =
            (gltf as { parser?: { json?: { textures?: unknown[] } } }).parser?.json
              ?.textures?.length ?? 0;
          const collectMaterials = (): THREE.Material[] => {
            const materials: THREE.Material[] = [];
            gltf.scene.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (mesh.isMesh) {
                const m = mesh.material;
                if (Array.isArray(m)) materials.push(...m);
                else if (m) materials.push(m);
              }
            });
            return materials;
          };
          if (bodyTexturesLanded(declared, collectMaterials())) return gltf;
          const repaired = await runTextureRepair(() => repairBodyTextures(gltf)).catch(
            () => false,
          );
          if (bodyTexturesLanded(declared, collectMaterials())) return gltf;
          throw new Error(
            repaired
              ? `textures did not land for ${url} (texture repair attempted)`
              : `textures did not land for ${url}`,
          );
        },
        FIXTURE_ATTEMPT_TIMEOUT_MS,
        {
          setTimer: (fn, ms) => setTimeout(fn, ms),
          clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
      );
    };
    return attemptLoadPlan(fixtureLoadPlan(mediaUrl(path), path), attempt, (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    );
  };
  /* One full load for a body — the bounded plan, normalization, and
   * the clone swap into every post of that body — shared by the fast
   * path and the heal loop. Resolves, never rejects. */
  let disposed = false;
  const healLoops = new Map<FixtureBodyId, FixtureHealLoop>();
  const beaconLedger = new FixtureBeaconLedger();
  const tryLoadBody = async (
    bodyDef: FixtureBodyDef,
  ): Promise<{ ok: true } | { ok: false; err: unknown }> => {
    try {
      const gltf = await loadBody(bodyDef.glbPath);
      const template = normalizeBody(gltf.scene, bodyDef.height);
      if (!template) throw new Error(`degenerate bounds in ${bodyDef.glbPath}`);
      for (const slot of slots) {
        if (slot.def.body !== bodyDef.id) continue;
        const bodyGroup = template.clone(true);
        bodyGroup.name = `fixture-body-${slot.def.id}`;
        slot.group.add(bodyGroup);
        /* The standin stays in the group, hidden — never an empty
         * post, and no shared-texture dispose hazards. */
        slot.standin.visible = false;
        slot.live = true;
      }
      liveBodies.add(bodyDef.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, err };
    }
  };
  for (const bodyId of fixtureBodyLoadOrder()) {
    const bodyDef = FIXTURE_BODIES[bodyId];
    void tryLoadBody(bodyDef).then((res) => {
      if (res.ok || disposed) return;
      /* The fast plan ran out. Report it once through onError — and
       * do not let it be final for the session: the heal loop keeps
       * re-walking the plan on the slow ring (minutes apart, visible
       * tab only) until the body lands or the scene is disposed.
       * Before the ring, this rejection was the end — the stand-in
       * held the post until re-entry, and on Oct 27 the King stood
       * as a gold capsule for the owner's whole session. */
      opts?.onError?.(bodyDef.id, res.err);
      /* Beacon: one report per POST of this body, once per session
       * (the ledger), so the next failure on any machine — the
       * owner's included — is diagnosable from the server logs
       * instead of a console nobody opens. Silent on success by
       * construction: this block only runs on exhaustion. */
      const fastAttempts = fixtureLoadPlan(mediaUrl(bodyDef.glbPath), bodyDef.glbPath).length;
      for (const slot of slots) {
        if (slot.def.body !== bodyDef.id) continue;
        if (!beaconLedger.claim(slot.def.id)) continue;
        const report = buildFixtureFailureReport({
          postId: slot.def.id,
          body: bodyDef.id,
          attempts: fastAttempts,
          err: res.err,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        });
        if (opts?.reportFailure) {
          opts.reportFailure(report);
        } else {
          void import("./fixture-beacon")
            .then((m) => m.sendFixtureFailureReport(report))
            .catch(() => {
              /* The beacon never becomes a failure itself. */
            });
        }
      }
      const loop = new FixtureHealLoop({
        attempt: async () => (await tryLoadBody(bodyDef)).ok,
        isVisible: () =>
          typeof document === "undefined" || document.visibilityState !== "hidden",
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        onHealed: () => opts?.onRecovered?.(bodyDef.id),
      });
      healLoops.set(bodyDef.id, loop);
      loop.start();
    });
  }

  return {
    hall,
    plaza,
    bodyLive: (body) => liveBodies.has(body),
    update(nowMs, camX, camZ) {
      for (const slot of slots) {
        if (slot.live) {
          const sway = fixtureSway(slot.def.id, nowMs);
          slot.group.rotation.y = fixtureRotY(slot.def) + sway.rotY;
          slot.group.rotation.z = sway.rotZ;
        } else {
          /* A flat stand-in turns to face the visitor (the presence
           * figures billboard the same way); the sway stays off so
           * the plane never slices edge-on while turning. */
          const dx = camX - slot.def.position.x;
          const dz = camZ - slot.def.position.z;
          if (dx * dx + dz * dz > 0.04) {
            slot.standin.rotation.y =
              Math.atan2(dx, dz) - fixtureRotY(slot.def);
          }
        }
      }
    },
    dispose() {
      disposed = true;
      for (const loop of healLoops.values()) loop.stop();
      healLoops.clear();
      const seen = new Set<unknown>();
      const kill = (root: THREE.Object3D) => {
        root.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry && !seen.has(mesh.geometry)) {
            seen.add(mesh.geometry);
            mesh.geometry.dispose();
          }
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : mesh.material
              ? [mesh.material]
              : [];
          for (const m of mats) {
            if (seen.has(m)) continue;
            seen.add(m);
            const std = m as THREE.MeshStandardMaterial;
            if (std.map && !seen.has(std.map)) {
              seen.add(std.map);
              std.map.dispose();
            }
            m.dispose();
          }
        });
      };
      kill(hall);
      kill(plaza);
      shadowTex.dispose();
    },
  };
}
