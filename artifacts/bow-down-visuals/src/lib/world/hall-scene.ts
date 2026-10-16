/**
 * hall-scene.ts — the King's Hall in Three.js: a palace hall with a
 * stage at the front and a big screen over it that plays the hall's
 * featured reel — or a live stream's HLS when one is truly live (the
 * page decides from GET /api/world/screen; this file just plays what
 * it's handed).
 *
 * The owner picked the hall's two faces (2026-10-16), switched by the
 * visitor's site theme (see hall-looks.ts):
 *   LIGHT → Look A "Golden Hour Palace": sunlit cream-and-gold marble,
 *           tall windows, dust in the light beams, mirror-bright floor.
 *   DARK  → Look B "Midnight Throne Room": black marble with gold
 *           veining, candle sconces and fire braziers, haze, deep
 *           premium shadow over a mirror-dark floor.
 * Both looks are PBR: real texture maps, themed environment
 * reflections, a true planar-reflection floor under a polished marble
 * overlay, and per-look light rigs. A quality ladder keeps phone-class
 * hardware (headsets included) honest: low tiers drop the planar
 * reflection, shadow maps and the extra point lights, in that order.
 * Imported ONLY via dynamic import from the /world page, so three.js
 * ships in the world chunk and nowhere else.
 *
 * Controls: WASD/arrows + drag-look (click for pointer-lock mouse
 * look) on desktop; left-thumb virtual stick + drag-look on touch;
 * WebXR immersive-vr with thumbstick walking when a headset offers it.
 * Heading convention (shared with the server): rotY 0 faces the
 * stage/screen (-Z). The local walker stays on the audience floor —
 * the stage is a stage.
 */
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { WorldPeer } from "./world-client";
import { HALL_SCREEN, hallLookFor, type HallLook, type HallTheme } from "./hall-looks";

export interface HallScreenSource {
  mode: "live" | "featured";
  videoUrl: string | null;
  hlsUrl: string | null;
}

const BOUNDS = { minX: -13.1, maxX: 13.1, minZ: -11.6, maxZ: 11.1 };
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 3.4;
const RUN_SPEED = 6;

const GOLD = 0xd4af37;
const GOLD_DEEP = 0x8a6a1c;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/* ── Quality ladder ───────────────────────────────────────────────────
   high:   planar mirror floor, soft shadow maps, every light live.
   medium: smaller mirror, shadow maps, candle points still live.
   low:    no mirror (polished env-reflective floor only), no shadow
           maps, candlelight is emissive-only. Pixel ratio steps down
           with the tier. Touch devices start a rung lower. */
type QualityTier = "high" | "medium" | "low";

function detectQuality(): QualityTier {
  const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 4 : 4;
  if (coarse) return cores >= 6 ? "medium" : "low";
  return cores >= 4 ? "high" : "medium";
}

const QUALITY = {
  high: { pixelRatio: 2, reflectorSize: 1024, shadows: true, candleLights: true },
  medium: { pixelRatio: 1.75, reflectorSize: 512, shadows: true, candleLights: true },
  low: { pixelRatio: 1.5, reflectorSize: 0, shadows: false, candleLights: false },
} as const;

/* ── Texture maps (public assets, lazy with the world chunk) ─────────
   One cached instance per (url, repeat) — materials vary by repeat,
   never by look, so a theme re-skin re-uses what's already loaded.
   Mirrored wrapping hides the tile seams of generated maps. */
const textureCache = new Map<string, THREE.Texture>();

function hallTexture(url: string, repeatX: number, repeatY: number): THREE.Texture {
  const key = `${url}@${repeatX}x${repeatY}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const path = `${import.meta.env.BASE_URL}${url.replace(/^\//, "")}`;
  const tex = new THREE.TextureLoader().load(path);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  textureCache.set(key, tex);
  return tex;
}

function screenIdleTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 440;
  const g = c.getContext("2d")!;
  g.fillStyle = "#050505";
  g.fillRect(0, 0, 1024, 440);
  g.strokeStyle = "rgba(212,175,55,0.8)";
  g.lineWidth = 6;
  g.strokeRect(18, 18, 988, 404);
  g.fillStyle = "#d4af37";
  g.font = "700 74px Georgia, 'Times New Roman', serif";
  g.textAlign = "center";
  g.fillText("THE KING'S HALL", 512, 205);
  g.fillStyle = "rgba(232,200,106,0.75)";
  g.font = "600 30px Georgia, serif";
  g.fillText("B O W   D O W N   V I S U A L S", 512, 268);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial glow — candle flames, light halos, dust motes, haze. */
function glowTexture(stops: Array<[number, string]>): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

let flameTex: THREE.CanvasTexture | null = null;
function flameTexture(): THREE.CanvasTexture {
  if (!flameTex) {
    flameTex = glowTexture([
      [0, "rgba(255,246,214,1)"],
      [0.25, "rgba(255,196,92,0.85)"],
      [0.6, "rgba(255,122,38,0.32)"],
      [1, "rgba(255,110,20,0)"],
    ]);
  }
  return flameTex;
}

let hazeTex: THREE.CanvasTexture | null = null;
function hazeTexture(): THREE.CanvasTexture {
  if (!hazeTex) {
    hazeTex = glowTexture([
      [0, "rgba(216,200,168,0.55)"],
      [0.55, "rgba(200,182,150,0.22)"],
      [1, "rgba(190,170,140,0)"],
    ]);
  }
  return hazeTex;
}

function nameSpriteTexture(peer: WorldPeer): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 144;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.font = "700 54px system-ui, sans-serif";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  const name = peer.displayName.slice(0, 24);
  g.strokeText(name, 256, 58);
  g.fillStyle = "#ffffff";
  g.fillText(name, 256, 58);
  g.font = "600 34px system-ui, sans-serif";
  const sub = peer.guest ? "guest" : peer.profileSlug ? `@${peer.profileSlug}` : "";
  g.lineWidth = 7;
  g.strokeText(sub, 256, 112);
  g.fillStyle = peer.guest ? "#b8b0a0" : "#e8c86a";
  g.fillText(sub, 256, 112);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── Avatar ─────────────────────────────────────────────────────────── */

interface AvatarRig {
  group: THREE.Group;
  target: { x: number; z: number; rotY: number };
}

function buildAvatar(peer: WorldPeer): AvatarRig {
  const group = new THREE.Group();
  const tint = new THREE.Color(peer.tint);
  const bodyMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.55), roughness: 0.6, metalness: 0.2 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.78, 4, 12), bodyMat);
  body.position.y = 0.98;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 18, 14), darkMat);
  head.position.y = 1.83;
  group.add(head);

  // Gold visor — the face cue (front = -Z at rotY 0).
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.055, 0.05),
    new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD_DEEP, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.8 }),
  );
  visor.position.set(0, 1.86, -0.19);
  group.add(visor);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.02, 8, 40),
    new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD_DEEP, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.8 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: nameSpriteTexture(peer), transparent: true, depthWrite: false }),
  );
  sprite.scale.set(2.3, 0.65, 1);
  sprite.position.y = 2.3;
  group.add(sprite);

  group.position.set(peer.x, 0, peer.z);
  group.rotation.y = peer.rotY;
  return { group, target: { x: peer.x, z: peer.z, rotY: peer.rotY } };
}

