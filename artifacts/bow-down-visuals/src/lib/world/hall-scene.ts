/**
 * hall-scene.ts — the King's Hall in Three.js: a golden black-marble
 * hall, a stage at the front, and a big screen over it that plays the
 * hall's featured reel — or a live stream's HLS when one is truly live
 * (the page decides from GET /api/world/screen; this file just plays
 * what it's handed).
 *
 * Built for phone-class hardware (headsets included): low-poly
 * primitives, no shadow maps, capped pixel ratio, a handful of lights,
 * canvas-baked floor/wall detail instead of shaders. Imported ONLY via
 * dynamic import from the /world page, so three.js ships in the world
 * chunk and nowhere else.
 *
 * Controls: WASD/arrows + drag-look (click for pointer-lock mouse
 * look) on desktop; left-thumb virtual stick + drag-look on touch;
 * WebXR immersive-vr with thumbstick walking when a headset offers it.
 * Heading convention (shared with the server): rotY 0 faces the
 * stage/screen (-Z). The local walker stays on the audience floor —
 * the stage is a stage.
 */
import * as THREE from "three";
import type { WorldPeer } from "./world-client";

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
const MARBLE = 0x14110c;
const MARBLE_LIGHT = 0x1d1913;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/* ── Baked canvas textures (cheap marble + the screen's idle card) ──── */

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0a09";
  g.fillRect(0, 0, 1024, 1024);
  // Tile seams.
  g.strokeStyle = "rgba(255,255,255,0.05)";
  g.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 128) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 1024);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(1024, i);
    g.stroke();
  }
  // Marble veins — soft, sparse, never repeating visibly.
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(205,195,175,${0.02 + Math.random() * 0.045})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    let x = Math.random() * 1024;
    let y = Math.random() * 1024;
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (Math.random() - 0.5) * 260;
      y += (Math.random() - 0.5) * 260;
      g.quadraticCurveTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60, x, y);
    }
    g.stroke();
  }
  // Gold inlay border + centre medallion.
  g.strokeStyle = "rgba(212,175,55,0.55)";
  g.lineWidth = 7;
  g.strokeRect(42, 42, 940, 940);
  g.strokeStyle = "rgba(212,175,55,0.35)";
  g.lineWidth = 2;
  g.strokeRect(62, 62, 900, 900);
  g.beginPath();
  g.arc(512, 512, 128, 0, Math.PI * 2);
  g.strokeStyle = "rgba(212,175,55,0.4)";
  g.lineWidth = 4;
  g.stroke();
  g.beginPath();
  g.arc(512, 512, 100, 0, Math.PI * 2);
  g.lineWidth = 2;
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
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

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.xr.enabled = true;
    try {
      this.renderer.xr.setReferenceSpaceType("local");
    } catch {
      /* default reference space is fine */
    }
    this.scene.background = new THREE.Color(0x030303);
    this.scene.fog = new THREE.Fog(0x030303, 20, 48);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 120);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.camera.rotation.order = "YXZ";
    this.rig.add(this.camera);
    this.rig.position.set(0, 0, 9.5);
    this.scene.add(this.rig);

    this.screenMaterial = new THREE.MeshBasicMaterial({ map: screenIdleTexture() });
    this.buildHall();
    this.bindControls();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.resizeObs.observe(canvas.parentElement);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /* ── Hall construction ── */
  private buildHall(): void {
    const goldMat = new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD_DEEP, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.8 });
    const marbleMat = new THREE.MeshStandardMaterial({ color: MARBLE, roughness: 0.85, metalness: 0.1 });
    const marbleLightMat = new THREE.MeshStandardMaterial({ color: MARBLE_LIGHT, roughness: 0.8, metalness: 0.1 });

    // Floor — canvas-baked black marble with gold inlay.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 30),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.4, metalness: 0.25 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -3);
    this.scene.add(floor);

    // Ceiling.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(28, 30), marbleMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 6.5, -3);
    this.scene.add(ceiling);

    // Walls (front carries the screen; back is the entrance wall).
    const mkWall = (w: number, x: number, z: number, rotY: number) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 6.5, 0.4), marbleMat);
      wall.position.set(x, 3.25, z);
      wall.rotation.y = rotY;
      this.scene.add(wall);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, 0.06), goldMat);
      trim.position.set(x, 5.7, z);
      trim.rotation.y = rotY;
      trim.translateZ(0.24);
      this.scene.add(trim);
    };
    mkWall(28.8, 0, -18.2, 0);
    mkWall(28.8, 0, 12.2, 0);
    mkWall(30.8, -14.2, -3, Math.PI / 2);
    mkWall(30.8, 14.2, -3, Math.PI / 2);

    // Columns with gold capitals.
    for (const x of [-12.4, 12.4]) {
      for (const z of [-8, 0, 8]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 6.5, 14), marbleLightMat);
        col.position.set(x, 3.25, z);
        this.scene.add(col);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.24, 1.35), goldMat);
        cap.position.set(x, 6.15, z);
        this.scene.add(cap);
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.22, 1.3), goldMat);
        base.position.set(x, 0.11, z);
        this.scene.add(base);
      }
    }

    // Stage (front, z from -18 to -12.2), raised, gold-lipped.
    const stage = new THREE.Mesh(new THREE.BoxGeometry(22, 0.7, 5.8), marbleLightMat);
    stage.position.set(0, 0.35, -15.1);
    this.scene.add(stage);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(22, 0.07, 0.07), goldMat);
    lip.position.set(0, 0.71, -12.22);
    this.scene.add(lip);

    // The big screen + its gold frame.
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 5.6), this.screenMaterial);
    screen.position.set(0, 3.55, -17.95);
    this.scene.add(screen);
    const frameMat = goldMat;
    const mkBar = (w: number, h: number, x: number, y: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), frameMat);
      bar.position.set(x, y, -17.93);
      this.scene.add(bar);
    };
    mkBar(13.9, 0.22, 0, 6.46);
    mkBar(13.9, 0.22, 0, 0.64);
    mkBar(0.22, 6.04, -6.84, 3.55);
    mkBar(0.22, 6.04, 6.84, 3.55);

    // Speaker stacks flanking the stage (the house set's voice).
    for (const x of [-9.8, 9.8]) {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.7, 1.2), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.7 }));
      stack.position.set(x, 0.7 + 1.35, -14.6);
      this.scene.add(stack);
      for (const [r, y] of [[0.52, 2.6], [0.34, 1.35]] as Array<[number, number]>) {
        const cone = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 0.5 }));
        cone.position.set(x, 0.7 + y, -13.98);
        this.scene.add(cone);
        const ringM = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 8, 32), goldMat);
        ringM.position.set(x, 0.7 + y, -13.97);
        this.scene.add(ringM);
      }
    }

    // Hanging mic over the stage lip — center front, house signature.
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.7, 6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    cable.position.set(0, 5.6, -13.2);
    this.scene.add(cable);
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.34, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.6 }));
    mic.position.set(0, 4.6, -13.2);
    mic.rotation.z = 0.35;
    this.scene.add(mic);
    const micBand = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.014, 8, 20), goldMat);
    micBand.position.set(0.06, 4.68, -13.2);
    micBand.rotation.z = 0.35;
    this.scene.add(micBand);

    // Lights — a warm ambient base + stage spots. No shadow maps:
    // the "baked" look comes from materials and the floor bake.
    this.scene.add(new THREE.AmbientLight(0x6b5836, 0.85));
    const hemi = new THREE.HemisphereLight(0x3a3222, 0x050505, 0.5);
    this.scene.add(hemi);
    for (const x of [-6, 0, 6]) {
      const spot = new THREE.SpotLight(0xffdf9e, 160, 30, 0.55, 0.65, 1.6);
      spot.position.set(x, 6.3, -10.5);
      spot.target.position.set(x * 0.6, 0.7, -15.5);
      this.scene.add(spot);
      this.scene.add(spot.target);
    }
    const house = new THREE.PointLight(0xffe2a8, 42, 26, 1.8);
    house.position.set(0, 5.6, 2);
    this.scene.add(house);
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

    if (this.renderer.xr.isPresenting) {
      this.tickXrMove(dt);
    } else {
      this.tickFlatMove(dt);
      this.rig.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    }

    // Remote avatars glide to their latest reported spots.
    const k = 1 - Math.exp(-9 * dt);
    for (const rig of this.avatars.values()) {
      rig.group.position.x += (rig.target.x - rig.group.position.x) * k;
      rig.group.position.z += (rig.target.z - rig.group.position.z) * k;
      rig.group.rotation.y = angleLerp(rig.group.rotation.y, rig.target.rotY, k);
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
    this.renderer.dispose();
  }
}
