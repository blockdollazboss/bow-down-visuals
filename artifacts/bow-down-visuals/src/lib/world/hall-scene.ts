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
 * Materials (overhaul stage B, pbr-materials.ts / sky-env.ts): the
 * marble/fabric colour maps are made tileable at load and given
 * procedurally DERIVED normal / roughness / AO maps — a vein-aware
 * heightfield (veins sit recessed in polished stone), never the
 * colour map fed back as its own bump. Texture repeats derive from
 * each surface's size in metres, gold wears procedural brushed-metal
 * maps, and environment reflections are PMREM-baked from a real
 * procedural sky per look (day sky / night sky), not a fake room.
 * A true planar-reflection floor sits under the polished marble
 * overlay, with per-look light rigs. A quality ladder keeps phone-class
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
 *
 * Character figures: a member who walked in as a Creative Vault
 * character (presence carries the server-verified ref) stands as
 * their portrait on a gold-framed panel figure, billboarded toward
 * the viewer, instead of the tinted capsule; everyone else — and
 * any portrait that fails to load — keeps the capsule. When the
 * portrait has a face (mouth located once by portrait-mouth.ts from
 * the real landmarks), its lips move with the speaker's live voice
 * level via setSpeechLevel; a portrait with no face found never
 * grows a mouth.
 *
 * The palace: the hall is the throne room of a multi-room palace
 * (palace-layout.ts holds the floor plan). Doorways pierce its west
 * wall (Music Hall, Game Rooms), east wall (Create Wing) and back
 * wall (the Courtyard arch); each room beyond is a shell in the
 * palace's materials — floored, walled, name-plated, empty of
 * features until its own lane docks them. Walking through a doorway
 * crosses rooms (the scene reports the crossing; the server moves
 * the presence), and only the room you stand in — plus the hall,
 * always — is rendered around you.
 */
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { WorldPeer } from "./world-client";
import { nameplateSub, nameplateTitle, starsMark } from "./nameplate";
import { selfPlateVisible, type HallViewMode } from "./view-mode";
import { capsuleBodyHex } from "./capsule-color";
import { HALL_SCREEN, hallLookFor, type HallLook, type HallTheme } from "./hall-looks";
import { mediaUrl } from "../media-cdn";
import {
  coverTransform,
  mouthOpennessForLevel,
  normalizedToCanvas,
  MOUTH_OPEN_HEIGHT_RATIO,
  type CoverTransform,
  type MouthBox,
} from "./lips";
import { locatePortraitMouth } from "./portrait-mouth";
import {
  firstGamepad,
  pollGamepad,
  IDLE_GAMEPAD_EDGES,
  type GamepadEdges,
} from "./gamepad";
import {
  figureWidthForHeight,
  defaultFigureCanvasSize,
  guardCharacterUrl,
  guardVariantForKey,
  houseGuardVariantForId,
  DEFAULT_FIGURE_HEIGHT,
  type DefaultArtState,
  type GuardVariant,
} from "./figure";
import {
  loopForCharacterRef,
  loopForGuardVariant,
  loopSuspendedForSpeech,
  loopVideoUrl,
  remapMaskAlpha,
  selectLiveLoops,
  MASK_INSET_PX,
  type FigureLoopDef,
} from "./figure-loop";
import {
  PALACE_LAYOUT,
  PALACE_DOORS,
  PALACE_DOOR_HEIGHT,
  HALL_ROOM_ID,
  MUSIC_HALL_ID,
  GAME_ROOMS_ID,
  CREATE_WING_ID,
  COURTYARD_ID,
  TREASURY_ID,
  ROYAL_COURT_ID,
  BRANDING_ATELIER_ID,
  CREATOR_ROOM_TEMPLATE,
  isCreatorRoomId,
  palaceRoomLayout,
  resolvePalaceMove,
  clampToRoom,
} from "./palace-layout";
import { stationsInRoom } from "./stations";
import { propVariation } from "./prop-variation";
import { DISTRICT_SUBPLATE, DISTRICT_THRESHOLDS, type DistrictThreshold } from "./district-gates";
import {
  createEmberField, emberCountForTier, emberOffsetAt, lanternGlowScale, type EmberParticle,
} from "./night-life";
import {
  EMPTY_MONUMENT_BOARD, MONUMENT_PLATE_H, MONUMENT_PLATE_W, drawMonumentBoardPlate,
  monumentBoardSignature, type MonumentBoardData, type MonumentPlateCtx,
} from "./monument-board";
import {
  ACTION_BY_ID,
  actionClearedByMove,
  actionPoseAt,
  type WorldActionId,
} from "./actions";
import { createMover, stepMover, type MoverState } from "./movement";
import {
  MARBLE_METRES_PER_TILE,
  FABRIC_METRES_PER_TILE,
  repeatForSize,
  derivedPbrTextures,
  brushedGoldTextures,
  enhanceLoadedTexture,
  type PbrKind,
} from "./pbr-materials";
import { buildSkyEnvironment } from "./sky-env";

/** A peer's figure chases its network target at most this fast
 *  (m/s) — a touch over run pace, so a sprinting peer reads as
 *  sprinting, never as teleporting rubber. */
const PEER_CHASE_MAX = 7.2;
/** Living loops: a figure's canvas repaints with its loop at most
 *  this often (ms) while the mouth is still — the eye reads 30fps
 *  motion fine, and phone GPUs keep the change. */
const LOOP_REDRAW_MS = 33;
/** Living loops: the still⇄loop crossfade length (seconds) — at
 *  speech edges and budget edges alike, nothing ever pops. */
const LOOP_FADE_SEC = 0.18;
/** Living loops: voice level above this counts as speaking for
 *  the mouth-drift suspension rule. */
const LOOP_SPEECH_LEVEL = 0.02;
/** Living loops: quiet this long (ms) before a speech-suspended
 *  loop fades back in — speech gaps don't flicker the figure. */
const LOOP_SPEECH_RESUME_MS = 300;
/** The shell-group key for the Creator Rooms template (3.5): one
 *  shell, dressed per host — see the scene's creatorDressing. */
const CREATOR_SHELL_KEY = "world:creator-room-template";

const LOOP_SCRATCH_SPHERE = new THREE.Sphere(new THREE.Vector3(), 1.4);
const LOOP_SCRATCH_MAT = new THREE.Matrix4();
/** Past this gap (m) a peer's figure snaps to its target instead
 *  of chasing — lag corrections land, they don't slide. */
const PEER_SNAP_DIST = 6;

export interface HallScreenSource {
  mode: "live" | "featured" | "video";
  videoUrl: string | null;
  hlsUrl: string | null;
  /** Watch-party videos: the shared playback state from the room's
   *  server stamp — start near positionSec, playing or paused. */
  playing?: boolean;
  startAtSec?: number;
}

/* The hall's camera clamp comes from the palace floor plan
   (palace-layout.ts) — the same numbers the hall has always used,
   now one source for the whole palace. */
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 3.4;
const RUN_SPEED = 6;
/* Third-person camera: behind and above your figure, clamped inside
   the walls so the follow cam never leaves the room. */
const THIRD_CAM_DISTANCE = 4.1;
const THIRD_CAM_HEIGHT = 2.45;
const CAM_CLAMP = PALACE_LAYOUT[HALL_ROOM_ID]!.camClamp;

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

/** Shared scratch for the per-frame camera position (tick-only). */
const SCRATCH_VEC = new THREE.Vector3();

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
  /* Overhaul stage 3 (perf audit E2): the phone rung was 1.75 with
   * MSAA always on — the most expensive default a tiled phone GPU
   * can be handed. 1.5 keeps the picture crisp above native CSS
   * pixels on most phones; low gets a genuine weak-hardware rung. */
  medium: { pixelRatio: 1.5, reflectorSize: 512, shadows: true, candleLights: true },
  low: { pixelRatio: 1.25, reflectorSize: 0, shadows: false, candleLights: false },
} as const;

/* ── Texture maps (public assets, lazy with the world chunk) ─────────
   One cached instance per (url, repeat) — materials vary by repeat,
   never by look, so a theme re-skin re-uses what's already loaded.
   Repeats come from repeatForSize (metres, not vibes — item 7) and
   wrapping is plain Repeat: the source is made tileable at load by
   pbr-materials.enhanceLoadedTexture (item 11), which also derives
   the normal/roughness/AO maps from it (item 9). The old mirrored
   wrapping kaleidoscoped the non-seamless source's veins. */
const textureCache = new Map<string, THREE.Texture>();

/* The renderer's real anisotropy ceiling, captured at scene
 * construction (overhaul audit T12: the hard-coded 8 smeared the
 * plaza floor at the grazing angles the world is mostly viewed
 * from — most current phones/desktops support 16). */
let maxTextureAnisotropy = 8;

