/**
 * guard-fixtures-scene.ts — builds the palace fixtures' three.js
 * groups (decisions: guard-fixtures.ts).
 *
 * Shape of the build, per fixture post:
 *   - The FALLBACK stands first, synchronously: the guard's approved
 *     matte on a plane (the presence figures' own material recipe),
 *     or the gold house capsule for the King. A post is never empty.
 *   - The body's GLB loads ONCE per body (three bodies total), is
 *     normalized with the proof loader's math, and a clone swaps into
 *     every post of that body. Any failure — network, parse,
 *     degenerate bounds — leaves the fallback standing and reports
 *     through onError; nothing here can throw into the scene.
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
  FIXTURE_BODIES,
  WORLD_FIXTURES,
  fixtureFallbackFor,
  fixtureNormalization,
  fixtureRotY,
  fixtureSway,
  type FixtureBodyId,
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
  } else {
    group.add(buildCapsule(body.height, fallback.color));
  }
  return group;
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
   * the hall's own texture loader: the media CDN first, and on any
   * failure the same asset on the site origin (the public/ copy ships
   * with the app whether or not the bucket carries the body yet). */
  const loader = new GLTFLoader();
  const loadBody = async (path: string) => {
    const cdn = mediaUrl(path);
    if (cdn !== path) {
      try {
        return await loader.loadAsync(cdn);
      } catch {
        /* fall through to the origin copy */
      }
    }
    return loader.loadAsync(path);
  };
  for (const bodyDef of Object.values(FIXTURE_BODIES)) {
    loadBody(bodyDef.glbPath)
      .then((gltf) => {
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
      })
      .catch((err: unknown) => {
        opts?.onError?.(bodyDef.id, err);
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