/* ── Per-look materials + animation registry ────────────────────────── */

interface LookMaterials {
  gold: THREE.MeshStandardMaterial;
  goldDark: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
  marbleWall: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
}

interface LookAnim {
  flames: Array<{ sprite: THREE.Sprite; baseX: number; baseY: number; phase: number }>;
  flickerLights: Array<{ light: THREE.PointLight; base: number; phase: number }>;
  dust: THREE.Points | null;
  smokes: Array<{ mesh: THREE.Mesh; baseX: number; phase: number; speed: number }>;
}

const EMPTY_ANIM: LookAnim = { flames: [], flickerLights: [], dust: null, smokes: [] };

/* ── The scene ──────────────────────────────────────────────────────── */

export class KingsHallScene {
  onPose: ((x: number, z: number, rotY: number) => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();
  private clock = new THREE.Clock();
  private avatars = new Map<string, AvatarRig>();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private lookDrag: { id: number; lastX: number; lastY: number } | null = null;
  private stick: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private lastPose = { x: Number.NaN, z: Number.NaN, rotY: Number.NaN };
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private screenMaterial: THREE.MeshBasicMaterial;
  private hls: { destroy(): void } | null = null;
  private screenKey = "";
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private boundHandlers: Array<[string, EventListener, unknown]> = [];

  private quality: QualityTier;
  private theme: HallTheme;
  private lookGroup: THREE.Group | null = null;
  private lookAnim: LookAnim = EMPTY_ANIM;
  private floorReflector: Reflector | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(private canvas: HTMLCanvasElement, theme: HallTheme = "dark") {
    this.quality = detectQuality();
    const q = QUALITY[this.quality];
    this.theme = theme;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;
    try {
      this.renderer.xr.setReferenceSpaceType("local");
    } catch {
      /* default reference space is fine */
    }

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 120);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.camera.rotation.order = "YXZ";
    this.rig.add(this.camera);
    this.rig.position.set(0, 0, 9.5);
    this.scene.add(this.rig);

    this.screenMaterial = new THREE.MeshBasicMaterial({ map: screenIdleTexture() });
    this.applyLook(theme);
    this.bindControls();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.resizeObs.observe(canvas.parentElement);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /* ── Theme ── */

  /** Re-skin the hall for the visitor's site theme. No-op if already
   *  wearing it. Presence, the screen and the controls are untouched —
   *  only the look group is rebuilt. */
  setTheme(theme: HallTheme): void {
    if (theme === this.theme || this.disposed) return;
    this.theme = theme;
    this.applyLook(theme);
  }

  get currentTheme(): HallTheme {
    return this.theme;
  }

  private applyLook(theme: HallTheme): void {
    const look = hallLookFor(theme);

    // Tear down the previous look — never the shared texture cache,
    // never the screen material (the reel keeps playing across a
    // re-skin), and avatars are not part of the look group.
    if (this.lookGroup) {
      this.scene.remove(this.lookGroup);
      this.disposeLookGroup(this.lookGroup);
      this.lookGroup = null;
      this.floorReflector = null;
    }
    if (this.envTarget) {
      this.envTarget.dispose();
      this.envTarget = null;
    }
    this.lookAnim = EMPTY_ANIM;

    this.renderer.toneMappingExposure = look.exposure;
    this.scene.background = new THREE.Color(look.background);
    this.scene.fog = new THREE.Fog(look.fogColor, look.fogNear, look.fogFar);
    this.envTarget = this.buildEnvironment(look);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = look.environmentIntensity;

    const group = new THREE.Group();
    this.buildLook(group, look);
    this.scene.add(group);
    this.lookGroup = group;
  }

  private disposeLookGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of mats) {
        if (m !== this.screenMaterial) m.dispose();
      }
    });
    if (this.floorReflector) this.floorReflector.getRenderTarget().dispose();
  }

  /** Themed reflections, baked from a thumbnail stand-in room: the
   *  palace gets a blazing window wall to mirror in its gold; the
   *  throne room gets near-black with a few warm candle glows. */
  private buildEnvironment(look: HallLook): THREE.WebGLRenderTarget {
    const env = new THREE.Scene();
    const roomMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), roomMat);
    if (look.theme === "light") {
      roomMat.color.setRGB(0.5, 0.46, 0.38);
      const windowWall = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(6.5, 5.9, 4.4) }),
      );
      windowWall.position.set(-11.8, 1, 0);
      windowWall.rotation.y = Math.PI / 2;
      env.add(windowWall);
      const floorGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.72, 0.5) }),
      );
      floorGlow.rotation.x = -Math.PI / 2;
      floorGlow.position.y = -6.8;
      env.add(floorGlow);
      const screenGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.5, 0.75) }),
      );
      screenGlow.position.set(0, 0.5, -11.8);
      env.add(screenGlow);
    } else {
      roomMat.color.setRGB(0.012, 0.011, 0.013);
      for (let i = 0; i < 7; i++) {
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(0.7, 1.1),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 1.8, 0.5) }),
        );
        const side = i % 2 === 0 ? -11.8 : 11.8;
        glow.position.set(side, -2.5 + (i % 3), -8 + i * 2.6);
        glow.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        env.add(glow);
      }
      const screenGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.13, 0.22) }),
      );
      screenGlow.position.set(0, 0.5, -11.8);
      env.add(screenGlow);
    }
    env.add(room);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(env, 0.05);
    pmrem.dispose();
    return target;
  }

  /* ── Look construction ── */

  private makeMaterials(look: HallLook): LookMaterials {
    const marbleMap = hallTexture(look.marbleTextureUrl, 2, 2);
    const gold = new THREE.MeshStandardMaterial({
      color: 0xd9b45c, metalness: 1, roughness: look.theme === "light" ? 0.21 : 0.3, envMapIntensity: 1.35,
    });
    const goldDark = new THREE.MeshStandardMaterial({
      color: 0x9a7a24, metalness: 1, roughness: 0.45, envMapIntensity: 0.9,
      emissive: GOLD_DEEP, emissiveIntensity: look.theme === "dark" ? 0.18 : 0.05,
    });
    const marble = new THREE.MeshStandardMaterial({
      map: marbleMap, bumpMap: marbleMap, bumpScale: 0.12, roughness: 0.42, metalness: 0.06, envMapIntensity: 0.7,
    });
    const marbleWall = new THREE.MeshStandardMaterial({
      map: hallTexture(look.marbleTextureUrl, 5, 1.4), roughness: 0.58, metalness: 0.05, envMapIntensity: 0.55,
    });
    const ceiling = new THREE.MeshStandardMaterial({
      map: hallTexture(look.marbleTextureUrl, 6, 6),
      color: look.theme === "light" ? 0xe9dfc8 : 0x59503f, roughness: 0.72, metalness: 0.05,
    });
    const fabric = new THREE.MeshStandardMaterial({
      map: hallTexture(look.throneFabricTextureUrl, 1.5, 1.5),
      roughness: look.theme === "light" ? 0.62 : 0.92, metalness: 0, envMapIntensity: 0.5,
    });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.55, metalness: 0.5 });
    return { gold, goldDark, marble, marbleWall, ceiling, fabric, darkMetal };
  }

  private buildLook(group: THREE.Group, look: HallLook): void {
    const mats = this.makeMaterials(look);
    const anim: LookAnim = { flames: [], flickerLights: [], dust: null, smokes: [] };
    this.buildFloor(group, look, mats);
    this.buildWalls(group, look, mats, anim);
    this.buildCeiling(group, look, mats);
    this.buildColumns(group, look, mats);
    this.buildStage(group, look, mats);
    this.buildScreen(group, mats);
    this.buildSpeakersAndMic(group, mats);
    this.buildLights(group, look);
    if (look.chandeliers) this.buildChandeliers(group, mats);
    if (look.candles) this.buildBraziers(group, mats, anim);
    if (look.lightBeams) this.buildBeams(group);
    if (look.dust) anim.dust = this.buildDust(group);
    if (look.haze) this.buildHaze(group, anim);
    this.lookAnim = anim;
  }

  /** The mirror floor: a true planar reflection under a polished
   *  marble overlay (front-side only, so the reflection pass never
   *  sees it) with the v1 hall's gold inlay kept as geometry. Low
   *  tiers skip the mirror and lean on environment reflections. */
  private buildFloor(group: THREE.Group, look: HallLook, mats: LookMaterials): void {
    const q = QUALITY[this.quality];
    if (q.reflectorSize > 0) {
      const reflector = new Reflector(new THREE.PlaneGeometry(28, 30), {
        clipBias: 0.003,
        textureWidth: q.reflectorSize,
        textureHeight: q.reflectorSize,
        color: look.floorReflectionTint,
      });
      reflector.rotation.x = -Math.PI / 2;
      reflector.position.set(0, 0, -3);
      group.add(reflector);
      this.floorReflector = reflector;
    }
    const floorMap = hallTexture(look.marbleTextureUrl, look.floorRepeat, look.floorRepeat * (30 / 28));
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 30),
      new THREE.MeshPhysicalMaterial({
        map: floorMap, bumpMap: floorMap, bumpScale: 0.08,
        transparent: true, opacity: q.reflectorSize > 0 ? look.floorOverlayOpacity : 0.97,
        roughness: look.floorRoughness, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3,
        envMapIntensity: 0.85, depthWrite: false,
      }),
    );
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(0, 0.01, -3);
    overlay.renderOrder = 2;
    overlay.receiveShadow = q.shadows;
    group.add(overlay);

    // Gold inlay: double border + centre medallion, as the v1 hall had.
    const strip = (w: number, d: number, x: number, z: number) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), mats.goldDark);
      s.position.set(x, 0.018, z);
      group.add(s);
    };
    const border = (inset: number, w: number) => {
      const x = 14 - inset;
      const zTop = -18 + inset;
      const zBot = 12 - inset;
      strip(2 * x, w, 0, zTop);
      strip(2 * x, w, 0, zBot);
      strip(w, zBot - zTop, -x, (zTop + zBot) / 2);
      strip(w, zBot - zTop, x, (zTop + zBot) / 2);
    };
    border(1.1, 0.07);
    border(1.45, 0.03);
    for (const r of [[1.85, 2.0], [1.5, 1.58]] as Array<[number, number]>) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r[0], r[1], 56), mats.goldDark);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.016, -3);
      ring.renderOrder = 3;
      group.add(ring);
    }
  }

  private buildWalls(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const mkWall = (w: number, x: number, z: number, rotY: number) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 6.5, 0.4), mats.marbleWall);
      wall.position.set(x, 3.25, z);
      wall.rotation.y = rotY;
      group.add(wall);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, 0.06), mats.gold);
      trim.position.set(x, 5.7, z);
      trim.rotation.y = rotY;
      trim.translateZ(0.24);
      group.add(trim);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.05), mats.goldDark);
      base.position.set(x, 0.16, z);
      base.rotation.y = rotY;
      base.translateZ(0.23);
      group.add(base);
    };
    mkWall(28.8, 0, -18.2, 0);
    mkWall(28.8, 0, 12.2, 0);
    mkWall(30.8, -14.2, -3, Math.PI / 2);
    mkWall(30.8, 14.2, -3, Math.PI / 2);

    if (look.windows) {
      for (const z of [-9, -2, 5]) this.buildWindow(group, mats, z);
      for (const z of [-9, -2, 5]) this.buildPanelFrame(group, mats, 1, z);
    } else {
      for (const side of [-1, 1] as const) {
        for (const z of [-9, -2, 5]) this.buildPanelFrame(group, mats, side, z);
        for (const z of [-5.5, 2.5]) this.buildSconce(group, mats, anim, side, z, side * 13.3);
      }
      for (const x of [-6, 6]) this.buildSconce(group, mats, anim, 0, x, null);
    }
  }

  /** A tall arched window pouring daylight in (Look A, left wall).
   *  Built facing +Z in a subgroup, then turned into the room. */
  private buildWindow(group: THREE.Group, mats: LookMaterials, z: number): void {
    const win = new THREE.Group();
    win.position.set(-13.96, 0, z);
    win.rotation.y = Math.PI / 2;
    const paneMat = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.0), paneMat);
    pane.position.set(0, 3.0, 0.01);
    win.add(pane);
    const arch = new THREE.Mesh(new THREE.CircleGeometry(1.15, 28, 0, Math.PI), paneMat);
    arch.position.set(0, 5.0, 0.01);
    win.add(arch);
    const bar = (w: number, h: number, x: number, y: number, d = 0.07) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.gold);
      b.position.set(x, y, 0.05);
      win.add(b);
    };
    bar(0.12, 4.0, -1.21, 3.0);
    bar(0.12, 4.0, 1.21, 3.0);
    bar(2.54, 0.12, 0, 0.97);
    bar(0.05, 4.0, 0, 3.0, 0.04);
    bar(2.3, 0.05, 0, 2.3, 0.04);
    bar(2.3, 0.05, 0, 3.7, 0.04);
    const archTrim = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.06, 8, 28, Math.PI), mats.gold);
    archTrim.position.set(0, 5.0, 0.05);
    win.add(archTrim);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.1, 0.2), mats.marble);
    sill.position.set(0, 0.9, 0.06);
    win.add(sill);
    group.add(win);
  }

  /** A gilt panel frame dressing a side wall. side: -1 left, +1 right. */
  private buildPanelFrame(group: THREE.Group, mats: LookMaterials, side: -1 | 1, z: number): void {
    const frame = new THREE.Group();
    frame.position.set(side * 13.96, 0, z);
    frame.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const bar = (w: number, h: number, x: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), mats.goldDark);
      b.position.set(x, y, 0.03);
      frame.add(b);
    };
    bar(3.2, 0.07, 0, 5.15);
    bar(3.2, 0.07, 0, 1.05);
    bar(0.07, 4.17, -1.6, 3.1);
    bar(0.07, 4.17, 1.6, 3.1);
    group.add(frame);
  }

  /** A three-candle wall sconce (Look B). When `lightX` is a number the
   *  sconce also gets a real flickering point light at that world X
   *  (side walls); back-wall sconces (side 0) stay emissive-only. */
  private buildSconce(
    group: THREE.Group, mats: LookMaterials, anim: LookAnim,
    side: -1 | 0 | 1, along: number, lightX: number | null,
  ): void {
    const sconce = new THREE.Group();
    if (side === 0) {
      sconce.position.set(along, 0, 11.96);
      sconce.rotation.y = Math.PI;
    } else {
      sconce.position.set(side * 13.96, 0, along);
      sconce.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.52, 0.06), mats.goldDark);
    plate.position.set(0, 3.1, 0.04);
    sconce.add(plate);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.26), mats.goldDark);
    arm.position.set(0, 3.3, 0.14);
    sconce.add(arm);
    const candleMat = new THREE.MeshStandardMaterial({ color: 0xf3e5c0, roughness: 0.6 });
    for (const dx of [-0.09, 0, 0.09]) {
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), candleMat);
      candle.position.set(dx, 3.44, 0.26);
      sconce.add(candle);
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      flame.scale.set(0.085, 0.17, 1);
      flame.position.set(dx, 3.62, 0.26);
      sconce.add(flame);
      anim.flames.push({ sprite: flame, baseX: 0.085, baseY: 0.17, phase: Math.random() * 20 });
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTexture(), transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.set(0.6, 0.6, 1);
    glow.position.set(0, 3.6, 0.26);
    sconce.add(glow);
    group.add(sconce);

    if (lightX !== null && QUALITY[this.quality].candleLights) {
      const light = new THREE.PointLight(0xffa245, 15, 11, 1.9);
      light.position.set(lightX, 3.4, along);
      group.add(light);
      anim.flickerLights.push({ light, base: 15, phase: Math.random() * 20 });
    }
  }

  private buildCeiling(group: THREE.Group, look: HallLook, mats: LookMaterials): void {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(28, 30), mats.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 6.5, -3);
    group.add(ceiling);
    // Gilt coffer grid under the ceiling slab.
    for (const z of [-15, -10, -5, 0, 5, 10]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(28, 0.07, 0.16), mats.goldDark);
      beam.position.set(0, 6.44, z);
      group.add(beam);
    }
    for (const x of [-10, -5, 0, 5, 10]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 30), mats.goldDark);
      beam.position.set(x, 6.44, -3);
      group.add(beam);
    }
    void look;
  }

  private buildColumns(group: THREE.Group, look: HallLook, mats: LookMaterials): void {
    const shadows = QUALITY[this.quality].shadows;
    for (const x of [-12.4, 12.4]) {
      for (const z of [-8, 0, 8]) {
        const col = new THREE.Group();
        col.position.set(x, 0, z);
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 1.5), mats.marble);
        plinth.position.y = 0.14;
        col.add(plinth);
        if (look.columnStyle === "gold-round") {
          const foot = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.18, 1.15), mats.gold);
          foot.position.y = 0.37;
          col.add(foot);
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 5.2, 20), mats.gold);
          shaft.position.y = 3.06;
          shaft.castShadow = shadows;
          col.add(shaft);
          const neck = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 24), mats.gold);
          neck.rotation.x = Math.PI / 2;
          neck.position.y = 5.6;
          col.add(neck);
          const cap = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 1.2), mats.gold);
          cap.position.y = 5.77;
          cap.castShadow = shadows;
          col.add(cap);
          const abacus = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.18, 1.38), mats.gold);
          abacus.position.y = 5.97;
          col.add(abacus);
        } else {
          const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.98, 5.2, 0.98), mats.marble);
          shaft.position.y = 3.06;
          shaft.castShadow = shadows;
          col.add(shaft);
          for (const y of [0.62, 5.5]) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(1.07, 0.09, 1.07), mats.goldDark);
            band.position.y = y;
            col.add(band);
          }
          const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.24, 1.3), mats.gold);
          cap.position.y = 5.78;
          cap.castShadow = shadows;
          col.add(cap);
          const abacus = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.16, 1.44), mats.goldDark);
          abacus.position.y = 5.98;
          col.add(abacus);
        }
        group.add(col);
      }
    }
  }

  private buildStage(group: THREE.Group, look: HallLook, mats: LookMaterials): void {
    const shadows = QUALITY[this.quality].shadows;
    const stage = new THREE.Mesh(new THREE.BoxGeometry(22, 0.7, 5.8), mats.marble);
    stage.position.set(0, 0.35, -15.1);
    stage.receiveShadow = shadows;
    group.add(stage);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(22, 0.07, 0.07), mats.gold);
    lip.position.set(0, 0.71, -12.22);
    group.add(lip);

    // The dais the throne sits on — wide and pale for the palace,
    // a narrower two-tier climb for the throne room.
    let throneBaseY = 0.7;
    if (look.theme === "light") {
      const dais = new THREE.Mesh(new THREE.BoxGeometry(12, 0.26, 4.4), mats.marble);
      dais.position.set(0, 0.83, -15.7);
      dais.receiveShadow = shadows;
      group.add(dais);
      throneBaseY = 0.96;
    } else {
      const tier1 = new THREE.Mesh(new THREE.BoxGeometry(9, 0.15, 4.6), mats.marble);
      tier1.position.set(0, 0.775, -15.7);
      group.add(tier1);
      const tier2 = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.28, 4.2), mats.marble);
      tier2.position.set(0, 0.99, -15.7);
      tier2.receiveShadow = shadows;
      group.add(tier2);
      throneBaseY = 1.13;
    }
    this.buildThrone(group, mats, throneBaseY);
  }

  /** The throne, centred on the dais under the big screen (both
   *  reference looks put it there): gilt frame, the look's fabric. */
  private buildThrone(group: THREE.Group, mats: LookMaterials, baseY: number): void {
    const shadows = QUALITY[this.quality].shadows;
    const throne = new THREE.Group();
    const z = -15.9;
    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 1.15), mats.gold);
    seatBase.position.set(0, baseY + 0.15, z);
    seatBase.castShadow = shadows;
    throne.add(seatBase);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 1.0), mats.fabric);
    cushion.position.set(0, baseY + 0.38, z);
    throne.add(cushion);
    for (const sx of [-0.7, 0.7]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mats.gold);
      foot.position.set(sx, baseY + 0.05, z + 0.5);
      throne.add(foot);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 10), mats.gold);
      post.position.set(sx + 0.02, baseY + 1.55, z - 0.48);
      post.castShadow = shadows;
      throne.add(post);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mats.gold);
      finial.position.set(sx + 0.02, baseY + 2.86, z - 0.48);
      throne.add(finial);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.95), mats.gold);
      arm.position.set(sx + 0.06, baseY + 0.95, z - 0.02);
      throne.add(arm);
      const support = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), mats.gold);
      support.position.set(sx + 0.06, baseY + 0.68, z + 0.32);
      throne.add(support);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.56, 2.3, 0.16), mats.gold);
    back.position.set(0, baseY + 1.5, z - 0.52);
    back.castShadow = shadows;
    throne.add(back);
    const inset = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.95, 0.06), mats.fabric);
    inset.position.set(0, baseY + 1.5, z - 0.42);
    throne.add(inset);
    // Crown crest over the back.
    const crest = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.23, 0.2, 10), mats.gold);
    crest.position.set(0, baseY + 2.78, z - 0.52);
    throne.add(crest);
    for (const dx of [-0.14, 0, 0.14]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.24, 8), mats.gold);
      spike.position.set(dx, baseY + 2.98, z - 0.52);
      throne.add(spike);
    }
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), mats.gold);
    jewel.position.set(0, baseY + 2.62, z - 0.4);
    throne.add(jewel);
    group.add(throne);
  }

  /** The big screen + its gold frame — centre of the front wall in
   *  both looks, playing whatever setScreenSource handed it. */
  private buildScreen(group: THREE.Group, mats: LookMaterials): void {
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(HALL_SCREEN.width, HALL_SCREEN.height),
      this.screenMaterial,
    );
    screen.position.set(HALL_SCREEN.centerX, HALL_SCREEN.centerY, HALL_SCREEN.z);
    group.add(screen);
    const mkBar = (w: number, h: number, x: number, y: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), mats.gold);
      bar.position.set(x, y, HALL_SCREEN.z + 0.02);
      group.add(bar);
    };
    mkBar(13.9, 0.22, 0, 6.46);
    mkBar(13.9, 0.22, 0, 0.64);
    mkBar(0.22, 6.04, -6.84, 3.55);
    mkBar(0.22, 6.04, 6.84, 3.55);
  }

  private buildSpeakersAndMic(group: THREE.Group, mats: LookMaterials): void {
    // Speaker stacks flanking the stage (the house set's voice).
    for (const x of [-9.8, 9.8]) {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.7, 1.2), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.7 }));
      stack.position.set(x, 0.7 + 1.35, -14.6);
      group.add(stack);
      for (const [r, y] of [[0.52, 2.6], [0.34, 1.35]] as Array<[number, number]>) {
        const cone = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 0.5 }));
        cone.position.set(x, 0.7 + y, -13.98);
        group.add(cone);
        const ringM = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 8, 32), mats.gold);
        ringM.position.set(x, 0.7 + y, -13.97);
        group.add(ringM);
      }
    }
    // Hanging mic over the stage lip — center front, house signature.
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.7, 6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    cable.position.set(0, 5.6, -13.2);
    group.add(cable);
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.34, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 }));
    mic.position.set(0, 4.6, -13.2);
    mic.rotation.z = 0.35;
    group.add(mic);
    const micBand = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.014, 8, 20), mats.gold);
    micBand.position.set(0.06, 4.68, -13.2);
    micBand.rotation.z = 0.35;
    group.add(micBand);
  }

  private buildLights(group: THREE.Group, look: HallLook): void {
    group.add(new THREE.AmbientLight(look.ambient.color, look.ambient.intensity));
    group.add(new THREE.HemisphereLight(look.hemisphere.sky, look.hemisphere.ground, look.hemisphere.intensity));
    for (const x of [-6, 0, 6]) {
      const spot = new THREE.SpotLight(look.stageSpot.color, look.stageSpot.intensity, 30, 0.55, 0.65, 1.6);
      spot.position.set(x, 6.3, -10.5);
      spot.target.position.set(x * 0.6, 0.7, -15.5);
      group.add(spot);
      group.add(spot.target);
    }
    const house = new THREE.PointLight(look.houseLight.color, look.houseLight.intensity, 26, 1.8);
    house.position.set(0, 5.6, 2);
    group.add(house);

    if (look.sun.present) {
      const sun = new THREE.DirectionalLight(look.sun.color, look.sun.intensity);
      sun.position.set(-13.5, 10.5, -1);
      sun.target.position.set(7, 0, -5);
      if (QUALITY[this.quality].shadows) {
        sun.castShadow = true;
        sun.shadow.mapSize.set(this.quality === "high" ? 2048 : 1024, this.quality === "high" ? 2048 : 1024);
        sun.shadow.camera.left = -20;
        sun.shadow.camera.right = 20;
        sun.shadow.camera.top = 20;
        sun.shadow.camera.bottom = -20;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 45;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.03;
      }
      group.add(sun);
      group.add(sun.target);
    }
  }

  private buildChandeliers(group: THREE.Group, mats: LookMaterials): void {
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0x1a1206, emissive: 0xffc978, emissiveIntensity: 2.4, roughness: 0.4,
    });
    const candleMat = new THREE.MeshStandardMaterial({ color: 0xf3e5c0, roughness: 0.6 });
    for (const z of [-5, 4]) {
      const ch = new THREE.Group();
      ch.position.set(0, 0, z);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.5, 6), mats.darkMetal);
      chain.position.y = 5.75;
      ch.add(chain);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 10, 44), mats.gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 4.95;
      ch.add(ring);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 10, 36), mats.gold);
      ring2.rotation.x = Math.PI / 2;
      ring2.position.y = 5.22;
      ch.add(ring2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 6), candleMat);
        stick.position.set(Math.cos(a) * 1.05, 5.04, Math.sin(a) * 1.05);
        ch.add(stick);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), bulbMat);
        bulb.position.set(Math.cos(a) * 1.05, 5.16, Math.sin(a) * 1.05);
        ch.add(bulb);
      }
      group.add(ch);
    }
    const glow = new THREE.PointLight(0xffd9a0, 34, 22, 1.8);
    glow.position.set(0, 4.7, -0.5);
    group.add(glow);
  }

  /** Fire braziers flanking the dais (Look B) — bronze bowls, live
   *  flame sprites, and a real flickering light on stronger tiers. */
  private buildBraziers(group: THREE.Group, mats: LookMaterials, anim: LookAnim): void {
    const bronze = new THREE.MeshStandardMaterial({ color: 0x4a3418, metalness: 0.85, roughness: 0.4 });
    for (const x of [-3.6, 3.6]) {
      const brazier = new THREE.Group();
      brazier.position.set(x, 0, -11.3);
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.5, 10), mats.darkMetal);
      pedestal.position.y = 0.25;
      brazier.add(pedestal);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.18, 0.3, 18), bronze);
      bowl.position.y = 0.65;
      brazier.add(bowl);
      const coals = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), new THREE.MeshBasicMaterial({ color: 0xff7a26 }));
      coals.rotation.x = -Math.PI / 2;
      coals.position.y = 0.79;
      brazier.add(coals);
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      flame.scale.set(0.6, 0.95, 1);
      flame.position.y = 1.18;
      brazier.add(flame);
      anim.flames.push({ sprite: flame, baseX: 0.6, baseY: 0.95, phase: Math.random() * 20 });
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTexture(), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.set(1.7, 1.7, 1);
      glow.position.y = 1.15;
      brazier.add(glow);
      group.add(brazier);
      if (QUALITY[this.quality].candleLights) {
        const light = new THREE.PointLight(0xff9040, 26, 13, 1.9);
        light.position.set(x, 1.35, -11.3);
        group.add(light);
        anim.flickerLights.push({ light, base: 26, phase: Math.random() * 20 });
      }
    }
  }

  /** Fake god-rays slanting from the window wall (Look A), with a
   *  warm pool where each beam lands. */
  private buildBeams(group: THREE.Group): void {
    const dir = new THREE.Vector3(0.94, -0.34, 0.02).normalize();
    const len = 13.5;
    for (const z of [-9, -2, 5]) {
      for (const [half, opacity] of [[2.0, 0.05], [1.1, 0.04]] as Array<[number, number]>) {
        const a = new THREE.Vector3(-13.9, 5.5, z - half);
        const b = new THREE.Vector3(-13.9, 5.5, z + half);
        const c = b.clone().addScaledVector(dir, len);
        const d = a.clone().addScaledVector(dir, len);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute([
          a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z,
        ], 3));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xffdf9e, transparent: true, opacity, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, fog: false,
        }));
        beam.renderOrder = 4;
        group.add(beam);
      }
      const pool = new THREE.Mesh(new THREE.CircleGeometry(2.7, 26), new THREE.MeshBasicMaterial({
        color: 0xffdf9e, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(-1.2, 0.022, z);
      pool.renderOrder = 3;
      group.add(pool);
    }
  }

  /** Dust motes hanging in the sunbeams (Look A). */
  private buildDust(group: THREE.Group): THREE.Points {
    const count = 340;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = -13.5 + Math.random() * 15.5;
      positions[i * 3 + 1] = 0.3 + Math.random() * 5.3;
      positions[i * 3 + 2] = -11.5 + Math.random() * 19;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({
      map: hazeTexture(), size: 0.055, transparent: true, opacity: 0.5, color: 0xffe9bb,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    dust.renderOrder = 5;
    group.add(dust);
    return dust;
  }

  /** Slow haze sheets drifting over the midnight floor (Look B). */
  private buildHaze(group: THREE.Group, anim: LookAnim): void {
    const specs: Array<[number, number, number]> = [
      [0, 2.3, -8], [-5.5, 2.7, -1], [5.5, 2.1, 3.5], [0, 2.9, -13.5],
    ];
    specs.forEach(([x, y, z], i) => {
      const sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 4.2),
        new THREE.MeshBasicMaterial({
          map: hazeTexture(), transparent: true, opacity: 0.15, depthWrite: false,
          fog: false, color: 0xa89372, side: THREE.DoubleSide,
        }),
      );
      sheet.position.set(x, y, z);
      sheet.rotation.y = i * 0.7;
      sheet.renderOrder = 4;
      group.add(sheet);
      anim.smokes.push({ mesh: sheet, baseX: x, phase: i * 1.7, speed: 0.5 + (i % 3) * 0.3 });
    });
  }

  /* ── Screen ── */
  async setScreenSource(source: HallScreenSource): Promise<void> {
    const key = `${source.mode}:${source.hlsUrl ?? source.videoUrl ?? ""}`;
    if (key === this.screenKey) return;
    this.screenKey = key;

    this.hls?.destroy();
    this.hls = null;
    if (!this.video) {
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.loop = true;
      this.video.playsInline = true;
      this.video.crossOrigin = "anonymous";
    }
    const video = this.video;
    video.loop = source.mode === "featured";

    if (source.mode === "live" && source.hlsUrl) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source.hlsUrl;
      } else {
        const { default: Hls } = await import("hls.js");
        if (this.disposed) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ maxBufferLength: 12 });
          hls.loadSource(source.hlsUrl);
          hls.attachMedia(video);
          this.hls = hls;
        } else {
          video.src = source.hlsUrl;
        }
      }
    } else if (source.videoUrl) {
      video.src = source.videoUrl;
    } else {
      return;
    }

    if (!this.videoTexture) {
      this.videoTexture = new THREE.VideoTexture(video);
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
      this.screenMaterial.map = this.videoTexture;
      this.screenMaterial.needsUpdate = true;
    }
    void video.play().catch(() => undefined);
  }

  /* ── Peers ── */
  upsertPeer(peer: WorldPeer): void {
    const existing = this.avatars.get(peer.peerId);
    if (existing) {
      existing.target = { x: peer.x, z: peer.z, rotY: peer.rotY };
      return;
    }
    const rig = buildAvatar(peer);
    this.avatars.set(peer.peerId, rig);
    this.scene.add(rig.group);
  }

  setPeerTarget(peerId: string, x: number, z: number, rotY: number): void {
    const rig = this.avatars.get(peerId);
    if (rig) rig.target = { x, z, rotY };
  }

  removePeer(peerId: string): void {
    const rig = this.avatars.get(peerId);
    if (!rig) return;
    this.avatars.delete(peerId);
    this.scene.remove(rig.group);
    rig.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
      const sprite = obj as THREE.Sprite;
      if (sprite.material) (sprite.material as THREE.SpriteMaterial).map?.dispose();
    });
  }

  setSpawn(x: number, z: number): void {
    this.rig.position.set(clamp(x, BOUNDS.minX, BOUNDS.maxX), 0, clamp(z, BOUNDS.minZ, BOUNDS.maxZ));
  }

  localPose(): { x: number; z: number; rotY: number } {
    return { x: this.rig.position.x, z: this.rig.position.z, rotY: this.yaw };
  }

  /* ── VR ── */
  async isVrSupported(): Promise<boolean> {
    try {
      const xr = (navigator as unknown as { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
      if (!xr) return false;
      return await xr.isSessionSupported("immersive-vr");
    } catch {
      return false;
    }
  }

  async enterVr(): Promise<boolean> {
    try {
      const xr = (navigator as unknown as { xr?: { requestSession(mode: string, opts?: unknown): Promise<unknown> } }).xr;
      if (!xr) return false;
      const session = await xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
      await this.renderer.xr.setSession(session as never);
      return true;
    } catch {
      return false;
    }
  }

  get isPresenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  /* ── Controls ── */
  private on<K extends keyof WindowEventMap>(target: Window | HTMLElement, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.boundHandlers.push([type, fn, target]);
  }

  private bindControls(): void {
    const canvas = this.canvas;
    this.on(window, "keydown", ((e: KeyboardEvent) => {
      this.keys.add(e.code);
    }) as EventListener);
    this.on(window, "keyup", ((e: KeyboardEvent) => {
      this.keys.delete(e.code);
    }) as EventListener);
    this.on(window, "blur", (() => this.keys.clear()) as EventListener);

    canvas.addEventListener("pointerdown", (e) => {
      const rect = canvas.getBoundingClientRect();
      if (e.pointerType === "touch" && e.clientX - rect.left < rect.width * 0.45 && !this.stick) {
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      } else if (!this.lookDrag) {
        this.lookDrag = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
        if (e.pointerType === "mouse") {
          canvas.requestPointerLock?.();
        }
      }
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        const max = 52;
        this.stick.dx = clamp((e.clientX - this.stick.ox) / max, -1, 1);
        this.stick.dy = clamp((e.clientY - this.stick.oy) / max, -1, 1);
        return;
      }
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        this.yaw -= e.movementX * 0.0021;
        this.pitch = clamp(this.pitch - e.movementY * 0.0021, -1.15, 1.15);
        return;
      }
      if (this.lookDrag && e.pointerId === this.lookDrag.id) {
        this.yaw -= (e.clientX - this.lookDrag.lastX) * 0.0042;
        this.pitch = clamp(this.pitch - (e.clientY - this.lookDrag.lastY) * 0.0042, -1.15, 1.15);
        this.lookDrag.lastX = e.clientX;
        this.lookDrag.lastY = e.clientY;
      }
    });
    const release = (e: PointerEvent) => {
      if (this.stick && e.pointerId === this.stick.id) this.stick = null;
      if (this.lookDrag && e.pointerId === this.lookDrag.id) this.lookDrag = null;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth || 1;
    const h = parent.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ── Frame ── */
  private tick(): void {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (this.renderer.xr.isPresenting) {
      this.tickXrMove(dt);
    } else {
      this.tickFlatMove(dt);
      this.rig.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    }
    // The planar mirror rests while presenting — Reflector and XR
    // don't mix; the polished overlay carries the floor in a headset.
    if (this.floorReflector) this.floorReflector.visible = !this.renderer.xr.isPresenting;

    // Remote avatars glide to their latest reported spots.
    const k = 1 - Math.exp(-9 * dt);
    for (const rig of this.avatars.values()) {
      rig.group.position.x += (rig.target.x - rig.group.position.x) * k;
      rig.group.position.z += (rig.target.z - rig.group.position.z) * k;
      rig.group.rotation.y = angleLerp(rig.group.rotation.y, rig.target.rotY, k);
    }

    // The look's living details: candle flames breathing, braziers
    // flickering, dust drifting in the sunbeams, haze rolling slow.
    const anim = this.lookAnim;
    for (const f of anim.flames) {
      const n = Math.sin(t * 11 + f.phase) * 0.5 + Math.sin(t * 23 + f.phase * 1.7) * 0.5;
      f.sprite.scale.set(f.baseX * (1 + n * 0.07), f.baseY * (1 + n * 0.14), 1);
    }
    for (const l of anim.flickerLights) {
      l.light.intensity = l.base * (1 + 0.13 * Math.sin(t * 9 + l.phase) + 0.06 * Math.sin(t * 27 + l.phase * 1.7));
    }
    if (anim.dust) {
      anim.dust.position.y = Math.sin(t * 0.12) * 0.12;
      anim.dust.rotation.y = t * 0.005;
    }
    for (const s of anim.smokes) {
      s.mesh.rotation.y += dt * 0.03 * s.speed;
      s.mesh.position.x = s.baseX + Math.sin(t * 0.05 + s.phase) * 0.7;
    }

    // Report my pose when it meaningfully changed (client throttles).
    const pose = this.localPose();
    if (
      Math.abs(pose.x - this.lastPose.x) > 0.03 ||
      Math.abs(pose.z - this.lastPose.z) > 0.03 ||
      Math.abs(pose.rotY - this.lastPose.rotY) > 0.03
    ) {
      this.lastPose = pose;
      this.onPose?.(pose.x, pose.z, pose.rotY);
    }

    this.renderer.render(this.scene, this.camera);
  }

  private moveRig(fwd: number, strafe: number, dt: number, speed: number, headingYaw: number): void {
    if (fwd === 0 && strafe === 0) return;
    const sin = Math.sin(headingYaw);
    const cos = Math.cos(headingYaw);
    // Camera forward on the floor plane is (-sin(yaw), -cos(yaw)).
    const dx = (-sin * fwd + cos * strafe) * speed * dt;
    const dz = (-cos * fwd - sin * strafe) * speed * dt;
    this.rig.position.x = clamp(this.rig.position.x + dx, BOUNDS.minX, BOUNDS.maxX);
    this.rig.position.z = clamp(this.rig.position.z + dz, BOUNDS.minZ, BOUNDS.maxZ);
  }

  private tickFlatMove(dt: number): void {
    let fwd = 0;
    let strafe = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fwd += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fwd -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
    if (this.stick) {
      strafe += this.stick.dx;
      fwd += -this.stick.dy;
    }
    const len = Math.hypot(fwd, strafe);
    if (len > 1) {
      fwd /= len;
      strafe /= len;
    }
    const run = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    this.moveRig(fwd, strafe, dt, run ? RUN_SPEED : WALK_SPEED, this.yaw);
  }

  private tickXrMove(dt: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    for (const source of session.inputSources) {
      const gp = source.gamepad;
      if (!gp || gp.axes.length < 4) continue;
      const ax = gp.axes[2] ?? 0;
      const ay = gp.axes[3] ?? 0;
      if (Math.abs(ax) < 0.12 && Math.abs(ay) < 0.12) continue;
      // Heading from the XR camera's world direction, flattened:
      // moveRig's forward is (-sin(yaw), -cos(yaw)), so the yaw that
      // matches a look vector (dx, dz) is atan2(-dx, -dz).
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const yawFromLook = Math.atan2(-dir.x, -dir.z);
      this.moveRig(-ay, ax, dt, WALK_SPEED, yawFromLook);
      return;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObs?.disconnect();
    for (const [type, fn, target] of this.boundHandlers) {
      (target as Window).removeEventListener(type, fn as EventListener);
    }
    this.boundHandlers = [];
    this.hls?.destroy();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
    }
    for (const peerId of [...this.avatars.keys()]) this.removePeer(peerId);
    if (this.lookGroup) {
      this.scene.remove(this.lookGroup);
      this.disposeLookGroup(this.lookGroup);
      this.lookGroup = null;
      this.floorReflector = null;
    }
    if (this.envTarget) {
      this.envTarget.dispose();
      this.envTarget = null;
    }
    for (const tex of textureCache.values()) tex.dispose();
    textureCache.clear();
    flameTex?.dispose();
    flameTex = null;
    hazeTex?.dispose();
    hazeTex = null;
    this.renderer.dispose();
  }
}