function hallTexture(url: string, repeatX: number, repeatY: number): THREE.Texture {
  const key = `${url}@${repeatX}x${repeatY}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  // Site assets resolve through the media CDN — TextureLoader requests
  // in CORS mode ('anonymous' is three's ImageLoader default) and the
  // bucket's CORS policy covers the site's origins, so WebGL uploads
  // stay clean. Absolute URLs (none today) pass through untouched.
  const path = url.startsWith("/") ? mediaUrl(url) : url;
  const tex = new THREE.TextureLoader().load(path, (loaded) => {
    /* The source landed: swap in its tileable variant and fill the
     * derived PBR maps registered for this URL (pbr-materials). */
    enhanceLoadedTexture(url, loaded);
  }, undefined, () => {
    /* Overhaul audit T14: a slow/blocked/CORS-failed CDN copy used
     * to leave the surface untextured black with no recovery. Fall
     * back to the same asset on the site origin (the public/ copy
     * still ships with the app); if that fails too, the material's
     * own colour carries the surface instead of a black hole. */
    if (path !== url) {
      new THREE.ImageLoader().load(
        url,
        (img) => {
          tex.image = img;
          tex.needsUpdate = true;
        },
        undefined,
        () => undefined,
      );
    }
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxTextureAnisotropy;
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

/** A creator room's screen at rest (Ring 2, 3.5): the host's name
 *  in the house card style — the screen is THEIRS, and when they
 *  have no featured video it says so by wearing their name rather
 *  than the hall's. Same canvas discipline as the hall's idle. */
function creatorScreenIdleTexture(hostName?: string): THREE.CanvasTexture {
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
  g.font = "700 64px Georgia, 'Times New Roman', serif";
  g.textAlign = "center";
  const name = (hostName ?? "").trim().toUpperCase().slice(0, 26) || "A CREATOR'S ROOM";
  g.fillText(name, 512, 205);
  g.fillStyle = "rgba(232,200,106,0.75)";
  g.font = "600 30px Georgia, serif";
  g.fillText("T H E I R   S C R E E N", 512, 268);
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

/* ── Door name plates ───────────────────────────────────────────────
   A bronze plaque with a gold hairline and serif caps, hung over
   every doorway: the room it leads to, readable from across the
   hall in both looks (basic material — the plate never goes dark).
   Cached per name; the four doors of the first ring are all the
   palace needs. */
const doorPlateCache = new Map<string, THREE.CanvasTexture>();

function doorPlateTexture(text: string): THREE.CanvasTexture {
  const hit = doorPlateCache.get(text);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 224;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 224);
  grad.addColorStop(0, "#2b1f0c");
  grad.addColorStop(0.5, "#1c1408");
  grad.addColorStop(1, "#120d05");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 224);
  g.strokeStyle = "rgba(212,175,55,0.9)";
  g.lineWidth = 5;
  g.strokeRect(14, 14, 996, 196);
  g.strokeStyle = "rgba(212,175,55,0.35)";
  g.lineWidth = 2;
  g.strokeRect(27, 27, 970, 170);
  g.fillStyle = "#e8c86a";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 96;
  g.font = `600 ${size}px Georgia, 'Times New Roman', serif`;
  while (g.measureText(text).width > 880 && size > 40) {
    size -= 6;
    g.font = `600 ${size}px Georgia, 'Times New Roman', serif`;
  }
  g.fillText(text, 512, 118);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  doorPlateCache.set(text, tex);
  return tex;
}

/* ── The Kingdom Board monument plate (Open World Phase 1,
   lettered for real in overhaul stage B, item 16) ─────────────
   The stele at the plaza's heart wears a tall engraved plate in
   the door plates' tradition — but the words on it are the
   board's REAL headlines now (monument-board.ts): who's here,
   today at the palace, and the week's standings, shaped from the
   same reads the Kingdom Board station panel shows. The live
   board still opens in the station panel at the monument's base.
   Themed like the hall itself: gold on dark marble in the dark
   look, dark bronze on cream in the light look. Cached per
   (theme, data signature) — the page hands fresh data through
   setMonumentBoardData and the plate repaints only when the
   words actually change. */
const kingdomBoardPlateCache = new Map<string, THREE.CanvasTexture>();

/* The board data the monument currently letters — module state
 * like the creator-room registration: the scene's shells (rebuilt
 * per theme) and the page's data seam read the same words. */
let monumentBoardCurrent: MonumentBoardData = EMPTY_MONUMENT_BOARD;

function kingdomBoardPlateTexture(theme: HallTheme): THREE.CanvasTexture {
  const key = `${theme}|${monumentBoardSignature(monumentBoardCurrent)}`;
  const hit = kingdomBoardPlateCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = MONUMENT_PLATE_W;
  c.height = MONUMENT_PLATE_H;
  const g = c.getContext("2d")!;
  drawMonumentBoardPlate(g as unknown as MonumentPlateCtx, theme, monumentBoardCurrent);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, maxTextureAnisotropy);
  kingdomBoardPlateCache.set(key, tex);
  return tex;
}

/** Everything the name plate shows — when any of it changes the
 *  plate is redrawn (see upsertPeer's plate reconcile). */
function namePlateKey(peer: WorldPeer, frontRow = false): string {
  return [
    peer.displayName,
    /* The stars are part of the plate's identity: a witnessed
     * level-up restars the peer record, the key changes, and the
     * plate is redrawn with the new rank (nameplate.ts). */
    starsMark(peer.stars),
    peer.guest ? "guest" : "",
    peer.profileSlug ?? "",
    peer.voiceOff ? "off" : "",
    peer.voiceDeaf ? "deaf" : "",
    frontRow ? "front-row" : "",
  ].join("|");
}

/** A small muted-mic badge: gold-ringed disc, pale mic, red slash.
 *  Drawn on the name plate of a voice-off peer — the hall's cue that
 *  this person can't hear voice right now. */
function drawVoiceOffBadge(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.save();
  g.beginPath();
  g.arc(cx, cy, 22, 0, Math.PI * 2);
  g.fillStyle = "rgba(10,8,6,0.78)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(232,200,106,0.9)";
  g.stroke();
  // The mic: capsule body + cradle arc + stem.
  g.fillStyle = "#e8e2d4";
  g.beginPath();
  g.arc(cx, cy - 6, 5.5, Math.PI, 0);
  g.fill();
  g.fillRect(cx - 5.5, cy - 6, 11, 11);
  g.beginPath();
  g.arc(cx, cy + 5, 5.5, 0, Math.PI);
  g.fill();
  g.strokeStyle = "#e8e2d4";
  g.lineWidth = 2.6;
  g.beginPath();
  g.arc(cx, cy - 1, 10, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, cy + 9);
  g.lineTo(cx, cy + 14);
  g.stroke();
  // The slash.
  g.strokeStyle = "#e0653f";
  g.lineWidth = 4.5;
  g.beginPath();
  g.moveTo(cx - 14, cy + 13);
  g.lineTo(cx + 14, cy - 13);
  g.stroke();
  g.restore();
}

/** A small deafened badge: gold-ringed disc, pale headphones, red
 *  slash. Drawn on the name plate of a deafened peer — the hall's cue
 *  that this person hears nobody right now (but is still IN voice,
 *  unlike the voice-off badge's mic: not gone, just deafened). */
function drawVoiceDeafBadge(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.save();
  g.beginPath();
  g.arc(cx, cy, 22, 0, Math.PI * 2);
  g.fillStyle = "rgba(10,8,6,0.78)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(232,200,106,0.9)";
  g.stroke();
  // The headphones: band arc over the top, a cup at each end.
  g.strokeStyle = "#e8e2d4";
  g.lineWidth = 3.4;
  g.beginPath();
  g.arc(cx, cy + 3, 11.5, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  g.fillStyle = "#e8e2d4";
  g.fillRect(cx - 15.5, cy - 1, 6.5, 12);
  g.fillRect(cx + 9, cy - 1, 6.5, 12);
  // The slash.
  g.strokeStyle = "#e0653f";
  g.lineWidth = 4.5;
  g.beginPath();
  g.moveTo(cx - 14, cy + 13);
  g.lineTo(cx + 14, cy - 13);
  g.stroke();
  g.restore();
}

function nameSpriteTexture(peer: WorldPeer, frontRow = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 144;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.font = "700 54px system-ui, sans-serif";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(0,0,0,0.85)";
  /* The name line carries the creator's stars beside the name —
   * the nameplate is the ONLY place stars render (THE-GAME §5 Q1);
   * the label itself is built in nameplate.ts. The star marks are
   * drawn in gold so rank reads at a glance. */
  const name = nameplateTitle(peer);
  g.strokeText(name, 256, 58);
  g.fillStyle = "#ffffff";
  g.fillText(name, 256, 58);
  const mark = starsMark(peer.stars);
  if (mark) {
    /* Repaint just the star run in house gold over the white name:
     * measure the plain name to find where the marks begin. */
    const nameOnly = peer.displayName.slice(0, 24);
    const totalW = g.measureText(name).width;
    const markW = g.measureText(` ${mark}`).width;
    const markStart = 256 - totalW / 2 + (totalW - markW);
    g.save();
    g.textAlign = "left";
    g.fillStyle = "#e8c86a";
    g.fillText(` ${mark}`, markStart, 58);
    g.restore();
    g.textAlign = "center";
  }
  g.font = "600 34px system-ui, sans-serif";
  /* Voice-off outranks the slug on the sub-line: "this person can't
   *  hear you" is the fact the hall needs at a glance. Deafened is
   *  next — same family of fact, different state (in voice, hearing
   *  nobody). A Front Row member (of the performer on stage) is named
   *  on the plate too — the honor is visible, not just a brighter ring.
   *  (The wording lives in nameplate.ts — nameplateSub.) */
  const sub = nameplateSub(peer, frontRow);
  g.lineWidth = 7;
  g.strokeText(sub, 256, 112);
  g.fillStyle = peer.voiceOff ? "#e08a6d" : peer.voiceDeaf ? "#a9c3d9" : peer.guest ? "#b8b0a0" : "#e8c86a";
  g.fillText(sub, 256, 112);
  if (peer.voiceOff) drawVoiceOffBadge(g, 470, 34);
  else if (peer.voiceDeaf) drawVoiceDeafBadge(g, 470, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ── Avatar ───────────────────────────────────────────────────────────
   Every peer stands as a `body` group inside their rig group: the
   tinted capsule by default, or — for a member who walked in as a
   Creative Vault character — their portrait on a gold-framed panel.
   The floor ring and the name sprite live on the rig group itself,
   so a figure swap never disturbs identity or footing. */

interface PortraitState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  image: HTMLImageElement;
  srcW: number;
  srcH: number;
  cover: CoverTransform;
  /** The mouth the landmarks found — null = no face, no lips, ever. */
  mouth: MouthBox | null;
  /** Living loop (figure-loop.ts): the loop's video element once
   *  it can play — drawn into this same canvas over the still.
   *  Null = still only. loopCrop is the figure's region of a
   *  shared sheet (the guards' videos), loopMask the still's own
   *  alpha re-cut for opaque masked loops, loopAlpha the 0..1
   *  crossfade blend the tick drives. */
  loopVideo: HTMLVideoElement | null;
  loopCrop: { x: number; y: number; w: number; h: number } | null;
  loopMask: HTMLCanvasElement | null;
  loopAlpha: number;
}

interface AvatarRig {
  group: THREE.Group;
  body: THREE.Group;
  sprite: THREE.Sprite;
  /** The house default figure (a palace guard) — drives the idle
   *  sway and the art-landing trade-up. */
  defaultFigure: boolean;
  /** The guard variant this rig currently stands as — null unless
   *  wearing a guard figure. */
  guardVariant: GuardVariant | null;
  /** The guard this presence should stand as per its latest
   *  reconcile: the explicit pick when they made one, else the
   *  deterministic deal off their identity. Null while standing as
   *  a vault portrait. The art-landing trade-up reads this. */
  guardWanted: GuardVariant | null;
  /** Per-figure phase so the hall doesn't sway in lockstep. */
  swayPhase: number;
  /** The avatar action this figure is performing, and when it
   *  started on the local clock. One-shots complete and settle on
   *  their own; toggles hold until stopped, replaced, or walked
   *  off (see actions.ts). */
  actionId: WorldActionId | null;
  actionAt: number;
  /** The pose the figure currently wears, eased toward the
   *  action's pose each frame so starts and stops never pop. The
   *  spin is NOT eased — a spin must turn exactly one full turn. */
  poseTiltX: number;
  poseTiltZ: number;
  poseY: number;
  poseSpinY: number;
  /** The figure's body physics (movement.ts): eased velocity,
   *  stride bob, lean, stop settle — fed the figure's real
   *  positions, so the gait tells the truth about the motion. */
  mover: MoverState;
  /** The floor ring (brightened + widened for Front Row members). */
  ring: THREE.Mesh;
  /** Whether the Front Row treatment is currently applied. */
  frontRow: boolean;
  /** Signature of what the name plate currently shows. */
  plateKey: string;
  tint: string;
  target: { x: number; z: number; rotY: number };
  /** The character the standing figure currently shows (null = capsule). */
  characterId: string | null;
  /** The character the presence payload wants. A portrait load is in
   *  flight (or failed terminally) whenever this differs from
   *  characterId; upsertPeer never re-fires a load for the same id. */
  requestedId: string | null;
  swapSeq: number;
  portrait: PortraitState | null;
  /** Mouth openness the speaker's voice asks for / currently drawn. */
  speechTarget: number;
  speechShown: number;
  lastMouthDrawAt: number;
  /** The living loop feeding this figure's canvas, if its
   *  character has one (figure-loop.ts). Owned end to end by the
   *  loop methods below; torn down on every figure swap. */
  loopFeed: FigureLoopFeed | null;
  /** The standing character's name from the latest reconcile —
   *  the loop registry keys the King's loop off it. */
  characterName: string;
}

/** One figure's living loop: the (never-displayed) video element
 *  whose frames are drawn into the figure's portrait canvas. The
 *  still stays first paint and permanent fallback — a failed feed
 *  simply never blends in. */
interface FigureLoopFeed {
  id: number;
  def: FigureLoopDef;
  video: HTMLVideoElement;
  /** canplay reached — frames are drawable. */
  ready: boolean;
  /** Terminal failure (error, repeated play rejection, mask could
   *  not be built): the figure stays its still, forever. */
  failed: boolean;
  /** The per-tick budget pass chose this feed to be playing. */
  active: boolean;
  /** 0..1 crossfade blend toward active (and not speech-suspended). */
  alpha: number;
  /** The still-alpha mask for masked loops, built at attach. */
  mask: HTMLCanvasElement | null;
  lastVideoTime: number;
  playRejections: number;
  /** When the figure last went quiet (speech-suspension release
   *  timing); 0 = currently speaking or never tracked. */
  silentSinceMs: number;
}

const PORTRAIT_CANVAS_W = 384;
const PORTRAIT_CANVAS_H = 512;
const PORTRAIT_PANEL_W = 1.0;
const PORTRAIT_PANEL_H = PORTRAIT_PANEL_W * (PORTRAIT_CANVAS_H / PORTRAIT_CANVAS_W);
const PORTRAIT_BASE_Y = 0.5; // easel height — the panel's bottom edge
const PORTRAIT_SPRITE_Y = 2.18;
const CAPSULE_SPRITE_Y = 2.3;
const DEFAULT_SPRITE_Y = 2.12;

function buildCapsuleBody(tintHex: string): THREE.Group {
  const body = new THREE.Group();
  /* The fallback figure is the HOUSE figure: the presence tint is
   * anchored into the gold family (capsule-color) before it ever
   * touches a material — raw, the coral/jade tints read as bare
   * skin or candy under the hall lights. The head rides the same
   * anchored gold, darkened: dark bronze under the gold visor. */
  const tint = new THREE.Color(capsuleBodyHex(tintHex));
  const bodyMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.55), roughness: 0.6, metalness: 0.2 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.78, 4, 12), bodyMat);
  torso.position.y = 0.98;
  body.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 18, 14), darkMat);
  head.position.y = 1.83;
  body.add(head);

  // Gold visor — the face cue (front = -Z at rotY 0).
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.055, 0.05),
    new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD_DEEP, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.8 }),
  );
  visor.position.set(0, 1.86, -0.19);
  body.add(visor);
  // Grounding blob (overhaul stage 3, audit B5): every figure stands
  // ON the floor, never floats over it — the capsule gets the same
  // painted shadow the house figure wears.
  body.add(floorBlob(1.0));
  return body;
}

/** The soft painted floor shadow every figure stands on. */
function floorBlob(size: number): THREE.Mesh {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  shadow.renderOrder = 1;
  return shadow;
}

/** Draw the portrait (cover-fit) plus — only when the landmarks found
 *  a mouth and the speaker's voice opens it — the mouth opening: a
 *  shaded ellipse exactly at the landmarked mouth, its height scaled
 *  by the openness. The closed-mouth draw is the portrait untouched. */
function drawPortraitCanvas(portrait: PortraitState, openness: number): void {
  const { ctx, canvas, image, cover } = portrait;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, cover.offsetX, cover.offsetY, cover.drawnW, cover.drawnH);
  // Living-loop layer: while this figure's loop is blended in,
  // its frames paint over the still in the same canvas — cropped
  // to the figure's own region when the loop is a shared sheet
  // (the guards), cover-fit whole when it isn't (the King).
  // Masked loops (opaque video, transparent still) are then
  // re-cut to the figure by the still's own alpha, so no studio
  // backdrop ever shows; the mouth overlay below still draws
  // last, over still and loop alike. Any draw failure leaves the
  // still standing — the loop is an enhancement, never a risk.
  const loopVideo = portrait.loopVideo;
  if (loopVideo && portrait.loopAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = portrait.loopAlpha;
    try {
      const crop = portrait.loopCrop;
      if (crop && loopVideo.videoWidth > 0) {
        ctx.drawImage(
          loopVideo,
          crop.x * loopVideo.videoWidth,
          crop.y * loopVideo.videoHeight,
          crop.w * loopVideo.videoWidth,
          crop.h * loopVideo.videoHeight,
          cover.offsetX,
          cover.offsetY,
          cover.drawnW,
          cover.drawnH,
        );
      } else {
        ctx.drawImage(loopVideo, cover.offsetX, cover.offsetY, cover.drawnW, cover.drawnH);
      }
    } catch {
      /* a torn-down or unready frame — the still underneath stands */
    }
    ctx.restore();
    if (portrait.loopMask) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(portrait.loopMask, 0, 0);
      ctx.restore();
    }
  }
  const mouth = portrait.mouth;
  if (mouth && openness > 0.015) {
    const center = normalizedToCanvas({ x: mouth.cx, y: mouth.cy }, portrait.srcW, portrait.srcH, cover);
    const mouthW = mouth.w * portrait.srcW * cover.scale;
    const rx = Math.max(3, mouthW / 2);
    const ry = Math.max(1.2, (openness * mouthW * MOUTH_OPEN_HEIGHT_RATIO) / 2);
    const cy = center.y + ry * 0.35; // the opening drops as it widens
    const grad = ctx.createRadialGradient(center.x, cy, 0, center.x, cy, rx);
    grad.addColorStop(0, "rgba(43,10,8,0.96)");
    grad.addColorStop(0.55, "rgba(74,22,16,0.92)");
    grad.addColorStop(0.85, "rgba(96,38,28,0.55)");
    grad.addColorStop(1, "rgba(96,38,28,0)");
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(center.x, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
  portrait.texture.needsUpdate = true;
}

interface BuiltFigure {
  body: THREE.Group;
  portrait: PortraitState;
}

function buildPortraitFigure(image: HTMLImageElement, mouth: MouthBox | null): BuiltFigure {
  const canvas = document.createElement("canvas");
  canvas.width = PORTRAIT_CANVAS_W;
  canvas.height = PORTRAIT_CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("portrait canvas has no 2d context");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const portrait: PortraitState = {
    canvas,
    ctx,
    texture,
    image,
    srcW: image.naturalWidth || image.width,
    srcH: image.naturalHeight || image.height,
    cover: coverTransform(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      PORTRAIT_CANVAS_W,
      PORTRAIT_CANVAS_H,
    ),
    mouth,
    loopVideo: null,
    loopCrop: null,
    loopMask: null,
    loopAlpha: 0,
  };

  const body = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({
    color: GOLD,
    emissive: GOLD_DEEP,
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.9,
  });
  const centerY = PORTRAIT_BASE_Y + PORTRAIT_PANEL_H / 2;
  // The gold frame behind the portrait panel.
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(PORTRAIT_PANEL_W + 0.1, PORTRAIT_PANEL_H + 0.1, 0.05),
    goldMat,
  );
  frame.position.set(0, centerY, 0);
  body.add(frame);
  // The portrait itself, proud of the frame's front face (+Z — the
  // figure billboards this side toward the viewer).
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(PORTRAIT_PANEL_W, PORTRAIT_PANEL_H),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.05 }),
  );
  panel.position.set(0, centerY, 0.028);
  body.add(panel);
  // The easel post down to the floor ring.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, PORTRAIT_BASE_Y - 0.02, 10), goldMat);
  post.position.y = (PORTRAIT_BASE_Y - 0.02) / 2 + 0.02;
  body.add(post);
  // Grounding blob under the easel (overhaul stage 3, audit B5).
  body.add(floorBlob(0.95));

  drawPortraitCanvas(portrait, 0);
  return { body, portrait };
}

let shadowTex: THREE.CanvasTexture | null = null;
function shadowTexture(): THREE.CanvasTexture {
  if (!shadowTex) {
    shadowTex = glowTexture([
      [0, "rgba(0,0,0,0.44)"],
      [0.55, "rgba(0,0,0,0.22)"],
      [1, "rgba(0,0,0,0)"],
    ]);
  }
  return shadowTex;
}

/** The house default figure: the King Shark palace guard, life-size,
 *  standing on a soft floor shadow. Built on the portrait pipeline —
 *  its own canvas per figure (lips are per-speaker), the art's aspect
 *  preserved edge-to-edge (the canvas is sized to the art), and the
 *  landmarked mouth driving lips exactly like a vault portrait. The
 *  art is a full-body cut-out (transparent ground): the plane is
 *  transparent so the guard himself stands in the hall, not a card. */
function buildDefaultFigure(image: HTMLImageElement, mouth: MouthBox | null): BuiltFigure {
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  const aspect = srcW / srcH;
  const size = defaultFigureCanvasSize(aspect);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("default figure canvas has no 2d context");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const portrait: PortraitState = {
    canvas,
    ctx,
    texture,
    image,
    srcW,
    srcH,
    cover: coverTransform(srcW, srcH, size.w, size.h),
    mouth,
    loopVideo: null,
    loopCrop: null,
    loopMask: null,
    loopAlpha: 0,
  };

  const body = new THREE.Group();
  const width = figureWidthForHeight(DEFAULT_FIGURE_HEIGHT, aspect);
  const figure = new THREE.Mesh(
    new THREE.PlaneGeometry(width, DEFAULT_FIGURE_HEIGHT),
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      roughness: 0.6,
      metalness: 0.05,
      alphaTest: 0.02,
    }),
  );
  figure.position.y = DEFAULT_FIGURE_HEIGHT / 2;
  body.add(figure);
  // The soft floor shadow — grounds the figure on the marble.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 1.15),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  shadow.renderOrder = 1;
  body.add(shadow);

  drawPortraitCanvas(portrait, 0);
  return { body, portrait };
}

function buildAvatar(peer: WorldPeer): AvatarRig {
  const group = new THREE.Group();

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
  sprite.position.y = CAPSULE_SPRITE_Y;
  group.add(sprite);

  const body = buildCapsuleBody(peer.tint);
  group.add(body);

  group.position.set(peer.x, 0, peer.z);
  group.rotation.y = peer.rotY;
  return {
    group,
    body,
    sprite,
    defaultFigure: false,
    guardVariant: null,
    guardWanted: null,
    swayPhase: Math.random() * Math.PI * 2,
    actionId: null,
    actionAt: 0,
    poseTiltX: 0,
    poseTiltZ: 0,
    poseY: 0,
    poseSpinY: 0,
    mover: createMover(peer.x, peer.z),
    ring,
    frontRow: false,
    plateKey: namePlateKey(peer),
    tint: peer.tint,
    target: { x: peer.x, z: peer.z, rotY: peer.rotY },
    characterId: null,
    requestedId: null,
    swapSeq: 0,
    portrait: null,
    speechTarget: 0,
    speechShown: 0,
    lastMouthDrawAt: 0,
    loopFeed: null,
    characterName: "",
  };
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
    const sprite = obj as THREE.Sprite;
    if (sprite.material) (sprite.material as THREE.SpriteMaterial).map?.dispose();
  });
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
  /** Per-metre material factories (item 7): a wall run, ceiling or
   *  plaza wall of a given size gets a material whose texture repeat
   *  derives from THAT size, so texel density is constant across the
   *  palace. Cached per size within the look. */
  wallFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
  marbleFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
  ceilingFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
}

interface LookAnim {
  flames: Array<{ sprite: THREE.Sprite; baseX: number; baseY: number; phase: number }>;
  flickerLights: Array<{ light: THREE.PointLight; base: number; phase: number }>;
  dust: THREE.Points | null;
  smokes: Array<{ mesh: THREE.Mesh; baseX: number; phase: number; speed: number }>;
  /* Night life (item 27): ember fields over the braziers — a
   * Points cloud per brazier plus its deterministic field. */
  embers: Array<{ points: THREE.Points; field: EmberParticle[] }>;
  /* Lantern glows on the district thresholds (item 27): they
   * breathe on lanternGlowScale, not the flame scale curve. */
  lanternGlows: Array<{ sprite: THREE.Sprite; base: number; phase: number }>;
}

const EMPTY_ANIM: LookAnim = { flames: [], flickerLights: [], dust: null, smokes: [], embers: [], lanternGlows: [] };

/* ── The scene ──────────────────────────────────────────────────────── */

export class KingsHallScene {
  onPose: ((x: number, z: number, rotY: number) => void) | null = null;
  /** The walker just crossed a doorway plane into another room —
   *  the page answers by asking the server to transfer presence
   *  (the scene has already flipped its own room: movement, camera
   *  and visibility follow the body, not the paperwork). */
  onRoomEnter: ((roomId: string) => void) | null = null;
  /** The palace room the walker physically stands in. The hall is
   *  home: spawn, stage, the palace's one mirror floor. */
  private currentRoom: string = HALL_ROOM_ID;
  /** Creator Rooms (Ring 2, 3.5): the template shell south of the
   *  Courtyard is registered under this key — its identity is
   *  whichever creator's room the walker stands in, and its
   *  dressing (name plate, accent, portrait, screen) is applied
   *  per host by setCreatorRoomDressing. The screen here is the
   *  room's own: a second, purely local video plane fed by the
   *  room-data endpoint — the hall's screen machinery (its
   *  resolvers, its one video texture) is never touched. */
  private creatorDressing: {
    displayName: string;
    roomName: string;
    accentHex: string;
    primaryHex: string;
    portraitUrl: string | null;
    screenVideoUrl: string | null;
    /** The room's evolution (Ring 3, Phase 5): the rank plate's
     *  line ("★★★ Gangster", composed from the server DTO) + the
     *  tier's trim color. Absent = unmeasured room, no plate. */
    rankLine?: string | null;
    tierTrimHex?: string | null;
    /** The owner's dressing choice (Ring 4): the picked template
     *  variant's scene parameters. Absent = the classic tuple. */
    palette?: "house" | "inverted" | "gilded";
    trimStyle?: "bar" | "double" | "crown";
    bannerStyle?: "flank" | "trio" | "none";
  } | null = null;
  private creatorDressingGroup: THREE.Group | null = null;
  /** The materials the current look's shells were built with —
   *  kept so a host change re-dresses in the look's own gold, not
   *  a guess. Refilled on every look build. */
  private shellMats: LookMaterials | null = null;
  private creatorScreenMesh: THREE.Mesh | null = null;
  private creatorScreenVideo: HTMLVideoElement | null = null;
  private creatorScreenTexture: THREE.VideoTexture | null = null;
  private creatorScreenUrl = "";
  /** The room shells by room id (children of the look group, so a
   *  theme re-skin rebuilds them in the new look's materials). */
  private shellGroups = new Map<string, THREE.Group>();

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();
  private clock = new THREE.Clock();
  private avatars = new Map<string, AvatarRig>();
  /** Your own figure — built like any peer's (capsule or portrait
   *  character) but glued to the walk rig and shown only to the
   *  third-person camera. First person and XR hide it: in a headset
   *  the XR camera rules stand, and a body at the camera's own spot
   *  would fill the view. */
  private selfRig: AvatarRig | null = null;
  /** My own body physics (movement.ts) — the walk rig's mover: eased
   *  velocity, stride bob, lean, stop settle. (My figure rig carries
   *  a mover too, unused — peers' rigs are the ones it drives.) */
  private selfMover: MoverState = createMover(0, 9.5);
  private viewMode: HallViewMode = "first";
  private keys = new Set<string>();
  /** Gamepad edge state carried between polls (toggle buttons fire
   *  once per press). */
  private padEdges: GamepadEdges = IDLE_GAMEPAD_EDGES;
  /** A controller's voice press (the page steps its voice mode). */
  onPadToggleVoice: (() => void) | null = null;
  /** A controller's view-toggle press (first/third person). */
  onPadToggleView: (() => void) | null = null;
  /** A controller's action press (D-pad / face buttons — the page
   *  performs it through the same path as the on-screen bar). */
  onPadAction: ((action: WorldActionId) => void) | null = null;
  /** A controller's station-interact press (LB — the page opens
   *  the door whose prompt is showing, the E key's twin). */
  onPadInteract: (() => void) | null = null;
  /** My own performed action changed on its own — a one-shot
   *  finished, or walking ended a held toggle — so the page's
   *  action bar stays truthful without polling. */
  onSelfAction: ((action: WorldActionId | null) => void) | null = null;
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
  /** The performer's Front Row (profile slugs) while a show is on —
   *  their figures wear the brighter ring + plate line. */
  private frontRowSlugs = new Set<string>();
  /** The monument faces' materials (item 16): every look build
   *  re-registers them, and setMonumentBoardData re-maps them
   *  when the board's words change. */
  private monumentFaceMats: THREE.MeshBasicMaterial[] = [];
  /** The honored seat arc before the stage, shown while a show runs. */
  private stageSeats: THREE.Group | null = null;
  /** The house guards' art (both approved slots): each loads once
   *  per scene; "ready" trades every presence dealt or picking that
   *  guard up from the capsule, "failed" leaves the capsule as that
   *  guard's fallback. */
  private guardArt: Record<
    GuardVariant,
    { status: DefaultArtState; image: HTMLImageElement | null; mouth: MouthBox | null }
  > = {
    male: { status: "pending", image: null, mouth: null },
    female: { status: "pending", image: null, mouth: null },
  };
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  /* Living loops: feed ids (budget keys) + the one-time
     hidden-tab pause hook. */
  private nextLoopFeedId = 1;
  private loopVisibilityHooked = false;
  private loopFrustum: THREE.Frustum | null = null;
  private boundHandlers: Array<[string, EventListener, unknown]> = [];

  private quality: QualityTier;
  private theme: HallTheme;
  private lookGroup: THREE.Group | null = null;
  private lookAnim: LookAnim = EMPTY_ANIM;
  private floorReflector: Reflector | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /* The one directional (sun by day, moon by night), re-aimed per
   * area by aimSun() — see buildLights. */
  private sunLight: THREE.DirectionalLight | null = null;
  private sunTarget: THREE.Object3D | null = null;

  constructor(private canvas: HTMLCanvasElement, theme: HallTheme = "dark") {
    this.quality = detectQuality();
    const q = QUALITY[this.quality];
    this.theme = theme;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    maxTextureAnisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy() || 8);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    /* Overhaul stage 3 (perf audit E4): every shadow caster in the
     * palace is architecture — static — and figures ground with
     * painted blobs, so the shadow map is rendered on demand
     * (aimSun/applyLook set needsUpdate) instead of re-rendered
     * every frame for a sun that never moves within an area. */
    this.renderer.shadowMap.autoUpdate = false;
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
    this.loadGuardArt();
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
    this.envTarget = buildSkyEnvironment(this.renderer, look);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = look.environmentIntensity;

    const group = new THREE.Group();
    this.buildLook(group, look);
    this.scene.add(group);
    this.lookGroup = group;
    // Fresh lights + fog for the room we stand in (aimSun also
    // requests the one shadow-map render the frozen map needs).
    this.applyAreaAtmosphere();
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

  /* Themed reflections come from sky-env.ts (item 21): a PMREM of
   * a procedural sky per look — the fake indoor-room env that gold
   * and marble used to reflect is gone. */

  /* ── Look construction ── */

  private makeMaterials(look: HallLook): LookMaterials {
    /* One marble surface builder for the whole palace: colour map +
     * the derived PBR set (normal/roughness/AO from pbr-materials,
     * filled in when the source lands) at a repeat derived from the
     * surface's size in metres. Scalar roughness is 1 wherever a
     * roughness MAP is attached — the map encodes the absolute
     * value, the scalar would only double-apply it. */
    const marbleSurface = (
      kind: PbrKind, widthM: number, heightM: number,
      opts: { color?: number; envMapIntensity: number; metalness?: number },
    ): THREE.MeshStandardMaterial => {
      const rep = repeatForSize(widthM, heightM, MARBLE_METRES_PER_TILE);
      const pbr = derivedPbrTextures(look.marbleTextureUrl, kind, rep.x, rep.y);
      for (const t of [pbr.normalMap, pbr.roughnessMap, pbr.aoMap]) t.anisotropy = maxTextureAnisotropy;
      return new THREE.MeshStandardMaterial({
        map: hallTexture(look.marbleTextureUrl, rep.x, rep.y),
        normalMap: pbr.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
        roughnessMap: pbr.roughnessMap, roughness: 1,
        aoMap: pbr.aoMap,
        color: opts.color, metalness: opts.metalness ?? 0.05, envMapIntensity: opts.envMapIntensity,
      });
    };
    const sizedCache = new Map<string, THREE.MeshStandardMaterial>();
    const sized = (
      tag: string, kind: PbrKind,
      opts: { color?: number; envMapIntensity: number; metalness?: number },
    ) => (widthM: number, heightM: number): THREE.MeshStandardMaterial => {
      const key = `${tag}|${widthM.toFixed(2)}x${heightM.toFixed(2)}`;
      const hit = sizedCache.get(key);
      if (hit) return hit;
      const mat = marbleSurface(kind, widthM, heightM, opts);
      sizedCache.set(key, mat);
      return mat;
    };

    /* Gold (item 12): brushed-metal maps — roughness that varies
     * along the brush (bright ≈ 0.14–0.34, deep ≈ 0.30–0.54) and a
     * subtle streak normal — under the sky env, so it reads as
     * metal. roughness scalar is 1: the map carries the value. */
    const goldMaps = brushedGoldTextures("bright", 2, 2);
    const gold = new THREE.MeshStandardMaterial({
      color: 0xd9b45c, metalness: 1, roughness: 1,
      roughnessMap: goldMaps.roughnessMap, normalMap: goldMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.35,
    });
    const goldDarkMaps = brushedGoldTextures("dark", 2, 2);
    const goldDark = new THREE.MeshStandardMaterial({
      color: 0x9a7a24, metalness: 1, roughness: 1,
      roughnessMap: goldDarkMaps.roughnessMap, normalMap: goldDarkMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.9,
      emissive: GOLD_DEEP, emissiveIntensity: look.theme === "dark" ? 0.18 : 0.05,
    });
    /* The shared prop marble: nominal 2 m surface (columns, stage,
     * monument, troughs — all in that size class). Big flat runs
     * (walls, ceilings, plaza walls) go through the *For factories
     * so their repeat matches their real size. */
    const marble = marbleSurface("marble", 2, 2, { envMapIntensity: 0.7, metalness: 0.06 });
    const marbleWall = marbleSurface("marble-rough", 28.8, 6.5, { envMapIntensity: 0.55 });
    const ceilingTint = look.theme === "light" ? 0xe9dfc8 : 0x59503f;
    const ceiling = marbleSurface("marble-rough", 28, 30, { color: ceilingTint, envMapIntensity: 0.55 });
    const fabricRep = repeatForSize(1.8, 1.8, FABRIC_METRES_PER_TILE);
    const fabricPbr = derivedPbrTextures(look.throneFabricTextureUrl, "fabric", fabricRep.x, fabricRep.y);
    const fabric = new THREE.MeshStandardMaterial({
      map: hallTexture(look.throneFabricTextureUrl, fabricRep.x, fabricRep.y),
      normalMap: fabricPbr.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: fabricPbr.roughnessMap, roughness: 1,
      aoMap: fabricPbr.aoMap,
      metalness: 0, envMapIntensity: 0.5,
    });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.55, metalness: 0.5 });
    return {
      gold, goldDark, marble, marbleWall, ceiling, fabric, darkMetal,
      wallFor: sized("wall", "marble-rough", { envMapIntensity: 0.55 }),
      marbleFor: sized("marble", "marble", { envMapIntensity: 0.7, metalness: 0.06 }),
      ceilingFor: sized("ceiling", "marble-rough", { color: ceilingTint, envMapIntensity: 0.55 }),
    };
  }

  private buildLook(group: THREE.Group, look: HallLook): void {
    const mats = this.makeMaterials(look);
    const anim: LookAnim = { flames: [], flickerLights: [], dust: null, smokes: [], embers: [], lanternGlows: [] };
    this.monumentFaceMats = [];
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
    this.buildRoomShells(group, look, mats, anim);
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
    /* Per-metre repeat (item 7): the 28×30 m floor samples the same
     * texel density as every other marble surface. The polished
     * floor's roughness lives in its derived map (marble-floor kind:
     * ~0.10 field, rougher veins) — roughness scalar 1, no bumpMap:
     * the normal map carries the relief now (item 9). */
    const floorRep = repeatForSize(28, 30, MARBLE_METRES_PER_TILE);
    const floorMap = hallTexture(look.marbleTextureUrl, floorRep.x, floorRep.y);
    const floorPbr = derivedPbrTextures(look.marbleTextureUrl, "marble-floor", floorRep.x, floorRep.y);
    for (const t of [floorPbr.normalMap, floorPbr.roughnessMap, floorPbr.aoMap]) t.anisotropy = maxTextureAnisotropy;
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 30),
      new THREE.MeshPhysicalMaterial({
        map: floorMap,
        normalMap: floorPbr.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
        roughnessMap: floorPbr.roughnessMap, aoMap: floorPbr.aoMap,
        transparent: true, opacity: q.reflectorSize > 0 ? look.floorOverlayOpacity : 0.97,
        roughness: 1, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3,
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

  /** One run of palace wall along X (at depth z) or along Z (at
   *  depth x), from `from` to `to`, spanning heights y0..y1 —
   *  full-height runs and the lintels over doorways share the code.
   *  `inward` points into the room the wall dresses: the gold trim
   *  line (at 5.7, running unbroken over the lintels) and the base
   *  sit on that face. (The v1 hall placed the back and east walls'
   *  trim on the far side, inside/outside the wall where no one
   *  could see it; the palace puts every wall's trim on its room
   *  face — the courtyard and the Create Wing made the far sides
   *  visible, and floating trim would have hung in their air.) */
  private wallRunX(
    group: THREE.Group, mats: LookMaterials,
    z: number, from: number, to: number, y0: number, y1: number, inward: 1 | -1,
  ): void {
    const len = to - from;
    if (len <= 0.01 || y1 <= y0) return;
    const cx = (from + to) / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, 0.4), mats.wallFor(len, y1 - y0));
    wall.position.set(cx, y0 + (y1 - y0) / 2, z);
    wall.receiveShadow = QUALITY[this.quality].shadows;
    group.add(wall);
    if (y0 <= 5.7 && y1 >= 5.7) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.06), mats.gold);
      trim.position.set(cx, 5.7, z + inward * 0.24);
      group.add(trim);
    }
    if (y0 === 0) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 0.05), mats.goldDark);
      base.position.set(cx, 0.16, z + inward * 0.23);
      group.add(base);
    }
  }

  private wallRunZ(
    group: THREE.Group, mats: LookMaterials,
    x: number, from: number, to: number, y0: number, y1: number, inward: 1 | -1,
  ): void {
    const len = to - from;
    if (len <= 0.01 || y1 <= y0) return;
    const cz = (from + to) / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, y1 - y0, len), mats.wallFor(len, y1 - y0));
    wall.position.set(x, y0 + (y1 - y0) / 2, cz);
    wall.receiveShadow = QUALITY[this.quality].shadows;
    group.add(wall);
    if (y0 <= 5.7 && y1 >= 5.7) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, len), mats.gold);
      trim.position.set(x + inward * 0.24, 5.7, cz);
      group.add(trim);
    }
    if (y0 === 0) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, len), mats.goldDark);
      base.position.set(x + inward * 0.23, 0.16, cz);
      group.add(base);
    }
  }

  /** The gold arch around a doorway in a wall running along Z (at
   *  depth x): two jambs and a header, proud of both faces — the
   *  same arch dresses the doorway from either room. */
  private doorArchZ(group: THREE.Group, mats: LookMaterials, x: number, spanMin: number, spanMax: number): void {
    const dh = PALACE_DOOR_HEIGHT;
    for (const z of [spanMin - 0.1, spanMax + 0.1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.56, dh, 0.2), mats.gold);
      jamb.position.set(x, dh / 2, z);
      group.add(jamb);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, spanMax - spanMin + 0.4), mats.gold);
    header.position.set(x, dh + 0.13, (spanMin + spanMax) / 2);
    group.add(header);
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.02, spanMax - spanMin), mats.goldDark);
    threshold.position.set(x, 0.012, (spanMin + spanMax) / 2);
    group.add(threshold);
  }

  /** The gold arch around a doorway in a wall running along X. */
  private doorArchX(group: THREE.Group, mats: LookMaterials, z: number, spanMin: number, spanMax: number): void {
    const dh = PALACE_DOOR_HEIGHT;
    for (const x of [spanMin - 0.1, spanMax + 0.1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.2, dh, 0.56), mats.gold);
      jamb.position.set(x, dh / 2, z);
      group.add(jamb);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(spanMax - spanMin + 0.4, 0.26, 0.56), mats.gold);
    header.position.set((spanMin + spanMax) / 2, dh + 0.13, z);
    group.add(header);
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(spanMax - spanMin, 0.02, 0.95), mats.goldDark);
    threshold.position.set((spanMin + spanMax) / 2, 0.012, z);
    group.add(threshold);
  }

  /** A doorway's name plate, hung over the arch on the face the
   *  `rotY` turns it toward. */
  private doorPlate(
    group: THREE.Group, text: string, x: number, y: number, z: number, rotY: number, width = 3.4,
  ): void {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(width, (width * 224) / 1024),
      new THREE.MeshBasicMaterial({ map: doorPlateTexture(text), toneMapped: false }),
    );
    plate.position.set(x, y, z);
    plate.rotation.y = rotY;
    group.add(plate);
  }

  private buildWalls(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const H = 6.5;
    const DH = PALACE_DOOR_HEIGHT;
    // The front wall (the stage wall) — solid, as it has always been.
    this.wallRunX(group, mats, -18.2, -14.4, 14.4, 0, H, 1);
    // The back wall — the Courtyard arch pierces it at x ∈ [-2.2, 2.2].
    this.wallRunX(group, mats, 12.2, -14.4, -2.2, 0, H, -1);
    this.wallRunX(group, mats, 12.2, 2.2, 14.4, 0, H, -1);
    this.wallRunX(group, mats, 12.2, -2.2, 2.2, DH, H, -1);
    this.doorArchX(group, mats, 12.2, -2.2, 2.2);
    this.doorPlate(group, "COURTYARD", 0, DH + 0.66, 11.93, Math.PI, 4.2);
    /* The arch's doors stand OPEN (Open World Phase 1): two
     * gold-trimmed dark leaves on the Creator Rooms arch's exact
     * construction (buildCreatorRoomsArch) — a hinged group at
     * each jamb, the slab laid back toward its hinge — swung
     * ~105° into the hall, so each leaf runs diagonally into the
     * hall from its jamb and the doorway reads OPEN from the
     * plaza. The hinges sit on the gold jambs (x ±2.24, inside
     * the jamb span 2.2..2.4), so even the leaves' hinge corners
     * stay at |x| ≥ 2.19 — outside the arch portal (|x| ≤ 2.15)
     * — and the walkway through the arch stays clear; angled
     * leaves touch the wall run only at the hinge line, so
     * nothing z-fights the south-wall segments. */
    {
      const darkSlab = new THREE.MeshStandardMaterial({ color: 0x17110a, roughness: 0.55, metalness: 0.25 });
      for (const sx of [-1, 1] as const) {
        const leaf = new THREE.Group();
        leaf.position.set(sx * 2.24, 0, 12.2);
        leaf.rotation.y = sx * -1.83; // ~105° open, into the hall
        const slab = new THREE.Mesh(new THREE.BoxGeometry(2.14, 3.4, 0.1), darkSlab);
        slab.position.set(sx * -1.07, 1.7, 0);
        leaf.add(slab);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.07, 0.12), mats.gold);
        trim.position.set(sx * -1.07, 3.3, 0);
        leaf.add(trim);
        const handle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mats.gold);
        handle.position.set(sx * -1.9, 1.55, -0.08);
        leaf.add(handle);
        group.add(leaf);
      }
    }
    // The west wall — doors to the Treasury (z = -13.5, front),
    // the Music Hall (z = -2) and the Game Rooms (z = 5).
    this.wallRunZ(group, mats, -14.2, -18.4, -15, 0, H, 1);
    this.wallRunZ(group, mats, -14.2, -12, -3.5, 0, H, 1);
    this.wallRunZ(group, mats, -14.2, -0.5, 3.5, 0, H, 1);
    this.wallRunZ(group, mats, -14.2, 6.5, 12.4, 0, H, 1);
    this.wallRunZ(group, mats, -14.2, -15, -12, DH, H, 1);
    this.wallRunZ(group, mats, -14.2, -3.5, -0.5, DH, H, 1);
    this.wallRunZ(group, mats, -14.2, 3.5, 6.5, DH, H, 1);
    this.doorArchZ(group, mats, -14.2, -15, -12);
    this.doorArchZ(group, mats, -14.2, -3.5, -0.5);
    this.doorArchZ(group, mats, -14.2, 3.5, 6.5);
    this.doorPlate(group, "TREASURY", -13.93, DH + 0.66, -13.5, Math.PI / 2);
    this.doorPlate(group, "MUSIC HALL", -13.93, DH + 0.66, -2, Math.PI / 2);
    this.doorPlate(group, "GAME ROOMS", -13.93, DH + 0.66, 5, Math.PI / 2);
    // The east wall — doors to the Royal Court Chamber (z = -13.5,
    // front), the Create Wing (z = -2) and the Branding Atelier
    // (z = 5).
    this.wallRunZ(group, mats, 14.2, -18.4, -15, 0, H, -1);
    this.wallRunZ(group, mats, 14.2, -12, -3.5, 0, H, -1);
    this.wallRunZ(group, mats, 14.2, -0.5, 3.5, 0, H, -1);
    this.wallRunZ(group, mats, 14.2, 6.5, 12.4, 0, H, -1);
    this.wallRunZ(group, mats, 14.2, -15, -12, DH, H, -1);
    this.wallRunZ(group, mats, 14.2, -3.5, -0.5, DH, H, -1);
    this.wallRunZ(group, mats, 14.2, 3.5, 6.5, DH, H, -1);
    this.doorArchZ(group, mats, 14.2, -15, -12);
    this.doorArchZ(group, mats, 14.2, -3.5, -0.5);
    this.doorArchZ(group, mats, 14.2, 3.5, 6.5);
    this.doorPlate(group, "ROYAL COURT", 13.93, DH + 0.66, -13.5, -Math.PI / 2);
    this.doorPlate(group, "CREATE WING", 13.93, DH + 0.66, -2, -Math.PI / 2);
    this.doorPlate(group, "BRANDING ATELIER", 13.93, DH + 0.66, 5, -Math.PI / 2);

    if (look.windows) {
      this.buildWindow(group, mats, -9);
      for (const z of [-9, 9.5]) this.buildPanelFrame(group, mats, 1, z);
    } else {
      for (const side of [-1, 1] as const) {
        // The side frames hang at z = -9 and z = 9.5 — clear of
        // every doorway (the z = 5 frame used to cross the Game
        // Rooms door, and would cross the Branding Atelier's too).
        for (const z of [-9, 9.5]) this.buildPanelFrame(group, mats, side, z);
        for (const z of [-5.5, 2.5]) this.buildSconce(group, mats, anim, side, z, side * 13.3);
      }
      for (const x of [-6, 6]) this.buildSconce(group, mats, anim, 0, x, null);
    }
    // The hall's own door-stations (the Kingdom Board, the Post
    // Office) stand against the back wall.
    this.buildStationMarkers(group, mats, HALL_ROOM_ID);
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
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(28, 30), mats.ceilingFor(28, 30));
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

    /* The palace's ONE directional — sun by day, moon by night —
     * re-aimed per area by aimSun() (overhaul stage 3, audit
     * B1/B2/B3: the shipped build aimed it at the hall stage only,
     * with a 40 m shadow box that never covered the plaza, and the
     * dark look had no directional at all, so the night plaza had
     * zero shadow-casting light). Always built; intensity decides
     * whether it shines. aimSun() runs at the end of applyLook and
     * on every room change, so the values set here are just the
     * indoor starting aim. */
    const sun = new THREE.DirectionalLight(look.sun.color, look.sun.present ? look.sun.intensity : 0);
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
    this.sunLight = sun;
    this.sunTarget = sun.target;
  }

  /** Aim the one directional + the fog for the area the visitor
   *  stands in. Indoors: the standing hall rig (window sun by day,
   *  dark at night, hall fog). On the plaza: a real sun over the
   *  grounds by day (or cool moonlight at night) with a shadow
   *  camera fitted to the plaza plan, and outdoor fog distances —
   *  the hall's fog (dark 16–46 m) otherwise swallows the palace
   *  from its own front door (audit C1). One light, re-aimed: no
   *  second shadow pass, no spill into the hall. */
  private aimSun(): void {
    const sun = this.sunLight;
    const tgt = this.sunTarget;
    if (!sun || !tgt) return;
    const look = hallLookFor(this.theme);
    const cam = sun.shadow.camera;
    if (this.currentRoom === COURTYARD_ID && look.sun.present) {
      // Day on the plaza: sun high in the southern sky, so the
      // palace facade and the monument throw real shadows.
      sun.position.set(16, 25, 47);
      tgt.position.set(0, 0, 20);
      sun.color.set(look.sun.color);
      sun.intensity = look.sun.intensity;
      cam.left = -36; cam.right = 36; cam.top = 36; cam.bottom = -36;
      cam.near = 1; cam.far = 120;
    } else if (this.currentRoom === COURTYARD_ID) {
      // Night on the plaza: moonlight — cool, dim, shadow-casting.
      sun.position.set(-14, 27, 42);
      tgt.position.set(0, 0, 20);
      sun.color.set(0x93a7d4);
      sun.intensity = 0.6;
      cam.left = -36; cam.right = 36; cam.top = 36; cam.bottom = -36;
      cam.near = 1; cam.far = 120;
    } else {
      sun.position.set(-13.5, 10.5, -1);
      tgt.position.set(7, 0, -5);
      sun.color.set(look.sun.color);
      sun.intensity = look.sun.present ? look.sun.intensity : 0;
      cam.left = -20; cam.right = 20; cam.top = 20; cam.bottom = -20;
      cam.near = 1; cam.far = 45;
    }
    cam.updateProjectionMatrix();
    tgt.updateMatrixWorld();
    // The casters are static per aim — one fresh shadow render.
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Fog + sun for the current room, called whenever the room or
   *  the look changes. Indoor fog stays exactly the look's; the
   *  plaza gets distances that keep the palace legible from the
   *  promenade (spawn sits ~19 m from the doors). */
  private applyAreaAtmosphere(): void {
    this.aimSun();
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.Fog)) return;
    const look = hallLookFor(this.theme);
    if (this.currentRoom === COURTYARD_ID) {
      fog.near = look.theme === "light" ? 48 : 34;
      fog.far = look.theme === "light" ? 140 : 115;
    } else {
      fog.near = look.fogNear;
      fog.far = look.fogFar;
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
      this.addEmbers(group, anim, x, 0.82, -11.3, `${x},-11.3`);
      if (QUALITY[this.quality].candleLights) {
        const light = new THREE.PointLight(0xff9040, 26, 13, 1.9);
        light.position.set(x, 1.35, -11.3);
        group.add(light);
        anim.flickerLights.push({ light, base: 26, phase: Math.random() * 20 });
      }
    }
  }

  /* ── Night life (item 27) ─────────────────────────────────────
     Embers over a brazier's coals: one Points cloud per brazier,
     its field deterministic in the brazier's position (night-life
     .ts), its count taken from the quality ladder's own spirit —
     the helper is only called in the dark look, and on the low
     rung (no candle point lights) the count is 0 and no cloud is
     built at all. Positions are poured per frame in tick(). */
  private addEmbers(parent: THREE.Group, anim: LookAnim, x: number, y: number, z: number, seedKey: string): void {
    const count = emberCountForTier(this.quality);
    if (count <= 0) return;
    const field = createEmberField(count, seedKey);
    const positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: flameTexture(), size: 0.075, transparent: true, opacity: 0.9, color: 0xffa050,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    points.position.set(x, y, z);
    points.renderOrder = 5;
    parent.add(points);
    anim.embers.push({ points, field });
  }

  /** A lantern glow sprite (item 27): a soft additive halo that
   *  breathes on lanternGlowScale in tick(). Dark look only —
   *  callers gate on look.candles. */
  private addLanternGlow(parent: THREE.Group, anim: LookAnim, x: number, y: number, z: number, base: number, phase: number): void {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTexture(), transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.set(base, base, 1);
    glow.position.set(x, y, z);
    parent.add(glow);
    anim.lanternGlows.push({ sprite: glow, base, phase });
  }

  /** Fake god-rays slanting from the window wall (Look A), with a
   *  warm pool where each beam lands. Only the z = -9 window remains
   *  on the west wall — z = -2 and z = 5 are doorways now, and a beam
   *  pouring from a lintel would read as a mistake, not sunlight. */
  private buildBeams(group: THREE.Group): void {
    const dir = new THREE.Vector3(0.94, -0.34, 0.02).normalize();
    const len = 13.5;
    for (const z of [-9]) {
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

  /* ── The palace rooms (shells) ────────────────────────────────────
     Each room beyond the hall is built to the palace's materials in
     the current look: polished marble floor with the gold inlay,
     marble walls with the trim line, a ceiling with a lantern for
     the indoor rooms, low marble walls and planters for the open
     Courtyard. SHELLS, deliberately: no jukebox, no game tables, no
     desks — each room's features dock in their own lane. The one
     mirror floor stays in the hall (the plan's performance law):
     shells get the polished overlay only, no second Reflector. */

  private buildRoomShells(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    this.shellMats = mats;
    this.shellGroups.clear();
    for (const roomId of [MUSIC_HALL_ID, GAME_ROOMS_ID, CREATE_WING_ID, TREASURY_ID, ROYAL_COURT_ID, BRANDING_ATELIER_ID]) {
      this.buildIndoorShell(group, look, mats, roomId);
    }
    this.buildCourtyardShell(group, look, mats, anim);
    this.buildCreatorRoomShell(group, look, mats);
    this.applyRoomVisibility();
  }

  /** A polished marble floor (no reflector — the hall owns the one
   *  mirror) with the palace's gold inlay border. */
  private shellFloor(
    g: THREE.Group, look: HallLook, mats: LookMaterials,
    rect: { minX: number; maxX: number; minZ: number; maxZ: number },
    kind: PbrKind,
  ): void {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    /* Per-metre repeat (item 7) — the old code rounded w/7 to whole
     * tiles, so every rect snapped to a different texel density.
     * Derived PBR maps ride along (item 9); roughness is encoded
     * in the kind's map, so the scalar is 1. */
    const rep = repeatForSize(w, d, MARBLE_METRES_PER_TILE);
    const map = hallTexture(look.marbleTextureUrl, rep.x, rep.y);
    const pbr = derivedPbrTextures(look.marbleTextureUrl, kind, rep.x, rep.y);
    for (const t of [pbr.normalMap, pbr.roughnessMap, pbr.aoMap]) t.anisotropy = maxTextureAnisotropy;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshPhysicalMaterial({
        map,
        normalMap: pbr.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
        roughnessMap: pbr.roughnessMap, aoMap: pbr.aoMap,
        transparent: true, opacity: 0.97,
        roughness: 1, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.35,
        envMapIntensity: 0.8, depthWrite: false,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.012, cz);
    floor.renderOrder = 2;
    floor.receiveShadow = QUALITY[this.quality].shadows;
    g.add(floor);
    const inset = 0.55;
    const strip = (sw: number, sd: number, x: number, z: number) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.012, sd), mats.goldDark);
      s.position.set(x, 0.02, z);
      g.add(s);
    };
    strip(w - inset * 2, 0.07, cx, rect.minZ + inset);
    strip(w - inset * 2, 0.07, cx, rect.maxZ - inset);
    strip(0.07, d - inset * 2, rect.minX + inset, cz);
    strip(0.07, d - inset * 2, rect.maxX - inset, cz);
  }

  /** A gilt panel frame on a shell's far wall — the palace's wall
   *  language carried into the rooms, empty until dressing lanes. */
  private shellPanelFrame(
    g: THREE.Group, mats: LookMaterials, x: number, z: number, rotY: number,
  ): void {
    const frame = new THREE.Group();
    frame.position.set(x, 0, z);
    frame.rotation.y = rotY;
    const bar = (w: number, h: number, bx: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), mats.goldDark);
      b.position.set(bx, y, 0.03);
      frame.add(b);
    };
    bar(3.2, 0.07, 0, 5.15);
    bar(3.2, 0.07, 0, 1.05);
    bar(0.07, 4.17, -1.6, 3.1);
    bar(0.07, 4.17, 1.6, 3.1);
    g.add(frame);
  }

  /** A hanging lantern at a shell's heart: chain, gilt ring, warm
   *  bulb — and the room's one steady point light on tiers that
   *  carry extra lights (the plan's budget: no room out-lights the
   *  hall; shells get exactly this one). */
  private shellLantern(g: THREE.Group, look: HallLook, x: number, z: number): void {
    const lanternGoldMaps = brushedGoldTextures("bright", 1, 1);
    const matsGold = new THREE.MeshStandardMaterial({
      color: 0xd9b45c, metalness: 1, roughness: 1,
      roughnessMap: lanternGoldMaps.roughnessMap, normalMap: lanternGoldMaps.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
    });
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.1, 6), matsGold);
    chain.position.set(x, 5.95, z);
    g.add(chain);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 28), matsGold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 5.36, z);
    g.add(ring);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: look.houseLight.color, emissiveIntensity: 1.6, roughness: 0.4 }),
    );
    bulb.position.set(x, 5.3, z);
    g.add(bulb);
    if (QUALITY[this.quality].candleLights) {
      const light = new THREE.PointLight(look.houseLight.color, 20, 16, 1.8);
      light.position.set(x, 4.9, z);
      g.add(light);
    }
  }

  private buildIndoorShell(group: THREE.Group, look: HallLook, mats: LookMaterials, roomId: string): void {
    const def = PALACE_LAYOUT[roomId]!;
    const g = new THREE.Group();
    const { interior } = def;
    const cx = (interior.minX + interior.maxX) / 2;
    const cz = (interior.minZ + interior.maxZ) / 2;
    // West-side rooms face east, east-side rooms face west — read
    // off the plan, so a new room needs no builder changes.
    const west = interior.maxX < 0;

    this.shellFloor(g, look, mats, interior, "marble-floor");

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(interior.maxX - interior.minX, interior.maxZ - interior.minZ),
      mats.ceilingFor(interior.maxX - interior.minX, interior.maxZ - interior.minZ),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, 6.5, cz);
    g.add(ceiling);

    // The three walls the hall didn't already build: the outer
    // wall, the front wall, and the back wall — each face 0.2 into
    // the wall band from its interior line, so two rooms sharing a
    // band build the same face twice at the same plane (the Music
    // Hall / Game Rooms wall at z = 3.3 is exactly that) and never
    // leave a gap. Room bands: Music −8.6..3.1, Game 3.5..11.9,
    // Treasury −17.9..−9.2, Create −8.6..3.1, Royal Court
    // −17.9..−9.2, Branding 3.5..11.9.
    if (west) {
      this.wallRunZ(g, mats, -28.4, interior.minZ - 0.2, interior.maxZ + 0.2, 0, 6.5, 1);
      this.wallRunX(g, mats, interior.minZ - 0.2, -28.4, -14.2, 0, 6.5, 1);
      this.wallRunX(g, mats, interior.maxZ + 0.2, -28.4, -14.2, 0, 6.5, -1);
    } else {
      this.wallRunZ(g, mats, 28.4, interior.minZ - 0.2, interior.maxZ + 0.2, 0, 6.5, -1);
      this.wallRunX(g, mats, interior.minZ - 0.2, 14.2, 28.4, 0, 6.5, 1);
      this.wallRunX(g, mats, interior.maxZ + 0.2, 14.2, 28.4, 0, 6.5, -1);
    }

    // The way back, labeled from inside: the plate names the hall.
    const door = PALACE_DOORS.find((d) => d.roomId === roomId)!;
    const doorCenter = (door.spanMin + door.spanMax) / 2;
    if (west) this.doorPlate(g, "THE KING'S HALL", -14.52, PALACE_DOOR_HEIGHT + 0.66, doorCenter, -Math.PI / 2);
    else this.doorPlate(g, "THE KING'S HALL", 14.52, PALACE_DOOR_HEIGHT + 0.66, doorCenter, Math.PI / 2);

    this.shellLantern(g, look, cx, cz);
    // One empty gilt frame on the far wall — the room's first wall
    // dressing, waiting for its lane like everything else here.
    if (west) this.shellPanelFrame(g, mats, interior.minX + 0.06, cz, Math.PI / 2);
    else this.shellPanelFrame(g, mats, interior.maxX - 0.06, cz, -Math.PI / 2);

    // The room's door-stations: walk up, and the feature opens.
    this.buildStationMarkers(g, mats, roomId);

    group.add(g);
    this.shellGroups.set(roomId, g);
  }

  /** The Creator Room shell (Ring 2, 3.5): the ONE template every
   *  creator's room stands in — the palace's indoor language
   *  (marble floor with the gold inlay, ceiling, lantern) turned
   *  south of the Courtyard, its north wall pierced by the arch
   *  doorway. The shell itself is anonymous; the host's dressing
   *  (name, accent, portrait, screen) is applied into a dedicated
   *  subgroup by applyCreatorDressing, so a theme re-skin rebuilds
   *  the shell and the dressing re-lands on top. The screen on the
   *  south wall is the room's own — gilt-framed, fed by the room's
   *  featured video through a local video element (see
   *  setCreatorRoomDressing); it is NOT the hall's screen and no
   *  hall resolver ever hears about it. */
  private buildCreatorRoomShell(group: THREE.Group, look: HallLook, mats: LookMaterials): void {
    const g = new THREE.Group();
    const t = CREATOR_ROOM_TEMPLATE;
    const { interior } = t;
    const cx = (interior.minX + interior.maxX) / 2;
    const cz = (interior.minZ + interior.maxZ) / 2;
    const H = 6.5;
    const DH = PALACE_DOOR_HEIGHT;
    const door = t.door;

    this.shellFloor(g, look, mats, interior, "marble-floor");

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(interior.maxX - interior.minX, interior.maxZ - interior.minZ),
      mats.ceilingFor(interior.maxX - interior.minX, interior.maxZ - interior.minZ),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, H, cz);
    g.add(ceiling);

    // North wall (the Courtyard's south face) with the arch gap.
    this.wallRunX(g, mats, interior.minZ - 0.2, interior.minX - 0.4, door.spanMin, 0, H, 1);
    this.wallRunX(g, mats, interior.minZ - 0.2, door.spanMax, interior.maxX + 0.4, 0, H, 1);
    this.wallRunX(g, mats, interior.minZ - 0.2, door.spanMin, door.spanMax, DH, H, 1);
    this.doorArchX(g, mats, interior.minZ - 0.2, door.spanMin, door.spanMax);
    // South wall (the screen's wall) and the two side walls.
    this.wallRunX(g, mats, interior.maxZ + 0.2, interior.minX - 0.4, interior.maxX + 0.4, 0, H, -1);
    this.wallRunZ(g, mats, interior.minX - 0.2, interior.minZ - 0.2, interior.maxZ + 0.2, 0, H, 1);
    this.wallRunZ(g, mats, interior.maxX + 0.2, interior.minZ - 0.2, interior.maxZ + 0.2, 0, H, -1);

    /* No static plate over this door: the spot belongs to the
     * host's name (the dressing lays it) — an anonymous template
     * wears nothing there, and the arch outside already says
     * whose wing this is. */

    this.shellLantern(g, look, cx, cz);
    // Gilt frames on the side walls — the room's walls carry the
    // host's work (the dressing fills the west one with their
    // portrait; the east waits for their next piece, honestly
    // empty like the fixed rooms' first frames were).
    this.shellPanelFrame(g, mats, interior.minX + 0.06, cz, Math.PI / 2);
    this.shellPanelFrame(g, mats, interior.maxX - 0.06, cz, -Math.PI / 2);

    // The room's screen: a gilt-framed plane on the south wall.
    // Its material is rebuilt with the shell (a theme flip
    // re-skins the frame too); the video texture survives in its
    // field and is re-attached here when one is live.
    const screenMat = new THREE.MeshBasicMaterial({
      map: this.creatorScreenTexture ?? creatorScreenIdleTexture(this.creatorDressing?.displayName),
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.5), screenMat);
    screen.position.set(cx, 3.15, interior.maxZ - 0.06);
    screen.rotation.y = Math.PI;
    g.add(screen);
    this.creatorScreenMesh = screen;
    const bar = (w: number, h: number, bx: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), mats.gold);
      b.position.set(bx, y, interior.maxZ - 0.02);
      g.add(b);
    };
    bar(5.95, 0.16, cx, 4.48);
    bar(5.95, 0.16, cx, 1.82);
    bar(0.16, 2.82, cx - 2.88, 3.15);
    bar(0.16, 2.82, cx + 2.88, 3.15);

    // The template's door-stations (markers are name plates only —
    // the slug in the key is a placeholder; the registry answers
    // the real room id with the same four doors).
    this.buildStationMarkers(g, mats, "creator:template");

    // The host's dressing subgroup — rebuilt per host.
    this.creatorDressingGroup = new THREE.Group();
    g.add(this.creatorDressingGroup);
    if (this.creatorDressing) this.applyCreatorDressing(mats);

    group.add(g);
    this.shellGroups.set(CREATOR_SHELL_KEY, g);
  }

  /** Dress the template as its host's BASE: their name over the
   *  door, their accent on the runner and the screen banners,
   *  their portrait in the west frame. Called by the page when a
   *  creator room is entered (the room-data read carries
   *  everything); null clears back to the anonymous template. */
  setCreatorRoomDressing(
    dressing: {
      displayName: string;
      roomName: string;
      accentHex: string;
      primaryHex: string;
      portraitUrl: string | null;
      screenVideoUrl: string | null;
      rankLine?: string | null;
      tierTrimHex?: string | null;
      /* The owner's dressing choice (Ring 4): the picked template
       * variant as scene parameters — palette treatment, trim
       * style, banner style (lib/world/creator-room-dressing.ts,
       * resolved server-side onto the room DTO). Absent — every
       * caller that doesn't carry a dressing — wears the classic
       * tuple, the Phase 5 rendering exactly. */
      palette?: "house" | "inverted" | "gilded";
      trimStyle?: "bar" | "double" | "crown";
      bannerStyle?: "flank" | "trio" | "none";
    } | null,
  ): void {
    this.creatorDressing = dressing;
    this.setCreatorRoomScreen(dressing?.screenVideoUrl ?? null, dressing?.displayName);
    /* The shell may not be built yet (first entry races the first
     * look build) — buildCreatorRoomShell applies the dressing
     * when it lands, with the look's own materials. */
    if (this.creatorDressingGroup && this.shellMats) {
      this.applyCreatorDressing(this.shellMats);
    }
  }

  /** (Re)build the dressing subgroup from the current host. The
   *  old subgroup's contents are disposed — a host change never
   *  leaves the previous creator's colors on the walls. */
  private applyCreatorDressing(mats: LookMaterials): void {
    const host = this.creatorDressingGroup;
    if (!host) return;
    while (host.children.length > 0) {
      const child = host.children[0]!;
      host.remove(child);
      disposeObjectTree(child);
    }
    const d = this.creatorDressing;
    if (!d) return;
    const t = CREATOR_ROOM_TEMPLATE;
    const { interior } = t;
    const cx = (interior.minX + interior.maxX) / 2;

    // Their name over the door, inside — you are in THEIR place.
    // (Just proud of the wall's inner face, the house plate offset.)
    this.doorPlate(host, d.roomName.toUpperCase(), cx, PALACE_DOOR_HEIGHT + 0.66, interior.minZ + 0.13, 0, 5.2);

    /* The room's evolution (Ring 3, Phase 5): under the name, the
     * rank plate — the owner's earned stars + rung, composed from
     * the server DTO — and above it a trim bar in the tier's own
     * gold, which deepens as the room levels. An unmeasured room
     * (no evolution on the DTO) wears neither: no fake rank. */
    if (d.rankLine) {
      this.doorPlate(host, d.rankLine, cx, PALACE_DOOR_HEIGHT + 0.08, interior.minZ + 0.13, 0, 4.2);
      if (d.tierTrimHex) {
        const trimMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(d.tierTrimHex),
          roughness: 0.35,
          metalness: 0.6,
        });
        const trimBar = (width: number, height: number, y: number) => {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.05), trimMat);
          bar.position.set(cx, y, interior.minZ + 0.1);
          host.add(bar);
        };
        /* The variant's trim style (Ring 4): "bar" is the Phase 5
         * single bar; "double" stacks a second over it; "crown"
         * wears one wider, taller bar. */
        if (d.trimStyle === "crown") {
          trimBar(6.4, 0.14, PALACE_DOOR_HEIGHT + 1.16);
        } else {
          trimBar(5.2, 0.07, PALACE_DOOR_HEIGHT + 1.12);
          if (d.trimStyle === "double") trimBar(5.2, 0.07, PALACE_DOOR_HEIGHT + 1.34);
        }
      }
    }

    /* The variant's palette treatment (Ring 4): "house" deals the
     * hues as Phase 5 did — runner in accent, banners in primary;
     * "inverted" swaps the two; "gilded" keeps the runner and
     * dresses the banners in the tier's own gold (the theme
     * primary stands in for an unmeasured room). */
    const palette = d.palette ?? "house";
    const runnerMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette === "inverted" ? d.primaryHex : d.accentHex),
      roughness: 0.85,
      metalness: 0.05,
    });
    const bannerMat =
      palette === "gilded"
        ? new THREE.MeshStandardMaterial({
            color: new THREE.Color(d.tierTrimHex ?? d.primaryHex),
            roughness: 0.35,
            metalness: 0.6,
          })
        : new THREE.MeshStandardMaterial({
            color: new THREE.Color(palette === "inverted" ? d.accentHex : d.primaryHex),
            roughness: 0.6,
            metalness: 0.25,
          });
    // The runner: door to screen, in their accent.
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 8.6), runnerMat);
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(cx, 0.018, 32.4);
    runner.renderOrder = 2;
    host.add(runner);
    /* The variant's banner style (Ring 4): "flank" is the Phase 5
     * pair flanking the screen; "trio" adds a third on the east
     * wall; "none" leaves the walls bare — the runner carries the
     * room's color alone. */
    const bannerStyle = d.bannerStyle ?? "flank";
    if (bannerStyle !== "none") {
      // Banners in their primary, flanking the screen.
      for (const bx of [cx - 3.9, cx + 3.9]) {
        const banner = new THREE.Mesh(new THREE.BoxGeometry(0.95, 3.1, 0.06), bannerMat);
        banner.position.set(bx, 3.5, interior.maxZ - 0.1);
        host.add(banner);
        const rod = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.09), mats.gold);
        rod.position.set(bx, 5.1, interior.maxZ - 0.1);
        host.add(rod);
      }
      if (bannerStyle === "trio") {
        const midZ = (interior.minZ + interior.maxZ) / 2;
        const banner = new THREE.Mesh(new THREE.BoxGeometry(0.95, 3.1, 0.06), bannerMat);
        banner.position.set(interior.maxX - 0.1, 3.5, midZ);
        banner.rotation.y = Math.PI / 2;
        host.add(banner);
        const rod = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.09), mats.gold);
        rod.position.set(interior.maxX - 0.1, 5.1, midZ);
        rod.rotation.y = Math.PI / 2;
        host.add(rod);
      }
    }
    // Their portrait in the west frame: the creator's own image,
    // standing in their room whether or not they're home — their
    // place stands. A failed load leaves the gilt frame honestly
    // empty rather than a broken texture.
    if (d.portraitUrl) {
      const portraitMat = new THREE.MeshBasicMaterial({ color: 0x14100a });
      const portrait = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 3.3), portraitMat);
      portrait.position.set(interior.minX + 0.1, 3.1, (interior.minZ + interior.maxZ) / 2);
      portrait.rotation.y = Math.PI / 2;
      host.add(portrait);
      new THREE.TextureLoader().load(
        d.portraitUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          portraitMat.map = tex;
          portraitMat.color.set(0xffffff);
          portraitMat.needsUpdate = true;
        },
        undefined,
        () => undefined,
      );
    }
  }

  /** The room screen's feed: the host's featured video, looping
   *  muted like every ambient screen (the panel's player carries
   *  the sound and the transport). A null url parks the screen on
   *  its idle card. Entirely local — the hall's screen element,
   *  texture and resolvers are separate machinery. */
  private setCreatorRoomScreen(url: string | null, hostName?: string): void {
    const key = url ?? "";
    if (key === this.creatorScreenUrl && url !== null) return;
    this.creatorScreenUrl = key;
    if (!url) {
      this.creatorScreenVideo?.pause();
      if (this.creatorScreenTexture) {
        this.creatorScreenTexture.dispose();
        this.creatorScreenTexture = null;
      }
      if (this.creatorScreenMesh) {
        const mat = this.creatorScreenMesh.material as THREE.MeshBasicMaterial;
        if (mat.map && mat.map !== this.creatorScreenTexture) mat.map.dispose();
        mat.map = creatorScreenIdleTexture(hostName);
        mat.needsUpdate = true;
      }
      return;
    }
    if (!this.creatorScreenVideo) {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      this.creatorScreenVideo = video;
    }
    const video = this.creatorScreenVideo;
    video.src = url;
    if (!this.creatorScreenTexture) {
      this.creatorScreenTexture = new THREE.VideoTexture(video);
      this.creatorScreenTexture.colorSpace = THREE.SRGBColorSpace;
    }
    if (this.creatorScreenMesh) {
      const mat = this.creatorScreenMesh.material as THREE.MeshBasicMaterial;
      mat.map = this.creatorScreenTexture;
      mat.needsUpdate = true;
    }
    void video.play().catch(() => undefined);
  }

  /** The access layer made physical: one marker per door-station
   *  (lib/world/stations) — a gold ring on the floor and the
   *  station's name plate floating over it, in the house plate
   *  style. The page reads the same registry for the walk-up
   *  prompt, so the marker and the prompt can never disagree
   *  about where a door stands. No lights, no new textures: the
   *  plate reuses the doorway plates' canvas. */
  private buildStationMarkers(group: THREE.Group, mats: LookMaterials, roomId: string): void {
    for (const s of stationsInRoom(roomId)) {
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.045, 8, 40), mats.gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.035;
      g.add(ring);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.8, 32),
        new THREE.MeshStandardMaterial({
          color: 0xd4af37, transparent: true, opacity: 0.13, roughness: 0.4, metalness: 0.6, depthWrite: false,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.025;
      g.add(disc);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), mats.gold);
      gem.position.y = 1.55;
      g.add(gem);
      const plate = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: doorPlateTexture(s.name.toUpperCase()), transparent: true, depthWrite: false }),
      );
      plate.scale.set(2.3, (2.3 * 224) / 1024, 1);
      plate.position.y = 2.15;
      g.add(plate);
      group.add(g);
    }
  }

  private buildCourtyardShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const def = PALACE_LAYOUT[COURTYARD_ID]!;
    const g = new THREE.Group();
    const { interior } = def;

    /* Floors (Open World Phase 1): the plaza's interior now spans
     * z to 34 across the full width, but the Creator Room template
     * owns its own floor south-east (interior x 2.6..16.4,
     * z 26.4..38) — one rect over both would z-fight it. Tile
     * instead: the main grounds, then the promenade, abutting at
     * z 26 with no overlap. Same rough outdoor finish as before. */
    this.shellFloor(g, look, mats, { minX: -28.2, maxX: 28.2, minZ: 12.4, maxZ: 26.0 }, "marble-rough");
    this.shellFloor(g, look, mats, { minX: -28.2, maxX: 2.6, minZ: 26.0, maxZ: 34.0 }, "marble-rough");
    /* The south-east patch (overhaul stage 3): east of the Creator
     * Room's floor and south of the main grounds, the shipped plan
     * laid NO floor at all — background void showed under the east
     * lawn's edge. This rect abuts the creator floor (x 16.4) and
     * the main grounds (z 26) without overlapping either. */
    this.shellFloor(g, look, mats, { minX: 16.4, maxX: 28.2, minZ: 26.0, maxZ: 34.0 }, "marble-rough");

    // Low marble walls with a gold cap on the open sides (the
    // fourth side is the hall's own back wall + the arch through
    // it), rebuilt for the plaza plan. Two gates pierce them: a
    // 2.2 m gap in the west wall at z ≈ 19.5 (Stage Grounds) and
    // one in the south promenade wall at x ≈ 0 (the Boardwalk) —
    // the walk rects end at ±27.85 / 33.6, so no gap can ever be
    // walked through; each gate's gold bar (below) makes the
    // closure visible. There is NO wall along z 26: the grounds
    // flow into the promenade, and the Creator Rooms arch area
    // (x 8.45..10.55 at z ≈ 26) stays open as it was.
    const lowWall = (w: number, d: number, x: number, z: number) => {
      /* The long runs (up to 27 m) get a per-metre material — the
       * shared prop marble would stretch one tile across the whole
       * promenade wall (item 7). */
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1.05, d), mats.marbleFor(Math.max(w, d), 1.05));
      wall.position.set(x, 0.525, z);
      wall.castShadow = QUALITY[this.quality].shadows;
      g.add(wall);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w === 0.35 ? 0.47 : w, 0.07, d === 0.35 ? 0.47 : d), mats.gold);
      cap.position.set(x, 1.09, z);
      g.add(cap);
    };
    // West wall x −28.2, z 12.4..34, split by the Stage Grounds gap.
    lowWall(0.35, 6.0, -28.2, 15.4);
    lowWall(0.35, 13.4, -28.2, 27.3);
    // East wall x 28.2, z 12.4..26.0 (beyond that is the creator wing).
    lowWall(0.35, 13.6, 28.2, 19.2);
    // South wall z 34.0 across the promenade span, split by the
    // Boardwalk gap at x −1.1..1.1.
    lowWall(27.1, 0.35, -14.65, 34.0);
    lowWall(1.25, 0.35, 1.725, 34.0);

    // Columns where the walls turn: plinth, marble shaft, gold cap —
    // the hall's column language at garden scale, moved to the
    // plaza's new corners (with a mid-wall column on each long side).
    // Variation (item 18): each column takes its deterministic
    // jitter — a breath of scale, its own marble tint (a cloned
    // material), and one of three cap treatments — so the six stop
    // reading as one column stamped six times. They stand ON the
    // wall line, so they never yaw (prop-variation's envelope).
    const column = (x: number, z: number, index: number) => {
      const v = propVariation("column", index);
      const col = new THREE.Group();
      col.position.set(x, 0, z);
      col.scale.set(v.scale, v.scaleY, v.scale);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.9), mats.marble);
      plinth.position.y = 1.13;
      col.add(plinth);
      const shaftMat = mats.marble.clone();
      shaftMat.color.offsetHSL(v.hueShift, 0, v.lightnessShift);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.62, 2.6, 0.62), shaftMat);
      shaft.position.y = 2.54;
      shaft.castShadow = QUALITY[this.quality].shadows;
      col.add(shaft);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 0.18, 0.86),
        v.variant === 2 ? mats.goldDark : mats.gold,
      );
      cap.position.y = 3.93;
      col.add(cap);
      if (v.variant === 1) {
        const capStep = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.09, 0.72), mats.goldDark);
        capStep.position.y = 3.79;
        col.add(capStep);
      }
      g.add(col);
    };
    column(-28.2, interior.minZ + 0.2, 0);
    column(28.2, interior.minZ + 0.2, 1);
    column(-28.2, interior.maxZ - 0.2, 2);
    column(2.35, interior.maxZ, 3);
    column(-28.2, 23.2, 4);
    column(28.2, 19.2, 5);

    /* Lawn panels on the east and west grounds — flat green fields
     * flanking the marble heart of the plaza (the centre,
     * |x| ≤ 6.5, stays marble). The green follows the look the way
     * the braziers follow look.candles: deep in the midnight look
     * (candles lit), a rich grass green in the golden-hour look. */
    const lawnMat = new THREE.MeshStandardMaterial({
      color: look.candles ? 0x1f4d26 : 0x478f36, roughness: 1, metalness: 0,
    });
    for (const sx of [-1, 1] as const) {
      const lawn = new THREE.Mesh(new THREE.BoxGeometry(20.5, 0.05, 11.0), lawnMat);
      lawn.position.set(sx * 16.75, 0.025, 19.2);
      lawn.receiveShadow = QUALITY[this.quality].shadows;
      g.add(lawn);
    }

    /* The marble path: from the hall arch (0, 12.4) south through
     * the monument to the Boardwalk gate (0, 34) — a marble slab
     * with gold edge strips, in the floor inlay's language. Two
     * runs abutting the monument plinth (z 18.0 / 21.4), so the
     * path reads as running through the monument's ground ring. */
    const pathRun = (fromZ: number, toZ: number) => {
      const len = toZ - fromZ;
      const pcz = (fromZ + toZ) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.016, len), mats.marble);
      slab.position.set(0, 0.022, pcz);
      g.add(slab);
      for (const sx of [-1.72, 1.72]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, len), mats.goldDark);
        strip.position.set(sx, 0.028, pcz);
        g.add(strip);
      }
    };
    pathRun(12.4, 18.0);
    pathRun(21.4, 34.0);

    /* ── The Kingdom Board monument (0, 19.7), plaza centre ──────
     * A stepped marble plinth, a gold-trimmed stele ~3.2 m tall,
     * gold finials at the plinth corners, and a gold ring inlay in
     * the ground around it. The stele's plate drum — a square
     * marble housing at reading height — wears the board's
     * lettered plate on ALL FOUR faces (item 16): the words are
     * the board's real headlines (monument-board.ts), the same
     * canvas whichever way a walker approaches, repainted through
     * setMonumentBoardData when the board's reads change. The
     * live board itself still opens in the station panel at the
     * board station (its marker stands on the open plaza just
     * south of the plinth, built by buildStationMarkers like
     * every station). No mirror, no lights of its own. */
    {
      const monument = new THREE.Group();
      monument.position.set(0, 0, 19.7);
      const tier1 = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 3.4), mats.marble);
      tier1.position.y = 0.11;
      tier1.castShadow = QUALITY[this.quality].shadows;
      monument.add(tier1);
      const tierTrim = new THREE.Mesh(new THREE.BoxGeometry(3.55, 0.05, 3.55), mats.goldDark);
      tierTrim.position.y = 0.245;
      monument.add(tierTrim);
      const tier2 = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.22, 2.5), mats.marble);
      tier2.position.y = 0.38;
      monument.add(tier2);
      const stele = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.2, 0.42), mats.marble);
      stele.position.y = 0.49 + 1.6;
      stele.castShadow = QUALITY[this.quality].shadows;
      monument.add(stele);
      for (const trimY of [0.56, 3.62]) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.09, 0.5), mats.gold);
        trim.position.y = trimY;
        monument.add(trim);
      }
      const crownCap = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.5, 4), mats.gold);
      crownCap.rotation.y = Math.PI / 4;
      crownCap.position.y = 3.94;
      monument.add(crownCap);
      /* The plate drum: a square housing around the stele at
       * reading height, so the plate has four equal faces to
       * live on (the stele's own section, 1.6 × 0.42, could only
       * ever letter two). One shared texture — the board reads
       * the same from every approach — re-mapped in place by
       * setMonumentBoardData when the words change. */
      const drum = new THREE.Mesh(new THREE.BoxGeometry(1.74, 2.1, 1.74), mats.marble);
      drum.position.y = 2.09;
      drum.castShadow = QUALITY[this.quality].shadows;
      monument.add(drum);
      const plateTex = kingdomBoardPlateTexture(look.theme);
      for (const [fx, fz, rotY] of [
        [0, 0.88, 0],
        [0, -0.88, Math.PI],
        [0.88, 0, Math.PI / 2],
        [-0.88, 0, -Math.PI / 2],
      ] as Array<[number, number, number]>) {
        const faceMat = new THREE.MeshBasicMaterial({ map: plateTex, toneMapped: false });
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.96), faceMat);
        face.position.set(fx, 2.09, fz);
        face.rotation.y = rotY;
        monument.add(face);
        this.monumentFaceMats.push(faceMat);
      }
      for (const fx of [-1.5, 1.5]) {
        for (const fz of [-1.5, 1.5]) {
          const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mats.gold);
          finial.position.set(fx, 0.31, fz);
          monument.add(finial);
        }
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.65, 56), mats.goldDark);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.016;
      ring.renderOrder = 3;
      monument.add(ring);
      g.add(monument);
    }

    // Planters along the side walls and down the promenade: marble
    // troughs, green crowns — the original construction, spread to
    // the plaza's new scale (nine in all). Geometries are shared.
    // Variation (item 18): every trough and crown takes its
    // deterministic jitter from prop-variation.ts — crowns turn
    // freely, stretch tall or squat, and wear their own tinted
    // leaf material; troughs breathe in scale and take one of
    // three rim treatments (plain, gold trim, dark trim). The
    // ninth planter is not a clone of the first, on any visit.
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 1, metalness: 0, flatShading: true });
    const troughGeoZ = new THREE.BoxGeometry(0.72, 0.55, 2.0);
    const troughGeoX = new THREE.BoxGeometry(2.0, 0.55, 0.72);
    const crownGeo = new THREE.IcosahedronGeometry(0.44, 1);
    let planterIndex = 0;
    const planter = (x: number, z: number, alongZ: boolean) => {
      const index = planterIndex++;
      const tv = propVariation("trough", index);
      const trough = new THREE.Mesh(alongZ ? troughGeoZ : troughGeoX, mats.marble);
      trough.position.set(x, 0.275, z);
      trough.rotation.y = tv.rotY;
      trough.scale.setScalar(tv.scale);
      g.add(trough);
      if (tv.variant !== 0) {
        const trim = new THREE.Mesh(
          alongZ ? new THREE.BoxGeometry(0.78, 0.05, 2.06) : new THREE.BoxGeometry(2.06, 0.05, 0.78),
          tv.variant === 1 ? mats.gold : mats.goldDark,
        );
        trim.position.set(x, 0.56, z);
        trim.rotation.y = tv.rotY;
        trim.scale.setScalar(tv.scale);
        g.add(trim);
      }
      [-0.5, 0.5].forEach((off, ci) => {
        const cv = propVariation("crown", index * 2 + ci);
        const crownMat = leafMat.clone();
        crownMat.color.offsetHSL(cv.hueShift, 0, cv.lightnessShift);
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.set(alongZ ? x : x + off, 0.82, alongZ ? z + off : z);
        crown.rotation.y = cv.rotY;
        crown.scale.set(cv.scale, cv.scale * cv.scaleY, cv.scale);
        crown.castShadow = QUALITY[this.quality].shadows;
        g.add(crown);
      });
    };
    planter(-27.3, 15.8, true);
    planter(-27.3, 22.6, true);
    planter(27.3, 15.8, true);
    planter(27.3, 22.6, true);
    planter(-27.3, 28.8, true);
    planter(-27.3, 32.3, true);
    planter(2.2, 29.5, true);
    planter(-20, 33.1, false);
    planter(-8, 33.1, false);

    // Braziers in the dark look — the courtyard burns at night.
    // The original pair keeps its place; a second pair flanks the
    // monument. Point lights only on tiers that carry them, as
    // everywhere in the hall; flames ride anim.flames as always.
    if (look.candles) {
      const bronze = new THREE.MeshStandardMaterial({ color: 0x4a3418, metalness: 0.85, roughness: 0.4 });
      for (const [bx, bz] of [[-4.6, 18.6], [4.6, 18.6], [-3.4, 19.7], [3.4, 19.7]] as Array<[number, number]>) {
        const brazier = new THREE.Group();
        brazier.position.set(bx, 0, bz);
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.5, 10), mats.darkMetal);
        pedestal.position.y = 0.25;
        brazier.add(pedestal);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.18, 0.3, 18), bronze);
        bowl.position.y = 0.65;
        brazier.add(bowl);
        /* Coals + halo, the hall braziers' full build (overhaul
         * stage 3, audit D3: the courtyard set was a downgrade —
         * flame sprite only, reading as a glow dot). */
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
        g.add(brazier);
        this.addEmbers(g, anim, bx, 0.82, bz, `${bx},${bz}`);
        if (QUALITY[this.quality].candleLights) {
          const light = new THREE.PointLight(0xff9040, 22, 12, 1.9);
          light.position.set(bx, 1.35, bz);
          g.add(light);
          anim.flickerLights.push({ light, base: 22, phase: Math.random() * 20 });
        }
      }
    }

    /* ── District thresholds (Phase-1 teasers, made honest in
     * stage B item 37; the classification lives in
     * district-gates.ts) ────────────────────────────────────────
     * Two builds only:
     *   GATE — at a REAL gap in a real wall: two marble posts
     *   taller than the low wall with gold caps and a gold header,
     *   its name plate seated ON the header (never floating), a
     *   COMING plate under it, and a gold bar across at 0.55 m so
     *   the closure is the visible truth — the walk rects end at
     *   the wall, so nothing could walk through anyway. After
     *   dark the gate carries a lantern glow (item 27).
     *   MARKER — a named district signpost, NOT a doorway: a
     *   plinth, one grounded post, the name plate mounted ON the
     *   post, a COMING plate under it, a lantern glow after dark.
     *   No span, no header, no bar — nothing implies a passage.
     *   The east pair stand on the open floor in front of the wall
     *   they used to be painted onto; the promenade pair keep
     *   their Phase-1 spots as signposts.
     * Both builds take their per-instance variation from
     * prop-variation.ts (item 18): the pair of posts of one gate
     * share ONE variation (a gate is one object, not two rolls). */
    const gatePostGeo = new THREE.BoxGeometry(0.32, 1.9, 0.32);
    const gateCapGeo = new THREE.BoxGeometry(0.46, 0.12, 0.46);
    const buildDistrictGate = (def: DistrictThreshold, index: number) => {
      const { name, x, z, axis, plateRotY } = def;
      const v = propVariation("gate", index);
      for (const sd of [-1.1, 1.1]) {
        const px = axis === "x" ? x + sd : x;
        const pz = axis === "x" ? z : z + sd;
        const postMat = mats.marble.clone();
        postMat.color.offsetHSL(v.hueShift, 0, v.lightnessShift);
        const post = new THREE.Mesh(gatePostGeo, postMat);
        post.position.set(px, 0.95 * v.scaleY, pz);
        post.scale.y = v.scaleY;
        post.castShadow = QUALITY[this.quality].shadows;
        g.add(post);
        const cap = new THREE.Mesh(gateCapGeo, v.variant === 2 ? mats.goldDark : mats.gold);
        cap.position.set(px, 1.9 * v.scaleY + 0.06, pz);
        g.add(cap);
      }
      const header = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(2.52, 0.12, 0.3) : new THREE.BoxGeometry(0.3, 0.12, 2.52),
        mats.gold,
      );
      header.position.set(x, 1.8 * v.scaleY, z);
      g.add(header);
      const bar = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(2.2, 0.07, 0.07) : new THREE.BoxGeometry(0.07, 0.07, 2.2),
        mats.gold,
      );
      bar.position.set(x + (def.barDx ?? 0), 0.55, z + (def.barDz ?? 0));
      g.add(bar);
      /* The plate SEATS on the header: plate height at width 2.6
       * is 0.57, so its centre sits header-top + half-height —
       * grounded, not floating at the old 2.33. */
      this.doorPlate(g, name, x, 1.86 * v.scaleY + 0.285, z, plateRotY, 2.6);
      this.doorPlate(g, DISTRICT_SUBPLATE, x, 1.58, z, plateRotY, 1.3);
      if (look.candles) {
        const lx = axis === "x" ? x : x + (def.barDx ?? 0);
        const lz = axis === "x" ? z + (def.barDz ?? 0) : z;
        this.addLanternGlow(g, anim, lx, 1.62, lz, 1.15, index * 1.7);
      }
    };
    const buildDistrictMarker = (def: DistrictThreshold, index: number) => {
      const { name, x, z, plateRotY } = def;
      const v = propVariation("gate", index);
      const marker = new THREE.Group();
      marker.position.set(x, 0, z);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.78), mats.marble);
      plinth.position.y = 0.07;
      marker.add(plinth);
      const postMat = mats.marble.clone();
      postMat.color.offsetHSL(v.hueShift, 0, v.lightnessShift);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.78, 0.2), postMat);
      post.position.y = 0.14 + 0.89;
      post.castShadow = QUALITY[this.quality].shadows;
      marker.add(post);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), v.variant === 2 ? mats.goldDark : mats.gold);
      finial.position.y = 2.0;
      marker.add(finial);
      g.add(marker);
      /* The plates are mounted ON the post (their centres ride
       * the post's own span, just proud of its face toward the
       * walkers) — a signpost you read, not a door you try. The
       * offset follows the plate's facing direction. */
      const fx = Math.sin(plateRotY) * 0.12;
      const fz = Math.cos(plateRotY) * 0.12;
      this.doorPlate(g, name, x + fx, 1.62, z + fz, plateRotY, 2.2);
      this.doorPlate(g, DISTRICT_SUBPLATE, x + fx, 1.14, z + fz, plateRotY, 1.1);
      if (look.candles) {
        this.addLanternGlow(g, anim, x + fx * 2, 1.86, z + fz * 2, 0.95, index * 2.3);
      }
    };
    DISTRICT_THRESHOLDS.forEach((def, i) => {
      if (def.kind === "gate") buildDistrictGate(def, i);
      else buildDistrictMarker(def, i);
    });

    // The way back, labeled from the courtyard side of the arch.
    this.doorPlate(g, "THE KING'S HALL", 0, PALACE_DOOR_HEIGHT + 0.66, 12.52, 0, 4.2);

    // The courtyard's door-stations along the colonnade.
    this.buildStationMarkers(g, mats, COURTYARD_ID);
    this.buildCreatorRoomsArch(g, mats);

    group.add(g);
    this.shellGroups.set(COURTYARD_ID, g);
  }
  /** The Creator Rooms arch (Ring 2, 3.5): the grand arch on the
   *  far colonnade, OPEN — the seal and the shut slabs of the
   *  sealed years are gone, the double doors stand swung inward
   *  against the room beyond, and the gold threshold runs through
   *  the opening. Behind it is a real doorway in the floor plan
   *  (palace-layout's creator-room door): pick a creator at the
   *  arch's station and the palace walks you in; once a room is
   *  yours to revisit, the arch itself is walkable both ways. */
  private buildCreatorRoomsArch(g: THREE.Group, mats: LookMaterials): void {
    const arch = new THREE.Group();
    arch.position.set(9.5, 0, 26.0);
    const darkSlab = new THREE.MeshStandardMaterial({ color: 0x17110a, roughness: 0.55, metalness: 0.25 });
    for (const sx of [-1.45, 1.45]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3.9, 0.55), mats.marble);
      pillar.position.set(sx, 1.95, 0);
      pillar.castShadow = QUALITY[this.quality].shadows;
      arch.add(pillar);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.72), mats.gold);
      cap.position.set(sx, 3.99, 0);
      arch.add(cap);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(3.62, 0.34, 0.6), mats.gold);
    header.position.set(0, 4.2, 0);
    arch.add(header);
    // The doors, OPEN: each leaf swung inward toward the room,
    // gold handle still on it — an invitation, not a barrier.
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Group();
      leaf.position.set(sx * 1.08, 0, 0.1);
      leaf.rotation.y = sx * -0.98;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.14, 3.05, 0.1), darkSlab);
      slab.position.set(sx * -0.57, 1.55, 0);
      leaf.add(slab);
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mats.gold);
      handle.position.set(sx * -0.14, 1.55, -0.1);
      leaf.add(handle);
      arch.add(leaf);
    }
    // The gold threshold through the opening.
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.025, 1.1), mats.goldDark);
    threshold.position.set(0, 0.015, 0.1);
    arch.add(threshold);
    this.doorPlate(arch, "CREATOR ROOMS", 0, 4.72, -0.32, Math.PI, 3.6);
    g.add(arch);
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
    if (source.mode === "video") {
      /* A watch party lands where the room already is: seek once the
       * metadata lands, then honor the shared play/pause state. The
       * position is approximate by design (the server stamps it). */
      const startAt = source.startAtSec ?? 0;
      const applyStart = () => this.setScreenPlayback(source.playing !== false, startAt);
      if (video.readyState >= 1) applyStart();
      else video.addEventListener("loadedmetadata", applyStart, { once: true });
    } else {
      void video.play().catch(() => undefined);
    }
  }

  /** Shared play/pause for the screen's video, from the room's
   *  server-stamped state. A drift beyond a couple of seconds snaps
   *  to the stamped position; inside it, local playback just runs —
   *  approximate sync is the v1 bar, honestly. */
  setScreenPlayback(playing: boolean, positionSec: number): void {
    const video = this.video;
    if (!video) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      if (Math.abs(video.currentTime - positionSec) > 2.5) {
        try {
          video.currentTime = Math.min(positionSec, Math.max(0, video.duration - 0.25));
        } catch {
          /* a seek racing metadata is harmless — the next stamp lands */
        }
      }
    }
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }

  /** The screen video's own position — the holder's pause action
   *  stamps from here, so the anchor starts from what's on screen. */
  screenPositionSec(): number {
    return this.video?.currentTime ?? 0;
  }

  /** The performer's Front Row, by profile slug. Empty = no show. */
  /** The Kingdom Board monument's data seam (item 16): the page
   *  hands the board's real headlines — the same reads the
   *  Kingdom Board station panel makes — and the plate on all
   *  four faces repaints when (and only when) the words change. */
  setMonumentBoardData(data: MonumentBoardData): void {
    if (monumentBoardSignature(data) === monumentBoardSignature(monumentBoardCurrent)) return;
    monumentBoardCurrent = data;
    const tex = kingdomBoardPlateTexture(this.theme);
    for (const mat of this.monumentFaceMats) {
      mat.map = tex;
      mat.needsUpdate = true;
    }
  }

  setFrontRowSlugs(slugs: ReadonlySet<string>): void {
    this.frontRowSlugs = new Set(slugs);
  }

  /** The honored seat arc before the stage: flat gold rings on the
   *  floor in a shallow arc facing the screen. Shown while a show
   *  runs — a visual honor marking where the Front Row sits; nobody
   *  is teleported, v1 keeps its promises light and true. Lives on
   *  the scene root (not a look group) so a theme flip keeps it. */
  setStageSeatsVisible(visible: boolean): void {
    if (!this.stageSeats) {
      const group = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const x = -6 + i * 2;
        const seat = new THREE.Mesh(
          new THREE.RingGeometry(0.36, 0.48, 40),
          new THREE.MeshBasicMaterial({
            color: GOLD,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        seat.rotation.x = -Math.PI / 2;
        seat.position.set(x, 0.02, -9.6 + (Math.abs(x) / 6) * 1.1);
        seat.renderOrder = 2;
        group.add(seat);
      }
      this.stageSeats = group;
      this.scene.add(group);
    }
    this.stageSeats.visible = visible;
  }

  /* ── Peers ── */
  upsertPeer(peer: WorldPeer): void {
    const existing = this.avatars.get(peer.peerId);
    if (existing) {
      existing.target = { x: peer.x, z: peer.z, rotY: peer.rotY };
      this.reconcileFigure(existing, peer);
      this.reconcilePlate(existing, peer);
      // A snapshot can carry an action already in progress (a
      // dancer mid-dance when I walk in) — start it on the figure.
      if (peer.action !== existing.actionId) this.setRigAction(existing, peer.action);
      return;
    }
    const rig = buildAvatar(peer);
    this.avatars.set(peer.peerId, rig);
    this.scene.add(rig.group);
    this.reconcileFigure(rig, peer);
    if (peer.action) this.setRigAction(rig, peer.action);
  }

  /** A peer started (or stopped) an avatar action — their figure
   *  performs it. Driven by the client's peer.action frames. */
  setPeerAction(peerId: string, action: WorldActionId | null): void {
    const rig = this.avatars.get(peerId);
    if (rig) this.setRigAction(rig, action);
  }

  /** Perform an action on my own figure (the page's optimistic
   *  half of the action bar / gamepad press). */
  setSelfAction(action: WorldActionId | null): void {
    if (this.selfRig) this.setRigAction(this.selfRig, action);
  }

  /** The one place a rig's performed action changes: stamps the
   *  start clock (one-shots settle from it; the dance loop phases
   *  from it) and keeps the page's bar honest about my own figure. */
  private setRigAction(rig: AvatarRig, action: WorldActionId | null): void {
    if (rig.actionId === action) return;
    rig.actionId = action;
    rig.actionAt = performance.now();
    if (rig === this.selfRig) this.onSelfAction?.(action);
  }



  /** One figure's action life for this frame: finish a completed
   *  one-shot, ease the worn pose toward the action's pose, and
   *  write it onto the body COMPOSED with the mover's gait — the
   *  figure rides its stride bob plus the action's lift, and leans
   *  with its motion under the action's tilts. updateFigure ADDS
   *  its idle sway on top of rotation.z afterwards (portrait/
   *  default figures only), and the spin rides the billboard yaw
   *  for portraits — composed here, decorated there, never owned
   *  twice. `mover` defaults to the rig's own; my figure passes
   *  the walk rig's mover instead. */
  private applyActionPose(rig: AvatarRig, dt: number, nowMs: number, mover: MoverState = rig.mover): void {
    if (rig.actionId) {
      const def = ACTION_BY_ID.get(rig.actionId);
      if (def?.kind === "once" && nowMs - rig.actionAt >= def.durationMs) {
        this.setRigAction(rig, null);
      }
    }
    const pose = rig.actionId ? actionPoseAt(rig.actionId, nowMs - rig.actionAt) : null;
    const blend = 1 - Math.exp(-16 * dt);
    rig.poseTiltX += ((pose?.tiltX ?? 0) - rig.poseTiltX) * blend;
    rig.poseTiltZ += ((pose?.tiltZ ?? 0) - rig.poseTiltZ) * blend;
    rig.poseY += ((pose?.y ?? 0) - rig.poseY) * blend;
    rig.poseSpinY = pose?.spinY ?? 0;
    rig.group.position.y = mover.bobY + rig.poseY;
    rig.body.rotation.x = rig.poseTiltX + mover.leanPitch;
    rig.body.rotation.z = rig.poseTiltZ + mover.leanRoll;
    if (!rig.portrait) rig.body.rotation.y = rig.poseSpinY;
  }

  /** Keep the name plate matched to the peer: when what it shows
   *  changes (a name settles, the voice switch flips), redraw the
   *  sprite's texture in place — the sprite itself never moves. The
   *  Front Row treatment (brighter, wider ring + plate line) rides
   *  the same reconcile: it lands on the next 120 ms cadence after
   *  setFrontRowSlugs, no special path. */
  private reconcilePlate(rig: AvatarRig, peer: WorldPeer): void {
    const frontRow = !!peer.profileSlug && this.frontRowSlugs.has(peer.profileSlug);
    if (frontRow !== rig.frontRow) {
      rig.frontRow = frontRow;
      const mat = rig.ring.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = frontRow ? 1.6 : 0.5;
      rig.ring.scale.setScalar(frontRow ? 1.3 : 1);
    }
    const key = namePlateKey(peer, frontRow);
    if (key === rig.plateKey) return;
    rig.plateKey = key;
    const mat = rig.sprite.material as THREE.SpriteMaterial;
    const old = mat.map;
    mat.map = nameSpriteTexture(peer, frontRow);
    mat.needsUpdate = true;
    old?.dispose();
  }

  /** Keep the standing figure matched to the peer's character: a new
   *  pick starts the portrait load (the current figure keeps standing
   *  until it lands), clearing the pick restores the house default at
   *  once, and a failed load leaves what's standing — requestedId
   *  stays set so the 120 ms upsert cadence never turns into a retry
   *  storm. */
  private reconcileFigure(rig: AvatarRig, peer: WorldPeer): void {
    const want = peer.character && (peer.character.portraitUrl || peer.character.loopUrl) ? peer.character : null;
    rig.characterName = want?.name ?? "";
    const wantId = want?.id ?? null;
    /* A house guard pick arrives as a character ref too — but it
     * stands as the full-body guard figure, never the easel. */
    const wantGuard = want ? houseGuardVariantForId(want.id) : null;
    if (wantId === rig.requestedId) {
      /* No pick change — the one drift left is a guard figure not
       * yet standing (its art landed after this rig settled as a
       * capsule, or the deal/pick points at the other guard).
       * Vault portraits never drift. */
      if (!want || wantGuard) this.reconcileGuardFigure(rig, peer, wantGuard);
      return;
    }
    rig.requestedId = wantId;
    const seq = ++rig.swapSeq;
    if (!want || wantGuard) {
      this.reconcileGuardFigure(rig, peer, wantGuard);
      return;
    }
    rig.guardWanted = null;
    if (want.portraitUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (rig.swapSeq !== seq || rig.requestedId !== wantId) return;
        void locatePortraitMouth(img).then((mouth) => {
          if (rig.swapSeq !== seq || rig.requestedId !== wantId) return;
          try {
            const built = buildPortraitFigure(img, mouth);
            rig.defaultFigure = false;
            rig.guardVariant = null;
            this.swapFigure(rig, built.body, built.portrait, wantId);
            // Living loop: the ref's loopUrl — resolved server-side
            // from the character's own vault row, keyed by its
            // identity end to end (never by name).
            this.attachLoopFeed(rig, loopForCharacterRef(want));
          } catch {
            /* canvas unavailable — the standing figure keeps standing */
          }
        });
      };
      img.onerror = () => {
        /* portrait unreachable (or not CORS-clean for WebGL): the
           standing figure keeps standing; no retry until the pick
           changes */
      };
      img.src = want.portraitUrl;
      return;
    }
    /* Video-only character: its vault row carries a living loop
       but no portrait. The figure's still is the loop's own first
       frame — snapshot it once the video can play, stand the
       figure on it, and let the loop feed take over from there.
       Any failure along the way leaves the standing figure
       standing — the same contract as a failed portrait load. */
    const loopUrl = want.loopUrl;
    if (!loopUrl) return;
    const probe = document.createElement("video");
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = "auto";
    probe.crossOrigin = "anonymous";
    probe.onerror = () => {
      /* loop unreachable — the standing figure keeps standing */
    };
    probe.oncanplay = () => {
      if (rig.swapSeq !== seq || rig.requestedId !== wantId) return;
      try {
        const snap = document.createElement("canvas");
        snap.width = probe.videoWidth;
        snap.height = probe.videoHeight;
        const sctx = snap.width > 0 ? snap.getContext("2d") : null;
        if (!sctx) return;
        sctx.drawImage(probe, 0, 0);
        const stillUrl = snap.toDataURL("image/png");
        probe.removeAttribute("src");
        probe.load();
        const img = new Image();
        img.onload = () => {
          if (rig.swapSeq !== seq || rig.requestedId !== wantId) return;
          void locatePortraitMouth(img).then((mouth) => {
            if (rig.swapSeq !== seq || rig.requestedId !== wantId) return;
            try {
              const built = buildPortraitFigure(img, mouth);
              rig.defaultFigure = false;
              rig.guardVariant = null;
              this.swapFigure(rig, built.body, built.portrait, wantId);
              this.attachLoopFeed(rig, loopForCharacterRef(want));
            } catch {
              /* canvas unavailable — the standing figure keeps standing */
            }
          });
        };
        img.src = stillUrl;
      } catch {
        /* a tainted or torn-down probe — the standing figure stands */
      }
    };
    probe.src = loopUrl;
  }

  /** Stand the presence as a palace guard: the explicit pick when
   *  they made one, else the guard their identity deals them — the
   *  same deal on every client, so the room agrees on who is whom
   *  and nobody flickers between guards. Cheap on the upsert
   *  cadence: a rig already wearing the right guard, or correctly
   *  waiting as a capsule while its art is in flight, stands as-is. */
  private reconcileGuardFigure(rig: AvatarRig, peer: WorldPeer, explicit: GuardVariant | null): void {
    const variant = explicit ?? guardVariantForKey(peer.profileSlug ?? peer.peerId);
    rig.guardWanted = variant;
    if (rig.portrait && rig.guardVariant === variant) return;
    if (!rig.portrait && this.guardArt[variant].status !== "ready") return;
    this.swapToGuardOrCapsule(rig, variant);
  }

  /** Build the guard figure for `variant` — every figure builds its
   *  own canvas off the one shared image, so lips stay per-speaker —
   *  or the capsule when that guard's art isn't there (still loading,
   *  or the slot can't load: the documented fallback, same as a
   *  failed portrait load). */
  private swapToGuardOrCapsule(rig: AvatarRig, variant: GuardVariant): void {
    const art = this.guardArt[variant];
    if (art.status === "ready" && art.image) {
      try {
        const built = buildDefaultFigure(art.image, art.mouth);
        rig.defaultFigure = true;
        rig.guardVariant = variant;
        this.swapFigure(rig, built.body, built.portrait, null, DEFAULT_SPRITE_Y);
        this.attachLoopFeed(rig, loopForGuardVariant(variant));
        return;
      } catch {
        /* canvas unavailable — fall through to the capsule */
      }
    }
    rig.defaultFigure = false;
    rig.guardVariant = null;
    this.swapFigure(rig, buildCapsuleBody(rig.tint), null, null);
  }

  /** Load both guards' art once for the whole scene (the approved
   *  slots at public/world/default-character.png and
   *  default-character-female.png) and landmark each mouth: the
   *  faces are frontal, so their lips work like any portrait's. As
   *  each guard's art lands, every presence dealt or picking that
   *  guard trades up from the capsule. A missing or unreadable slot
   *  leaves the capsule standing for that guard — the fallback,
   *  never a broken figure. */
  private loadGuardArt(): void {
    (Object.keys(this.guardArt) as GuardVariant[]).forEach((variant) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        void locatePortraitMouth(img).then((mouth) => {
          if (this.disposed) return;
          this.guardArt[variant] = { status: "ready", image: img, mouth };
          for (const rig of this.avatars.values()) {
            if (rig.guardWanted === variant && rig.guardVariant !== variant) {
              this.swapToGuardOrCapsule(rig, variant);
            }
          }
          if (
            this.selfRig &&
            this.selfRig.guardWanted === variant &&
            this.selfRig.guardVariant !== variant
          ) {
            this.swapToGuardOrCapsule(this.selfRig, variant);
          }
        });
      };
      img.onerror = () => {
        this.guardArt[variant] = { status: "failed", image: null, mouth: null };
      };
      img.src = guardCharacterUrl(import.meta.env.BASE_URL, variant);
    });
  }

  private swapFigure(
    rig: AvatarRig,
    body: THREE.Group,
    portrait: PortraitState | null,
    characterId: string | null,
    spriteY?: number,
  ): void {
    // The old figure's loop dies with it — every swap path (guard,
    // portrait, capsule) funnels through here.
    this.teardownLoopFeed(rig);
    rig.group.remove(rig.body);
    if (rig.portrait) rig.portrait.texture.dispose();
    disposeObjectTree(rig.body);
    rig.body = body;
    rig.portrait = portrait;
    rig.characterId = characterId;
    rig.speechTarget = 0;
    rig.speechShown = 0;
    rig.sprite.position.y = spriteY ?? (portrait ? PORTRAIT_SPRITE_Y : CAPSULE_SPRITE_Y);
    rig.group.add(body);
  }

  /** The speaker's live voice level (0..1) for this peer's character
   *  figure — the lips follow it. Ignored for capsule figures: a
   *  capsule has no mouth to move. */
  setSpeechLevel(peerId: string, level: number): void {
    const rig = this.avatars.get(peerId);
    if (!rig || !rig.portrait) return;
    rig.speechTarget = mouthOpennessForLevel(level);
  }

  setPeerTarget(peerId: string, x: number, z: number, rotY: number): void {
    const rig = this.avatars.get(peerId);
    if (rig) rig.target = { x, z, rotY };
  }

  removePeer(peerId: string): void {
    const rig = this.avatars.get(peerId);
    if (!rig) return;
    this.avatars.delete(peerId);
    this.teardownLoopFeed(rig);
    this.scene.remove(rig.group);
    if (rig.portrait) rig.portrait.texture.dispose();
    disposeObjectTree(rig.group);
  }

  setSpawn(x: number, z: number): void {
    const p = clampToRoom(this.currentRoom, x, z);
    this.rig.position.set(p.x, 0, p.z);
    // The body re-anchors with the spawn — no stride, no settle
    // carried across a teleport.
    this.selfMover = createMover(p.x, p.z);
  }

  /** The room the walker stands in (the scene's own truth — it
   *  flips at the doorway plane, a step ahead of the server's
   *  transfer welcome, which setRoom then confirms). */
  get roomId(): string {
    return this.currentRoom;
  }

  /** Confirm the room from the server's welcome. Movement, camera
   *  clamp and shell visibility all follow the room. */
  setRoom(roomId: string): void {
    if (!palaceRoomLayout(roomId)) return;
    this.currentRoom = roomId;
    this.applyRoomVisibility();
  }

  /** A doorway crossing, detected by the movement resolver: flip
   *  the scene's room and tell the page (which transfers presence
   *  server-side to match). */
  private crossedInto(roomId: string): void {
    this.currentRoom = roomId;
    this.applyRoomVisibility();
    this.onRoomEnter?.(roomId);
  }

  /** The destination room was full (the server refused the
   *  transfer): step back through the doorway. Call AFTER
   *  setRoom(serverRoom) — the scene's room flips back to the room
   *  the server still holds me in, and the rig (standing in that
   *  room's doorway apron) clamps to just inside its door — the
   *  honest step back. */
  returnThroughDoor(): void {
    const p = clampToRoom(this.currentRoom, this.rig.position.x, this.rig.position.z);
    this.rig.position.x = p.x;
    this.rig.position.z = p.z;
    // The step back is a placement, not a walk — the body follows.
    this.selfMover.px = p.x;
    this.selfMover.pz = p.z;
    this.selfMover.vx = 0;
    this.selfMover.vz = 0;
  }

  /** Only the room you stand in renders around you — plus the hall,
   *  which is never a shell: it is the look group itself, visible
   *  through every doorway from every room. From the hall, every
   *  shell shows (you glimpse each room through its door). */
  private applyRoomVisibility(): void {
    for (const [id, g] of this.shellGroups) {
      /* The Creator Rooms template (3.5) answers to every creator
       * room id — and to the Courtyard, whose open arch looks
       * straight into it. */
      const creatorVisible =
        id === CREATOR_SHELL_KEY &&
        (isCreatorRoomId(this.currentRoom) || this.currentRoom === COURTYARD_ID);
      g.visible = this.currentRoom === HALL_ROOM_ID || this.currentRoom === id || creatorVisible;
    }
    this.applyAreaAtmosphere();
  }

  /** Every peer figure out — a room change despawns the old room's
   *  crowd locally; the new room's snapshot re-stands them. */
  removeAllPeers(): void {
    for (const peerId of [...this.avatars.keys()]) this.removePeer(peerId);
  }

  /* ── Your own figure + camera ── */

  /** First person (you are the camera) or third (the camera follows
   *  behind your figure). Flat-screen only: while XR is presenting
   *  the headset owns the camera whatever this says. */
  setViewMode(mode: HallViewMode): void {
    this.viewMode = mode;
  }

  get currentViewMode(): HallViewMode {
    return this.viewMode;
  }

  /** Stand (or re-dress) your own figure from your presence peer —
   *  the same reconcile every peer gets, so a character pick swaps
   *  your figure the moment the room confirms it. Null = no figure
   *  (not inside yet). */
  setSelfFigure(peer: WorldPeer | null): void {
    if (!peer) {
      if (this.selfRig) {
        this.teardownLoopFeed(this.selfRig);
        this.scene.remove(this.selfRig.group);
        if (this.selfRig.portrait) this.selfRig.portrait.texture.dispose();
        disposeObjectTree(this.selfRig.group);
        this.selfRig = null;
      }
      return;
    }
    if (!this.selfRig) {
      const rig = buildAvatar(peer);
      this.selfRig = rig;
      this.scene.add(rig.group);
      this.reconcileFigure(rig, peer);
      return;
    }
    this.reconcileFigure(this.selfRig, peer);
    this.reconcilePlate(this.selfRig, peer);
  }

  /** Your own voice level for your figure's lips — fed from your
   *  mic the same way peers' levels are fed from their streams. */
  setSelfSpeechLevel(level: number): void {
    if (!this.selfRig || !this.selfRig.portrait) return;
    this.selfRig.speechTarget = mouthOpennessForLevel(level);
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

    const presenting = this.renderer.xr.isPresenting;
    if (presenting) {
      this.tickXrMove(dt);
    } else {
      this.tickFlatMove(dt);
      this.rig.rotation.y = this.yaw;
      this.applyFlatCamera();
    }

    // Your own figure stands where you stand. Only the flat
    // third-person camera ever sees it — first person is the camera,
    // and in XR the headset's own camera rules stand (a body parked
    // at the eye point would fill the view), so it steps aside.
    if (this.selfRig) {
      this.selfRig.group.position.set(this.rig.position.x, 0, this.rig.position.z);
      this.selfRig.group.rotation.y = this.yaw;
      this.selfRig.group.visible = !presenting && this.viewMode === "third";
      // Your own name plate never hangs over your own third-person
      // view — the billboard sits between the follow camera and your
      // figure and reads as a giant floating sign (see view-mode's
      // selfPlateVisible). Peers' plates are not touched.
      this.selfRig.sprite.visible = selfPlateVisible(this.viewMode);
    }
    // The planar mirror rests while presenting — Reflector and XR
    // don't mix; the polished overlay carries the floor in a headset.
    if (this.floorReflector) this.floorReflector.visible = !this.renderer.xr.isPresenting;

    // Remote figures walk to their latest reported spots — as
    // bodies, not gliders: each rig's mover chases the target
    // (desired velocity = the gap, capped a touch over run pace),
    // so peers lean into their starts, bob with their stride and
    // settle on arrival exactly like my own figure does. A gap too
    // wide to be a walk (lag snap, fresh spawn) lands instantly.
    const k = 1 - Math.exp(-9 * dt);
    const nowMs = performance.now();
    for (const rig of this.avatars.values()) {
      const dx = rig.target.x - rig.group.position.x;
      const dz = rig.target.z - rig.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > PEER_SNAP_DIST) {
        rig.group.position.x = rig.target.x;
        rig.group.position.z = rig.target.z;
        rig.mover = createMover(rig.target.x, rig.target.z);
      }
      let desiredVx = 0;
      let desiredVz = 0;
      if (dist > 0.02) {
        const chase = Math.min(dist * 5.5, PEER_CHASE_MAX);
        desiredVx = (dx / dist) * chase;
        desiredVz = (dz / dist) * chase;
      }
      stepMover(rig.mover, rig.group.position, desiredVx, desiredVz, rig.group.rotation.y, dt);
      rig.group.position.x += rig.mover.vx * dt;
      rig.group.position.z += rig.mover.vz * dt;
      rig.group.rotation.y = angleLerp(rig.group.rotation.y, rig.target.rotY, k);
      // A held toggle ends when the figure actually starts walking
      // — read off the body's measured speed (the server's
      // clearing frame confirms it a beat later).
      if (rig.actionId && actionClearedByMove(rig.actionId) && rig.mover.speed > 0.6) {
        this.setRigAction(rig, null);
      }
      this.applyActionPose(rig, dt, nowMs);
    }
    // My own figure wears its action too (visible in third person),
    // composed with my walk rig's body physics.
    if (this.selfRig) this.applyActionPose(this.selfRig, dt, nowMs, this.selfMover);

    // Living-loop budget pass: decide which feeds may decode
    // this tick (nearest visible, capped) before the figure
    // updates below drive their crossfades.
    this.serviceLoopFeeds();

    // Character figures: the portrait panel billboards toward the
    // viewer (a portrait is a face — it should meet your eye, not the
    // walker's heading), and its lips track the speaker's voice.
    // Your own figure gets the same treatment in third person.
    if (this.avatars.size || this.selfRig?.portrait) {
      this.camera.getWorldPosition(SCRATCH_VEC);
      for (const rig of this.avatars.values()) {
        if (rig.portrait) this.updateFigure(rig, dt, nowMs);
      }
      if (this.selfRig?.portrait && this.selfRig.group.visible) {
        this.updateFigure(this.selfRig, dt, nowMs);
      }
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
    for (const e of anim.embers) {
      const attr = e.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < e.field.length; i++) {
        const o = emberOffsetAt(e.field[i]!, t);
        attr.setXYZ(i, o.x, o.y, o.z);
      }
      attr.needsUpdate = true;
    }
    for (const l of anim.lanternGlows) {
      const sc = lanternGlowScale(l.base, t, l.phase);
      l.sprite.scale.set(sc, sc, 1);
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

  /** One figure's per-frame life: billboard the portrait toward the
   *  camera (SCRATCH_VEC holds the camera's world position) and run
   *  its lips toward the speaker's level. */
  private updateFigure(rig: AvatarRig, dt: number, nowMs: number): void {
    if (!rig.portrait) return;
    const faceYaw =
      Math.atan2(SCRATCH_VEC.x - rig.group.position.x, SCRATCH_VEC.z - rig.group.position.z) -
      rig.group.rotation.y;
    rig.body.rotation.y = angleLerp(rig.body.rotation.y, faceYaw, 1 - Math.exp(-7 * dt));
    // A spin turns the portrait with everything else — the yaw the
    // billboard just settled gets the spin's turn on top.
    if (rig.poseSpinY !== 0) rig.body.rotation.y += rig.poseSpinY;
    /* The default figure breathes: a barely-there idle sway, phased
     * per figure so the hall never moves in lockstep. ADDED to the
     * action pose's tilt — applyActionPose owns rotation.z now. */
    if (rig.defaultFigure) {
      rig.body.rotation.z += Math.sin(nowMs / 1500 + rig.swayPhase) * 0.018;
    }

    // A loop feed that failed mid-life steps aside for good: the
    // canvas goes back to the still alone, once, and stays there.
    const portrait = rig.portrait;
    if (rig.loopFeed?.failed && portrait.loopVideo) {
      portrait.loopVideo = null;
      portrait.loopMask = null;
      portrait.loopCrop = null;
      portrait.loopAlpha = 0;
      drawPortraitCanvas(portrait, rig.speechShown);
    }

    // Living loop: drive the still⇄loop crossfade. The blend aims
    // at 1 only while the budget pass keeps this feed live, its
    // video can play, and — for a character whose landmarked mouth
    // would drift on its loop (the mouth-drift rule in
    // figure-loop.ts) — its figure is silent: speech suspends the
    // loop at once, and ~300ms of quiet brings it back. The mouth
    // overlay keeps drawing over both layers in the same pass.
    const feed = rig.loopFeed && !rig.loopFeed.failed ? rig.loopFeed : null;
    let loopWantsDraw = false;
    if (feed) {
      const speaking = rig.speechTarget > LOOP_SPEECH_LEVEL;
      const suspended = loopSuspendedForSpeech(feed.def, speaking);
      if (suspended) feed.silentSinceMs = 0;
      else if (feed.silentSinceMs === 0) feed.silentSinceMs = nowMs;
      const resting =
        !suspended && feed.silentSinceMs !== 0 && nowMs - feed.silentSinceMs >= LOOP_SPEECH_RESUME_MS;
      const target = feed.ready && feed.active && resting ? 1 : 0;
      if (feed.alpha !== target) {
        const dir = target > feed.alpha ? 1 : -1;
        feed.alpha = clamp(feed.alpha + dir * (dt / LOOP_FADE_SEC), 0, 1);
        loopWantsDraw = true;
      } else if (
        target === 1 &&
        feed.video.readyState >= 2 &&
        feed.video.currentTime !== feed.lastVideoTime
      ) {
        feed.lastVideoTime = feed.video.currentTime;
        loopWantsDraw = true;
      }
      portrait.loopAlpha = feed.alpha;
    }

    const opennessDiff = rig.speechTarget - rig.speechShown;
    const mouthMoving = Math.abs(opennessDiff) > 0.002;
    if (mouthMoving) {
      rig.speechShown += opennessDiff * Math.min(1, dt * 20);
      if (Math.abs(rig.speechTarget - rig.speechShown) <= 0.004) rig.speechShown = rig.speechTarget;
    }
    // ~15 fps texture updates while the mouth is actually moving;
    // ~30 fps while the loop paints and the mouth is still.
    const drawDue = mouthMoving
      ? nowMs - rig.lastMouthDrawAt >= 66 || rig.speechShown === rig.speechTarget
      : loopWantsDraw && nowMs - rig.lastMouthDrawAt >= LOOP_REDRAW_MS;
    if ((mouthMoving || loopWantsDraw) && drawDue) {
      rig.lastMouthDrawAt = nowMs;
      drawPortraitCanvas(portrait, rig.speechShown);
    }
  }

  /* ── Living loops (figure-loop.ts) ─────────────────────────────
   * A loop feeds FRAMES into the figure's existing portrait
   * canvas; the still stays first paint and permanent fallback,
   * the mouth overlay keeps drawing over both, and the body —
   * gait, lean, poses, billboard — is untouched: the loop
   * replaces the texture's pixels, never the figure. */

  /** Attach the character's loop to a freshly swapped figure.
   *  Cheap to call on every swap: a rig already feeding the same
   *  loop keeps its feed. A masked loop whose still-alpha mask
   *  cannot be built fails ON PURPOSE — an unmasked guard loop
   *  would show its studio backdrop, so the still stands. */
  private attachLoopFeed(rig: AvatarRig, def: FigureLoopDef | null): void {
    if (!def || !rig.portrait) return;
    if (rig.loopFeed?.def.key === def.key && !rig.loopFeed.failed) return;
    this.teardownLoopFeed(rig);
    const portrait = rig.portrait;
    let mask: HTMLCanvasElement | null = null;
    if (def.masked) {
      mask = this.buildLoopMask(portrait);
      if (!mask) return; // no feed at all — the still stands
    }
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    // No poster attribute: the element is never displayed — the
    // figure's still IS the first paint; the registry's poster
    // path ships as an asset for surfaces that show one.
    video.src = loopVideoUrl(import.meta.env.BASE_URL, def);
    const feed: FigureLoopFeed = {
      id: this.nextLoopFeedId++,
      def,
      video,
      ready: false,
      failed: false,
      active: false,
      alpha: 0,
      mask,
      lastVideoTime: -1,
      playRejections: 0,
      silentSinceMs: 0,
    };
    rig.loopFeed = feed;
    video.addEventListener("canplay", () => {
      if (rig.loopFeed !== feed) return;
      feed.ready = true;
      portrait.loopVideo = video;
      portrait.loopCrop = def.sourceCrop;
      portrait.loopMask = feed.mask;
    });
    video.addEventListener(
      "error",
      () => {
        feed.failed = true;
      },
      { once: true },
    );
    this.hookLoopVisibility();
  }

  /** Stop and release a figure's loop. Called on every figure
   *  swap (from swapFigure), on peer removal, and when the self
   *  figure goes away — a video element must never outlive its
   *  figure or keep decoding for nobody. */
  private teardownLoopFeed(rig: AvatarRig): void {
    const feed = rig.loopFeed;
    if (!feed) return;
    rig.loopFeed = null;
    try {
      feed.video.pause();
    } catch {
      /* never played — nothing to stop */
    }
    feed.video.removeAttribute("src");
    try {
      feed.video.load();
    } catch {
      /* release is best-effort; the element is garbage either way */
    }
    if (rig.portrait) {
      rig.portrait.loopVideo = null;
      rig.portrait.loopMask = null;
      rig.portrait.loopCrop = null;
      rig.portrait.loopAlpha = 0;
    }
  }

  /** Build the guard mask from the figure's own still: draw the
   *  still exactly as the portrait canvas does, keep only its
   *  alpha (levels remapped per figure-loop.ts), then inset it a
   *  couple of px so the mask edge tucks inside the video
   *  figure's own edge. Null on any failure — the caller fails
   *  the feed rather than play unmasked video. */
  private buildLoopMask(portrait: PortraitState): HTMLCanvasElement | null {
    try {
      const { canvas, image, cover } = portrait;
      const mask = document.createElement("canvas");
      mask.width = canvas.width;
      mask.height = canvas.height;
      const mctx = mask.getContext("2d", { willReadFrequently: true });
      if (!mctx) return null;
      mctx.drawImage(image, cover.offsetX, cover.offsetY, cover.drawnW, cover.drawnH);
      const data = mctx.getImageData(0, 0, mask.width, mask.height);
      const px = data.data;
      for (let i = 3; i < px.length; i += 4) px[i] = remapMaskAlpha(px[i]!);
      mctx.putImageData(data, 0, 0);
      const inset = document.createElement("canvas");
      inset.width = mask.width;
      inset.height = mask.height;
      const ictx = inset.getContext("2d");
      if (!ictx) return null;
      const s = MASK_INSET_PX;
      ictx.drawImage(mask, s, s, mask.width - s * 2, mask.height - s * 2);
      return inset;
    } catch {
      return null;
    }
  }

  /** The per-tick loop budget: at most MAX_LIVE_LOOPS feeds play
   *  (figure-loop.ts), nearest visible figures first; everyone
   *  else's video pauses and their figure crossfades back to its
   *  still in updateFigure. Also self-heals playback after the
   *  tab was hidden (the visibility hook pauses everything). */
  private serviceLoopFeeds(): void {
    const entries: { rig: AvatarRig; feed: FigureLoopFeed }[] = [];
    const collect = (rig: AvatarRig | null) => {
      if (rig?.loopFeed && !rig.loopFeed.failed && rig.portrait) {
        entries.push({ rig, feed: rig.loopFeed });
      }
    };
    for (const rig of this.avatars.values()) collect(rig);
    collect(this.selfRig);
    if (!entries.length) return;
    this.camera.getWorldPosition(SCRATCH_VEC);
    if (!this.loopFrustum) this.loopFrustum = new THREE.Frustum();
    const frustum = this.loopFrustum;
    frustum.setFromProjectionMatrix(
      LOOP_SCRATCH_MAT.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    const decorated = entries.map(({ rig, feed }) => {
      const p = rig.group.position;
      LOOP_SCRATCH_SPHERE.center.set(p.x, 1, p.z);
      const inView =
        rig === this.selfRig ? rig.group.visible : rig.group.visible && frustum.intersectsSphere(LOOP_SCRATCH_SPHERE);
      return {
        key: `f${feed.id}`,
        distance: Math.hypot(p.x - SCRATCH_VEC.x, p.z - SCRATCH_VEC.z),
        visible: inView,
        feed,
      };
    });
    const live = selectLiveLoops(decorated);
    for (const d of decorated) {
      const shouldLive = live.has(d.key) && d.feed.ready;
      d.feed.active = shouldLive;
      const v = d.feed.video;
      if (shouldLive && v.paused) {
        v.play().catch(() => {
          d.feed.playRejections += 1;
          if (d.feed.playRejections >= 3) d.feed.failed = true;
        });
      } else if (!shouldLive && !v.paused) {
        v.pause();
      }
    }
  }

  /** Pause every loop while the tab is hidden — a backgrounded
   *  hall shouldn't keep decoding video for nobody. Registered
   *  once, on the first feed; the budget pass resumes the chosen
   *  feeds when the hall is visible again. */
  private hookLoopVisibility(): void {
    if (this.loopVisibilityHooked) return;
    this.loopVisibilityHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (this.disposed || !document.hidden) return;
      const pause = (rig: AvatarRig | null) => {
        try {
          rig?.loopFeed?.video.pause();
        } catch {
          /* not playing */
        }
      };
      for (const rig of this.avatars.values()) pause(rig);
      pause(this.selfRig);
    });
  }

  /** The flat-screen camera. First person: at the rig's eye, pitch
   *  is the look. Third person: pulled behind and above your figure
   *  (which the tick makes visible), the pitch gentled so the figure
   *  stays framed; the world spot is clamped inside the walls so
   *  backing into a corner never pushes the camera out of the room.
   *  Never called while XR presents — the headset owns the camera. */
  private applyFlatCamera(): void {
    if (this.viewMode === "third") {
      /* The follow camera clamps inside the room you stand in —
       * each palace room has its own clamp, the hall's unchanged. */
      const cc = palaceRoomLayout(this.currentRoom)?.camClamp ?? CAM_CLAMP;
      this.rig.updateMatrixWorld();
      SCRATCH_VEC.set(0, THIRD_CAM_HEIGHT, THIRD_CAM_DISTANCE);
      this.rig.localToWorld(SCRATCH_VEC);
      SCRATCH_VEC.x = clamp(SCRATCH_VEC.x, cc.minX, cc.maxX);
      SCRATCH_VEC.z = clamp(SCRATCH_VEC.z, cc.minZ, cc.maxZ);
      this.rig.worldToLocal(SCRATCH_VEC);
      this.camera.position.copy(SCRATCH_VEC);
      this.camera.rotation.x = this.pitch * 0.5 - 0.14;
    } else {
      // First person rides the stride — gentled (the full bob
      // plays on the figure, seen in third person), so the view
      // breathes with the walk without swimming.
      this.camera.position.set(0, EYE_HEIGHT + this.selfMover.bobY * 0.45, 0);
      this.camera.rotation.x = this.pitch;
    }
  }

  private moveRig(fwd: number, strafe: number, dt: number, speed: number, headingYaw: number): void {
    const sin = Math.sin(headingYaw);
    const cos = Math.cos(headingYaw);
    // Camera forward on the floor plane is (-sin(yaw), -cos(yaw)).
    // Input becomes the body's DESIRED velocity; the mover eases
    // the actual velocity toward it (acceleration/deceleration
    // curves, lean, stride — movement.ts), so a start takes a
    // beat and a stop carries weight. Runs every frame, input or
    // not: the ease-out IS the frames after the keys come up.
    const desiredVx = (-sin * fwd + cos * strafe) * speed;
    const desiredVz = (-cos * fwd - sin * strafe) * speed;
    const prevX = this.rig.position.x;
    const prevZ = this.rig.position.z;
    stepMover(
      this.selfMover,
      { x: prevX, z: prevZ },
      desiredVx,
      desiredVz,
      headingYaw,
      dt,
    );
    /* The palace resolves the step: walls are solid everywhere
     * except the doorways, a blocked diagonal slides along the
     * wall, and crossing a doorway plane reports the new room. The
     * mover reads the RESOLVED position next frame, so a wall
     * stops the gait as surely as it stops the body. */
    const res = resolvePalaceMove(
      { x: prevX, z: prevZ, room: this.currentRoom },
      prevX + this.selfMover.vx * dt,
      prevZ + this.selfMover.vz * dt,
    );
    this.rig.position.x = res.x;
    this.rig.position.z = res.z;
    // Actually walking ends a held toggle (dance/sit) on my own
    // figure — the same rule the server applies to my move frames,
    // so what I see and what the room sees agree.
    if (
      this.selfRig?.actionId &&
      actionClearedByMove(this.selfRig.actionId) &&
      (res.x !== prevX || res.z !== prevZ)
    ) {
      this.setRigAction(this.selfRig, null);
    }
    if (res.entered) this.crossedInto(res.entered);
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
    let run = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    /* A paired controller (Bluetooth gamepads arrive as standard
     * gamepads) merges in — it never replaces keyboard/mouse/touch,
     * it adds to them: left stick walks, right stick looks with the
     * same sign conventions as the mouse, RT/L3 hurries, the two
     * face-button toggles fire their page callbacks on the press
     * edge, and LB lands the station interact the same way.
     * Flat-screen only: XR keeps its own controller rules in
     * tickXrMove. */
    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    const pad = pads ? firstGamepad([...pads]) : null;
    const polled = pollGamepad(pad, this.padEdges);
    this.padEdges = polled.edges;
    if (pad) {
      const intent = polled.intent;
      strafe += intent.moveX;
      fwd += -intent.moveY;
      this.yaw -= intent.lookX * 2.2 * dt;
      this.pitch = clamp(this.pitch - intent.lookY * 2.2 * dt, -1.15, 1.15);
      if (intent.sprint) run = true;
      if (intent.toggleVoice) this.onPadToggleVoice?.();
      if (intent.toggleView) this.onPadToggleView?.();
      if (intent.action) this.onPadAction?.(intent.action);
      if (intent.interact) this.onPadInteract?.();
    }
    const len = Math.hypot(fwd, strafe);
    if (len > 1) {
      fwd /= len;
      strafe /= len;
    }
    this.moveRig(fwd, strafe, dt, run ? RUN_SPEED : WALK_SPEED, this.yaw);
  }

  private tickXrMove(dt: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    let fwd = 0;
    let strafe = 0;
    let yawFromLook = this.yaw;
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
      yawFromLook = Math.atan2(-dir.x, -dir.z);
      fwd = -ay;
      strafe = ax;
      break;
    }
    // Called every frame, stick centered or not — the body's ease
    // and settle live in the frames after the stick lets go.
    this.moveRig(fwd, strafe, dt, WALK_SPEED, yawFromLook);
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
    this.setSelfFigure(null);
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
    for (const tex of doorPlateCache.values()) tex.dispose();
    doorPlateCache.clear();
    for (const tex of kingdomBoardPlateCache.values()) tex.dispose();
    kingdomBoardPlateCache.clear();
    flameTex?.dispose();
    flameTex = null;
    hazeTex?.dispose();
    hazeTex = null;
    this.renderer.dispose();
  }
}
