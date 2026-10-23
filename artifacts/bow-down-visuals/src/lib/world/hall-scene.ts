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
 * Stage C (items 1–4): the palace has an EXTERIOR now — a stone
 * façade with pilasters, lit windows, cornice, pediment and
 * banners skinning the hall's back wall (palace-exterior.ts holds
 * the placement data and its walk-line laws), a roofline of slabs,
 * parapets, turrets and a dome so the palace reads solid from any
 * raised angle, and a real sky: the visible dome is built from the
 * very sky definition sky-env.ts PMREMs for reflections (sun +
 * drifting clouds by day, stars + moon by night), following the
 * camera as pure background.
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
import {
  QUALITY_RUNGS,
  FrameTimeMonitor,
  detectInitialTier,
  loadQualityPreference,
  resolveTier,
  shadowRefreshDue,
  steppedTextureSize,
  storeQualityPreference,
  type QualityPreference,
  type QualityTier,
} from "./quality";
import {
  areaForRoom,
  hallInteriorCulled,
  lightScopedOff,
  lodTierAt,
  plazaDressingCulled,
  reflectorShouldRender,
} from "./visibility";
import { capsuleBodyHex } from "./capsule-color";
import { HALL_SCREEN, hallLookFor, lookFadeProgress, type HallLook, type HallTheme } from "./hall-looks";
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
import { sharedGeometry, tintColor } from "./perf-census";
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
  STAGE_GROUNDS_ID,
  LISTENING_GARDENS_ID,
  CREATION_ROW_ID,
  ATELIERS_ID,
  BOARDWALK_ID,
  HEIGHTS_ID,
  CREATOR_ROOM_TEMPLATE,
  isCreatorRoomId,
  palaceRoomLayout,
  resolvePalaceMove,
  groundHeightAt,
  pullInCamera,
  clampToRoom,
  PLAZA_WALL_RUNS,
  PLAZA_COLUMNS,
  PLAZA_PLANTERS,
  PLAZA_BRAZIERS,
  PLAZA_GATES,
} from "./palace-layout";
import { stationsInRoom } from "./stations";
import { propVariation } from "./prop-variation";
import { HOUSE_TRIM, roomTrimProfile, type RoomTrimProfile } from "./room-trim";
import { DISTRICT_OPEN_SUBPLATE, DISTRICT_SUBPLATE, DISTRICT_THRESHOLDS, gateLeafYaw, type DistrictThreshold } from "./district-gates";
import {
  STAGE_GROUNDS_INTERIOR, STAGE_WALL_RUNS, STAGE_PIERS, STAGE_PLATFORM,
  STAGE_SHELL_BACK, STAGE_SHELL_RETURNS, STAGE_CURTAIN, SPEAKER_STACKS, SPEAKER_STACK,
  TRUSS, BANNER_POLES, BANNER_POLE, AUDIENCE_LAWN, STAGE_BENCHES, ENTRY_PATH, STAGE_LAMPS,
  STAGE_ARRIVAL_ARCH,
} from "./stage-grounds";
import {
  GARDENS_INTERIOR, GARDENS_WALL_RUNS, GARDENS_PIERS, PARTERRE_LAWN, RILL,
  RILL_BENCHES, GARDEN_HEDGES, NOOK_BENCHES, PAVILION, PAVILION_POSTS,
  GARDENS_ENTRY_PATH, GARDENS_LAMPS, GARDENS_BANNER_POLES, GARDENS_BANNER_POLE,
  GARDENS_FOUNTAIN,
} from "./listening-gardens";
import {
  ROW_INTERIOR, ROW_WALL_RUNS, ROW_PIERS, ROW_STREET, ROW_STALLS, STALL_KIT,
  ROW_STALL_POSTS, ROW_STALL_BENCHES, ROW_PLINTHS, PLINTH, ROW_CRATES, CRATE,
  ROW_CANVAS_STACKS, ROW_TOOL_BENCHES, ROW_PLANTERS, ROW_PLANTER_CROWNS,
  ROW_LAMPS, ROW_BANNER_POLES, ROW_BANNER_POLE,
} from "./creation-row";
import {
  ATELIERS_INTERIOR, ATELIERS_WALL_RUNS, ATELIERS_PIERS, ATELIERS_LANE, ATELIER_BAYS, BAY_KIT,
  ATELIER_BAY_POSTS, ATELIER_BAY_TABLES, ATELIER_BAY_PANELS, ATELIER_VITRINES, VITRINE,
  ATELIER_PLINTHS, ATELIER_PLINTH, ATELIER_CRATES, ATELIER_CRATE, ATELIER_STONE_STACKS,
  ATELIER_TOOL_BENCHES, ATELIERS_PLANTERS, ATELIERS_PLANTER_CROWNS, ATELIERS_LAMPS,
  ATELIERS_BANNER_POLES, ATELIERS_BANNER_POLE,
  ATELIER_MANNEQUINS, MANNEQUIN, ATELIER_FABRIC_BOLTS, ATELIER_CASCADE,
} from "./ateliers";
import {
  BOARDWALK_FLOOR_RECTS, BOARDWALK_WALL_RUNS, BOARDWALK_PIERS, BOARDWALK_DECK_PLANKS,
  boardwalkDeckStyle, BOARDWALK_STALLS, BOARDWALK_STALL_POSTS, BOARDWALK_STALL_BENCHES,
  BANDSTAND, BANDSTAND_POSTS, BANDSTAND_STEPS, BOARDWALK_BASIN, BOARDWALK_RAILING,
  BOARDWALK_RAILING_POSTS, BOARDWALK_BENCHES, BOARDWALK_PLANTERS, BOARDWALK_PLANTER_CROWNS,
  BOARDWALK_LAMPS, BOARDWALK_BANNER_POLES, BOARDWALK_BANNER_POLE,
  BOARDWALK_WHEEL, wheelAngleAt,
} from "./boardwalk";
import {
  HEIGHTS_INTERIOR, HEIGHTS_WALL_RUNS, HEIGHTS_PIERS, HEIGHTS_WALKWAY, HEIGHTS_FRONTS, FRONT_KIT,
  HEIGHTS_FRONT_POSTS, HEIGHTS_FRONT_DOORS, HEIGHTS_TERRACES, HEIGHTS_TERRACE_STEPS,
  HEIGHTS_TERRACE_CROWNS, HEIGHTS_BENCHES, HEIGHTS_PLANTERS, HEIGHTS_PLANTER_CROWNS,
  HEIGHTS_LAMPS, HEIGHTS_BANNER_POLES, HEIGHTS_BANNER_POLE,
  HEIGHTS_PLATES, HEIGHTS_PLATE, heightsPlateLines, heightsRosterSignature,
  HEIGHTS_DESK, HEIGHTS_RUNNER, HEIGHTS_THRESHOLD,
} from "./creator-heights";
import {
  createEmberField, emberCountForTier, emberOffsetAt, lanternGlowScale,
  FAKE_POOL, fakePoolOpacity, type EmberParticle,
} from "./night-life";
import {
  POOL, FOUNTAIN, FOUNTAIN_FALL, WET_EDGE, PLAZA_LAMPS, LAMP, lampGlassStyle, PLAZA_BENCHES, BENCH,
  PLAZA_TABLE_SETS, PLAZA_URNS, URN, PLAZA_STALLS, STALL, SPAWN_DRESSING,
  bannerSwayAt, createPollenField, pollenCountForScale, pollenPositionAt,
  waterSurfaceAt, poolWaterTint, type PollenMote,
} from "./plaza-life";
import { PLAZA_LIONS, LION, COMPASS_ROSE, PLAZA_DAMS, DAM } from "./plaza-solids";
import {
  EMPTY_MONUMENT_BOARD, MONUMENT_PLATE_H, MONUMENT_PLATE_W, drawMonumentBoardPlate,
  monumentBoardSignature, monumentPlateEmissiveIntensity, type MonumentBoardData, type MonumentPlateCtx,
} from "./monument-board";
import {
  ACTION_BY_ID,
  actionClearedByMove,
  actionPoseAt,
  type WorldActionId,
} from "./actions";
import { createMover, stepMover, easeFigureHeight, type MoverState } from "./movement";
import {
  createStepDust,
  spawnStepPuff,
  advanceStepDust,
  writeStepDustBuffers,
  stepsLanded,
  STEP_DUST_CAPACITY,
  type StepDustPool,
} from "./step-dust";
import {
  MARBLE_METRES_PER_TILE,
  FABRIC_METRES_PER_TILE,
  PAVING_METRES_PER_TILE,
  LAWN_METRES_PER_TILE,
  repeatForSize,
  derivedPbrTextures,
  brushedGoldTextures,
  rippleNormalTexture,
  MATERIAL_NORMAL_SCALES,
  GOLD_METRES_PER_TILE,
  enhanceLoadedTexture,
  type PbrKind,
} from "./pbr-materials";
import {
  PAVING_SLABS,
  pavingSlabsFor,
  LAWN_PANELS,
  LAWN_BED,
  PARTERRE_MEDALLION,
  lawnEdgingRuns,
  lawnPlantingSpots,
  MONUMENT,
  BACKDROP,
  BACKDROP_WINGS,
  BACKDROP_GARDENS,
  backdropWindowStyle,
  hallStepRuns,
  terraceRuns,
} from "./palace-grounds";
import {
  buildSkyEnvironment,
  buildVisibleSkyDome,
  skyHasClouds,
  cloudDriftX,
  cloudShadeAt,
  SKY_CLOUDS,
  type SkyCloudDef,
} from "./sky-env";
import {
  FACADE,
  FACADE_CORNICE,
  FACADE_CORNICE_TRIM,
  FACADE_PILASTER_XS,
  FACADE_STONE_METRES_PER_TILE,
  FACADE_MARBLE_METRES_PER_TILE,
  FACADE_WINDOWS,
  FACADE_WINDOW_GLASS_Z,
  FACADE_WINDOW_W,
  FACADE_WINDOW_H,
  FACADE_BANNERS,
  BANNER,
  PEDIMENT,
  ROOF_SLABS,
  ROOF_PARAPETS,
  TURRETS,
  TURRET,
  DOME,
  facadeSkinRuns,
  facadePlinthRuns,
  facadePilaster,
  facadeWindowFrameBars,
  facadeWindowStyle,
  type ExteriorBox,
} from "./palace-exterior";

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
   The rung table, the persisted user preference and the adaptive
   frame-time monitor live in quality.ts (items 22 + 99) — this
   file only APPLIES a rung. In Auto the monitor steps the rung
   down under sustained load and back up with headroom; an explicit
   preference pins it. LOW keeps the brazier lights (the night
   plaza's only lights) and cuts shadows/reflector/pixels first. */
const QUALITY = QUALITY_RUNGS;

/** The walker's reduced-motion preference (item 44): when set,
 *  the SELF mover's bob and settle are silenced at the source
 *  (movement.ts bobScale) — the body still leans and eases, the
 *  view just never rides a stride. Peers keep their gait: their
 *  bob is the world's life, not the walker's vestibular input. */
function detectReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function detectQuality(): QualityTier {
  const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 4 : 4;
  return detectInitialTier(coarse, cores);
}

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

/* Stack-100 #2 items 82/84/94 — the rung's anisotropy, applied
 * honestly everywhere a surface map is born and re-applied on every
 * ladder step. Two facts used to break the ladder's word: textures
 * were created at the DEVICE ceiling (a low-rung scene still decoded
 * its surfaces at anisotropy 16 until some later step happened to
 * re-range the colour cache), and the derived PBR sets + brushed
 * gold maps were never re-ranged at all — the tier pass iterated the
 * colour textureCache only, so the maps that carry the palace's
 * grazing-angle detail (floor/rect PBR sets, the fabric set, and the
 * gold maps the district gates' caps and headers wear) kept whatever
 * they were born with forever. Now: every surface texture is born at
 * surfaceAnisotropy() (the ACTIVE rung capped by the device), and
 * the non-cache sets register here so applyTierToRenderer re-ranges
 * them alongside the colour cache on every step. */
let activeRungAnisotropy = 16;
const rungSurfaceTextures = new Set<THREE.Texture>();

/* Item 93: the active rung's texture decode scale, consulted by
 * hallTexture's load callback (see steppedTextureSize in
 * quality.ts). Seeded from the boot rung, moved by ladder steps;
 * textures already decoded keep their size until they reload. */
let activeTextureScale = 1;

/** Canvas-downscale a freshly landed texture image to the active
 *  rung's decode size (item 93 — the figure-canvas precedent: draw
 *  the source onto a smaller canvas and hand THAT to the GPU). The
 *  shared tileable canvas enhanceLoadedTexture installed is only
 *  READ here; each texture gets its own stepped canvas. */
function downscaleTextureImage(tex: THREE.Texture, scale: number): void {
  const img = tex.image as { width?: number; height?: number } | undefined;
  if (!img) return;
  const size = steppedTextureSize(img.width ?? 0, img.height ?? 0, scale);
  if (size.width === 0 || size.height === 0) return;
  if (size.width === img.width && size.height === img.height) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.drawImage(img as CanvasImageSource, 0, 0, size.width, size.height);
    tex.image = canvas;
    tex.needsUpdate = true;
  } catch {
    /* A source that refuses the canvas keeps its full size — the
     * surface still renders, just unstepped. */
  }
}

function surfaceAnisotropy(): number {
  return Math.min(activeRungAnisotropy, maxTextureAnisotropy);
}

/** Born at the active rung's anisotropy and registered for every
 *  future ladder step (see the note above). */
function registerRungSurfaceTexture(tex: THREE.Texture): void {
  tex.anisotropy = surfaceAnisotropy();
  rungSurfaceTextures.add(tex);
}

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
    /* Item 93: on a stepped-down rung the decoded set shrinks with
     * it — same source file, smaller canvas, a fraction of the
     * memory (the scale squares: medium ≈ 1/4 the pixels). */
    if (activeTextureScale < 1) downscaleTextureImage(loaded, activeTextureScale);
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
  tex.anisotropy = surfaceAnisotropy();
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

let cloudTex: THREE.CanvasTexture | null = null;
/** A soft cloud puff for the day sky (item 3): overlapping radial
 *  blobs, white fading to nothing — a sprite, never a mesh, so the
 *  whole day-sky life costs a handful of billboards. */
function cloudTexture(): THREE.CanvasTexture {
  if (cloudTex) return cloudTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const blob = (x: number, y: number, r: number, a: number) => {
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, `rgba(255,252,244,${a})`);
    grad.addColorStop(0.6, `rgba(255,248,232,${a * 0.45})`);
    grad.addColorStop(1, "rgba(255,248,232,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(128, 70, 62, 0.85);
  blob(84, 76, 44, 0.7);
  blob(176, 76, 46, 0.7);
  blob(110, 58, 40, 0.6);
  blob(152, 60, 38, 0.6);
  cloudTex = new THREE.CanvasTexture(c);
  return cloudTex;
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

/* The Heights roster the residence plates currently letter
 * (Stack-100 #2 item 20) — module state like the monument's:
 * the scene's shells (rebuilt per theme) and the page's roster
 * seam read the same names. Empty = every front VACANT. */
let heightsRosterCurrent: readonly string[] = [];

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
  /** The ground height this figure currently STANDS at (item 54):
   *  eased toward target.y for peers; for my own figure it mirrors
   *  the walk rig's y. applyActionPose composes it under the
   *  stride bob + action pose lift — a figure on a terrace stands
   *  ON the terrace, never snapped to the room floor. */
  groundY: number;
  /** The mover's step counter as the step-dust hook last read it
   *  (item 57) — increments since then are footsteps to raise. */
  lastStepCount: number;
  /** The floor ring (brightened + widened for Front Row members). */
  ring: THREE.Mesh;
  /** Whether the Front Row treatment is currently applied. */
  frontRow: boolean;
  /** Signature of what the name plate currently shows. */
  plateKey: string;
  tint: string;
  target: { x: number; y: number; z: number; rotY: number };
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

  group.position.set(peer.x, peer.y, peer.z);
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
    groundY: peer.y,
    lastStepCount: 0,
    ring,
    frontRow: false,
    plateKey: namePlateKey(peer),
    tint: peer.tint,
    target: { x: peer.x, y: peer.y, z: peer.z, rotY: peer.rotY },
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

/* ── Perf round 2: instanced repeated kits (perf-census.ts) ──────
 * The census proved the world draw-call bound and named the kits
 * whose parts are byte-identical across placements. The builds
 * below instance those parts. PARITY CONTRACT (pinned in
 * perf-census.test.ts): same geometry (now shared objects), same
 * materials, same per-part transforms, same shadow flags — only
 * the draw count changes. Where the old build cloned a material
 * per instance for an HSL tint, the tint rides instanceColor
 * (tintColor in perf-census.ts) over the same white-based
 * material, which three multiplies into the diffuse identically. */

/** One instanced draw for a repeated part: `place` fills each
 *  instance's transform on the scratch dummy. */
export function instancedPart(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  count: number,
  place: (dummy: THREE.Object3D, index: number) => void,
  opts?: { castShadow?: boolean; colorAt?: (index: number) => THREE.Color },
): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    place(dummy, i);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    if (opts?.colorAt) im.setColorAt(i, opts.colorAt(i));
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = opts?.castShadow ?? false;
  parent.add(im);
  return im;
}

/** The district pier kit (perf round 2, item 86): plinth + shaft +
 *  cap, one recipe shared by all six district shells — previously
 *  six copies of the same 7-line loop, three meshes per pier.
 *  Only the shaft casts, exactly as the loops did. */
export function buildPierSet(
  g: THREE.Group,
  mats: LookMaterials,
  shadows: boolean,
  piers: ReadonlyArray<{ x: number; z: number }>,
): void {
  instancedPart(
    g,
    sharedGeometry("pier-plinth", () => new THREE.BoxGeometry(0.9, 0.3, 0.9)),
    mats.marble, piers.length,
    (d, i) => d.position.set(piers[i].x, 0.15, piers[i].z),
  );
  instancedPart(
    g,
    sharedGeometry("pier-shaft", () => new THREE.BoxGeometry(0.62, 3.54, 0.62)),
    mats.marble, piers.length,
    (d, i) => d.position.set(piers[i].x, 0.3 + 3.54 / 2, piers[i].z),
    { castShadow: shadows },
  );
  instancedPart(
    g,
    sharedGeometry("pier-cap", () => new THREE.BoxGeometry(0.86, 0.18, 0.86)),
    mats.gold, piers.length,
    (d, i) => d.position.set(piers[i].x, 3.93, piers[i].z),
  );
}

/* ── Per-look materials + animation registry ────────────────────────── */

interface LookMaterials {
  gold: THREE.MeshStandardMaterial;
  goldDark: THREE.MeshStandardMaterial;
  /** Per-metre gold factories (Stack-100 #2 materials round 2):
   *  a hero gold surface (monument bands, gate caps/headers) gets
   *  brushed maps repeated from ITS size, not the shared 2×2. */
  goldFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
  goldDarkFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
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
  /** Exterior factories (Stage C items 1/2): the façade's stone
   *  courses and its gold-vein accent marble, per-metre repeats
   *  from the art lane's new textures, per look. */
  stoneFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
  facadeMarbleFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
  /** Grounds factories (Stage C items 6/8): the plaza's outdoor
   *  paving and its lawns, per-metre repeats from the art lane's
   *  grounds textures, per look. */
  pavingFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
  lawnFor: (widthM: number, heightM: number) => THREE.MeshStandardMaterial;
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
  /* The day sky's drifting clouds (item 3): sprites riding the
   * visible sky dome, drifted on sky-env's wrapped cloudDriftX. */
  clouds: Array<{ sprite: THREE.Sprite; def: SkyCloudDef }>;
  /* Plaza life (Stage C batch C3): the façade banners' sway
   * pivots (item 26 — light look only, never registered under
   * reduced motion), the daylight pollen field (item 26), and the
   * pool's water surface + fountain jet (item 28 — registered in
   * both looks; the tick applies their motion only when reduced
   * motion is off). */
  bannerSways: Array<{ pivot: THREE.Group; phase: number }>;
  pollen: { points: THREE.Points; field: PollenMote[] } | null;
  /* Water round 2 (Stack-100 #2 items 5–7): every entry's colour
   * layer scrolls one way and its ripple NORMAL layer counter-
   * scrolls (normalTex), both from plaza-life's ONE water model;
   * fountains add their falling sheet (fall) and the plaza
   * fountain its impact ripple ring. */
  waters: Array<{
    tex: THREE.Texture;
    jet: THREE.Mesh | null;
    normalTex?: THREE.Texture;
    fall?: THREE.Mesh | null;
    /** The fall sheet's built opacity; the model scales it. */
    fallBase?: number;
    ripple?: THREE.Mesh | null;
  }>;
  /* Stack-100 #2 item 29: spinning dressing (the boardwalk prize
   * wheel) — the tick sets each spinner's z-rotation from its
   * angle function; registered in both looks, never under
   * reduced motion. */
  spinners: Array<{ obj: THREE.Group; angleAt: (t: number) => number }>;
}

const EMPTY_ANIM: LookAnim = { flames: [], flickerLights: [], dust: null, smokes: [], embers: [], lanternGlows: [], clouds: [], bannerSways: [], pollen: null, waters: [], spinners: [] };

/* ── The scene ──────────────────────────────────────────────────────── */

export class KingsHallScene {
  onPose: ((x: number, z: number, rotY: number, y: number) => void) | null = null;
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
  /** Footstep dust (item 57): the pool every figure's completed
   *  steps raise puffs into, and the ONE Points cloud that renders
   *  them (built lazily at the first footfall). */
  private stepDust: StepDustPool = createStepDust();
  private stepDustPoints: THREE.Points | null = null;
  private stepDustPos = new Float32Array(STEP_DUST_CAPACITY * 3);
  private stepDustCol = new Float32Array(STEP_DUST_CAPACITY * 3);
  /** My own mover's step counter as the dust hook last read it. */
  private selfLastStepCount = 0;
  private viewMode: HallViewMode = "first";
  private keys = new Set<string>();
  /** Gamepad edge state carried between polls (toggle buttons fire
   *  once per press). */
  private padEdges: GamepadEdges = IDLE_GAMEPAD_EDGES;
  /** A controller's voice press (the page steps its voice mode). */
  onPadToggleVoice: (() => void) | null = null;
  /** A controller's LT press (the page steps its voice mode
   *  BACKWARD — the A button's reverse, item 59). */
  onPadVoiceBack: (() => void) | null = null;
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
  private lastPose = { x: Number.NaN, y: Number.NaN, z: Number.NaN, rotY: Number.NaN };
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
   *  when the board's words change. Stack-100 #2 monument finish:
   *  the faces are LIT PBR (standard materials) whose emissive
   *  map is the plate itself — after dark the board glows with
   *  its own words instead of wearing an unlit decal. */
  private monumentFaceMats: THREE.MeshStandardMaterial[] = [];
  /** The Heights roster plates' materials (Stack-100 #2 item 20):
   *  every look build re-registers them, and setHeightsRoster
   *  re-letters them when the room's live roster changes. */
  private heightsPlateMats: THREE.MeshBasicMaterial[] = [];
  private heightsRosterSig = "";
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
  /* Item 96: serviceLoopFeeds runs every tick and used to allocate
   * its candidate + decorated arrays (and a fresh key string per
   * feed) on every call. The scratch buffers below are refilled in
   * place — slots are reused by index, and a decorated slot's key
   * string is rebuilt only when the slot changes feeds. */
  private loopEntriesScratch: { rig: AvatarRig; feed: FigureLoopFeed }[] = [];
  private loopDecoratedScratch: { key: string; distance: number; visible: boolean; feed: FigureLoopFeed }[] = [];
  private boundHandlers: Array<[string, EventListener, unknown]> = [];

  private quality: QualityTier;
  /** Reduced-motion preference, read once at construction. */
  private reducedMotion = detectReducedMotion();
  private qualityPref: QualityPreference = "auto";
  private frameMonitor: FrameTimeMonitor | null = null;
  private frameIndex = 0;
  /** The hall's own build (floor/walls/stage/lights) as one group,
   *  so the portal cull (item 23) can rest the whole interior when
   *  the arch provably cannot be seen from the plaza. */
  private hallGroup: THREE.Group | null = null;
  /** The visible sky group (items 3/4): re-centred on the camera
   *  per frame in servicePerfSystems so the dome is always the
   *  same distance in every direction. */
  private skyGroup: THREE.Group | null = null;
  /** The visible dome's shader material (Stack-100 #2 item 1):
   *  the tick advances its uTime so the night stars twinkle and
   *  drift — never under reduced motion, and never the PMREM
   *  capture (its uTime stays 0: reflections are the average). */
  private skyDomeMaterial: THREE.ShaderMaterial | null = null;
  /** Brazier point lights (plaza + hall dais — ONE class) that
   *  cast shadows on the top rung (item 13): re-registered per
   *  look build, re-ruled per ladder step. */
  private brazierShadowLights: THREE.PointLight[] = [];
  /** Day/night crossfade state: the previous look's exposure /
   *  background / fog the tick eases away from (null = no fade). */
  private lookFade: {
    fromExposure: number; toExposure: number;
    fromBg: THREE.Color; toBg: THREE.Color;
    fromFog: THREE.Color; toFog: THREE.Color;
    startedAtMs: number;
  } | null = null;
  private floorOverlayMat: THREE.MeshPhysicalMaterial | null = null;
  /** Every scoped point/spot light in the current look, with its
   *  world position + range (item 24) — judged per room change. */
  private scopedLights: Array<{ light: THREE.Light; x: number; z: number; range: number }> = [];
  /** LOD-registered dressing (item 99): station markers today. */
  private lodItems: Array<{ obj: THREE.Object3D; x: number; z: number; detail: THREE.Object3D[] }> = [];
  /** The courtyard shell's room-change visibility, before the
   *  per-frame portal cull has its say. */
  private plazaBaseVisible = true;
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
    this.qualityPref = loadQualityPreference();
    const detected = detectQuality();
    this.frameMonitor = new FrameTimeMonitor(detected);
    this.quality = resolveTier(this.qualityPref, detected);
    const q = QUALITY[this.quality];
    this.theme = theme;

    /* MSAA is construction-time (quality.ts): a scene built on a
     * low rung gets no antialias; runtime ladder steps apply
     * every other rung axis and MSAA follows on the next entry. */
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: "high-performance" });
    maxTextureAnisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy() || 8);
    activeRungAnisotropy = q.anisotropy;
    activeTextureScale = q.textureScale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    /* Item 14: plain PCF, deliberately — PCFSoftShadowMap IGNORES
     * shadow.radius in three.js, so the rung's softness table
     * (2/3/4) would be a lie under it. Under PCF the radius is
     * real, and the top rung's 4 reads soft. */
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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

    /* Day/night crossfade: capture the OUTGOING look's light
     * values before teardown — the tick eases exposure, background
     * and fog colour from these to the new look's over
     * LOOK_FADE_MS. First build has nothing to fade from. */
    const fadeFrom = this.lookGroup
      ? {
          fromExposure: this.renderer.toneMappingExposure,
          fromBg: (this.scene.background as THREE.Color | null)?.clone() ?? new THREE.Color(look.background),
          fromFog: this.scene.fog instanceof THREE.Fog ? this.scene.fog.color.clone() : new THREE.Color(look.fogColor),
        }
      : null;

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
    this.brazierShadowLights = [];

    this.renderer.toneMappingExposure = look.exposure;
    this.scene.background = new THREE.Color(look.background);
    this.scene.fog = new THREE.Fog(look.fogColor, look.fogNear, look.fogFar);
    if (fadeFrom) {
      this.lookFade = {
        ...fadeFrom,
        toExposure: look.exposure,
        toBg: new THREE.Color(look.background),
        toFog: new THREE.Color(look.fogColor),
        startedAtMs: performance.now(),
      };
      // The tick starts the ease FROM the old look's values.
      this.renderer.toneMappingExposure = fadeFrom.fromExposure;
      (this.scene.background as THREE.Color).copy(fadeFrom.fromBg);
      this.scene.fog.color.copy(fadeFrom.fromFog);
    }
    this.envTarget = buildSkyEnvironment(this.renderer, look);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = look.environmentIntensity;

    const group = new THREE.Group();
    this.buildLook(group, look);
    this.scene.add(group);
    this.lookGroup = group;
    this.applyLocalShadowLights();
    this.collectScopedLights(group);
    this.applyLightScoping();
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
    const surface = (
      url: string, metresPerTile: number,
      kind: PbrKind, widthM: number, heightM: number,
      opts: { color?: number; envMapIntensity: number; metalness?: number },
    ): THREE.MeshStandardMaterial => {
      const rep = repeatForSize(widthM, heightM, metresPerTile);
      const pbr = derivedPbrTextures(url, kind, rep.x, rep.y);
      for (const t of [pbr.normalMap, pbr.roughnessMap, pbr.aoMap]) registerRungSurfaceTexture(t);
      return new THREE.MeshStandardMaterial({
        map: hallTexture(url, rep.x, rep.y),
        normalMap: pbr.normalMap, normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.surface, MATERIAL_NORMAL_SCALES.surface),
        roughnessMap: pbr.roughnessMap, roughness: 1,
        aoMap: pbr.aoMap,
        color: opts.color, metalness: opts.metalness ?? 0.05, envMapIntensity: opts.envMapIntensity,
      });
    };
    const marbleSurface = (
      kind: PbrKind, widthM: number, heightM: number,
      opts: { color?: number; envMapIntensity: number; metalness?: number },
    ): THREE.MeshStandardMaterial =>
      surface(look.marbleTextureUrl, MARBLE_METRES_PER_TILE, kind, widthM, heightM, opts);
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
    const sizedUrl = (
      tag: string, url: string, metresPerTile: number, kind: PbrKind,
      opts: { color?: number; envMapIntensity: number; metalness?: number },
    ) => (widthM: number, heightM: number): THREE.MeshStandardMaterial => {
      const key = `${tag}|${widthM.toFixed(2)}x${heightM.toFixed(2)}`;
      const hit = sizedCache.get(key);
      if (hit) return hit;
      const mat = surface(url, metresPerTile, kind, widthM, heightM, opts);
      sizedCache.set(key, mat);
      return mat;
    };

    /* Gold (item 12): brushed-metal maps — roughness that varies
     * along the brush (bright ≈ 0.14–0.34, deep ≈ 0.30–0.54) and a
     * subtle streak normal — under the sky env, so it reads as
     * metal. roughness scalar is 1: the map carries the value.
     * Round 2: gold is built by ONE maker, and goldFor/goldDarkFor
     * give a surface a material whose brushed repeat derives from
     * ITS size in metres (GOLD_METRES_PER_TILE) — the shared
     * gold/goldDark below are the maker's 2×2 default, unchanged
     * for the hundreds of small gilt pieces that share them. */
    const makeGold = (variant: "bright" | "dark", repX: number, repY: number): THREE.MeshStandardMaterial => {
      const maps = brushedGoldTextures(variant, repX, repY);
      registerRungSurfaceTexture(maps.normalMap);
      registerRungSurfaceTexture(maps.roughnessMap);
      return variant === "bright"
        ? new THREE.MeshStandardMaterial({
            color: 0xd9b45c, metalness: 1, roughness: 1,
            roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
            normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.gold, MATERIAL_NORMAL_SCALES.gold), envMapIntensity: 1.35,
          })
        : new THREE.MeshStandardMaterial({
            color: 0x9a7a24, metalness: 1, roughness: 1,
            roughnessMap: maps.roughnessMap, normalMap: maps.normalMap,
            normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.gold, MATERIAL_NORMAL_SCALES.gold), envMapIntensity: 0.9,
            emissive: GOLD_DEEP, emissiveIntensity: look.theme === "dark" ? 0.18 : 0.05,
          });
    };
    const gold = makeGold("bright", 2, 2);
    const goldDark = makeGold("dark", 2, 2);
    const goldCache = new Map<string, THREE.MeshStandardMaterial>();
    const goldSized = (variant: "bright" | "dark") => (widthM: number, heightM: number): THREE.MeshStandardMaterial => {
      const key = `${variant}|${widthM.toFixed(2)}x${heightM.toFixed(2)}`;
      const hit = goldCache.get(key);
      if (hit) return hit;
      const rep = repeatForSize(widthM, heightM, GOLD_METRES_PER_TILE);
      const mat = makeGold(variant, rep.x, rep.y);
      goldCache.set(key, mat);
      return mat;
    };
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
    for (const t of [fabricPbr.normalMap, fabricPbr.roughnessMap, fabricPbr.aoMap]) registerRungSurfaceTexture(t);
    const fabric = new THREE.MeshStandardMaterial({
      map: hallTexture(look.throneFabricTextureUrl, fabricRep.x, fabricRep.y),
      normalMap: fabricPbr.normalMap, normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.fabric, MATERIAL_NORMAL_SCALES.fabric),
      roughnessMap: fabricPbr.roughnessMap, roughness: 1,
      aoMap: fabricPbr.aoMap,
      metalness: 0, envMapIntensity: 0.5,
    });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.55, metalness: 0.5 });
    return {
      gold, goldDark, marble, marbleWall, ceiling, fabric, darkMetal,
      goldFor: goldSized("bright"),
      goldDarkFor: goldSized("dark"),
      wallFor: sized("wall", "marble-rough", { envMapIntensity: 0.55 }),
      marbleFor: sized("marble", "marble", { envMapIntensity: 0.7, metalness: 0.06 }),
      ceilingFor: sized("ceiling", "marble-rough", { color: ceilingTint, envMapIntensity: 0.55 }),
      /* Round 2: the façade stone finally derives as the STONE
       * kind it is — it used to borrow marble-rough's carve, and
       * the dedicated "stone" kind sat unused. */
      stoneFor: sizedUrl("stone", look.facadeStoneTextureUrl, FACADE_STONE_METRES_PER_TILE, "stone", { envMapIntensity: 0.5 }),
      facadeMarbleFor: sizedUrl("facade-marble", look.facadeMarbleTextureUrl, FACADE_MARBLE_METRES_PER_TILE, "marble", { envMapIntensity: 0.7, metalness: 0.06 }),
      pavingFor: sizedUrl("paving", look.pavingTextureUrl, PAVING_METRES_PER_TILE, "paving", { envMapIntensity: 0.45 }),
      lawnFor: sizedUrl("lawn", look.lawnTextureUrl, LAWN_METRES_PER_TILE, "lawn", { envMapIntensity: 0.3 }),
    };
  }

  private buildLook(group: THREE.Group, look: HallLook): void {
    const mats = this.makeMaterials(look);
    const anim: LookAnim = { flames: [], flickerLights: [], dust: null, smokes: [], embers: [], lanternGlows: [], clouds: [], bannerSways: [], pollen: null, waters: [], spinners: [] };
    this.monumentFaceMats = [];
    this.heightsPlateMats = [];
    this.lodItems = [];
    /* The hall's own build rides in ONE subgroup (item 23 portal
     * culling): from the plaza the interior is visible only through
     * the arch, so the whole subgroup can rest when the arch
     * provably cannot be in view. Shells stay siblings of it. */
    const hall = new THREE.Group();
    group.add(hall);
    this.hallGroup = hall;
    this.buildFloor(hall, look, mats);
    this.buildWalls(hall, look, mats, anim);
    this.buildCeiling(hall, look, mats);
    this.buildColumns(hall, look, mats);
    this.buildStage(hall, look, mats);
    this.buildScreen(hall, mats);
    this.buildSpeakersAndMic(hall, mats);
    this.buildLights(hall, look);
    if (look.chandeliers) this.buildChandeliers(hall, mats);
    if (look.candles) this.buildBraziers(hall, mats, anim);
    if (look.lightBeams) this.buildBeams(hall);
    if (look.dust) anim.dust = this.buildDust(hall);
    if (look.haze) this.buildHaze(hall, anim);
    this.buildRoomShells(group, look, mats, anim);
    /* Stage C (items 1–4): the palace's outside + the real sky.
     * Both live on the look group itself — never inside the hall
     * group (portal-culled from the plaza, exactly when the
     * façade is the thing being looked at) and never inside a
     * room shell (room-culled from indoors, exactly when the
     * roofline must still read from a raised camera). */
    this.buildPalaceExterior(group, look, mats, anim);
    this.buildBackdropGrounds(group, look, anim);
    this.buildVisibleSky(group, look, anim);
    this.lookAnim = anim;
  }

  /** The visible sky (items 3 + 4): ONE dome from sky-env's single
   *  sky definition — the same palette + shader the PMREM bakes
   *  the environment reflections from, so the sky you see is the
   *  sky the gold reflects. Day adds the drifting cloud sprites;
   *  night's stars + moon are already in the dome shader (the
   *  palette's star field and disc). No lights, no fog, depth
   *  never written — pure background that follows the camera. */
  private buildVisibleSky(group: THREE.Group, look: HallLook, anim: LookAnim): void {
    const sky = new THREE.Group();
    const dome = buildVisibleSkyDome(look);
    this.skyDomeMaterial = dome.material as THREE.ShaderMaterial;
    sky.add(dome);
    if (skyHasClouds(look)) {
      const tex = cloudTexture();
      for (const def of SKY_CLOUDS) {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tex, transparent: true, opacity: def.opacity,
            depthWrite: false, fog: false,
          }),
        );
        sprite.position.set(def.baseX, def.y, def.z);
        sprite.scale.set(def.w, def.h, 1);
        sprite.renderOrder = -99;
        sky.add(sprite);
        anim.clouds.push({ sprite, def });
      }
    }
    group.add(sky);
    this.skyGroup = sky;
  }

  /** The palace exterior (items 1 + 2), built entirely from
   *  palace-exterior.ts placement data: the façade skin in the
   *  look's stone courses with gold-vein marble accents, instanced
   *  pilasters / window frames / turrets, emissive window glass
   *  (lit at night, pale by day — never a real light), cornice,
   *  pediment, static banners; and the roofline — slabs over every
   *  roofed block, parapets, corner turrets and the central dome —
   *  so the palace reads solid from any angle. The hall interior,
   *  its arch and its door logic are untouched: the skin abuts the
   *  back wall's outer face and every ground-level piece stays
   *  inside the plaza walk line (palace-exterior's pinned laws). */
  private buildPalaceExterior(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();
    const shadows = QUALITY[this.quality].shadows;
    const box = (b: ExteriorBox, mat: THREE.Material, cast = false): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
      mesh.position.set(b.cx, b.cy, b.cz);
      mesh.receiveShadow = shadows;
      mesh.castShadow = cast && shadows;
      g.add(mesh);
      return mesh;
    };
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; sy?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(1, p.sy ?? 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      g.add(im);
      return im;
    };

    /* ── Item 1: the façade ── */
    for (const run of facadeSkinRuns()) box(run, mats.stoneFor(run.w, run.h));
    for (const run of facadePlinthRuns()) box(run, mats.facadeMarbleFor(run.w, run.h));
    // Pilasters: one instanced shaft set (gold-vein marble) + one
    // instanced capital/base set (gold) — two draws for eight
    // dressed columns.
    const pilasters = FACADE_PILASTER_XS.map((x) => facadePilaster(x));
    instanced(
      new THREE.BoxGeometry(0.66, FACADE.topY, 0.26),
      mats.facadeMarbleFor(0.66, FACADE.topY),
      pilasters.map((p) => ({ x: p.shaft.cx, y: p.shaft.cy, z: p.shaft.cz })),
    );
    instanced(
      new THREE.BoxGeometry(0.86, 1, 0.3),
      mats.gold,
      pilasters.flatMap((p) => [
        { x: p.capital.cx, y: p.capital.cy, z: p.capital.cz, sy: p.capital.h },
        { x: p.base.cx, y: p.base.cy, z: p.base.cz, sy: p.base.h },
      ]),
    );
    // Windows: instanced emissive glass + instanced gold frames.
    const style = facadeWindowStyle(look.theme);
    instanced(
      new THREE.PlaneGeometry(FACADE_WINDOW_W, FACADE_WINDOW_H),
      new THREE.MeshStandardMaterial({
        color: style.color, emissive: style.emissive,
        emissiveIntensity: style.emissiveIntensity, roughness: style.roughness,
        metalness: style.metalness, envMapIntensity: style.envMapIntensity,
      }),
      FACADE_WINDOWS.map((w) => ({ x: w.x, y: w.y, z: FACADE_WINDOW_GLASS_Z })),
    );
    {
      const bars = FACADE_WINDOWS.flatMap((w) => facadeWindowFrameBars(w));
      const frame = new THREE.InstancedMesh(sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)), mats.gold, bars.length);
      bars.forEach((b, i) => {
        dummy.position.set(b.cx, b.cy, b.cz);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        frame.setMatrixAt(i, dummy.matrix);
      });
      frame.instanceMatrix.needsUpdate = true;
      g.add(frame);
    }
    // Cornice + its gold trim line (high above the walk line, so
    // it projects to throw its shadow line across the stone).
    box(FACADE_CORNICE, mats.stoneFor(FACADE_CORNICE.w, FACADE_CORNICE.h), true);
    box(FACADE_CORNICE_TRIM, mats.gold);
    // Pediment: gold-vein tympanum, two raking gold slabs, finial.
    {
      const shape = new THREE.Shape();
      shape.moveTo(-PEDIMENT.halfWidth, 0);
      shape.lineTo(PEDIMENT.halfWidth, 0);
      shape.lineTo(0, PEDIMENT.apexY - PEDIMENT.baseY);
      shape.closePath();
      const tympanum = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        mats.facadeMarbleFor(PEDIMENT.halfWidth * 2, PEDIMENT.apexY - PEDIMENT.baseY),
      );
      tympanum.position.set(PEDIMENT.centerX, PEDIMENT.baseY, PEDIMENT.z);
      tympanum.castShadow = shadows;
      g.add(tympanum);
      for (const sx of [-1, 1] as const) {
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(PEDIMENT.slabLength + 0.3, 0.18, 0.24), mats.gold,
        );
        slab.position.set(
          sx * PEDIMENT.halfWidth / 2,
          (PEDIMENT.baseY + PEDIMENT.apexY) / 2 + 0.06,
          PEDIMENT.z + 0.08,
        );
        slab.rotation.z = -sx * PEDIMENT.slabTiltRad;
        slab.castShadow = shadows;
        g.add(slab);
      }
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mats.gold);
      finial.position.set(PEDIMENT.centerX, PEDIMENT.finialY, PEDIMENT.z + 0.08);
      g.add(finial);
    }
    // Banners flanking the arch — cloth panels in the look's
    // throne fabric with gold rod + hem bar, hung from a pivot at
    // the rod so the panel + hem swing as one cloth. Item 26:
    // in the LIGHT look the pivots register a gentle sway in
    // tick() (plaza-life's bannerSwayAt); in the dark look — and
    // under reduced motion in either look — they hang still,
    // exactly as C1 built them.
    FACADE_BANNERS.forEach((banner, bi) => {
      const panelH = BANNER.topY - BANNER.bottomY;
      const pivot = new THREE.Group();
      pivot.position.set(banner.x, BANNER.rodY, BANNER.z);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(BANNER.w, panelH, 0.045), mats.fabric);
      panel.position.y = BANNER.bottomY + panelH / 2 - BANNER.rodY;
      panel.castShadow = shadows;
      pivot.add(panel);
      const hem = new THREE.Mesh(new THREE.BoxGeometry(BANNER.w, 0.07, 0.07), mats.gold);
      hem.position.y = BANNER.bottomY - BANNER.rodY;
      pivot.add(hem);
      g.add(pivot);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, BANNER.w + 0.34, 8), mats.gold);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(banner.x, BANNER.rodY, BANNER.z);
      g.add(rod);
      if (look.theme === "light" && !this.reducedMotion) {
        anim.bannerSways.push({ pivot, phase: bi * 1.9 });
      }
    });

    /* ── Item 2: roofline & silhouette ── */
    for (const slab of ROOF_SLABS) box(slab, mats.stoneFor(slab.w, slab.d));
    for (const p of ROOF_PARAPETS) box(p, mats.stoneFor(Math.max(p.w, p.d), p.h));
    // Corner turrets: instanced shafts + instanced gold cone caps.
    instanced(
      new THREE.CylinderGeometry(TURRET.radius, TURRET.radius * 1.08, TURRET.topY - TURRET.baseY, 14),
      mats.facadeMarbleFor(TURRET.radius * 2, TURRET.topY - TURRET.baseY),
      TURRETS.map((t) => ({ x: t.x, y: (TURRET.baseY + TURRET.topY) / 2, z: t.z })),
    );
    instanced(
      new THREE.ConeGeometry(TURRET.radius + 0.2, TURRET.capApexY - TURRET.topY, 14),
      mats.gold,
      TURRETS.map((t) => ({ x: t.x, y: (TURRET.topY + TURRET.capApexY) / 2, z: t.z })),
    );
    // The central dome: drum + hemisphere in gold-vein marble, a
    // gold finial spike at the crown.
    {
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(DOME.drumRadius, DOME.drumRadius * 1.05, DOME.drumTopY - DOME.drumBaseY, 24),
        mats.facadeMarbleFor(DOME.drumRadius * 2, DOME.drumTopY - DOME.drumBaseY),
      );
      drum.position.set(DOME.cx, (DOME.drumBaseY + DOME.drumTopY) / 2, DOME.cz);
      drum.castShadow = shadows;
      g.add(drum);
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(DOME.domeRadius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        mats.facadeMarbleFor(DOME.domeRadius * 2, DOME.domeRadius),
      );
      shell.position.set(DOME.cx, DOME.drumTopY, DOME.cz);
      shell.castShadow = shadows;
      g.add(shell);
      const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.06, DOME.finialTopY - DOME.finialBaseY, 8), mats.gold,
      );
      spike.position.set(DOME.cx, (DOME.finialBaseY + DOME.finialTopY) / 2, DOME.cz);
      g.add(spike);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), mats.gold);
      orb.position.set(DOME.cx, DOME.finialBaseY + 0.12, DOME.cz);
      g.add(orb);
    }

    group.add(g);
  }

  /** The backdrop ring (Stage C item 5), built from
   *  palace-grounds' BACKDROP data: beyond the plaza's 1.05 m
   *  perimeter wall the world used to end in void. Now a ground
   *  skirt runs out toward the sky dome, a moat strip glints
   *  south and east, garden masses mound the middle distance, and
   *  distant palace wings stand in the fog with a few lit windows
   *  echoing the façade. Everything is silhouette, not detail:
   *  MeshBasicMaterial masses (unlit — at 40–80 m through the
   *  courtyard fog, shading is fog), FOG LEFT ON for every piece
   *  (depth is the point — the fog does the modelling), emissive
   *  windows only, never a real light. A handful of draws: three
   *  wing boxes + instanced windows + instanced garden mounds +
   *  skirt + moat. It lives on the look group like the exterior —
   *  never in a room shell (the grounds are where it's seen from)
   *  and never in the hall group. Nothing here is walkable ground
   *  and nothing needs a blocked rect: it all stands outside
   *  every walk rect, inside the 90 m dome (palace-grounds pins
   *  both). */
  private buildBackdropGrounds(group: THREE.Group, look: HallLook, anim: LookAnim): void {
    const g = new THREE.Group();
    const night = look.theme === "dark";
    const dummy = new THREE.Object3D();

    /* The ground skirt: one great disc under everything beyond
     * the grounds, coloured to fall away into the fog — near-black
     * green at dusk, hazy warm green-cream by day. */
    const skirt = new THREE.Mesh(
      new THREE.CircleGeometry(BACKDROP.skirtR, 40),
      new THREE.MeshBasicMaterial({ color: night ? 0x0a0f0a : 0x9aa578 }),
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.set(BACKDROP.moatCenter.x, BACKDROP.skirtY, BACKDROP.moatCenter.z);
    g.add(skirt);

    /* The moat glint: a flat ring segment of the look's water,
     * glossy enough to catch the sky env. Stack-100 #2: the moat
     * JOINS the animated system — its colour texture is a clone
     * registered in anim.waters with a ripple normal layer, so
     * the backdrop water lives by the same ONE water model as
     * the pool (it used to be the world's one still water). A
     * standard material (it must shade + fog), three segments'
     * worth of ring facing the plaza's open sides. */
    const waterRep = repeatForSize(8, 8, 4);
    const moatTex = hallTexture(look.waterTextureUrl, waterRep.x, waterRep.y).clone();
    moatTex.needsUpdate = true;
    const moatNormal = this.rippleNormalFor(8, 8);
    const water = new THREE.Mesh(
      new THREE.RingGeometry(BACKDROP.moatInnerR, BACKDROP.moatOuterR, 48, 1, Math.PI * 0.72, Math.PI * 0.95),
      new THREE.MeshStandardMaterial({
        map: moatTex,
        normalMap: moatNormal, normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.water, MATERIAL_NORMAL_SCALES.water),
        color: night ? 0xbfd4de : 0xdfe9e4,
        roughness: 0.12, metalness: 0.05, envMapIntensity: 1.3,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(BACKDROP.moatCenter.x, BACKDROP.moatY, BACKDROP.moatCenter.z);
    g.add(water);
    anim.waters.push({ tex: moatTex, jet: null, normalTex: moatNormal });

    /* The distant wings: unlit stone masses. Their colour is a
     * fog-veiled silhouette tone per look (dark masses at night,
     * pale wings in haze by day) — the fog finishes the blend. */
    const wingMat = new THREE.MeshBasicMaterial({ color: night ? 0x11131c : 0xd8cba6 });
    for (const wing of BACKDROP_WINGS) {
      const mass = new THREE.Mesh(new THREE.BoxGeometry(wing.w, wing.h, wing.d), wingMat);
      mass.position.set(wing.cx, wing.cy, wing.cz);
      g.add(mass);
      // A low gold-vein roofline cap per wing — one thin box that
      // catches the look's accent language at skyline scale.
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(wing.w + 0.8, 0.5, wing.d + 0.8),
        new THREE.MeshBasicMaterial({ color: night ? 0x241a08 : 0xcbb37e }),
      );
      cap.position.set(wing.cx, wing.cy + wing.h / 2 + 0.25, wing.cz);
      g.add(cap);
    }
    /* The wings' windows: ONE instanced draw of emissive planes
     * on the wings' plaza-facing sides (south faces for the two
     * northern wings, the north face for the southern pavilion),
     * echoing the façade's lit windows at distance. */
    const winStyle = backdropWindowStyle(look.theme);
    const winPlaces: Array<{ x: number; y: number; z: number; rotY: number }> = [];
    for (const wing of BACKDROP_WINGS) {
      const south = wing.cz < BACKDROP.moatCenter.z;
      for (const win of wing.windows) {
        winPlaces.push({
          x: wing.cx + win.dx,
          y: win.dy,
          z: wing.cz + (south ? wing.d / 2 + 0.06 : -wing.d / 2 - 0.06),
          rotY: south ? 0 : Math.PI,
        });
      }
    }
    const winInst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.5, 2.1),
      new THREE.MeshStandardMaterial({
        color: winStyle.color, emissive: winStyle.emissive,
        emissiveIntensity: winStyle.emissiveIntensity, roughness: 0.4, metalness: 0.1,
      }),
      winPlaces.length,
    );
    winPlaces.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      winInst.setMatrixAt(i, dummy.matrix);
    });
    winInst.instanceMatrix.needsUpdate = true;
    g.add(winInst);

    /* Garden masses: instanced squashed spheres — hedges in the
     * dark look's deep green, pale gold-green topiary by day. */
    const gardenMat = new THREE.MeshBasicMaterial({ color: night ? 0x0d2013 : 0x7d9a52 });
    const gardenInst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8), gardenMat, BACKDROP_GARDENS.length,
    );
    BACKDROP_GARDENS.forEach((m, i) => {
      dummy.position.set(m.x, 0, m.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(m.r, m.h, m.r);
      dummy.updateMatrix();
      gardenInst.setMatrixAt(i, dummy.matrix);
    });
    gardenInst.instanceMatrix.needsUpdate = true;
    g.add(gardenInst);

    group.add(g);
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
    for (const t of [floorPbr.normalMap, floorPbr.roughnessMap, floorPbr.aoMap]) registerRungSurfaceTexture(t);
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
    this.floorOverlayMat = overlay.material as THREE.MeshPhysicalMaterial;
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
    trimProfile: RoomTrimProfile = HOUSE_TRIM,
  ): void {
    const len = to - from;
    if (len <= 0.01 || y1 <= y0) return;
    const cx = (from + to) / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, 0.4), mats.wallFor(len, y1 - y0));
    wall.position.set(cx, y0 + (y1 - y0) / 2, z);
    wall.receiveShadow = QUALITY[this.quality].shadows;
    group.add(wall);
    if (y0 <= trimProfile.y && y1 >= trimProfile.y) {
      const trimMat = trimProfile.dark ? mats.goldDark : mats.gold;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.06), trimMat);
      trim.position.set(cx, trimProfile.y, z + inward * 0.24);
      group.add(trim);
      if (trimProfile.double) {
        const second = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), trimMat);
        second.position.set(cx, trimProfile.y - 0.18, z + inward * 0.24);
        group.add(second);
      }
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
    trimProfile: RoomTrimProfile = HOUSE_TRIM,
  ): void {
    const len = to - from;
    if (len <= 0.01 || y1 <= y0) return;
    const cz = (from + to) / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, y1 - y0, len), mats.wallFor(len, y1 - y0));
    wall.position.set(x, y0 + (y1 - y0) / 2, cz);
    wall.receiveShadow = QUALITY[this.quality].shadows;
    group.add(wall);
    if (y0 <= trimProfile.y && y1 >= trimProfile.y) {
      const trimMat = trimProfile.dark ? mats.goldDark : mats.gold;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, len), trimMat);
      trim.position.set(x + inward * 0.24, trimProfile.y, cz);
      group.add(trim);
      if (trimProfile.double) {
        const second = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), trimMat);
        second.position.set(x + inward * 0.24, trimProfile.y - 0.18, cz);
        group.add(second);
      }
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

  /** A BACKED, two-faced plate (Stack-100 #2 gates round): the
   *  district gates' name plates used to be one single-sided
   *  plane — from the district side a walker saw through the
   *  gate's name entirely. Now the plate is a thin gilt slab
   *  (cast + receive shadow) wearing the lettering on BOTH faces,
   *  each face reading correctly from its own side. */
  private doorPlateBacked(
    group: THREE.Group, text: string, x: number, y: number, z: number, rotY: number, width: number,
    mats: LookMaterials,
  ): void {
    const h = (width * 224) / 1024;
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = rotY;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, h + 0.06, 0.045), mats.goldDark);
    slab.castShadow = true;
    slab.receiveShadow = true;
    holder.add(slab);
    for (const side of [1, -1] as const) {
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(width, h),
        new THREE.MeshBasicMaterial({ map: doorPlateTexture(text), toneMapped: false }),
      );
      face.position.z = side * 0.026;
      if (side < 0) face.rotation.y = Math.PI;
      holder.add(face);
    }
    group.add(holder);
  }

  /* ── Water round 2 helpers (Stack-100 #2 items 5–7) ──────────
   * Every water surface in the world is built the same way: the
   * look's water colour texture (cloned, scrolled by the tick)
   * PLUS a cloned ripple normal texture the same tick counter-
   * scrolls — the surface bends light, not just slides a picture.
   * And every basin wears the wet edge: a dark band on the water
   * at its rim (plaza-life's WET_EDGE), so water meets stone
   * like water, not like a decal. */

  /** A per-surface ripple normal texture: shared pixels, own
   *  repeat + own offset (the tick animates the offset). */
  private rippleNormalFor(repeatX: number, repeatY: number): THREE.Texture {
    const tex = rippleNormalTexture().clone();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.needsUpdate = true;
    return tex;
  }

  private wetEdgeMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: WET_EDGE.color, transparent: true, opacity: WET_EDGE.opacity, depthWrite: false,
    });
  }

  /** The wet edge for a rectangular basin: four flat strips just
   *  inside the rim, hovering a breath over the water. */
  private wetEdgeRect(cx: number, cz: number, w: number, d: number, waterY: number): THREE.Group {
    const g = new THREE.Group();
    const mat = this.wetEdgeMaterial();
    const bw = WET_EDGE.width;
    const y = waterY + WET_EDGE.lift;
    const strips: Array<{ w: number; d: number; x: number; z: number }> = [
      { w, d: bw, x: cx, z: cz - d / 2 + bw / 2 },
      { w, d: bw, x: cx, z: cz + d / 2 - bw / 2 },
      { w: bw, d: d - bw * 2, x: cx - w / 2 + bw / 2, z: cz },
      { w: bw, d: d - bw * 2, x: cx + w / 2 - bw / 2, z: cz },
    ];
    for (const s of strips) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.x, y, s.z);
      m.renderOrder = 2;
      g.add(m);
    }
    return g;
  }

  /** The wet edge for a round basin: one flat ring at the rim. */
  private wetEdgeRing(cx: number, cz: number, r: number, waterY: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r - WET_EDGE.width, r, 36),
      this.wetEdgeMaterial(),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, waterY + WET_EDGE.lift, cz);
    m.renderOrder = 2;
    return m;
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
    /* Perf round 2 (item 86): the six columns instance per part —
     * same parts, same heights, same shadow flags (shaft + cap
     * cast; plinths, feet, necks, bands and abaci never did). The
     * marble style's two bands per column share one instanced
     * mesh of twelve. */
    const spots: Array<{ x: number; z: number }> = [];
    for (const x of [-12.4, 12.4]) for (const z of [-8, 0, 8]) spots.push({ x, z });
    const at = (y: number) => (d: THREE.Object3D, i: number) => d.position.set(spots[i].x, y, spots[i].z);
    instancedPart(
      group, sharedGeometry("hall-column-plinth", () => new THREE.BoxGeometry(1.5, 0.28, 1.5)),
      mats.marble, spots.length, at(0.14),
    );
    if (look.columnStyle === "gold-round") {
      instancedPart(
        group, sharedGeometry("hall-column-foot", () => new THREE.BoxGeometry(1.15, 0.18, 1.15)),
        mats.gold, spots.length, at(0.37),
      );
      instancedPart(
        group, sharedGeometry("hall-column-shaft-round", () => new THREE.CylinderGeometry(0.42, 0.5, 5.2, 20)),
        mats.gold, spots.length, at(3.06), { castShadow: shadows },
      );
      instancedPart(
        group, sharedGeometry("hall-column-neck", () => new THREE.TorusGeometry(0.46, 0.05, 8, 24)),
        mats.gold, spots.length, (d, i) => {
          d.position.set(spots[i].x, 5.6, spots[i].z);
          d.rotation.x = Math.PI / 2;
        },
      );
      instancedPart(
        group, sharedGeometry("hall-column-cap-round", () => new THREE.BoxGeometry(1.2, 0.22, 1.2)),
        mats.gold, spots.length, at(5.77), { castShadow: shadows },
      );
      instancedPart(
        group, sharedGeometry("hall-column-abacus-round", () => new THREE.BoxGeometry(1.38, 0.18, 1.38)),
        mats.gold, spots.length, at(5.97),
      );
    } else {
      instancedPart(
        group, sharedGeometry("hall-column-shaft-box", () => new THREE.BoxGeometry(0.98, 5.2, 0.98)),
        mats.marble, spots.length, at(3.06), { castShadow: shadows },
      );
      instancedPart(
        group, sharedGeometry("hall-column-band", () => new THREE.BoxGeometry(1.07, 0.09, 1.07)),
        mats.goldDark, spots.length * 2, (d, k) => {
          const s = spots[Math.floor(k / 2)];
          d.position.set(s.x, k % 2 === 0 ? 0.62 : 5.5, s.z);
        },
      );
      instancedPart(
        group, sharedGeometry("hall-column-cap-box", () => new THREE.BoxGeometry(1.3, 0.24, 1.3)),
        mats.gold, spots.length, at(5.78), { castShadow: shadows },
      );
      instancedPart(
        group, sharedGeometry("hall-column-abacus-box", () => new THREE.BoxGeometry(1.44, 0.16, 1.44)),
        mats.goldDark, spots.length, at(5.98),
      );
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
      sun.shadow.mapSize.set(QUALITY[this.quality].shadowMapSize, QUALITY[this.quality].shadowMapSize);
      sun.shadow.radius = QUALITY[this.quality].shadowRadius;
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
    /* The Stage Grounds (item 31), the Listening Gardens
     * (item 32), Creation Row (item 33), the Ateliers
     * (item 34) and the Boardwalk (item 35) stand outdoors
     * under the same sky: standing in a district, the sun/moon
     * keeps the plaza's aim and the shadow camera widens to
     * cover the district too — one light, still one shadow
     * pass. The Gardens' aim centres south, on the parterre;
     * the Row's centres east, on the makers' street; the
     * Ateliers' centres south-east, on the fine-work lane; the
     * Boardwalk's centres south, on the bandstand. Creator
     * Heights (item 36) is an enclave ON the plaza floor, so it
     * keeps the plaza's own aim and fit — its ground lies well
     * inside the plaza's shadow camera. */
    const outdoors = this.currentRoom === COURTYARD_ID || this.currentRoom === STAGE_GROUNDS_ID || this.currentRoom === LISTENING_GARDENS_ID || this.currentRoom === CREATION_ROW_ID || this.currentRoom === ATELIERS_ID || this.currentRoom === BOARDWALK_ID || this.currentRoom === HEIGHTS_ID;
    const inDistrict = this.currentRoom === STAGE_GROUNDS_ID;
    const inGardens = this.currentRoom === LISTENING_GARDENS_ID;
    const inRow = this.currentRoom === CREATION_ROW_ID;
    const inAteliers = this.currentRoom === ATELIERS_ID;
    const inBoardwalk = this.currentRoom === BOARDWALK_ID;
    if (outdoors && look.sun.present) {
      // Day on the plaza: sun high in the southern sky, so the
      // palace facade and the monument throw real shadows.
      sun.position.set(16, 25, 47);
      tgt.position.set(inBoardwalk ? 7.6 : inAteliers ? 41 : inRow ? 41 : inGardens ? -26 : inDistrict ? -14 : 0, 0, inBoardwalk ? 49 : inAteliers ? 40.5 : inRow ? 14.5 : inGardens ? 47 : 20);
      sun.color.set(look.sun.color);
      sun.intensity = look.sun.intensity;
      const fit = inDistrict || inGardens || inRow || inAteliers || inBoardwalk ? 44 : 36;
      cam.left = -fit; cam.right = fit; cam.top = fit; cam.bottom = -fit;
      cam.near = 1; cam.far = 120;
    } else if (outdoors) {
      // Night on the plaza: moonlight — cool, dim, shadow-casting.
      sun.position.set(-14, 27, 42);
      tgt.position.set(inBoardwalk ? 7.6 : inAteliers ? 41 : inRow ? 41 : inGardens ? -26 : inDistrict ? -14 : 0, 0, inBoardwalk ? 49 : inAteliers ? 40.5 : inRow ? 14.5 : inGardens ? 47 : 20);
      sun.color.set(0x93a7d4);
      sun.intensity = 0.6;
      const fit = inDistrict || inGardens || inRow || inAteliers || inBoardwalk ? 44 : 36;
      cam.left = -fit; cam.right = fit; cam.top = fit; cam.bottom = -fit;
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
    if (this.currentRoom === COURTYARD_ID || this.currentRoom === STAGE_GROUNDS_ID || this.currentRoom === LISTENING_GARDENS_ID || this.currentRoom === CREATION_ROW_ID || this.currentRoom === ATELIERS_ID || this.currentRoom === BOARDWALK_ID || this.currentRoom === HEIGHTS_ID) {
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
    /* Perf round 2 (item 91): the two chandeliers are identical,
     * so every repeated part instances — chains, both rings, the
     * sixteen candle sticks and sixteen bulbs each draw once.
     * (The census answer for the chandelier was instancing, not
     * LOD: zero swapped geometry, zero visible change.) */
    const zs = [-5, 4];
    instancedPart(
      group, sharedGeometry("chandelier-chain", () => new THREE.CylinderGeometry(0.018, 0.018, 1.5, 6)),
      mats.darkMetal, zs.length, (d, i) => d.position.set(0, 5.75, zs[i]),
    );
    instancedPart(
      group, sharedGeometry("chandelier-ring", () => new THREE.TorusGeometry(1.05, 0.05, 10, 44)),
      mats.gold, zs.length, (d, i) => {
        d.position.set(0, 4.95, zs[i]);
        d.rotation.x = Math.PI / 2;
      },
    );
    instancedPart(
      group, sharedGeometry("chandelier-ring2", () => new THREE.TorusGeometry(0.62, 0.04, 10, 36)),
      mats.gold, zs.length, (d, i) => {
        d.position.set(0, 5.22, zs[i]);
        d.rotation.x = Math.PI / 2;
      },
    );
    const candlePlace = (y: number) => (d: THREE.Object3D, k: number) => {
      const a = ((k % 8) / 8) * Math.PI * 2;
      d.position.set(Math.cos(a) * 1.05, y, zs[Math.floor(k / 8)] + Math.sin(a) * 1.05);
    };
    instancedPart(
      group, sharedGeometry("chandelier-stick", () => new THREE.CylinderGeometry(0.016, 0.016, 0.14, 6)),
      candleMat, zs.length * 8, candlePlace(5.04),
    );
    instancedPart(
      group, sharedGeometry("chandelier-bulb", () => new THREE.SphereGeometry(0.042, 10, 8)),
      bulbMat, zs.length * 8, candlePlace(5.16),
    );
    const glow = new THREE.PointLight(0xffd9a0, 34, 22, 1.8);
    glow.position.set(0, 4.7, -0.5);
    group.add(glow);
  }

  /** Fire braziers flanking the dais (Look B) — bronze bowls, live
   *  flame sprites, and a real flickering light on stronger tiers. */
  private buildBraziers(group: THREE.Group, mats: LookMaterials, anim: LookAnim): void {
    const bronze = new THREE.MeshStandardMaterial({ color: 0x4a3418, metalness: 0.85, roughness: 0.4 });
    /* Perf round 2 (item 87): the solid parts instance across
     * the pair (same shared geometries as the plaza set); the
     * flame + glow sprites stay per-brazier, at the same world
     * positions their brazier groups used to give them. */
    const xs = [-3.6, 3.6];
    instancedPart(
      group, sharedGeometry("brazier-pedestal", () => new THREE.CylinderGeometry(0.09, 0.14, 0.5, 10)),
      mats.darkMetal, xs.length, (d, i) => d.position.set(xs[i], 0.25, -11.3),
    );
    instancedPart(
      group, sharedGeometry("brazier-bowl", () => new THREE.CylinderGeometry(0.46, 0.18, 0.3, 18)),
      bronze, xs.length, (d, i) => d.position.set(xs[i], 0.65, -11.3),
    );
    instancedPart(
      group, sharedGeometry("brazier-coals", () => new THREE.CircleGeometry(0.4, 20)),
      new THREE.MeshBasicMaterial({ color: 0xff7a26 }), xs.length, (d, i) => {
        d.position.set(xs[i], 0.79, -11.3);
        d.rotation.x = -Math.PI / 2;
      },
    );
    for (const x of xs) {
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      flame.scale.set(0.6, 0.95, 1);
      flame.position.set(x, 1.18, -11.3);
      group.add(flame);
      anim.flames.push({ sprite: flame, baseX: 0.6, baseY: 0.95, phase: Math.random() * 20 });
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTexture(), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.set(1.7, 1.7, 1);
      glow.position.set(x, 1.15, -11.3);
      group.add(glow);
      this.addEmbers(group, anim, x, 0.82, -11.3, `${x},-11.3`);
      if (QUALITY[this.quality].brazierLights) {
        const light = new THREE.PointLight(0xff9040, 26, 13, 1.9);
        light.position.set(x, 1.35, -11.3);
        group.add(light);
        anim.flickerLights.push({ light, base: 26, phase: Math.random() * 20 });
        /* Item 13: the dais braziers join the one shadow-casting
         * local light class (ruled in applyLocalShadowLights). */
        this.brazierShadowLights.push(light);
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
    /* Item 99: the rung's particle scale draws a prefix of the
     * motes — geometry is built full-size so a step UP restores
     * them without a rebuild (applyTierToRenderer re-ranges). */
    geo.setDrawRange(0, Math.floor(count * QUALITY[this.quality].particleScale));
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
    this.buildStageGroundsShell(group, look, mats, anim);
    this.buildListeningGardensShell(group, look, mats, anim);
    this.buildCreationRowShell(group, look, mats, anim);
    this.buildAteliersShell(group, look, mats, anim);
    this.buildBoardwalkShell(group, look, mats, anim);
    this.buildCreatorHeightsShell(group, look, mats, anim);
    this.buildCreatorRoomShell(group, look, mats);
    this.applyRoomVisibility();
  }

  /** A polished marble floor (no reflector — the hall owns the one
   *  mirror) with the palace's gold inlay border. */
  private shellFloor(
    g: THREE.Group, look: HallLook, mats: LookMaterials,
    rect: { minX: number; maxX: number; minZ: number; maxZ: number },
    kind: PbrKind,
    /* Stage C item 6: an alternate wearing surface for OUTDOOR
     * floors — the courtyard passes the look's paving (its own
     * texture + tile size). Indoor shells omit it and keep the
     * marble exactly as before. */
    surface?: { url: string; metresPerTile: number },
  ): void {
    const w = rect.maxX - rect.minX;
    const d = rect.maxZ - rect.minZ;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    /* Per-metre repeat (item 7) — the old code rounded w/7 to whole
     * tiles, so every rect snapped to a different texel density.
     * Derived PBR maps ride along (item 9); roughness is encoded
     * in the kind's map, so the scalar is 1. */
    const texUrl = surface?.url ?? look.marbleTextureUrl;
    const rep = repeatForSize(w, d, surface?.metresPerTile ?? MARBLE_METRES_PER_TILE);
    const map = hallTexture(texUrl, rep.x, rep.y);
    const pbr = derivedPbrTextures(texUrl, kind, rep.x, rep.y);
    for (const t of [pbr.normalMap, pbr.roughnessMap, pbr.aoMap]) registerRungSurfaceTexture(t);
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
    registerRungSurfaceTexture(lanternGoldMaps.normalMap);
    registerRungSurfaceTexture(lanternGoldMaps.roughnessMap);
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
    /* Stack-100 #2 item 41: each room wears its OWN trim —
     * height, profile and accent from room-trim.ts — so the six
     * wing rooms stop reading as one shell re-skinned. */
    const trim = roomTrimProfile(roomId);
    if (west) {
      this.wallRunZ(g, mats, -28.4, interior.minZ - 0.2, interior.maxZ + 0.2, 0, 6.5, 1, trim);
      this.wallRunX(g, mats, interior.minZ - 0.2, -28.4, -14.2, 0, 6.5, 1, trim);
      this.wallRunX(g, mats, interior.maxZ + 0.2, -28.4, -14.2, 0, 6.5, -1, trim);
    } else {
      this.wallRunZ(g, mats, 28.4, interior.minZ - 0.2, interior.maxZ + 0.2, 0, 6.5, -1, trim);
      this.wallRunX(g, mats, interior.minZ - 0.2, 14.2, 28.4, 0, 6.5, 1, trim);
      this.wallRunX(g, mats, interior.maxZ + 0.2, 14.2, 28.4, 0, 6.5, -1, trim);
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

    /* Interior dressing parity (Stack-100 #2, items 39–47 tail):
     * every wing room — Treasury, Royal Court, Branding Atelier
     * and their west-side siblings — carries the same floor
     * dressing from this one builder: a fabric rug inlay with a
     * gold border at the room's heart, sized from its own
     * interior. Flat inlay like every palace path — no collision,
     * and no room is left barer than another. */
    {
      const rugW = (interior.maxX - interior.minX) * 0.52;
      const rugD = (interior.maxZ - interior.minZ) * 0.52;
      const border = new THREE.Mesh(new THREE.BoxGeometry(rugW + 0.24, 0.014, rugD + 0.24), mats.goldDark);
      border.position.set(cx, 0.028, cz);
      g.add(border);
      const rug = new THREE.Mesh(new THREE.BoxGeometry(rugW, 0.018, rugD), mats.fabric);
      rug.position.set(cx, 0.032, cz);
      rug.receiveShadow = QUALITY[this.quality].shadows;
      g.add(rug);
    }

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
      /* LOD foundation (item 99): markers are dressing — far ones
       * simplify (gem + plate rest) and then hide, per rung. */
      this.lodItems.push({ obj: g, x: s.x, z: s.z, detail: [gem, plate] });
    }
  }

  private buildCourtyardShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();

    /* Floors (Open World Phase 1): the plaza's interior now spans
     * z to 34 across the full width, but the Creator Room template
     * owns its own floor south-east (interior x 2.6..16.4,
     * z 26.4..38) — one rect over both would z-fight it. Tile
     * instead: the main grounds, then the promenade, abutting at
     * z 26 with no overlap. The finish is the item-6 paving now.
     * (The west gate gap at z 18.4..20.6 is a true passage since
     * item 31 — the Stage Grounds shell floors the ground beyond
     * it and the gate's bar is gone; the Boardwalk gap in the
     * south wall stays barred, its district unbuilt.) */
    /* Outdoor ground system (Stage C item 6): the broad plaza
     * floor is real PAVING now — the look's setts with derived
     * joint relief — not the hall's interior marble dragged
     * outdoors. The three rects keep their footprints; the marble
     * survives as the accent language it is indoors (the central
     * path, the arch spur, the monument ring below). */
    const pavingSurface = { url: look.pavingTextureUrl, metresPerTile: PAVING_METRES_PER_TILE };
    /* The Creator Heights enclave (item 36) owns its own floor
     * on the north-east quadrant (interior x 13.5..28.2,
     * z 15.9..25.7) — the tiling cedes that footprint to the
     * Heights shell exactly as it cedes the Creator Room's, so
     * no two underlays ever coincide: west of the enclave, the
     * north-east lane strip north of it, and the sliver south
     * of it down to the z 26 abut line. */
    this.shellFloor(g, look, mats, { minX: -28.2, maxX: 13.5, minZ: 12.4, maxZ: 26.0 }, "paving", pavingSurface);
    this.shellFloor(g, look, mats, { minX: 13.5, maxX: 28.2, minZ: 12.4, maxZ: 15.9 }, "paving", pavingSurface);
    this.shellFloor(g, look, mats, { minX: 13.5, maxX: 28.2, minZ: 25.7, maxZ: 26.0 }, "paving", pavingSurface);
    this.shellFloor(g, look, mats, { minX: -28.2, maxX: 2.6, minZ: 26.0, maxZ: 34.0 }, "paving", pavingSurface);
    /* The south-east patch (overhaul stage 3): east of the Creator
     * Room's floor and south of the main grounds, the shipped plan
     * laid NO floor at all — background void showed under the east
     * lawn's edge. This rect abuts the creator floor (x 16.4) and
     * the main grounds (z 26) without overlapping either. */
    this.shellFloor(g, look, mats, { minX: 16.4, maxX: 28.2, minZ: 26.0, maxZ: 34.0 }, "paving", pavingSurface);
    /* The wearing course: whole-tile paving slabs (palace-grounds'
     * PAVING_SLABS — every slab exactly one texture tile, so the
     * sett joints stay even and integral per the art manifest),
     * instanced in ONE draw a hair above the underlay rects. The
     * underlay catches the margins no whole tile fits. */
    {
      /* The Heights enclave's slabs are the Heights shell's to
       * lay (item 36): the plaza's whole-tile plan is filtered
       * past the enclave's footprint so no slab is drawn twice. */
      const plazaSlabs = PAVING_SLABS.filter(
        (s) => !(s.cx > HEIGHTS_INTERIOR.minX && s.cx < HEIGHTS_INTERIOR.maxX && s.cz > HEIGHTS_INTERIOR.minZ && s.cz < HEIGHTS_INTERIOR.maxZ),
      );
      const slabInst = new THREE.InstancedMesh(
        sharedGeometry("paving-slab", () => new THREE.BoxGeometry(4, 0.03, 4)), mats.pavingFor(4, 4), plazaSlabs.length,
      );
      const dummy = new THREE.Object3D();
      plazaSlabs.forEach((s, i) => {
        dummy.position.set(s.cx, 0.015, s.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        slabInst.setMatrixAt(i, dummy.matrix);
      });
      slabInst.instanceMatrix.needsUpdate = true;
      slabInst.receiveShadow = QUALITY[this.quality].shadows;
      g.add(slabInst);
    }

    // Low marble walls with a gold cap on the open sides (the
    // fourth side is the hall's own back wall + the arch through
    // it). The runs are palace-layout's PLAZA_WALL_RUNS — one
    // enclosure now (item 42): the east wall runs the grounds'
    // full length, a south run closes the south-east yard (itself
    // walkable plaza ground since item 34 — the notch wall that
    // used to stand on the main grounds' south edge east of the
    // Creator Room is gone with the invisible boundary it hid),
    // and two short returns flank the Creator Rooms arch
    // (item 41). Five gates pierce the runs: a 2.2 m gap
    // in the west wall at z ≈ 19.5 (Stage Grounds), one in the
    // south promenade wall at x ≈ 0 (the Boardwalk), one in
    // the south wall at x ≈ −26 (the Listening Gardens, on the
    // old marker's line), one in the east wall at z ≈ 14.5
    // (Creation Row, on its old marker's line), and one in the
    // east wall's south run at z ≈ 30.5 (the Ateliers — not on
    // its old marker's line at z 22.5, which opens into the
    // built Creation Row; z 30.5 opens into the Ateliers quarter
    // south of the Row). The Boardwalk gap stays barred and the
    // walk rects end inside it; the Stage Grounds gap is walked
    // through since item 31, the Gardens gap since item 32, the
    // Row gap since item 33 and the Ateliers gap since item 34
    // (their districts are built — see buildStageGroundsShell /
    // buildListeningGardensShell / buildCreationRowShell /
    // buildAteliersShell).
    // Every run is a blocked rect in the layout, derived from
    // this same list.
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
    for (const run of PLAZA_WALL_RUNS) lowWall(run.w, run.d, run.x, run.z);

    // Columns where the walls turn — grounded piers now (item
    // 43): the plinth stands ON THE GROUND and the shaft rises
    // from it through the low wall's line to the same gold cap at
    // the same height as before (the shipped build grew the shaft
    // out of a plinth floating on the knee wall's cap, supporting
    // nothing). Positions are palace-layout's PLAZA_COLUMNS —
    // footprints blocked there from the same list. Variation
    // (item 18): each pier takes its deterministic jitter — a
    // breath of scale, its own marble tint, one of three cap
    // treatments; the scale is anchored at the ground, so a
    // varied pier still lands.
    /* Perf round 2 (item 86): the eight columns instance — the
     * group scale rides each instance matrix, the shaft's cloned
     * tint becomes instanceColor on the same white-based shared
     * marble (tintColor, perf-census.ts), and the caps split by
     * their variant material exactly as the per-column build did. */
    const columnPlace = (localY: number) => (d: THREE.Object3D, i: number) => {
      const c = PLAZA_COLUMNS[i];
      const v = propVariation("column", i);
      d.position.set(c.x, localY * v.scaleY, c.z);
      d.scale.set(v.scale, v.scaleY, v.scale);
    };
    instancedPart(
      g, sharedGeometry("pier-plinth", () => new THREE.BoxGeometry(0.9, 0.3, 0.9)),
      mats.marble, PLAZA_COLUMNS.length, columnPlace(0.15),
    );
    instancedPart(
      g, sharedGeometry("pier-shaft", () => new THREE.BoxGeometry(0.62, 3.54, 0.62)),
      mats.marble, PLAZA_COLUMNS.length, columnPlace(0.3 + 3.54 / 2),
      {
        castShadow: QUALITY[this.quality].shadows,
        colorAt: (i) => tintColor(0xffffff, propVariation("column", i)),
      },
    );
    const goldCapIdx = PLAZA_COLUMNS.map((_, i) => i).filter((i) => propVariation("column", i).variant !== 2);
    const darkCapIdx = PLAZA_COLUMNS.map((_, i) => i).filter((i) => propVariation("column", i).variant === 2);
    const stepIdx = PLAZA_COLUMNS.map((_, i) => i).filter((i) => propVariation("column", i).variant === 1);
    if (goldCapIdx.length > 0) {
      instancedPart(
        g, sharedGeometry("pier-cap", () => new THREE.BoxGeometry(0.86, 0.18, 0.86)),
        mats.gold, goldCapIdx.length, (d, k) => columnPlace(3.93)(d, goldCapIdx[k]),
      );
    }
    if (darkCapIdx.length > 0) {
      instancedPart(
        g, sharedGeometry("pier-cap", () => new THREE.BoxGeometry(0.86, 0.18, 0.86)),
        mats.goldDark, darkCapIdx.length, (d, k) => columnPlace(3.93)(d, darkCapIdx[k]),
      );
    }
    if (stepIdx.length > 0) {
      instancedPart(
        g, sharedGeometry("column-cap-step", () => new THREE.BoxGeometry(0.72, 0.09, 0.72)),
        mats.goldDark, stepIdx.length, (d, k) => columnPlace(3.79)(d, stepIdx[k]),
      );
    }

    /* Lawns & planting (Stage C item 8): the two flat plastic
     * slabs are real lawns now. Each panel keeps EXACTLY its
     * shipped footprint (20.5 × 11.0 at (±16.75, 19.2)) and its
     * walk semantics (grass was stroll-across ground and stays
     * so — nothing here is blocked), but it is built as a garden:
     * a shallow ashlar bed, textured grass at per-metre repeats
     * in the look's lawn (deep dusk green / bright day green),
     * stone edging on the rim, a gold parterre medallion at its
     * heart, and low planting masses in the planter-crown
     * language (item-18 variation, instanced). */
    {
      const shadows = QUALITY[this.quality].shadows;
      const dummy = new THREE.Object3D();
      /* Item 36: the Creator Heights enclave stands on the east
       * lawn's eastern share (its wall at x 13.5). LAWN_PANELS
       * data is untouched — the build CLIPS the east panel to
       * the strip west of the wall (x 6.5..13.5), exactly the
       * ground the plaza still owns there; the quarter's own
       * green is its planters and terrace crowns. The clipped
       * panel gets no medallion (its heart is the enclave's
       * court now), and the per-panel grass size below replaces
       * the old shared size, which only held while both panels
       * matched. */
      const lawnPanels = LAWN_PANELS.map((p) =>
        p.cx > 0 ? { panel: { ...p, cx: 10.0, w: 7.0 }, clipped: true } : { panel: p, clipped: false },
      );
      /* Edging: one instanced draw for all eight rim runs. */
      const edging = lawnPanels.flatMap(({ panel }) => lawnEdgingRuns(panel));
      const edgeInst = new THREE.InstancedMesh(
        sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)), mats.stoneFor(2, 0.3), edging.length,
      );
      edging.forEach((b, i) => {
        /* +0.025: the curb stands a hair proud of the bed's top
         * face — coplanar stone-on-stone would z-fight. */
        dummy.position.set(b.cx, b.cy + 0.025, b.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        edgeInst.setMatrixAt(i, dummy.matrix);
      });
      edgeInst.instanceMatrix.needsUpdate = true;
      edgeInst.castShadow = shadows;
      g.add(edgeInst);
      /* Planting crowns: one instanced draw for both lawns'
       * parterres, jitter + tint per crown from prop-variation. */
      const spots = lawnPanels.flatMap(({ panel }, pi) =>
        lawnPlantingSpots(panel)
          .filter((s) => Math.abs(s.x - panel.cx) < panel.w / 2 - LAWN_BED.inset && Math.abs(s.z - panel.cz) < panel.d / 2 - LAWN_BED.inset)
          .map((s, si) => ({ ...s, index: pi * 100 + si })),
      );
      const crownInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.44, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        spots.length,
      );
      const crownColor = new THREE.Color(0x2e5d33);
      spots.forEach((s, i) => {
        const cv = propVariation("crown", s.index);
        dummy.position.set(s.x, LAWN_PANELS[0]!.topY + 0.18, s.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale * 1.25, cv.scale * cv.scaleY * 0.72, cv.scale * 1.25);
        dummy.updateMatrix();
        crownInst.setMatrixAt(i, dummy.matrix);
        crownInst.setColorAt(i, crownColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      crownInst.castShadow = shadows;
      g.add(crownInst);
      for (const { panel, clipped } of lawnPanels) {
        const grassW = panel.w - LAWN_BED.inset * 2;
        const grassD = panel.d - LAWN_BED.inset * 2;
        const bed = new THREE.Mesh(
          new THREE.BoxGeometry(panel.w, LAWN_BED.rimH, panel.d),
          mats.stoneFor(panel.w, LAWN_BED.rimH),
        );
        bed.position.set(panel.cx, LAWN_BED.rimH / 2, panel.cz);
        bed.receiveShadow = shadows;
        g.add(bed);
        const grass = new THREE.Mesh(
          new THREE.BoxGeometry(grassW, 0.04, grassD), mats.lawnFor(grassW, grassD),
        );
        grass.position.set(panel.cx, panel.topY - 0.02, panel.cz);
        grass.receiveShadow = shadows;
        g.add(grass);
        if (clipped) continue;
        const medallion = new THREE.Mesh(
          new THREE.RingGeometry(PARTERRE_MEDALLION.innerR, PARTERRE_MEDALLION.outerR, 40),
          mats.goldDark,
        );
        medallion.rotation.x = -Math.PI / 2;
        medallion.position.set(panel.cx, panel.topY + 0.006, panel.cz);
        medallion.renderOrder = 3;
        g.add(medallion);
      }
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

    /* The arch spur (item 41): the same marble-and-gold language
     * turned east–west, from the main path's edge to the Creator
     * Rooms arch's forecourt, so the arch is ARRIVED at, not
     * floated past. It runs along the creator wall's face on the
     * layout's spur grounds (z 25.6..26.05 walkable); the two
     * return walls flank the forecourt at its end, standing on
     * the path's line like gateposts — the walk baffles around
     * the west return's end and in between the pair. */
    {
      const spurFromX = 1.8;
      const spurToX = 10.6;
      const spurLen = spurToX - spurFromX;
      const spurCx = (spurFromX + spurToX) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(spurLen, 0.016, 1.4), mats.marble);
      slab.position.set(spurCx, 0.022, 25.5);
      g.add(slab);
      for (const sz of [24.87, 26.13]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(spurLen, 0.012, 0.07), mats.goldDark);
        strip.position.set(spurCx, 0.028, sz);
        g.add(strip);
      }
    }

    /* ── The Kingdom Board monument (0, 19.7), plaza centre ──────
     * GROWN (Stage C item 17), built from palace-grounds'
     * MONUMENT plan: a three-tier stepped plinth (the tiers are
     * item 38's massing steps up the plinth) in gold-vein marble,
     * a taller BEVELLED stele wearing gold relief bands and a
     * relief panel, urn finials on pedestals at the plinth
     * corners in place of the old 0.09 m spheres, a real crown —
     * fluted cap, orb and spike — where the flat cone sat, and a
     * wider gold ring inlay in the ground around it. The stele's
     * plate drum is UNCHANGED — same 1.74 m housing at the same
     * centre height, same four faces at the same size — so item
     * 16's lettered plate (the board's real headlines,
     * monument-board.ts, repainted through setMonumentBoardData)
     * renders exactly as it did. The live board itself still
     * opens in the station panel at the board station (its marker
     * stands on the open plaza just south of the plinth, built by
     * buildStationMarkers like every station). No mirror, no
     * lights of its own. The grown plinth's blocked rect grew in
     * the same batch (palace-layout's MONUMENT_BLOCKED). */
    {
      const M = MONUMENT;
      const monument = new THREE.Group();
      monument.position.set(M.cx, 0, M.cz);
      const shadows = QUALITY[this.quality].shadows;
      const tier = (size: number, h: number, topY: number) => {
        const t = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), mats.facadeMarbleFor(size, h));
        t.position.y = topY - h / 2;
        t.castShadow = shadows;
        t.receiveShadow = shadows;
        monument.add(t);
      };
      const trim = (size: number, h: number, y: number, mat: THREE.Material) => {
        const t = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), mat);
        t.position.y = y;
        monument.add(t);
      };
      tier(M.tier1.size, M.tier1.h, M.tier1.topY);
      trim(M.tier1Trim.size, M.tier1Trim.h, M.tier1.topY + M.tier1Trim.h / 2, mats.goldDark);
      tier(M.tier2.size, M.tier2.h, M.tier2.topY);
      trim(M.tier2Trim.size, M.tier2Trim.h, M.tier2.topY + M.tier2Trim.h / 2, mats.gold);
      tier(M.tier3.size, M.tier3.h, M.tier3.topY);
      /* The bevelled stele: a four-sided frustum (cylinder with
       * 4 radial segments, turned to the square) — wider at its
       * foot, narrower at the crown, in gold-vein marble. */
      const steleH = M.stele.topY - M.stele.baseY;
      const stele = new THREE.Mesh(
        new THREE.CylinderGeometry(
          (M.stele.topW / 2) * Math.SQRT2, (M.stele.baseW / 2) * Math.SQRT2,
          steleH, 4, 1, false, Math.PI / 4, Math.PI * 2,
        ),
        mats.facadeMarbleFor(M.stele.baseW, steleH),
      );
      /* thetaStart π/4 puts the four faces square to the plaza
       * (no mesh rotation), so this z-squash — the stele is
       * shallower than it is wide — acts in world axes and the
       * cross-section stays a true rectangle at every height
       * (top depth = topW × baseD/baseW, as the plan records). */
      stele.scale.z = M.stele.baseD / M.stele.baseW;
      stele.position.y = M.stele.baseY + steleH / 2;
      stele.castShadow = shadows;
      monument.add(stele);
      /* Relief banding: gold bands proud of ALL FOUR faces of
       * the stele at the plan's heights (Stack-100 #2 monument
       * finish — the relief used to wrap only front and back, so
       * the stele's flanks were bald) — widths following the
       * frustum's taper at those heights, gold at per-metre
       * repeats. */
      for (const bandY of M.reliefBandYs) {
        const t = (bandY - M.stele.baseY) / steleH;
        const wAt = M.stele.baseW + (M.stele.topW - M.stele.baseW) * t;
        const dAt = M.stele.baseD + (M.stele.topD - M.stele.baseD) * t;
        for (const sz of [-1, 1] as const) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(wAt + 0.1, 0.11, 0.05), mats.goldFor(wAt + 0.1, 0.11));
          band.position.set(0, bandY, sz * (dAt / 2 + 0.012));
          monument.add(band);
          const flank = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, dAt + 0.1), mats.goldFor(dAt + 0.1, 0.11));
          flank.position.set(sz * (wAt / 2 + 0.012), bandY, 0);
          monument.add(flank);
        }
      }
      /* The relief panel: a gold relief in a dark-gold frame,
       * below the plate drum — now on ALL FOUR faces (it lived
       * on the south face alone), each face turned outward. The
       * stele is a shallow slab (1.9 wide × 0.56 deep), so the
       * flank panels take the flank's own width and stand on the
       * flank's own surface — same relief, honestly sized. */
      {
        const t142 = (1.42 - M.stele.baseY) / steleH;
        const wAt142 = M.stele.baseW + (M.stele.topW - M.stele.baseW) * t142;
        const dAt142 = M.stele.baseD + (M.stele.topD - M.stele.baseD) * t142;
        for (const [rotY, faceW, out] of [
          [0, 0.92, M.stele.baseD / 2 + 0.03],
          [Math.PI, 0.92, M.stele.baseD / 2 + 0.03],
          [Math.PI / 2, Math.min(0.4, dAt142 - 0.1), wAt142 / 2 + 0.03],
          [-Math.PI / 2, Math.min(0.4, dAt142 - 0.1), wAt142 / 2 + 0.03],
        ] as Array<[number, number, number]>) {
          const faceGroup = new THREE.Group();
          faceGroup.rotation.y = rotY;
          const panel = new THREE.Mesh(new THREE.BoxGeometry(faceW, 0.62, 0.045), mats.goldDarkFor(faceW, 0.62));
          panel.position.set(0, 1.42, out);
          faceGroup.add(panel);
          const relief = new THREE.Mesh(new THREE.BoxGeometry(faceW * 0.8, 0.44, 0.03), mats.goldFor(faceW * 0.8, 0.44));
          relief.position.set(0, 1.42, out + 0.025);
          faceGroup.add(relief);
          monument.add(faceGroup);
        }
      }
      /* The plate drum: a square housing around the stele at
       * reading height, so the plate has four equal faces to
       * live on (the stele's own section could only ever letter
       * two). One shared texture — the board reads the same from
       * every approach — re-mapped in place by
       * setMonumentBoardData when the words change. */
      const drum = new THREE.Mesh(
        new THREE.BoxGeometry(M.drum.size, M.drum.h, M.drum.size), mats.facadeMarbleFor(M.drum.size, M.drum.h),
      );
      drum.position.y = M.drum.centerY;
      drum.castShadow = shadows;
      monument.add(drum);
      const plateTex = kingdomBoardPlateTexture(look.theme);
      for (const [fx, fz, rotY] of [
        [0, M.drum.faceOffset, 0],
        [0, -M.drum.faceOffset, Math.PI],
        [M.drum.faceOffset, 0, Math.PI / 2],
        [-M.drum.faceOffset, 0, -Math.PI / 2],
      ] as Array<[number, number, number]>) {
        /* Monument finish (Stack-100 #2): the plate face is LIT
         * PBR now — a standard material that takes the plaza's
         * light like gilt stone, with the plate itself as its
         * emissive map so after dark the board glows with its own
         * words (monument-board's per-theme intensity). */
        const faceMat = new THREE.MeshStandardMaterial({
          map: plateTex,
          emissiveMap: plateTex,
          emissive: 0xffffff,
          emissiveIntensity: monumentPlateEmissiveIntensity(look.theme),
          roughness: 0.38, metalness: 0.15, envMapIntensity: 0.8,
        });
        const face = new THREE.Mesh(new THREE.PlaneGeometry(M.drum.faceW, M.drum.faceH), faceMat);
        face.position.set(fx, M.drum.centerY, fz);
        face.rotation.y = rotY;
        monument.add(face);
        this.monumentFaceMats.push(faceMat);
      }
      /* The crown: a fluted gold cap (12-segment cone, wider and
       * taller than the old flat 4-sided cone), an orb on its
       * neck, and a spike — a finial with presence at plaza
       * scale. */
      const crownCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, M.crown.capR, M.crown.capTopY - M.crown.capBaseY, 12),
        mats.goldFor(M.crown.capR * 2, M.crown.capTopY - M.crown.capBaseY),
      );
      crownCap.position.y = (M.crown.capBaseY + M.crown.capTopY) / 2;
      crownCap.castShadow = shadows;
      monument.add(crownCap);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(M.crown.orbR, 14, 12), mats.gold);
      orb.position.y = M.crown.orbY;
      monument.add(orb);
      const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.055, M.crown.spikeTopY - M.crown.orbY, 8), mats.gold,
      );
      spike.position.y = (M.crown.orbY + M.crown.spikeTopY) / 2;
      monument.add(spike);
      /* Urn finials on the plinth corners, replacing the 0.09 m
       * spheres: a marble pedestal on tier 2's surface at each
       * corner, a gold urn (foot, belly, lip) and a small gold
       * ball crown. */
      for (const fx of [-M.urns.at, M.urns.at]) {
        for (const fz of [-M.urns.at, M.urns.at]) {
          const pedestal = new THREE.Mesh(
            new THREE.BoxGeometry(0.34, M.urns.pedestalH, 0.34), mats.facadeMarbleFor(0.34, M.urns.pedestalH),
          );
          pedestal.position.set(fx, M.tier2.topY + M.urns.pedestalH / 2, fz);
          monument.add(pedestal);
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.07, 10), mats.gold);
          foot.position.set(fx, M.urns.urnBaseY + 0.035, fz);
          monument.add(foot);
          const belly = new THREE.Mesh(new THREE.SphereGeometry(M.urns.urnR, 12, 10), mats.gold);
          belly.scale.y = 1.25;
          belly.position.set(fx, M.urns.urnBaseY + 0.07 + M.urns.urnR * 1.1, fz);
          monument.add(belly);
          const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 0.07, 10), mats.gold);
          lip.position.set(fx, M.urns.urnTopY - 0.1, fz);
          monument.add(lip);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mats.gold);
          ball.position.set(fx, M.urns.urnTopY, fz);
          monument.add(ball);
        }
      }
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(M.ring.innerR, M.ring.outerR, 56), mats.goldDark,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.016;
      ring.renderOrder = 3;
      monument.add(ring);
      g.add(monument);
    }

    /* Elevation (Stage C item 38): ceremonial steps flanking the
     * hall-arch approach and stepped terraces massing the
     * grounds' east/west edges — visual elevation AROUND the walk
     * paths; the path itself stays clear. Stack-100 #2 finished
     * the climbable-Y the round-1 build parked: palace-layout
     * derives climbable step zones from this same data
     * (HALL_STEP_ZONES / TERRACE_ZONES at the masses' authored
     * tops), movement carries a real Y, and the blocked lists
     * (HALL_STEPS_BLOCKED / TERRACE_BLOCKED) remain the masses'
     * footprint record. */
    {
      const shadows = QUALITY[this.quality].shadows;
      const dummy = new THREE.Object3D();
      const steps = hallStepRuns();
      const stepInst = new THREE.InstancedMesh(
        sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)), mats.stoneFor(3.5, 0.4), steps.length,
      );
      steps.forEach((b, i) => {
        dummy.position.set(b.cx, b.cy, b.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        stepInst.setMatrixAt(i, dummy.matrix);
      });
      stepInst.instanceMatrix.needsUpdate = true;
      stepInst.castShadow = shadows;
      stepInst.receiveShadow = shadows;
      g.add(stepInst);
      /* Gold nosing on the hall platforms' front edges. */
      for (const sx of [-1, 1] as const) {
        const nosing = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.05, 0.06), mats.gold);
        nosing.position.set(sx * 3.85, 0.36, 15.19);
        g.add(nosing);
      }
      const terraces = terraceRuns();
      const terraceInst = new THREE.InstancedMesh(
        sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)), mats.stoneFor(3.2, 0.6), terraces.length,
      );
      terraces.forEach((b, i) => {
        dummy.position.set(b.cx, b.cy, b.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        terraceInst.setMatrixAt(i, dummy.matrix);
      });
      terraceInst.instanceMatrix.needsUpdate = true;
      terraceInst.castShadow = shadows;
      terraceInst.receiveShadow = shadows;
      g.add(terraceInst);
      /* Planting on the terraces' top steps: crown masses in the
       * planter language, one instanced draw, on blocked ground. */
      const terraceCrowns: Array<{ x: number; z: number }> = [];
      for (const sx of [-1, 1] as const) {
        for (const cz of [14.1, 15.0, 15.9]) terraceCrowns.push({ x: sx * 27.06, z: cz });
      }
      const tcInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.44, 1),
        new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 1, metalness: 0, flatShading: true }),
        terraceCrowns.length,
      );
      terraceCrowns.forEach((s, i) => {
        const cv = propVariation("crown", 500 + i);
        dummy.position.set(s.x, 1.12, s.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale * 1.3, cv.scale * cv.scaleY * 0.8, cv.scale * 1.3);
        dummy.updateMatrix();
        tcInst.setMatrixAt(i, dummy.matrix);
      });
      tcInst.instanceMatrix.needsUpdate = true;
      tcInst.castShadow = shadows;
      g.add(tcInst);
    }

    // Planters along the side walls and down the promenade: marble
    // troughs, green crowns — the original construction, spread to
    // the plaza's new scale (nine in all). Trough bodies instance
    // (item 25) with their jitter carried in the instance matrix;
    // everything else takes its deterministic variation from
    // prop-variation.ts (item 18) — crowns turn freely, stretch
    // tall or squat, and wear their own leaf tint; troughs
    // breathe in scale and take one of three rim treatments
    // (plain, gold trim, dark trim). The ninth planter is not a
    // clone of the first, on any visit.
    const troughGeoZ = sharedGeometry("trough-z", () => new THREE.BoxGeometry(0.72, 0.55, 2.0));
    const troughGeoX = sharedGeometry("trough-x", () => new THREE.BoxGeometry(2.0, 0.55, 0.72));
    /* Trough bodies instance (item 25): one draw per orientation,
     * matrices carrying each trough's item-18 jitter (rotation +
     * uniform scale) — variation survives instancing because it
     * lives in the transform. Rim trims and crowns stay individual
     * meshes: they carry cloned tinted materials and variant
     * geometry that one shared material cannot express. */
    const spotsZ = PLAZA_PLANTERS.filter((pl) => pl.alongZ);
    const spotsX = PLAZA_PLANTERS.filter((pl) => !pl.alongZ);
    const troughZInst = new THREE.InstancedMesh(troughGeoZ, mats.marble, spotsZ.length);
    const troughXInst = new THREE.InstancedMesh(troughGeoX, mats.marble, spotsX.length);
    troughZInst.frustumCulled = false;
    troughXInst.frustumCulled = false;
    {
      const dummy = new THREE.Object3D();
      const putTrough = (im: THREE.InstancedMesh, p: (typeof PLAZA_PLANTERS)[number], index: number) => {
        const tv = propVariation("trough", index);
        dummy.position.set(p.x, 0.275, p.z);
        dummy.rotation.set(0, tv.rotY, 0);
        dummy.scale.setScalar(tv.scale);
        dummy.updateMatrix();
        im.setMatrixAt(index, dummy.matrix);
      };
      spotsZ.forEach((pl, i) => putTrough(troughZInst, pl, PLAZA_PLANTERS.indexOf(pl)));
      spotsX.forEach((pl, i) => putTrough(troughXInst, pl, PLAZA_PLANTERS.indexOf(pl)));
      troughZInst.instanceMatrix.needsUpdate = true;
      troughXInst.instanceMatrix.needsUpdate = true;
    }
    g.add(troughZInst);
    g.add(troughXInst);
    /* Positions are palace-layout's PLAZA_PLANTERS — the layout
     * derives each trough's blocked rect from this same list. */
    PLAZA_PLANTERS.forEach((p, index) => {
      const tv = propVariation("trough", index);
      if (tv.variant !== 0) {
        const trim = new THREE.Mesh(
          p.alongZ ? new THREE.BoxGeometry(0.78, 0.05, 2.06) : new THREE.BoxGeometry(2.06, 0.05, 0.78),
          tv.variant === 1 ? mats.gold : mats.goldDark,
        );
        trim.position.set(p.x, 0.56, p.z);
        trim.rotation.y = tv.rotY;
        trim.scale.setScalar(tv.scale);
        g.add(trim);
      }
    });
    /* Perf round 2 (item 88): the crowns instance — the item-47
     * cluster (shaped planting, not a blob: a centre cone + two
     * side mounds) was 3 meshes per crown × 18 crowns, each crown
     * wearing a CLONED tinted leaf material. Cones draw as one
     * instanced mesh, mounds as
     * another; the tint rides instanceColor on a white-based twin
     * of the old shared leaf material (the lawn crowns' own
     * pattern above), and each
     * instance matrix is the old crown-group transform composed
     * with the child's old local transform — same shapes, same
     * places, same tints. */
    {
      const crownLeafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true });
      const crownCount = PLAZA_PLANTERS.length * 2;
      const coneInst = new THREE.InstancedMesh(
        sharedGeometry("crown-cone", () => new THREE.ConeGeometry(0.26, 0.62, 10)), crownLeafMat, crownCount,
      );
      const moundInst = new THREE.InstancedMesh(
        sharedGeometry("crown-mound", () => new THREE.SphereGeometry(0.21, 10, 8)), crownLeafMat, crownCount * 2,
      );
      const crownM = new THREE.Matrix4();
      const localM = new THREE.Matrix4();
      const outM = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      PLAZA_PLANTERS.forEach((p, index) => {
        [-0.5, 0.5].forEach((off, ci) => {
          const k = index * 2 + ci;
          const cv = propVariation("crown", k);
          q.setFromEuler(new THREE.Euler(0, cv.rotY, 0));
          crownM.compose(
            new THREE.Vector3(p.alongZ ? p.x : p.x + off, 0.55, p.alongZ ? p.z + off : p.z),
            q,
            new THREE.Vector3(cv.scale, cv.scale * cv.scaleY, cv.scale),
          );
          const tint = tintColor(0x2e5d33, cv);
          localM.makeTranslation(0, 0.31, 0);
          coneInst.setMatrixAt(k, outM.multiplyMatrices(crownM, localM));
          coneInst.setColorAt(k, tint);
          [-0.24, 0.24].forEach((sideOff, mi) => {
            localM.compose(
              new THREE.Vector3(p.alongZ ? 0 : sideOff, 0.16, p.alongZ ? sideOff : 0),
              new THREE.Quaternion(),
              new THREE.Vector3(1, 0.75, 1),
            );
            moundInst.setMatrixAt(k * 2 + mi, outM.multiplyMatrices(crownM, localM));
            moundInst.setColorAt(k * 2 + mi, tint);
          });
        });
      });
      coneInst.instanceMatrix.needsUpdate = true;
      moundInst.instanceMatrix.needsUpdate = true;
      if (coneInst.instanceColor) coneInst.instanceColor.needsUpdate = true;
      if (moundInst.instanceColor) moundInst.instanceColor.needsUpdate = true;
      coneInst.castShadow = QUALITY[this.quality].shadows;
      moundInst.castShadow = QUALITY[this.quality].shadows;
      g.add(coneInst);
      g.add(moundInst);
    }

    // Braziers — the courtyard burns at night. The original pair
    // keeps its place; a second pair flanks the monument. The
    // pedestal and bowl stand in BOTH looks (item 39): they are
    // solid furniture with a blocked rect in the layout, and a
    // collision footprint that only exists in one theme would be
    // an invisible wall in the other. Only the fire follows the
    // dark look — coals, flame, glow and point light, exactly as
    // before (the light hook stays look.candles-gated; tiers that
    // carry candle lights, as everywhere in the hall; flames ride
    // anim.flames as always).
    {
      const bronze = new THREE.MeshStandardMaterial({ color: 0x4a3418, metalness: 0.85, roughness: 0.4 });
      /* Perf round 2 (item 87): the solid parts instance — one
       * draw for all pedestals, one for all bowls (and one for
       * the coals after dark). The flame + glow sprites, embers,
       * fake pools and lights stay per-brazier below: they are
       * the animation, not the furniture. Sprite positions move
       * from brazier-group-local to the same world coordinates. */
      instancedPart(
        g, sharedGeometry("brazier-pedestal", () => new THREE.CylinderGeometry(0.09, 0.14, 0.5, 10)),
        mats.darkMetal, PLAZA_BRAZIERS.length,
        (d, i) => d.position.set(PLAZA_BRAZIERS[i].x, 0.25, PLAZA_BRAZIERS[i].z),
      );
      instancedPart(
        g, sharedGeometry("brazier-bowl", () => new THREE.CylinderGeometry(0.46, 0.18, 0.3, 18)),
        bronze, PLAZA_BRAZIERS.length,
        (d, i) => d.position.set(PLAZA_BRAZIERS[i].x, 0.65, PLAZA_BRAZIERS[i].z),
      );
      if (look.candles) {
        instancedPart(
          g, sharedGeometry("brazier-coals", () => new THREE.CircleGeometry(0.4, 20)),
          new THREE.MeshBasicMaterial({ color: 0xff7a26 }), PLAZA_BRAZIERS.length,
          (d, i) => {
            d.position.set(PLAZA_BRAZIERS[i].x, 0.79, PLAZA_BRAZIERS[i].z);
            d.rotation.x = -Math.PI / 2;
          },
        );
      }
      for (const { x: bx, z: bz } of PLAZA_BRAZIERS) {
        if (look.candles) {
          /* Coals + halo, the hall braziers' full build (overhaul
           * stage 3, audit D3: the courtyard set was a downgrade —
           * flame sprite only, reading as a glow dot). */
          const flame = new THREE.Sprite(new THREE.SpriteMaterial({
            map: flameTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
          }));
          flame.scale.set(0.6, 0.95, 1);
          flame.position.set(bx, 1.18, bz);
          g.add(flame);
          anim.flames.push({ sprite: flame, baseX: 0.6, baseY: 0.95, phase: Math.random() * 20 });
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: flameTexture(), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
          }));
          glow.scale.set(1.7, 1.7, 1);
          glow.position.set(bx, 1.15, bz);
          g.add(glow);
        }
        if (look.candles) this.addEmbers(g, anim, bx, 0.82, bz, `${bx},${bz}`);
        if (look.candles) this.addFakePool(g, bx, bz, "brazier");
        if (look.candles && QUALITY[this.quality].brazierLights) {
          const light = new THREE.PointLight(0xff9040, 22, 12, 1.9);
          light.position.set(bx, 1.35, bz);
          g.add(light);
          anim.flickerLights.push({ light, base: 22, phase: Math.random() * 20 });
          /* Item 13: the plaza braziers join the one shadow-casting
           * local light class (ruled in applyLocalShadowLights). */
          this.brazierShadowLights.push(light);
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
     *   OPEN GATE (item 31) — the Stage Grounds gate since its
     *   district was built: same posts and header, NO bar, and
     *   the sub-plate reads OPEN — the passage is real, and the
     *   walk truth runs through it into the district beyond.
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
      const shadows = QUALITY[this.quality].shadows;
      /* Gates round (Stack-100 #2): the gate's gold is ITS OWN —
       *  the identity's cap variant at per-metre repeats — not
       *  the shared kit's. */
      const capMat = def.identity.capVariant === "dark" ? mats.goldDarkFor(0.46, 0.12) : mats.goldFor(0.46, 0.12);
      const headerMat = def.identity.capVariant === "dark" ? mats.goldDarkFor(2.52, 0.12) : mats.goldFor(2.52, 0.12);
      for (const sd of [-1.1, 1.1]) {
        const px = axis === "x" ? x + sd : x;
        const pz = axis === "x" ? z : z + sd;
        const postMat = mats.marble.clone();
        postMat.color.offsetHSL(v.hueShift, 0, v.lightnessShift);
        const post = new THREE.Mesh(gatePostGeo, postMat);
        post.position.set(px, 0.95 * v.scaleY, pz);
        post.scale.y = v.scaleY;
        post.castShadow = shadows;
        post.receiveShadow = shadows;
        g.add(post);
        const cap = new THREE.Mesh(gateCapGeo, capMat);
        cap.position.set(px, 1.9 * v.scaleY + 0.06, pz);
        cap.castShadow = shadows;
        cap.receiveShadow = shadows;
        g.add(cap);
      }
      const header = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(2.52, 0.12, 0.3) : new THREE.BoxGeometry(0.3, 0.12, 2.52),
        headerMat,
      );
      header.position.set(x, 1.8 * v.scaleY, z);
      header.castShadow = shadows;
      header.receiveShadow = shadows;
      g.add(header);
      /* The OPEN LEAVES: an open gate used to be two posts and a
       * header with nothing in the passage's history — now each
       * gate wears its pair of leaves, swung open toward its own
       * district (district-gates' gateLeafYaw), cloth in the
       * district's accent with a gilt frame. Closed gates (none
       * today) wear the bar instead, as before. */
      if (def.open) {
        const leafMat = new THREE.MeshStandardMaterial({
          color: def.identity.accent, roughness: 0.82, metalness: 0.05, envMapIntensity: 0.4,
        });
        for (const sd of [-1.1, 1.1]) {
          const extendingPlus = sd < 0; // the leaf reaches from its post toward the centre
          const pivot = new THREE.Group();
          pivot.position.set(axis === "x" ? x + sd : x, 0, axis === "x" ? z : z + sd);
          pivot.rotation.y = gateLeafYaw(def, extendingPlus);
          const leaf = new THREE.Mesh(
            axis === "x" ? new THREE.BoxGeometry(1.02, 1.52, 0.05) : new THREE.BoxGeometry(0.05, 1.52, 1.02),
            leafMat,
          );
          // The leaf hangs from the pivot at the post, reaching
          // toward the gate's centre BEFORE the yaw swings it.
          if (axis === "x") leaf.position.set(sd < 0 ? 0.53 : -0.53, 0.82, 0);
          else leaf.position.set(0, 0.82, sd < 0 ? 0.53 : -0.53);
          leaf.castShadow = shadows;
          leaf.receiveShadow = shadows;
          pivot.add(leaf);
          const stile = new THREE.Mesh(
            axis === "x" ? new THREE.BoxGeometry(1.06, 0.07, 0.07) : new THREE.BoxGeometry(0.07, 0.07, 1.06),
            headerMat,
          );
          stile.position.copy(leaf.position);
          stile.position.y = 1.56;
          pivot.add(stile);
          g.add(pivot);
        }
      }
      /* The LANTERN MESH: every gate hangs a real lantern from
       * its header — gilt cage, glass in the lamp-glass law,
       * a cap — where before a glow sprite hung on nothing. The
       * item-27 glow sprite now sits at the lantern's heart. */
      {
        const lantern = new THREE.Group();
        const hy = 1.8 * v.scaleY;
        lantern.position.set(x, hy, z);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6), mats.darkMetal);
        stem.position.y = -0.08;
        lantern.add(stem);
        const cage = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.21, 0.17), headerMat);
        cage.position.y = -0.27;
        cage.castShadow = shadows;
        lantern.add(cage);
        const glassStyle = lampGlassStyle(look.theme);
        const glass = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.15, 0.12),
          new THREE.MeshStandardMaterial({
            color: glassStyle.color, emissive: glassStyle.emissive,
            emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
          }),
        );
        glass.position.y = -0.27;
        lantern.add(glass);
        const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.1, 4), headerMat);
        capTop.position.y = -0.13;
        capTop.rotation.y = Math.PI / 4;
        lantern.add(capTop);
        g.add(lantern);
      }
      /* A CLOSED gate wears its gold bar; an OPEN gate (item 31:
       * the district beyond is built) wears none — the passage
       * between the posts is the visible truth, and its sub-plate
       * reads OPEN where a closed gate's reads COMING. */
      if (!def.open) {
        const bar = new THREE.Mesh(
          axis === "x" ? new THREE.BoxGeometry(2.2, 0.07, 0.07) : new THREE.BoxGeometry(0.07, 0.07, 2.2),
          mats.gold,
        );
        bar.position.set(x + (def.barDx ?? 0), 0.55, z + (def.barDz ?? 0));
        g.add(bar);
      }
      /* The plate SEATS on the header: plate height at width 2.6
       * is 0.57, so its centre sits header-top + half-height —
       * grounded, not floating at the old 2.33. Gates round: the
       * gate plates are BACKED and two-faced (doorPlateBacked) —
       * the district reads its name on the way back too. */
      this.doorPlateBacked(g, name, x, 1.86 * v.scaleY + 0.285, z, plateRotY, 2.6, mats);
      this.doorPlateBacked(g, def.open ? DISTRICT_OPEN_SUBPLATE : DISTRICT_SUBPLATE, x, 1.58, z, plateRotY, 1.3, mats);
      if (look.candles) {
        const lx = axis === "x" ? x : x + (def.barDx ?? 0);
        const lz = axis === "x" ? z + (def.barDz ?? 0) : z;
        /* The glow now lives at the lantern mesh's heart (header
         * height − its cage drop), not at a floating 1.62. */
        this.addLanternGlow(g, anim, lx, 1.8 * v.scaleY - 0.27, lz, 1.15, index * 1.7);
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

    /* Plaza life (Stage C batch C3, plaza-life.ts): the pool +
     * fountain, the lamp standards, the furniture set, the
     * daylight pollen and the spawn arrival dressing. */
    this.buildPlazaLife(g, look, mats, anim);

    // The courtyard's door-stations along the colonnade.
    this.buildStationMarkers(g, mats, COURTYARD_ID);
    this.buildCreatorRoomsArch(g, mats);

    group.add(g);
    this.shellGroups.set(COURTYARD_ID, g);
  }
  /** The Stage Grounds shell (Stage C item 31): the outdoor stage
   *  quarter west of the plaza, built entirely from
   *  stage-grounds.ts placement data — the same data palace-layout
   *  registers as the room's blocked rects, so every body built
   *  here is solid there. The ground wears the OUTDOOR system
   *  (the look's paving + whole-tile slabs, a real lawn for the
   *  audience ground — never interior marble). Draw discipline:
   *  repeated pieces instance (slabs, bench parts, lamp parts,
   *  truss heads, speaker cabinets). Light discipline: ZERO new
   *  real lights — the truss lamps and lamp standards glow by
   *  emissive glass + item-27 lantern-glow sprites after dark. */
  private buildStageGroundsShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();
    const shadows = QUALITY[this.quality].shadows;
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; rotY?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY ?? 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
      return im;
    };

    /* The ground: the look's paving over the whole quarter (the
     * shell floor), with the whole-tile wearing slabs instanced
     * over it — palace-grounds' paving plan for this rect. */
    const pavingSurface = { url: look.pavingTextureUrl, metresPerTile: PAVING_METRES_PER_TILE };
    this.shellFloor(g, look, mats, STAGE_GROUNDS_INTERIOR, "paving", pavingSurface);
    {
      const slabs = pavingSlabsFor(STAGE_GROUNDS_INTERIOR);
      const slabInst = new THREE.InstancedMesh(
        sharedGeometry("paving-slab", () => new THREE.BoxGeometry(4, 0.03, 4)), mats.pavingFor(4, 4), slabs.length,
      );
      slabs.forEach((s, i) => {
        dummy.position.set(s.cx, 0.015, s.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        slabInst.setMatrixAt(i, dummy.matrix);
      });
      slabInst.instanceMatrix.needsUpdate = true;
      slabInst.receiveShadow = shadows;
      g.add(slabInst);
    }

    /* The quarter's own enclosure: low marble walls with gold
     * caps on the west, north and south (the plaza's language) —
     * the east side is the plaza's west wall and its open gate. */
    for (const run of STAGE_WALL_RUNS) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(run.w, 1.05, run.d), mats.marbleFor(Math.max(run.w, run.d), 1.05),
      );
      wall.position.set(run.x, 0.525, run.z);
      wall.castShadow = shadows;
      g.add(wall);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(run.w === 0.35 ? 0.47 : run.w, 0.07, run.d === 0.35 ? 0.47 : run.d), mats.gold,
      );
      cap.position.set(run.x, 1.09, run.z);
      g.add(cap);
    }
    /* Grounded piers on the west wall's line (item 43's build). */
    buildPierSet(g, mats, shadows, STAGE_PIERS);

    /* The stage: a stone platform with a gold trim line on its
     * front edge, the backdrop shell behind it (back wall + two
     * returns in façade marble), and the curtain on the shell's
     * face — fabric on a gold rod, in the look's cloth. */
    {
      const plat = STAGE_PLATFORM;
      const platform = new THREE.Mesh(
        new THREE.BoxGeometry(plat.w, plat.h, plat.d), mats.stoneFor(plat.w, plat.h),
      );
      platform.position.set(plat.cx, plat.cy, plat.cz);
      platform.castShadow = shadows;
      platform.receiveShadow = shadows;
      g.add(platform);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, plat.d), mats.gold);
      trim.position.set(plat.cx + plat.w / 2 + 0.01, plat.h - 0.05, plat.cz);
      g.add(trim);
      const back = STAGE_SHELL_BACK;
      const backWall = new THREE.Mesh(
        new THREE.BoxGeometry(back.w, back.h, back.d), mats.facadeMarbleFor(back.d, back.h),
      );
      backWall.position.set(back.cx, back.cy, back.cz);
      backWall.castShadow = shadows;
      g.add(backWall);
      for (const ret of STAGE_SHELL_RETURNS) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(ret.w, ret.h, ret.d), mats.facadeMarbleFor(ret.w, ret.h),
        );
        wall.position.set(ret.cx, ret.cy, ret.cz);
        wall.castShadow = shadows;
        g.add(wall);
      }
      /* A gold crown strip across the shell's top front edge. */
      const crown = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, back.d), mats.gold);
      crown.position.set(back.cx + back.w / 2 + 0.02, back.h - 0.07, back.cz);
      g.add(crown);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, STAGE_CURTAIN.d + 0.5, 8), mats.gold);
      rod.rotation.x = Math.PI / 2;
      rod.position.set(STAGE_CURTAIN.cx + 0.12, STAGE_CURTAIN.cy + STAGE_CURTAIN.h / 2 + 0.12, STAGE_CURTAIN.cz);
      g.add(rod);
      const curtain = new THREE.Mesh(
        new THREE.BoxGeometry(STAGE_CURTAIN.w, STAGE_CURTAIN.h, STAGE_CURTAIN.d), mats.fabric,
      );
      curtain.position.set(STAGE_CURTAIN.cx, STAGE_CURTAIN.cy, STAGE_CURTAIN.cz);
      curtain.castShadow = shadows;
      g.add(curtain);
    }

    /* Speaker stacks: a stone plinth and three dark cabinets
     * each, gold-dark grilles on the audience face — instanced. */
    {
      instanced(
        new THREE.BoxGeometry(1.5, 0.12, 1.5), mats.stoneFor(1.5, 0.2),
        SPEAKER_STACKS.map((s) => ({ x: s.x, y: 0.06, z: s.z })),
      );
      const cabinets: Array<{ x: number; y: number; z: number }> = [];
      const grilles: Array<{ x: number; y: number; z: number }> = [];
      for (const s of SPEAKER_STACKS) {
        for (let k = 0; k < SPEAKER_STACK.cabinets; k++) {
          const y = 0.12 + SPEAKER_STACK.cabinetH / 2 + k * SPEAKER_STACK.cabinetH;
          cabinets.push({ x: s.x, y, z: s.z });
          grilles.push({ x: s.x + SPEAKER_STACK.w / 2 + 0.03, y, z: s.z });
        }
      }
      instanced(new THREE.BoxGeometry(SPEAKER_STACK.w, SPEAKER_STACK.cabinetH - 0.04, SPEAKER_STACK.d), mats.darkMetal, cabinets);
      instanced(new THREE.BoxGeometry(0.05, SPEAKER_STACK.cabinetH - 0.2, SPEAKER_STACK.d - 0.25), mats.goldDark, grilles);
    }

    /* The lighting truss: two dark posts, a crossbar over the
     * stage's front line, and five emissive lamp heads under it
     * (lit amber after dark, pale by day — the lamp-glass law),
     * each carrying a lantern-glow sprite after dark. No real
     * light rides the truss. */
    {
      instanced(
        new THREE.CylinderGeometry(0.07, 0.09, TRUSS.postH, 10), mats.darkMetal,
        TRUSS.postZs.map((z) => ({ x: TRUSS.postX, y: TRUSS.postH / 2, z })),
      );
      const barLen = TRUSS.postZs[TRUSS.postZs.length - 1]! - TRUSS.postZs[0]! + 0.6;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, barLen), mats.darkMetal);
      bar.position.set(TRUSS.postX, TRUSS.barY, (TRUSS.postZs[0]! + TRUSS.postZs[TRUSS.postZs.length - 1]!) / 2);
      bar.castShadow = shadows;
      g.add(bar);
      const glassStyle = lampGlassStyle(look.theme);
      const heads = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.24, 0.2, 0.24),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        TRUSS.headZs.length,
      );
      TRUSS.headZs.forEach((z, i) => {
        dummy.position.set(TRUSS.postX, TRUSS.headY, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
      });
      heads.instanceMatrix.needsUpdate = true;
      g.add(heads);
      if (look.candles) {
        TRUSS.headZs.forEach((z, i) => {
          this.addLanternGlow(g, anim, TRUSS.postX, TRUSS.headY, z, 0.95, i * 1.93);
        });
      }
    }

    /* Banner poles flanking the truss line: a dark pole, a gold
     * crossarm, and a hanging banner in the look's cloth. */
    for (const p of BANNER_POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, BANNER_POLE.h, 8), mats.darkMetal);
      pole.position.set(p.x, BANNER_POLE.h / 2, p.z);
      pole.castShadow = shadows;
      g.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mats.gold);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(p.x, BANNER_POLE.h - 0.15, p.z);
      g.add(arm);
      const bannerPivot = new THREE.Group();
      bannerPivot.position.set(p.x, BANNER_POLE.h - 0.2, p.z);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.95), mats.fabric);
      banner.position.set(0, -0.85, 0);
      banner.castShadow = shadows;
      bannerPivot.add(banner);
      g.add(bannerPivot);
      /* Stack-100 #2 item 30: district banners sway like the hall's —
       * registered in both looks, never under reduced motion. */
      if (!this.reducedMotion) anim.bannerSways.push({ pivot: bannerPivot, phase: 0.7 + (p.x + p.z) });
    }

    /* The audience lawn (the plaza lawns' construction: stone
     * bed, textured grass inset, instanced edging) — stroll-across
     * ground holding the bench rows. */
    {
      const panel = AUDIENCE_LAWN;
      const edging = lawnEdgingRuns(panel);
      const edgeInst = new THREE.InstancedMesh(
        sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)), mats.stoneFor(2, 0.3), edging.length,
      );
      edging.forEach((b, i) => {
        dummy.position.set(b.cx, b.cy + 0.025, b.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        edgeInst.setMatrixAt(i, dummy.matrix);
      });
      edgeInst.instanceMatrix.needsUpdate = true;
      edgeInst.castShadow = shadows;
      g.add(edgeInst);
      const bed = new THREE.Mesh(
        new THREE.BoxGeometry(panel.w, LAWN_BED.rimH, panel.d), mats.stoneFor(panel.w, LAWN_BED.rimH),
      );
      bed.position.set(panel.cx, LAWN_BED.rimH / 2, panel.cz);
      bed.receiveShadow = shadows;
      g.add(bed);
      const grass = new THREE.Mesh(
        new THREE.BoxGeometry(panel.w - LAWN_BED.inset * 2, 0.04, panel.d - LAWN_BED.inset * 2),
        mats.lawnFor(panel.w - LAWN_BED.inset * 2, panel.d - LAWN_BED.inset * 2),
      );
      grass.position.set(panel.cx, panel.topY - 0.02, panel.cz);
      grass.receiveShadow = shadows;
      g.add(grass);
    }

    /* Bench rows facing the stage: instanced seats, backs (on the
     * east side, away from the stage they face) and legs — the
     * plaza benches' construction, turned west. */
    {
      const seatPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      const backPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      const legPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      for (const b of STAGE_BENCHES) {
        seatPlaces.push({ x: b.x, y: BENCH.seatY, z: b.z, rotY: Math.PI / 2 });
        backPlaces.push({ x: b.x + 0.24, y: BENCH.seatY + 0.28, z: b.z, rotY: Math.PI / 2 });
        for (const endOff of [-0.8, 0.8]) {
          legPlaces.push({ x: b.x, y: BENCH.seatY / 2, z: b.z + endOff, rotY: Math.PI / 2 });
        }
      }
      instanced(sharedGeometry("bench-seat", () => new THREE.BoxGeometry(BENCH.len, 0.09, BENCH.depth)), mats.stoneFor(2, 0.4), seatPlaces);
      instanced(sharedGeometry("bench-back", () => new THREE.BoxGeometry(BENCH.len, 0.5, 0.08)), mats.stoneFor(2, 0.5), backPlaces);
      instanced(sharedGeometry("bench-legs", () => new THREE.BoxGeometry(0.09, BENCH.seatY, BENCH.depth - 0.1)), mats.darkMetal, legPlaces);
    }

    /* The entry path: a marble strip on the gate's line from the
     * plaza wall to the lawn, gold strips on its edges — the
     * plaza spine's language, turned west. Flat accent, no
     * collision, like every path on the grounds. */
    {
      const len = ENTRY_PATH.toX - ENTRY_PATH.fromX;
      const cx = (ENTRY_PATH.fromX + ENTRY_PATH.toX) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.016, ENTRY_PATH.w), mats.marble);
      slab.position.set(cx, 0.022, ENTRY_PATH.cz);
      g.add(slab);
      for (const sz of [-1.03, 1.03]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.07), mats.goldDark);
        strip.position.set(cx, 0.028, ENTRY_PATH.cz + sz);
        g.add(strip);
      }
    }

    /* Stack-100 #2 item 39: the arrival arch — two marble
     * columns flanking the entry path just inside the gate, a
     * gold band spanning them, and the district's name plate on
     * the band facing the arriving walker: the proscenium's
     * language at garden scale. The columns are solid from
     * STAGE_ARRIVAL_ARCH's own data; the band rides above. */
    {
      const a = STAGE_ARRIVAL_ARCH;
      /* Perf round 2 (item 86): the arch's two columns instance
       * per part — the pier pattern at garden scale. */
      instancedPart(
        g, sharedGeometry("arch-column-plinth", () => new THREE.BoxGeometry(0.72, 0.28, 0.72)),
        mats.marble, a.columnZs.length, (d, i) => d.position.set(a.x, 0.14, a.columnZs[i]),
      );
      instancedPart(
        g, sharedGeometry(`arch-column-shaft:${a.columnH}`, () => new THREE.CylinderGeometry(0.21, 0.25, a.columnH - 0.46, 12)),
        mats.marble, a.columnZs.length,
        (d, i) => d.position.set(a.x, 0.28 + (a.columnH - 0.46) / 2, a.columnZs[i]),
        { castShadow: shadows },
      );
      instancedPart(
        g, sharedGeometry("arch-column-cap", () => new THREE.BoxGeometry(0.66, 0.18, 0.66)),
        mats.gold, a.columnZs.length, (d, i) => d.position.set(a.x, a.columnH - 0.09, a.columnZs[i]),
      );
      const span = a.columnZs[1]! - a.columnZs[0]!;
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, span + 0.7), mats.gold);
      band.position.set(a.x, a.bandY, ENTRY_PATH.cz);
      band.castShadow = shadows;
      g.add(band);
      this.doorPlate(g, "STAGE GROUNDS", a.x + 0.19, a.plateY, ENTRY_PATH.cz, Math.PI / 2, 2.4);
    }

    /* The quarter's lamp standards — plaza-life's LAMP build,
     * instanced: stone plinths, dark posts, gold cages, emissive
     * glass, glow sprites after dark. Zero real lights. */
    {
      instanced(
        sharedGeometry("lamp-plinth", () => new THREE.BoxGeometry(0.42, 0.18, 0.42)), mats.stoneFor(0.5, 0.2),
        STAGE_LAMPS.map((l) => ({ x: l.x, y: 0.09, z: l.z })),
      );
      instanced(
        sharedGeometry(`lamp-post:${LAMP.postH}`, () => new THREE.CylinderGeometry(0.055, 0.085, LAMP.postH, 10)), mats.darkMetal,
        STAGE_LAMPS.map((l) => ({ x: l.x, y: 0.18 + LAMP.postH / 2, z: l.z })),
      );
      instanced(
        sharedGeometry("lamp-cage", () => new THREE.BoxGeometry(0.3, 0.36, 0.3)), mats.gold,
        STAGE_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY, z: l.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      const glass = new THREE.InstancedMesh(
        sharedGeometry("lamp-glass", () => new THREE.BoxGeometry(0.21, 0.27, 0.21)),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        STAGE_LAMPS.length,
      );
      STAGE_LAMPS.forEach((l, i) => {
        dummy.position.set(l.x, LAMP.headY, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      });
      glass.instanceMatrix.needsUpdate = true;
      g.add(glass);
      instanced(
        sharedGeometry("lamp-cap", () => new THREE.ConeGeometry(0.3, 0.22, 4)), mats.goldDark,
        STAGE_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY + 0.29, z: l.z, rotY: Math.PI / 4 })),
      );
      if (look.candles) {
        STAGE_LAMPS.forEach((l, i) => {
          this.addLanternGlow(g, anim, l.x, LAMP.headY, l.z, LAMP.glowBase, i * 1.47);
        });
      }
    }

    // The way back, labeled from the district side of the gate.
    this.doorPlate(g, "THE KING'S PLAZA", -28.45, PALACE_DOOR_HEIGHT + 0.66, 19.5, -Math.PI / 2, 2.6);

    // The district's door-station: the Stage Bill at the path's head.
    this.buildStationMarkers(g, mats, STAGE_GROUNDS_ID);

    group.add(g);
    this.shellGroups.set(STAGE_GROUNDS_ID, g);
  }

  /** The Listening Gardens shell (Stage C item 32): the gardens
   *  quarter south of the promenade, built entirely from
   *  listening-gardens.ts placement data — the same data
   *  palace-layout registers as the room's blocked rects, so
   *  every body built here is solid there. A look/listen
   *  quarter: a parterre lawn around a still reflecting rill,
   *  hedged listening nooks with benches, an open pavilion, and
   *  the quarter's lamps and banners. The ground wears the
   *  OUTDOOR system (the look's paving + whole-tile slabs, a
   *  real lawn for the parterre — never interior marble). Draw
   *  discipline: repeated pieces instance (slabs, hedge runs,
   *  bench parts, lamp parts, pavilion posts, planting crowns).
   *  Light discipline: ZERO new real lights — the lantern
   *  standards glow by emissive glass + item-27 lantern-glow
   *  sprites after dark. */
  private buildListeningGardensShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();
    const shadows = QUALITY[this.quality].shadows;
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; rotY?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY ?? 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
      return im;
    };

    /* The ground: the look's paving over the whole quarter (the
     * shell floor), with the whole-tile wearing slabs instanced
     * over it — palace-grounds' paving plan for this rect. */
    const pavingSurface = { url: look.pavingTextureUrl, metresPerTile: PAVING_METRES_PER_TILE };
    this.shellFloor(g, look, mats, GARDENS_INTERIOR, "paving", pavingSurface);
    {
      const slabs = pavingSlabsFor(GARDENS_INTERIOR);
      const slabInst = new THREE.InstancedMesh(
        sharedGeometry("paving-slab", () => new THREE.BoxGeometry(4, 0.03, 4)), mats.pavingFor(4, 4), slabs.length,
      );
      slabs.forEach((s, i) => {
        dummy.position.set(s.cx, 0.015, s.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        slabInst.setMatrixAt(i, dummy.matrix);
      });
      slabInst.instanceMatrix.needsUpdate = true;
      slabInst.receiveShadow = shadows;
      g.add(slabInst);
    }

    /* The quarter's own enclosure: low marble walls with gold
     * caps on the west, east and south (the plaza's language) —
     * the north side is the promenade's south wall and its open
     * gate. */
    for (const run of GARDENS_WALL_RUNS) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(run.w, 1.05, run.d), mats.marbleFor(Math.max(run.w, run.d), 1.05),
      );
      wall.position.set(run.x, 0.525, run.z);
      wall.castShadow = shadows;
      g.add(wall);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(run.w === 0.35 ? 0.47 : run.w, 0.07, run.d === 0.35 ? 0.47 : run.d), mats.gold,
      );
      cap.position.set(run.x, 1.09, run.z);
      g.add(cap);
    }
    /* Grounded piers on the south wall's line (item 43's build). */
    buildPierSet(g, mats, shadows, GARDENS_PIERS);

    /* The parterre lawn (the plaza lawns' construction: stone
     * bed, textured grass inset, instanced edging) — stroll-
     * across ground holding the rill, its benches and the
     * parterre's planting crowns. No medallion here: the rill
     * is this lawn's centrepiece, running through its heart. */
    {
      const panel = PARTERRE_LAWN;
      const edging = lawnEdgingRuns(panel);
      const edgeInst = new THREE.InstancedMesh(
        sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)), mats.stoneFor(2, 0.3), edging.length,
      );
      edging.forEach((b, i) => {
        dummy.position.set(b.cx, b.cy + 0.025, b.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        edgeInst.setMatrixAt(i, dummy.matrix);
      });
      edgeInst.instanceMatrix.needsUpdate = true;
      edgeInst.castShadow = shadows;
      g.add(edgeInst);
      const bed = new THREE.Mesh(
        new THREE.BoxGeometry(panel.w, LAWN_BED.rimH, panel.d), mats.stoneFor(panel.w, LAWN_BED.rimH),
      );
      bed.position.set(panel.cx, LAWN_BED.rimH / 2, panel.cz);
      bed.receiveShadow = shadows;
      g.add(bed);
      const grass = new THREE.Mesh(
        new THREE.BoxGeometry(panel.w - LAWN_BED.inset * 2, 0.04, panel.d - LAWN_BED.inset * 2),
        mats.lawnFor(panel.w - LAWN_BED.inset * 2, panel.d - LAWN_BED.inset * 2),
      );
      grass.position.set(panel.cx, panel.topY - 0.02, panel.cz);
      grass.receiveShadow = shadows;
      g.add(grass);
      /* Planting crowns: the parterre pattern (palace-grounds'
       * lawnPlantingSpots), one instanced draw, jitter + tint
       * per crown from prop-variation (item 18) — the ring
       * stands clear of the rill by the pattern's own radii. */
      const spots = lawnPlantingSpots(panel);
      const crownInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.44, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        spots.length,
      );
      const crownColor = new THREE.Color(0x2e5d33);
      spots.forEach((s, i) => {
        const cv = propVariation("crown", 700 + i);
        dummy.position.set(s.x, panel.topY + 0.3 * cv.scaleY, s.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale, cv.scale * cv.scaleY, cv.scale);
        dummy.updateMatrix();
        crownInst.setMatrixAt(i, dummy.matrix);
        crownInst.setColorAt(i, crownColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      crownInst.castShadow = shadows;
      g.add(crownInst);
    }

    /* The rill: a narrow reflecting strip down the lawn's
     * middle — the plaza pool's construction stretched thin: a
     * stone rim ring proud of the grass, a gold trim line, and
     * still water held just under the lip, wearing the look's
     * water texture (cloned, so its shimmer scroll is its own).
     * The whole footprint is RILL_BLOCKED in the layout — a
     * walker rounds it or crosses at its ends, never wades. */
    {
      const rimMat = mats.stoneFor(RILL.d, RILL.rimH);
      const rimRuns: Array<{ w: number; d: number; x: number; z: number }> = [
        { w: RILL.w, d: RILL.rimLip, x: RILL.cx, z: RILL.cz - RILL.d / 2 + RILL.rimLip / 2 },
        { w: RILL.w, d: RILL.rimLip, x: RILL.cx, z: RILL.cz + RILL.d / 2 - RILL.rimLip / 2 },
        { w: RILL.rimLip, d: RILL.d - RILL.rimLip * 2, x: RILL.cx - RILL.w / 2 + RILL.rimLip / 2, z: RILL.cz },
        { w: RILL.rimLip, d: RILL.d - RILL.rimLip * 2, x: RILL.cx + RILL.w / 2 - RILL.rimLip / 2, z: RILL.cz },
      ];
      for (const r of rimRuns) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(r.w, RILL.rimH, r.d), rimMat);
        rim.position.set(r.x, RILL.rimH / 2 + PARTERRE_LAWN.topY, r.z);
        rim.castShadow = shadows;
        rim.receiveShadow = shadows;
        g.add(rim);
      }
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(RILL.w + 0.06, 0.04, RILL.d + 0.06), mats.goldDark,
      );
      trim.position.set(RILL.cx, RILL.rimH + PARTERRE_LAWN.topY - 0.02, RILL.cz);
      g.add(trim);
      const tint = poolWaterTint(look.theme);
      const waterTex = hallTexture(look.waterTextureUrl, 0.4, 3).clone();
      waterTex.needsUpdate = true;
      const rillNormal = this.rippleNormalFor(0.4, 3);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(RILL.w - RILL.rimLip * 2, RILL.d - RILL.rimLip * 2),
        new THREE.MeshStandardMaterial({
          map: waterTex, color: tint.color, roughness: tint.roughness,
          normalMap: rillNormal, normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.water, MATERIAL_NORMAL_SCALES.water),
          metalness: 0.35, envMapIntensity: 0.9,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(RILL.cx, RILL.waterY + PARTERRE_LAWN.topY, RILL.cz);
      g.add(water);
      g.add(this.wetEdgeRect(RILL.cx, RILL.cz, RILL.w - RILL.rimLip * 2, RILL.d - RILL.rimLip * 2, RILL.waterY + PARTERRE_LAWN.topY));
      anim.waters.push({ tex: waterTex, jet: null, normalTex: rillNormal });
    }

    /* Stack-100 #2 item 36: the gardens' fountain — a round
     * stone basin at the rill's centre (the plaza pool
     * fountain's construction, turned round): a rim ring with a
     * gold trim, animated water just under its lip (a cloned
     * texture the tick scrolls), a centre column, an upper
     * bowl, a rising jet the tick pulses, and a falling-water
     * cone from the bowl back to the basin. Soundless motion;
     * the whole footprint is GARDENS_FOUNTAIN_BLOCKED. */
    {
      const f = GARDENS_FOUNTAIN;
      const baseY = PARTERRE_LAWN.topY;
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(f.rimR, f.rimR * 1.04, f.rimH, 28, 1, true),
        mats.stoneFor(3, 0.4),
      );
      rim.position.set(f.cx, baseY + f.rimH / 2, f.cz);
      rim.castShadow = shadows;
      rim.receiveShadow = shadows;
      g.add(rim);
      const rimTop = new THREE.Mesh(new THREE.TorusGeometry(f.rimR - 0.04, 0.045, 8, 36), mats.goldDark);
      rimTop.rotation.x = Math.PI / 2;
      rimTop.position.set(f.cx, baseY + f.rimH, f.cz);
      g.add(rimTop);
      const tint = poolWaterTint(look.theme);
      const waterTex = hallTexture(look.waterTextureUrl, 1, 1).clone();
      waterTex.needsUpdate = true;
      const basinNormal = this.rippleNormalFor(1, 1);
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(f.rimR - 0.08, 28),
        new THREE.MeshStandardMaterial({
          map: waterTex, color: tint.color, roughness: tint.roughness,
          normalMap: basinNormal, normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.water, MATERIAL_NORMAL_SCALES.water),
          metalness: 0.35, envMapIntensity: 0.9,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(f.cx, baseY + f.waterY, f.cz);
      g.add(water);
      g.add(this.wetEdgeRing(f.cx, f.cz, f.rimR - 0.08, baseY + f.waterY));
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.18, f.columnTopY - 0.2, 12), mats.stoneFor(0.4, 0.8),
      );
      column.position.set(f.cx, baseY + (f.columnTopY - 0.2) / 2 + 0.1, f.cz);
      column.castShadow = shadows;
      g.add(column);
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(f.bowlR, f.bowlR * 0.72, 0.16, 20), mats.stoneFor(1.2, 0.4),
      );
      bowl.position.set(f.cx, baseY + f.columnTopY, f.cz);
      bowl.castShadow = shadows;
      g.add(bowl);
      const jetMat = new THREE.MeshBasicMaterial({
        color: look.theme === "dark" ? 0x9fc4d8 : 0xeaf6ff, transparent: true,
        opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
      });
      const jet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.14, f.jetTopY - f.jetBaseY, 10, 1, true), jetMat,
      );
      jet.position.set(f.cx, baseY + (f.jetBaseY + f.jetTopY) / 2, f.cz);
      jet.renderOrder = 4;
      g.add(jet);
      /* The falling water: a translucent cone sheet from the
       * bowl's rim back down to the basin's surface. Its material
       * is a CLONE of the jet's: the water model breathes the
       * fall's opacity (Stack-100 #2 item 7) and the jet must not
       * breathe with it. */
      const fall = new THREE.Mesh(
        new THREE.CylinderGeometry(f.bowlR * 0.92, f.bowlR * 1.5, f.columnTopY - f.waterY - 0.05, 20, 1, true),
        jetMat.clone(),
      );
      fall.position.set(f.cx, baseY + (f.columnTopY + f.waterY) / 2, f.cz);
      fall.renderOrder = 4;
      g.add(fall);
      anim.waters.push({ tex: waterTex, jet, normalTex: basinNormal, fall, fallBase: 0.5 });
    }

    /* The hedged listening nooks: clipped hedge runs (instanced
     * unit boxes scaled to each run, foliage-tinted per run by
     * item-18 variation) forming four three-sided enclosures
     * that open toward the lawn. */
    {
      const hedgeInst = new THREE.InstancedMesh(
        sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        GARDEN_HEDGES.length,
      );
      const hedgeColor = new THREE.Color(0x274d2c);
      GARDEN_HEDGES.forEach((h, i) => {
        const cv = propVariation("crown", 800 + i);
        dummy.position.set(h.cx, h.cy, h.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(h.w, h.h, h.d);
        dummy.updateMatrix();
        hedgeInst.setMatrixAt(i, dummy.matrix);
        hedgeInst.setColorAt(i, hedgeColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      hedgeInst.instanceMatrix.needsUpdate = true;
      if (hedgeInst.instanceColor) hedgeInst.instanceColor.needsUpdate = true;
      hedgeInst.castShadow = shadows;
      g.add(hedgeInst);
    }

    /* Benches: the nooks' benches (facing the lawn out of their
     * hedges) and the rill benches (facing the water) — instanced
     * seats, backs (on the side away from what they face) and
     * legs, the plaza benches' construction turned to their
     * views. Facing: a west piece faces east (+1), east −1. */
    {
      const benches: Array<{ x: number; z: number; facing: 1 | -1 }> = [
        ...NOOK_BENCHES.map((b) => ({
          x: b.x, z: b.z,
          facing: (b.x < PARTERRE_LAWN.cx ? 1 : -1) as 1 | -1,
        })),
        ...RILL_BENCHES.map((b) => ({
          x: b.x, z: b.z,
          facing: (b.x < RILL.cx ? 1 : -1) as 1 | -1,
        })),
      ];
      const seatPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      const backPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      const legPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      for (const b of benches) {
        seatPlaces.push({ x: b.x, y: BENCH.seatY, z: b.z, rotY: Math.PI / 2 });
        backPlaces.push({ x: b.x - b.facing * 0.24, y: BENCH.seatY + 0.28, z: b.z, rotY: Math.PI / 2 });
        for (const endOff of [-0.8, 0.8]) {
          legPlaces.push({ x: b.x, y: BENCH.seatY / 2, z: b.z + endOff, rotY: Math.PI / 2 });
        }
      }
      instanced(sharedGeometry("bench-seat", () => new THREE.BoxGeometry(BENCH.len, 0.09, BENCH.depth)), mats.stoneFor(2, 0.4), seatPlaces);
      instanced(sharedGeometry("bench-back", () => new THREE.BoxGeometry(BENCH.len, 0.5, 0.08)), mats.stoneFor(2, 0.5), backPlaces);
      instanced(sharedGeometry("bench-legs", () => new THREE.BoxGeometry(0.09, BENCH.seatY, BENCH.depth - 0.1)), mats.darkMetal, legPlaces);
    }

    /* The pavilion: a low stone roundel (flat accent — walk
     * over it, never collide), six slender posts (instanced),
     * a gold ring beam on their heads, a shallow cloth cone
     * roof with gold trim and a gold finial. You stand IN it
     * and look back down the rill to the gate. */
    {
      const roundel = new THREE.Mesh(
        new THREE.CylinderGeometry(PAVILION.roundelR, PAVILION.roundelR, 0.06, 28), mats.stoneFor(3, 0.2),
      );
      roundel.position.set(PAVILION.cx, 0.03, PAVILION.cz);
      roundel.receiveShadow = shadows;
      g.add(roundel);
      instanced(
        new THREE.CylinderGeometry(0.09, 0.12, PAVILION.postH, 10), mats.marble,
        PAVILION_POSTS.map((p) => ({ x: p.x, y: PAVILION.postH / 2 + 0.06, z: p.z })),
      );
      const beam = new THREE.Mesh(new THREE.TorusGeometry(PAVILION.postR, 0.06, 8, 32), mats.gold);
      beam.rotation.x = Math.PI / 2;
      beam.position.set(PAVILION.cx, PAVILION.postH + 0.06, PAVILION.cz);
      g.add(beam);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(PAVILION.roofR, PAVILION.roofH, 28), mats.fabric,
      );
      roof.position.set(PAVILION.cx, PAVILION.roofY + PAVILION.roofH / 2, PAVILION.cz);
      roof.castShadow = shadows;
      g.add(roof);
      const roofTrim = new THREE.Mesh(new THREE.TorusGeometry(PAVILION.roofR * 0.99, 0.035, 8, 36), mats.gold);
      roofTrim.rotation.x = Math.PI / 2;
      roofTrim.position.set(PAVILION.cx, PAVILION.roofY + 0.02, PAVILION.cz);
      g.add(roofTrim);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mats.gold);
      finial.position.set(PAVILION.cx, PAVILION.roofY + PAVILION.roofH + 0.1, PAVILION.cz);
      g.add(finial);
    }

    /* The entry path: a marble strip on the gate's line from
     * the promenade wall to the parterre, gold strips on its
     * edges — the plaza spine's language, turned south. Flat
     * accent, no collision, like every path on the grounds. */
    {
      const len = GARDENS_ENTRY_PATH.toZ - GARDENS_ENTRY_PATH.fromZ;
      const cz = (GARDENS_ENTRY_PATH.fromZ + GARDENS_ENTRY_PATH.toZ) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(GARDENS_ENTRY_PATH.w, 0.016, len), mats.marble);
      slab.position.set(GARDENS_ENTRY_PATH.cx, 0.022, cz);
      g.add(slab);
      for (const sx of [-1.03, 1.03]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, len), mats.goldDark);
        strip.position.set(GARDENS_ENTRY_PATH.cx + sx, 0.028, cz);
        g.add(strip);
      }
    }

    /* Banner poles flanking the pavilion approach: a dark pole,
     * a gold crossarm, and a hanging banner in the look's cloth
     * — the Stage Grounds' pole build, on the gardens' line. */
    for (const p of GARDENS_BANNER_POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, GARDENS_BANNER_POLE.h, 8), mats.darkMetal);
      pole.position.set(p.x, GARDENS_BANNER_POLE.h / 2, p.z);
      pole.castShadow = shadows;
      g.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mats.gold);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(p.x, GARDENS_BANNER_POLE.h - 0.15, p.z);
      g.add(arm);
      const bannerPivot = new THREE.Group();
      bannerPivot.position.set(p.x, GARDENS_BANNER_POLE.h - 0.2, p.z);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.7, 0.05), mats.fabric);
      banner.position.set(0, -0.85, 0);
      banner.castShadow = shadows;
      bannerPivot.add(banner);
      g.add(bannerPivot);
      /* Stack-100 #2 item 30: district banners sway like the hall's —
       * registered in both looks, never under reduced motion. */
      if (!this.reducedMotion) anim.bannerSways.push({ pivot: bannerPivot, phase: 2.3 + (p.x + p.z) });
    }

    /* The quarter's lantern standards — plaza-life's LAMP build,
     * instanced: stone plinths, dark posts, gold cages, emissive
     * glass, glow sprites after dark. Zero real lights. */
    {
      instanced(
        sharedGeometry("lamp-plinth", () => new THREE.BoxGeometry(0.42, 0.18, 0.42)), mats.stoneFor(0.5, 0.2),
        GARDENS_LAMPS.map((l) => ({ x: l.x, y: 0.09, z: l.z })),
      );
      instanced(
        sharedGeometry(`lamp-post:${LAMP.postH}`, () => new THREE.CylinderGeometry(0.055, 0.085, LAMP.postH, 10)), mats.darkMetal,
        GARDENS_LAMPS.map((l) => ({ x: l.x, y: 0.18 + LAMP.postH / 2, z: l.z })),
      );
      instanced(
        sharedGeometry("lamp-cage", () => new THREE.BoxGeometry(0.3, 0.36, 0.3)), mats.gold,
        GARDENS_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY, z: l.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      const glass = new THREE.InstancedMesh(
        sharedGeometry("lamp-glass", () => new THREE.BoxGeometry(0.21, 0.27, 0.21)),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        GARDENS_LAMPS.length,
      );
      GARDENS_LAMPS.forEach((l, i) => {
        dummy.position.set(l.x, LAMP.headY, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      });
      glass.instanceMatrix.needsUpdate = true;
      g.add(glass);
      instanced(
        sharedGeometry("lamp-cap", () => new THREE.ConeGeometry(0.3, 0.22, 4)), mats.goldDark,
        GARDENS_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY + 0.29, z: l.z, rotY: Math.PI / 4 })),
      );
      if (look.candles) {
        GARDENS_LAMPS.forEach((l, i) => {
          this.addLanternGlow(g, anim, l.x, LAMP.headY, l.z, LAMP.glowBase, i * 1.31);
        });
      }
    }

    // The way back, labeled from the district side of the gate.
    this.doorPlate(g, "THE KING'S PLAZA", -26, PALACE_DOOR_HEIGHT + 0.66, 34.45, 0, 2.6);

    // The district's door-station: the Gardens Slate at the path's head.
    this.buildStationMarkers(g, mats, LISTENING_GARDENS_ID);

    group.add(g);
    this.shellGroups.set(LISTENING_GARDENS_ID, g);
  }

  /** The Creation Row shell (Stage C item 33): the makers' row
   *  east of the plaza, built entirely from creation-row.ts
   *  placement data — the same data palace-layout registers as
   *  the room's blocked rects, so every body built here is solid
   *  there. A working street: workbench stalls with canopies
   *  lining a marble-striped street, display plinths along its
   *  edges, crates / canvas stacks / tool benches as materials
   *  dressing, planted beds closing the north and south reaches,
   *  and the quarter's lamps and banners. The ground wears the
   *  OUTDOOR system (the look's paving + whole-tile slabs —
   *  never interior marble). Draw discipline: repeated pieces
   *  instance (slabs, stall posts, bench bodies, plinth bodies,
   *  crates, lamp parts, planting crowns). Light discipline:
   *  ZERO new real lights — the lantern standards glow by
   *  emissive glass + item-27 lantern-glow sprites after dark. */
  private buildCreationRowShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();
    const shadows = QUALITY[this.quality].shadows;
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; rotY?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY ?? 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
      return im;
    };

    /* The ground: the look's paving over the whole quarter (the
     * shell floor), with the whole-tile wearing slabs instanced
     * over it — palace-grounds' paving plan for this rect. */
    const pavingSurface = { url: look.pavingTextureUrl, metresPerTile: PAVING_METRES_PER_TILE };
    this.shellFloor(g, look, mats, ROW_INTERIOR, "paving", pavingSurface);
    {
      const slabs = pavingSlabsFor(ROW_INTERIOR);
      const slabInst = new THREE.InstancedMesh(
        sharedGeometry("paving-slab", () => new THREE.BoxGeometry(4, 0.03, 4)), mats.pavingFor(4, 4), slabs.length,
      );
      slabs.forEach((s, i) => {
        dummy.position.set(s.cx, 0.015, s.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        slabInst.setMatrixAt(i, dummy.matrix);
      });
      slabInst.instanceMatrix.needsUpdate = true;
      slabInst.receiveShadow = shadows;
      g.add(slabInst);
    }

    /* The quarter's own enclosure: low marble walls with gold
     * caps on the east, north and south (the plaza's language) —
     * the west side is the plaza's east wall and its open gate. */
    for (const run of ROW_WALL_RUNS) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(run.w, 1.05, run.d), mats.marbleFor(Math.max(run.w, run.d), 1.05),
      );
      wall.position.set(run.x, 0.525, run.z);
      wall.castShadow = shadows;
      g.add(wall);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(run.w === 0.35 ? 0.47 : run.w, 0.07, run.d === 0.35 ? 0.47 : run.d), mats.gold,
      );
      cap.position.set(run.x, 1.09, run.z);
      g.add(cap);
    }
    /* Grounded piers on the east wall's line (item 43's build). */
    buildPierSet(g, mats, shadows, ROW_PIERS);

    /* The street: a marble strip on the gate's line running
     * east into the quarter, gold strips on its edges — the
     * plaza spine's language, turned east. Flat accent, no
     * collision, like every path on the grounds. */
    {
      const len = ROW_STREET.toX - ROW_STREET.fromX;
      const cx = (ROW_STREET.fromX + ROW_STREET.toX) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.016, ROW_STREET.w), mats.marble);
      slab.position.set(cx, 0.022, ROW_STREET.cz);
      g.add(slab);
      for (const sz of [-1.03, 1.03]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.07), mats.goldDark);
        strip.position.set(cx, 0.028, ROW_STREET.cz + sz);
        g.add(strip);
      }
    }

    /* The workbench stalls: four posts per stall (instanced),
     * a fabric canopy with a gold-dark edge on their heads, and
     * the workbench against each stall's back (instanced bodies
     * with a gold trim line on the street face). The stall's
     * mouth stays open floor — a maker stands in it. */
    {
      instanced(
        sharedGeometry("stall-post", () => new THREE.CylinderGeometry(0.07, 0.09, STALL_KIT.postH, 10)), mats.darkMetal,
        ROW_STALL_POSTS.map((p) => ({ x: p.x, y: STALL_KIT.postH / 2, z: p.z })),
      );
      /* Perf round 2 (item 88): trims + canopies instance. The
       * item-35 stall variety survives exactly — each canopy's
       * cloth tint (a cloned fabric before) rides instanceColor
       * on the shared white-based fabric, and its whisper of
       * scale rides the instance matrix; the posts and the
       * blocked rect are never varied. */
      instancedPart(
        g, sharedGeometry("stall-canopy-trim", () => new THREE.BoxGeometry(STALL_KIT.canopyW + 0.1, 0.05, STALL_KIT.canopyD + 0.1)),
        mats.goldDark, ROW_STALLS.length,
        (d, si) => d.position.set(ROW_STALLS[si].x, STALL_KIT.canopyY - 0.04, ROW_STALLS[si].z),
      );
      instancedPart(
        g, sharedGeometry("stall-canopy", () => new THREE.BoxGeometry(STALL_KIT.canopyW, 0.08, STALL_KIT.canopyD)),
        mats.fabric, ROW_STALLS.length,
        (d, si) => {
          const s = ROW_STALLS[si];
          const sv = propVariation("stall", si + 0);
          d.position.set(s.x, STALL_KIT.canopyY, s.z);
          d.scale.set(sv.scale, sv.scaleY, sv.scale);
        },
        { castShadow: shadows, colorAt: (si) => tintColor(0xffffff, propVariation("stall", si + 0)) },
      );
      instanced(
        sharedGeometry("stall-bench", () => new THREE.BoxGeometry(STALL_KIT.benchW, STALL_KIT.benchH, STALL_KIT.benchD)), mats.stoneFor(STALL_KIT.benchW, STALL_KIT.benchH),
        ROW_STALL_BENCHES.map((b) => ({ x: b.cx, y: b.cy, z: b.cz })),
      );
      const trims: Array<{ x: number; y: number; z: number }> = [];
      ROW_STALLS.forEach((s, i) => {
        const b = ROW_STALL_BENCHES[i]!;
        trims.push({ x: b.cx, y: STALL_KIT.benchH - 0.06, z: b.cz + s.side * (STALL_KIT.benchD / 2 + 0.02) });
      });
      instanced(sharedGeometry("stall-bench-trim", () => new THREE.BoxGeometry(STALL_KIT.benchW, 0.05, 0.05)), mats.gold, trims);
    }

    /* The display plinths: stone pedestals (instanced) with a
     * gold-dark cap and a small made thing in gold on each — the
     * outdoor gallery of the craft along the street's edges. */
    {
      instanced(
        new THREE.BoxGeometry(PLINTH.w, PLINTH.h, PLINTH.w), mats.stoneFor(PLINTH.w, PLINTH.h),
        ROW_PLINTHS.map((p) => ({ x: p.x, y: PLINTH.h / 2, z: p.z })),
      );
      instanced(
        new THREE.BoxGeometry(0.86, 0.06, 0.86), mats.goldDark,
        ROW_PLINTHS.map((p) => ({ x: p.x, y: PLINTH.h + 0.03, z: p.z })),
      );
      instanced(
        new THREE.IcosahedronGeometry(0.22, 1), mats.gold,
        ROW_PLINTHS.map((p) => ({ x: p.x, y: PLINTH.h + 0.32, z: p.z })),
      );
    }

    /* Materials dressing: crate stacks (two crates a stack,
     * instanced, timber-toned), canvas stacks in the look's
     * cloth, and tool benches against the far wall. */
    {
      const cratePlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      ROW_CRATES.forEach((c, i) => {
        const cv = propVariation("trough", 300 + i);
        cratePlaces.push({ x: c.x, y: CRATE.size / 2, z: c.z, rotY: cv.rotY });
        cratePlaces.push({ x: c.x + 0.06, y: CRATE.size * 1.5, z: c.z - 0.04, rotY: cv.rotY + 0.35 });
      });
      instanced(
        new THREE.BoxGeometry(CRATE.size, CRATE.size, CRATE.size),
        new THREE.MeshStandardMaterial({ color: 0x8a6b42, roughness: 1, metalness: 0, flatShading: true }),
        cratePlaces,
      );
      for (const s of ROW_CANVAS_STACKS) {
        const stack = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mats.fabric);
        stack.position.set(s.cx, s.cy, s.cz);
        stack.castShadow = shadows;
        g.add(stack);
      }
      for (const b of ROW_TOOL_BENCHES) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mats.darkMetal);
        bench.position.set(b.cx, b.cy, b.cz);
        bench.castShadow = shadows;
        g.add(bench);
        const top = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.12, 0.06, b.d + 0.12), mats.stoneFor(b.d, 0.2));
        top.position.set(b.cx, b.h + 0.03, b.cz);
        g.add(top);
      }
    }

    /* The planted edges: stone-edged beds closing the north and
     * south reaches, green-topped, with planting crowns along
     * each bed (instanced, item-18 variation per crown). */
    {
      for (const p of ROW_PLANTERS) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mats.stoneFor(p.w, p.h));
        bed.position.set(p.cx, p.cy, p.cz);
        bed.castShadow = shadows;
        bed.receiveShadow = shadows;
        g.add(bed);
        const green = new THREE.Mesh(
          new THREE.BoxGeometry(p.w - 0.2, 0.07, p.d - 0.2),
          new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 1, metalness: 0 }),
        );
        green.position.set(p.cx, p.h + 0.035, p.cz);
        g.add(green);
      }
      const crownInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.4, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        ROW_PLANTER_CROWNS.length,
      );
      const crownColor = new THREE.Color(0x2e5d33);
      ROW_PLANTER_CROWNS.forEach((c, i) => {
        const cv = propVariation("crown", 900 + i);
        dummy.position.set(c.x, 0.55 + 0.28 * cv.scaleY, c.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale, cv.scale * cv.scaleY, cv.scale);
        dummy.updateMatrix();
        crownInst.setMatrixAt(i, dummy.matrix);
        crownInst.setColorAt(i, crownColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      crownInst.castShadow = shadows;
      g.add(crownInst);
    }

    /* Banner poles flanking the street's far end: a dark pole, a
     * gold crossarm, and a hanging banner in the look's cloth —
     * the gardens' pole build, turned to face the street. */
    for (const p of ROW_BANNER_POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, ROW_BANNER_POLE.h, 8), mats.darkMetal);
      pole.position.set(p.x, ROW_BANNER_POLE.h / 2, p.z);
      pole.castShadow = shadows;
      g.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mats.gold);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(p.x, ROW_BANNER_POLE.h - 0.15, p.z);
      g.add(arm);
      const bannerPivot = new THREE.Group();
      bannerPivot.position.set(p.x, ROW_BANNER_POLE.h - 0.2, p.z);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.95), mats.fabric);
      banner.position.set(0, -0.85, 0);
      banner.castShadow = shadows;
      bannerPivot.add(banner);
      g.add(bannerPivot);
      /* Stack-100 #2 item 30: district banners sway like the hall's —
       * registered in both looks, never under reduced motion. */
      if (!this.reducedMotion) anim.bannerSways.push({ pivot: bannerPivot, phase: 3.9 + (p.x + p.z) });
    }

    /* The quarter's lantern standards — plaza-life's LAMP build,
     * instanced: stone plinths, dark posts, gold cages, emissive
     * glass, glow sprites after dark. Zero real lights. */
    {
      instanced(
        sharedGeometry("lamp-plinth", () => new THREE.BoxGeometry(0.42, 0.18, 0.42)), mats.stoneFor(0.5, 0.2),
        ROW_LAMPS.map((l) => ({ x: l.x, y: 0.09, z: l.z })),
      );
      instanced(
        sharedGeometry(`lamp-post:${LAMP.postH}`, () => new THREE.CylinderGeometry(0.055, 0.085, LAMP.postH, 10)), mats.darkMetal,
        ROW_LAMPS.map((l) => ({ x: l.x, y: 0.18 + LAMP.postH / 2, z: l.z })),
      );
      instanced(
        sharedGeometry("lamp-cage", () => new THREE.BoxGeometry(0.3, 0.36, 0.3)), mats.gold,
        ROW_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY, z: l.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      const glass = new THREE.InstancedMesh(
        sharedGeometry("lamp-glass", () => new THREE.BoxGeometry(0.21, 0.27, 0.21)),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        ROW_LAMPS.length,
      );
      ROW_LAMPS.forEach((l, i) => {
        dummy.position.set(l.x, LAMP.headY, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      });
      glass.instanceMatrix.needsUpdate = true;
      g.add(glass);
      instanced(
        sharedGeometry("lamp-cap", () => new THREE.ConeGeometry(0.3, 0.22, 4)), mats.goldDark,
        ROW_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY + 0.29, z: l.z, rotY: Math.PI / 4 })),
      );
      if (look.candles) {
        ROW_LAMPS.forEach((l, i) => {
          this.addLanternGlow(g, anim, l.x, LAMP.headY, l.z, LAMP.glowBase, i * 1.31);
        });
      }
    }

    // The way back, labeled from the district side of the gate.
    this.doorPlate(g, "THE KING'S PLAZA", 28.45, PALACE_DOOR_HEIGHT + 0.66, 14.5, Math.PI / 2, 2.6);

    // The district's door-station: the Row Slate at the street's head.
    this.buildStationMarkers(g, mats, CREATION_ROW_ID);

    group.add(g);
    this.shellGroups.set(CREATION_ROW_ID, g);
  }

  /** The Ateliers shell (Stage C item 34): the fine-work quarter
   *  south-east of the plaza, south of Creation Row, built
   *  entirely from ateliers.ts placement data — the same data
   *  palace-layout registers as the room's blocked rects, so
   *  every body built here is solid there. A working lane:
   *  glazed workshop bays lining a marble-striped lane, display
   *  vitrines along its edges, sculpture plinths, work yards
   *  with crates / stone stacks / tool benches, planted beds
   *  closing the north and south reaches, and the quarter's
   *  lamps and banners. The ground wears the OUTDOOR system
   *  (the look's paving + whole-tile slabs — never interior
   *  marble). Draw discipline: repeated pieces instance (slabs,
   *  bay posts, table/panel bodies, plinth bodies, crates, lamp
   *  parts, planting crowns). Light discipline: ZERO new real
   *  lights — the lantern standards AND the bays' glazed studio
   *  fronts glow by emissive glass + item-27 lantern-glow
   *  sprites after dark. */
  private buildAteliersShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();
    const shadows = QUALITY[this.quality].shadows;
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; rotY?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY ?? 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
      return im;
    };

    /* The ground: the look's paving over the whole quarter (the
     * shell floor), with the whole-tile wearing slabs instanced
     * over it — palace-grounds' paving plan for this rect. */
    const pavingSurface = { url: look.pavingTextureUrl, metresPerTile: PAVING_METRES_PER_TILE };
    this.shellFloor(g, look, mats, ATELIERS_INTERIOR, "paving", pavingSurface);
    {
      const slabs = pavingSlabsFor(ATELIERS_INTERIOR);
      const slabInst = new THREE.InstancedMesh(
        sharedGeometry("paving-slab", () => new THREE.BoxGeometry(4, 0.03, 4)), mats.pavingFor(4, 4), slabs.length,
      );
      slabs.forEach((s, i) => {
        dummy.position.set(s.cx, 0.015, s.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        slabInst.setMatrixAt(i, dummy.matrix);
      });
      slabInst.instanceMatrix.needsUpdate = true;
      slabInst.receiveShadow = shadows;
      g.add(slabInst);
    }

    /* The quarter's own enclosure: low marble walls with gold
     * caps on the east, south and west-south (the plaza's
     * language) — the north side is Creation Row's south wall
     * and the west side north of z 34 is the plaza's east wall
     * and its open gate. */
    for (const run of ATELIERS_WALL_RUNS) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(run.w, 1.05, run.d), mats.marbleFor(Math.max(run.w, run.d), 1.05),
      );
      wall.position.set(run.x, 0.525, run.z);
      wall.castShadow = shadows;
      g.add(wall);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(run.w === 0.35 ? 0.47 : run.w, 0.07, run.d === 0.35 ? 0.47 : run.d), mats.gold,
      );
      cap.position.set(run.x, 1.09, run.z);
      g.add(cap);
    }
    /* Grounded piers on the east wall's line (item 43's build). */
    buildPierSet(g, mats, shadows, ATELIERS_PIERS);

    /* The lane: a marble strip on the quarter's centre line
     * running east into the quarter, gold strips on its edges —
     * the plaza spine's language, turned east. Flat accent, no
     * collision, like every path on the grounds. */
    {
      const len = ATELIERS_LANE.toX - ATELIERS_LANE.fromX;
      const cx = (ATELIERS_LANE.fromX + ATELIERS_LANE.toX) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.016, ATELIERS_LANE.w), mats.marble);
      slab.position.set(cx, 0.022, ATELIERS_LANE.cz);
      g.add(slab);
      for (const sz of [-1.03, 1.03]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.07), mats.goldDark);
        strip.position.set(cx, 0.028, ATELIERS_LANE.cz + sz);
        g.add(strip);
      }
    }

    /* The workshop bays: four posts per bay (instanced), a fabric
     * canopy with a gold-dark edge on their heads, the worktable
     * against each bay's back (instanced bodies), and the glazed
     * studio front closing the back — a gold-dark frame carrying
     * a warm-lit glass panel (the lamp-glass law: emissive at
     * dusk, pale by day; NO real light behind it). The bay's
     * mouth stays open floor — a maker stands in it. */
    {
      instanced(
        new THREE.CylinderGeometry(0.07, 0.09, BAY_KIT.postH, 10), mats.darkMetal,
        ATELIER_BAY_POSTS.map((p) => ({ x: p.x, y: BAY_KIT.postH / 2, z: p.z })),
      );
      for (const s of ATELIER_BAYS) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(BAY_KIT.canopyW + 0.1, 0.05, BAY_KIT.canopyD + 0.1), mats.goldDark);
        trim.position.set(s.x, BAY_KIT.canopyY - 0.04, s.z);
        g.add(trim);
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(BAY_KIT.canopyW, 0.08, BAY_KIT.canopyD), mats.fabric);
        canopy.position.set(s.x, BAY_KIT.canopyY, s.z);
        canopy.castShadow = shadows;
        g.add(canopy);
      }
      instanced(
        new THREE.BoxGeometry(BAY_KIT.tableW, BAY_KIT.tableH, BAY_KIT.tableD), mats.stoneFor(BAY_KIT.tableW, BAY_KIT.tableH),
        ATELIER_BAY_TABLES.map((b) => ({ x: b.cx, y: b.cy, z: b.cz })),
      );
      const trims: Array<{ x: number; y: number; z: number }> = [];
      ATELIER_BAYS.forEach((s, i) => {
        const b = ATELIER_BAY_TABLES[i]!;
        trims.push({ x: b.cx, y: BAY_KIT.tableH - 0.06, z: b.cz + s.side * (BAY_KIT.tableD / 2 + 0.02) });
      });
      instanced(new THREE.BoxGeometry(BAY_KIT.tableW, 0.05, 0.05), mats.gold, trims);
      /* The glazed fronts: frames (instanced, gold-dark) a hair
       * behind the glass line, glass panels (instanced) on it. */
      instanced(
        new THREE.BoxGeometry(BAY_KIT.panelW + 0.16, BAY_KIT.panelH + 0.16, 0.1), mats.goldDark,
        ATELIER_BAYS.map((s, i) => {
          const p = ATELIER_BAY_PANELS[i]!;
          return { x: p.cx, y: p.cy, z: p.cz - s.side * 0.08 };
        }),
      );
      const glassStyle = lampGlassStyle(look.theme);
      instanced(
        new THREE.BoxGeometry(BAY_KIT.panelW, BAY_KIT.panelH, BAY_KIT.panelD),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.35, metalness: 0.1,
        }),
        ATELIER_BAY_PANELS.map((p) => ({ x: p.cx, y: p.cy, z: p.cz })),
      );
    }

    /* Stack-100 #2 items 31–33: the dress-form mannequins and
     * the fabric bolts. One mannequin per bay stands in its
     * mouth: a tripod stand, a cloth torso, a neck, and a real
     * HEAD FORM — a smooth matte head proportioned like a
     * tailor's form (item 32), never a textured sphere. The
     * forms are solid from ATELIER_MANNEQUINS' own data. On
     * every worktable lie three fabric bolts, varied in length,
     * radius and colour (item 33), and at the first bay's table
     * edge one bolt stands unrolled, its cloth draping to the
     * floor — the cascade. */
    {
      instanced(
        new THREE.CylinderGeometry(0.26, 0.3, 0.06, 12), mats.darkMetal,
        ATELIER_MANNEQUINS.map((m) => ({ x: m.x, y: 0.03, z: m.z })),
      );
      instanced(
        new THREE.CylinderGeometry(0.03, 0.03, MANNEQUIN.torsoY - 0.35, 8), mats.darkMetal,
        ATELIER_MANNEQUINS.map((m) => ({ x: m.x, y: (MANNEQUIN.torsoY - 0.35) / 2 + 0.06, z: m.z })),
      );
      instanced(
        new THREE.CapsuleGeometry(0.17, 0.32, 6, 12), mats.fabric,
        ATELIER_MANNEQUINS.map((m) => ({ x: m.x, y: MANNEQUIN.torsoY, z: m.z })),
      );
      instanced(
        new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8), mats.darkMetal,
        ATELIER_MANNEQUINS.map((m) => ({ x: m.x, y: MANNEQUIN.headY - 0.14, z: m.z })),
      );
      const headGeo = new THREE.SphereGeometry(1, 18, 14);
      const heads = new THREE.InstancedMesh(
        headGeo,
        new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.65, metalness: 0 }),
        ATELIER_MANNEQUINS.length,
      );
      ATELIER_MANNEQUINS.forEach((m, i) => {
        dummy.position.set(m.x, MANNEQUIN.headY, m.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(MANNEQUIN.headRx, MANNEQUIN.headRy, MANNEQUIN.headRz);
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
      });
      heads.instanceMatrix.needsUpdate = true;
      heads.castShadow = shadows;
      g.add(heads);

      /* The bolts: unit cylinders scaled per bolt (length along
       * X, its own radius), coloured per instance. */
      const boltGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
      const bolts = new THREE.InstancedMesh(
        boltGeo,
        new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
        ATELIER_FABRIC_BOLTS.length,
      );
      const boltColor = new THREE.Color();
      ATELIER_FABRIC_BOLTS.forEach((b, i) => {
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(0, 0, Math.PI / 2);
        dummy.scale.set(b.r, b.len, b.r);
        dummy.updateMatrix();
        bolts.setMatrixAt(i, dummy.matrix);
        bolts.setColorAt(i, boltColor.setHex(b.color));
      });
      bolts.instanceMatrix.needsUpdate = true;
      if (bolts.instanceColor) bolts.instanceColor.needsUpdate = true;
      bolts.castShadow = shadows;
      g.add(bolts);

      /* The cascade: a standing bolt at the first table's edge
       * and its cloth fall to the floor. */
      const c = ATELIER_CASCADE;
      const cascadeMat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.9, metalness: 0 });
      const standing = new THREE.Mesh(new THREE.CylinderGeometry(c.boltR, c.boltR, 1.3, 14), cascadeMat);
      standing.rotation.z = Math.PI / 2;
      standing.position.set(c.boltX, BAY_KIT.tableH + c.boltR, c.boltZ);
      standing.castShadow = shadows;
      g.add(standing);
      const drape = new THREE.Mesh(new THREE.BoxGeometry(c.drapeW, c.drapeH, 0.03), cascadeMat);
      drape.position.set(c.drapeX, c.drapeH / 2, c.drapeZ);
      drape.castShadow = shadows;
      g.add(drape);
    }

    /* The display vitrines: stone pedestals (instanced) carrying
     * an open gold-dark case — bottom and top slabs — with a
     * small made thing in gold inside and a glass pane over its
     * lane face (transparent, emissive-warmed at dusk). */
    {
      instanced(
        new THREE.BoxGeometry(0.7, 0.75, 0.7), mats.stoneFor(0.7, 0.75),
        ATELIER_VITRINES.map((p) => ({ x: p.x, y: 0.375, z: p.z })),
      );
      instanced(
        new THREE.BoxGeometry(VITRINE.w, 0.06, VITRINE.w), mats.goldDark,
        ATELIER_VITRINES.map((p) => ({ x: p.x, y: 0.78, z: p.z })),
      );
      instanced(
        new THREE.BoxGeometry(VITRINE.w, 0.06, VITRINE.w), mats.goldDark,
        ATELIER_VITRINES.map((p) => ({ x: p.x, y: VITRINE.h - 0.03, z: p.z })),
      );
      instanced(
        new THREE.IcosahedronGeometry(0.2, 1), mats.gold,
        ATELIER_VITRINES.map((p) => ({ x: p.x, y: 1.0, z: p.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      instanced(
        new THREE.BoxGeometry(VITRINE.w - 0.06, VITRINE.h - 0.81, VITRINE.w - 0.06),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity * 0.5,
          roughness: 0.15, metalness: 0, transparent: true, opacity: 0.32,
        }),
        ATELIER_VITRINES.map((p) => ({ x: p.x, y: 1.0, z: p.z })),
      );
    }

    /* The sculpture plinths: stone pedestals (instanced) with a
     * gold-dark cap and a small sculpted piece in gold on each —
     * the fine work on show in the yards. */
    {
      instanced(
        new THREE.BoxGeometry(ATELIER_PLINTH.w, ATELIER_PLINTH.h, ATELIER_PLINTH.w), mats.stoneFor(ATELIER_PLINTH.w, ATELIER_PLINTH.h),
        ATELIER_PLINTHS.map((p) => ({ x: p.x, y: ATELIER_PLINTH.h / 2, z: p.z })),
      );
      instanced(
        new THREE.BoxGeometry(0.86, 0.06, 0.86), mats.goldDark,
        ATELIER_PLINTHS.map((p) => ({ x: p.x, y: ATELIER_PLINTH.h + 0.03, z: p.z })),
      );
      instanced(
        new THREE.IcosahedronGeometry(0.22, 1), mats.gold,
        ATELIER_PLINTHS.map((p) => ({ x: p.x, y: ATELIER_PLINTH.h + 0.32, z: p.z })),
      );
    }

    /* Materials dressing: crate stacks (two crates a stack,
     * instanced, timber-toned), raw stone block stacks, and tool
     * benches against the far wall. */
    {
      const cratePlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      ATELIER_CRATES.forEach((c, i) => {
        const cv = propVariation("trough", 500 + i);
        cratePlaces.push({ x: c.x, y: ATELIER_CRATE.size / 2, z: c.z, rotY: cv.rotY });
        cratePlaces.push({ x: c.x + 0.06, y: ATELIER_CRATE.size * 1.5, z: c.z - 0.04, rotY: cv.rotY + 0.35 });
      });
      instanced(
        new THREE.BoxGeometry(ATELIER_CRATE.size, ATELIER_CRATE.size, ATELIER_CRATE.size),
        new THREE.MeshStandardMaterial({ color: 0x8a6b42, roughness: 1, metalness: 0, flatShading: true }),
        cratePlaces,
      );
      for (const s of ATELIER_STONE_STACKS) {
        const stack = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mats.stoneFor(s.w, s.h));
        stack.position.set(s.cx, s.cy, s.cz);
        stack.castShadow = shadows;
        g.add(stack);
      }
      for (const b of ATELIER_TOOL_BENCHES) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mats.darkMetal);
        bench.position.set(b.cx, b.cy, b.cz);
        bench.castShadow = shadows;
        g.add(bench);
        const top = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.12, 0.06, b.d + 0.12), mats.stoneFor(b.d, 0.2));
        top.position.set(b.cx, b.h + 0.03, b.cz);
        g.add(top);
      }
    }

    /* The planted edges: stone-edged beds closing the north and
     * south reaches, green-topped, with planting crowns along
     * each bed (instanced, item-18 variation per crown). */
    {
      for (const p of ATELIERS_PLANTERS) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mats.stoneFor(p.w, p.h));
        bed.position.set(p.cx, p.cy, p.cz);
        bed.castShadow = shadows;
        bed.receiveShadow = shadows;
        g.add(bed);
        const green = new THREE.Mesh(
          new THREE.BoxGeometry(p.w - 0.2, 0.07, p.d - 0.2),
          new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 1, metalness: 0 }),
        );
        green.position.set(p.cx, p.h + 0.035, p.cz);
        g.add(green);
      }
      const crownInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.4, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        ATELIERS_PLANTER_CROWNS.length,
      );
      const crownColor = new THREE.Color(0x2e5d33);
      ATELIERS_PLANTER_CROWNS.forEach((c, i) => {
        const cv = propVariation("crown", 1100 + i);
        dummy.position.set(c.x, 0.55 + 0.28 * cv.scaleY, c.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale, cv.scale * cv.scaleY, cv.scale);
        dummy.updateMatrix();
        crownInst.setMatrixAt(i, dummy.matrix);
        crownInst.setColorAt(i, crownColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      crownInst.castShadow = shadows;
      g.add(crownInst);
    }

    /* Banner poles flanking the lane's far end: a dark pole, a
     * gold crossarm, and a hanging banner in the look's cloth —
     * the Row's pole build, turned to face the lane. */
    for (const p of ATELIERS_BANNER_POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, ATELIERS_BANNER_POLE.h, 8), mats.darkMetal);
      pole.position.set(p.x, ATELIERS_BANNER_POLE.h / 2, p.z);
      pole.castShadow = shadows;
      g.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mats.gold);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(p.x, ATELIERS_BANNER_POLE.h - 0.15, p.z);
      g.add(arm);
      const bannerPivot = new THREE.Group();
      bannerPivot.position.set(p.x, ATELIERS_BANNER_POLE.h - 0.2, p.z);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.95), mats.fabric);
      banner.position.set(0, -0.85, 0);
      banner.castShadow = shadows;
      bannerPivot.add(banner);
      g.add(bannerPivot);
      /* Stack-100 #2 item 30: district banners sway like the hall's —
       * registered in both looks, never under reduced motion. */
      if (!this.reducedMotion) anim.bannerSways.push({ pivot: bannerPivot, phase: 5.5 + (p.x + p.z) });
    }

    /* The quarter's lantern standards — plaza-life's LAMP build,
     * instanced: stone plinths, dark posts, gold cages, emissive
     * glass, glow sprites after dark. Zero real lights. */
    {
      instanced(
        sharedGeometry("lamp-plinth", () => new THREE.BoxGeometry(0.42, 0.18, 0.42)), mats.stoneFor(0.5, 0.2),
        ATELIERS_LAMPS.map((l) => ({ x: l.x, y: 0.09, z: l.z })),
      );
      instanced(
        sharedGeometry(`lamp-post:${LAMP.postH}`, () => new THREE.CylinderGeometry(0.055, 0.085, LAMP.postH, 10)), mats.darkMetal,
        ATELIERS_LAMPS.map((l) => ({ x: l.x, y: 0.18 + LAMP.postH / 2, z: l.z })),
      );
      instanced(
        sharedGeometry("lamp-cage", () => new THREE.BoxGeometry(0.3, 0.36, 0.3)), mats.gold,
        ATELIERS_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY, z: l.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      const glass = new THREE.InstancedMesh(
        sharedGeometry("lamp-glass", () => new THREE.BoxGeometry(0.21, 0.27, 0.21)),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        ATELIERS_LAMPS.length,
      );
      ATELIERS_LAMPS.forEach((l, i) => {
        dummy.position.set(l.x, LAMP.headY, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      });
      glass.instanceMatrix.needsUpdate = true;
      g.add(glass);
      instanced(
        sharedGeometry("lamp-cap", () => new THREE.ConeGeometry(0.3, 0.22, 4)), mats.goldDark,
        ATELIERS_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY + 0.29, z: l.z, rotY: Math.PI / 4 })),
      );
      if (look.candles) {
        ATELIERS_LAMPS.forEach((l, i) => {
          this.addLanternGlow(g, anim, l.x, LAMP.headY, l.z, LAMP.glowBase, i * 1.31);
        });
      }
    }

    // The way back, labeled from the district side of the gate.
    this.doorPlate(g, "THE KING'S PLAZA", 28.45, PALACE_DOOR_HEIGHT + 0.66, 30.5, Math.PI / 2, 2.6);

    // The district's door-station: the Ateliers Slate at the lane's head.
    this.buildStationMarkers(g, mats, ATELIERS_ID);

    group.add(g);
    this.shellGroups.set(ATELIERS_ID, g);
  }

  /** The Boardwalk shell (Stage C item 35): the waterfront
   *  quarter south of the plaza, between the Listening Gardens
   *  and the Ateliers, built entirely from boardwalk.ts
   *  placement data — the same data palace-layout registers as
   *  the room's blocked rects, so every body built here is solid
   *  there. A timber-deck promenade: stalls in the Row kit, a
   *  bandstand at its heart, benches facing a long water basin
   *  behind a gold-capped railing, planted strips by the gate,
   *  lamps and banners. The ground is the deck — instanced
   *  timber planks in the look's deck palette over a paving
   *  underlay, never interior marble. Draw discipline: repeated
   *  pieces instance (planks, stall posts, bench parts, lamp
   *  parts, railing posts, planting crowns). Light discipline:
   *  ZERO new real lights — the lantern standards glow by
   *  emissive glass + item-27 lantern-glow sprites after dark,
   *  and the basin's water is animated by the tick's texture
   *  scroll like the pool's and the rill's. */
  private buildBoardwalkShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();
    const shadows = QUALITY[this.quality].shadows;
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; rotY?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY ?? 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
      return im;
    };

    /* The ground: a paving underlay over every floor rect (the
     * main deck and both north strips), with the timber deck
     * laid over it — whole board-length planks, ONE instanced
     * draw of unit boards scaled to boardwalk.ts' plank plan,
     * in the look's deck palette (dark warm wood at dusk, pale
     * sun-bleached by day). */
    const pavingSurface = { url: look.pavingTextureUrl, metresPerTile: PAVING_METRES_PER_TILE };
    for (const rect of BOARDWALK_FLOOR_RECTS) {
      this.shellFloor(g, look, mats, rect, "paving", pavingSurface);
    }
    {
      const deckStyle = boardwalkDeckStyle(look.theme);
      const plankInst = new THREE.InstancedMesh(
        sharedGeometry("unit-box", () => new THREE.BoxGeometry(1, 1, 1)),
        new THREE.MeshStandardMaterial({ color: deckStyle.color, roughness: deckStyle.roughness, metalness: 0 }),
        BOARDWALK_DECK_PLANKS.length,
      );
      BOARDWALK_DECK_PLANKS.forEach((p, i) => {
        dummy.position.set(p.cx, p.cy, p.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(p.w, p.h, p.d);
        dummy.updateMatrix();
        plankInst.setMatrixAt(i, dummy.matrix);
      });
      plankInst.instanceMatrix.needsUpdate = true;
      plankInst.receiveShadow = shadows;
      g.add(plankInst);
      /* Gold trim lines edging the deck's long runs — the
       * promenade's brass inlay, at the stall line and the
       * water-bench line. Flat accent, no collision. */
      for (const tz of [43.6, 53.6]) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(39.2, 0.012, 0.07), mats.goldDark);
        trim.position.set(7.6, 0.045, tz);
        g.add(trim);
      }
    }

    /* The quarter's own enclosure: low marble walls with gold
     * caps (the plaza's language) — the deck's west, south and
     * east-south runs and the two flanks against the Creator
     * Rooms building. The shared perimeter (the Gardens' east
     * wall, the Ateliers' west wall, the plaza's south wall and
     * its open gate) already stands in those shells. */
    for (const run of BOARDWALK_WALL_RUNS) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(run.w, 1.05, run.d), mats.marbleFor(Math.max(run.w, run.d), 1.05),
      );
      wall.position.set(run.x, 0.525, run.z);
      wall.castShadow = shadows;
      g.add(wall);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(run.w === 0.35 ? 0.47 : run.w, 0.07, run.d === 0.35 ? 0.47 : run.d), mats.gold,
      );
      cap.position.set(run.x, 1.09, run.z);
      g.add(cap);
    }
    /* Grounded piers on the south wall's line (item 43's build). */
    buildPierSet(g, mats, shadows, BOARDWALK_PIERS);

    /* The promenade stalls: the Creation Row kit — four posts
     * per stall (instanced), a fabric canopy with a gold-dark
     * edge, and the workbench against each stall's back
     * (instanced bodies with a gold trim line on the open face).
     * The stall's mouth stays open floor. */
    {
      instanced(
        sharedGeometry("stall-post", () => new THREE.CylinderGeometry(0.07, 0.09, STALL_KIT.postH, 10)), mats.darkMetal,
        BOARDWALK_STALL_POSTS.map((p) => ({ x: p.x, y: STALL_KIT.postH / 2, z: p.z })),
      );
      /* Perf round 2 (item 88): trims + canopies instance, the
       * Boardwalk keeping its own item-35 variation offset (the
       * si + 100 stream) — tint on instanceColor, scale on the
       * instance matrix, exactly as the Row. */
      instancedPart(
        g, sharedGeometry("stall-canopy-trim", () => new THREE.BoxGeometry(STALL_KIT.canopyW + 0.1, 0.05, STALL_KIT.canopyD + 0.1)),
        mats.goldDark, BOARDWALK_STALLS.length,
        (d, si) => d.position.set(BOARDWALK_STALLS[si].x, STALL_KIT.canopyY - 0.04, BOARDWALK_STALLS[si].z),
      );
      instancedPart(
        g, sharedGeometry("stall-canopy", () => new THREE.BoxGeometry(STALL_KIT.canopyW, 0.08, STALL_KIT.canopyD)),
        mats.fabric, BOARDWALK_STALLS.length,
        (d, si) => {
          const s = BOARDWALK_STALLS[si];
          const sv = propVariation("stall", si + 100);
          d.position.set(s.x, STALL_KIT.canopyY, s.z);
          d.scale.set(sv.scale, sv.scaleY, sv.scale);
        },
        { castShadow: shadows, colorAt: (si) => tintColor(0xffffff, propVariation("stall", si + 100)) },
      );
      instanced(
        sharedGeometry("stall-bench", () => new THREE.BoxGeometry(STALL_KIT.benchW, STALL_KIT.benchH, STALL_KIT.benchD)), mats.stoneFor(STALL_KIT.benchW, STALL_KIT.benchH),
        BOARDWALK_STALL_BENCHES.map((b) => ({ x: b.cx, y: b.cy, z: b.cz })),
      );
      const trims: Array<{ x: number; y: number; z: number }> = [];
      BOARDWALK_STALLS.forEach((s, i) => {
        const b = BOARDWALK_STALL_BENCHES[i]!;
        trims.push({ x: b.cx, y: STALL_KIT.benchH - 0.06, z: b.cz + s.side * (STALL_KIT.benchD / 2 + 0.02) });
      });
      instanced(sharedGeometry("stall-bench-trim", () => new THREE.BoxGeometry(STALL_KIT.benchW, 0.05, 0.05)), mats.gold, trims);
    }

    /* The bandstand: a stone-rimmed round platform in the
     * deck's timber, ceremonial steps on its north face (inside
     * its blocked footprint), six slender posts (instanced), a
     * gold ring beam, a shallow cloth cone roof with gold trim
     * and a gold finial — the gardens pavilion's build, raised
     * on the platform the stage grounds' precedent blocks
     * whole. */
    {
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(BANDSTAND.platformR + 0.18, BANDSTAND.platformR + 0.18, BANDSTAND.platformH, 28),
        mats.stoneFor(3, 0.4),
      );
      rim.position.set(BANDSTAND.cx, BANDSTAND.platformH / 2, BANDSTAND.cz);
      rim.castShadow = shadows;
      rim.receiveShadow = shadows;
      g.add(rim);
      const deckStyle = boardwalkDeckStyle(look.theme);
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(BANDSTAND.platformR, BANDSTAND.platformR, 0.06, 28),
        new THREE.MeshStandardMaterial({ color: deckStyle.color, roughness: deckStyle.roughness, metalness: 0 }),
      );
      top.position.set(BANDSTAND.cx, BANDSTAND.platformH + 0.03, BANDSTAND.cz);
      top.receiveShadow = shadows;
      g.add(top);
      for (const s of BANDSTAND_STEPS) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mats.stoneFor(s.w, s.h));
        step.position.set(s.cx, s.cy, s.cz);
        step.castShadow = shadows;
        g.add(step);
      }
      instanced(
        new THREE.CylinderGeometry(0.09, 0.12, BANDSTAND.postH, 10), mats.marble,
        BANDSTAND_POSTS.map((p) => ({ x: p.x, y: BANDSTAND.platformH + BANDSTAND.postH / 2, z: p.z })),
      );
      const beam = new THREE.Mesh(new THREE.TorusGeometry(BANDSTAND.postR, 0.06, 8, 32), mats.gold);
      beam.rotation.x = Math.PI / 2;
      beam.position.set(BANDSTAND.cx, BANDSTAND.platformH + BANDSTAND.postH, BANDSTAND.cz);
      g.add(beam);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(BANDSTAND.roofR, BANDSTAND.roofH, 28), mats.fabric);
      roof.position.set(BANDSTAND.cx, BANDSTAND.roofY + BANDSTAND.roofH / 2, BANDSTAND.cz);
      roof.castShadow = shadows;
      g.add(roof);
      const roofTrim = new THREE.Mesh(new THREE.TorusGeometry(BANDSTAND.roofR * 0.99, 0.035, 8, 36), mats.gold);
      roofTrim.rotation.x = Math.PI / 2;
      roofTrim.position.set(BANDSTAND.cx, BANDSTAND.roofY + 0.02, BANDSTAND.cz);
      g.add(roofTrim);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), mats.gold);
      finial.position.set(BANDSTAND.cx, BANDSTAND.roofY + BANDSTAND.roofH + 0.1, BANDSTAND.cz);
      g.add(finial);
    }

    /* Stack-100 #2 item 29: the prize wheel — the boardwalk's
     * game stand, west of the bandstand: a stone base, a dark
     * post, and a gold-rimmed wheel with segment pegs and a
     * pointer, turning on wheelAngleAt (idle creep + a full
     * eased spin every cycle) — registered as a spinner in
     * both looks, never under reduced motion. The stand is
     * solid from BOARDWALK_WHEEL's own data. */
    {
      const w = BOARDWALK_WHEEL;
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 1.1), mats.stoneFor(1.1, 0.3));
      base.position.set(w.x, 0.11, w.z);
      base.castShadow = shadows;
      g.add(base);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, w.axleY, 10), mats.darkMetal);
      post.position.set(w.x, w.axleY / 2 + 0.2, w.z);
      post.castShadow = shadows;
      g.add(post);
      const wheel = new THREE.Group();
      wheel.position.set(w.x, w.axleY, w.z);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(w.r, w.r, 0.09, 28), mats.fabric);
      disc.rotation.x = Math.PI / 2;
      disc.castShadow = shadows;
      wheel.add(disc);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(w.r, 0.045, 8, 36), mats.gold);
      wheel.add(rim);
      for (let i = 0; i < w.pegs; i++) {
        const a = (i / w.pegs) * Math.PI * 2;
        const peg = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), mats.gold);
        peg.position.set(Math.cos(a) * (w.r - 0.09), Math.sin(a) * (w.r - 0.09), 0.07);
        wheel.add(peg);
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, w.r - 0.12, 0.04), mats.goldDark);
        spoke.rotation.z = a - Math.PI / 2;
        spoke.position.set(Math.cos(a) * (w.r / 2 - 0.03), Math.sin(a) * (w.r / 2 - 0.03), 0.05);
        wheel.add(spoke);
      }
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mats.gold);
      hub.position.z = 0.07;
      wheel.add(hub);
      g.add(wheel);
      const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), mats.gold);
      pointer.rotation.x = Math.PI;
      pointer.position.set(w.x, w.axleY + w.r + 0.14, w.z);
      g.add(pointer);
      if (!this.reducedMotion) anim.spinners.push({ obj: wheel, angleAt: wheelAngleAt });
    }

    /* The water basin: a stone rim slab along the south edge
     * holding real animated water (a cloned texture the tick
     * scrolls, the pool/rill law), and the railing on its deck
     * edge — instanced posts, a gold top rail at hand height
     * and a mid rail. Beyond the south wall behind it, the
     * backdrop moat glints. */
    {
      const rimSlab = new THREE.Mesh(
        new THREE.BoxGeometry(BOARDWALK_BASIN.w, BOARDWALK_BASIN.rimH, BOARDWALK_BASIN.d),
        mats.stoneFor(BOARDWALK_BASIN.w, BOARDWALK_BASIN.rimH),
      );
      rimSlab.position.set(BOARDWALK_BASIN.cx, BOARDWALK_BASIN.rimH / 2, BOARDWALK_BASIN.cz);
      rimSlab.castShadow = shadows;
      rimSlab.receiveShadow = shadows;
      g.add(rimSlab);
      const tint = poolWaterTint(look.theme);
      const waterTex = hallTexture(look.waterTextureUrl, 6, 0.6).clone();
      waterTex.needsUpdate = true;
      const basinNormal = this.rippleNormalFor(6, 0.6);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(BOARDWALK_BASIN.w - BOARDWALK_BASIN.rimLip * 2, BOARDWALK_BASIN.d - BOARDWALK_BASIN.rimLip * 2),
        new THREE.MeshStandardMaterial({
          map: waterTex, color: tint.color, roughness: tint.roughness,
          normalMap: basinNormal, normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.water, MATERIAL_NORMAL_SCALES.water),
          metalness: 0.05, envMapIntensity: 1.2, transparent: true, opacity: 0.94,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(BOARDWALK_BASIN.cx, BOARDWALK_BASIN.waterY, BOARDWALK_BASIN.cz);
      g.add(water);
      g.add(this.wetEdgeRect(BOARDWALK_BASIN.cx, BOARDWALK_BASIN.cz, BOARDWALK_BASIN.w - BOARDWALK_BASIN.rimLip * 2, BOARDWALK_BASIN.d - BOARDWALK_BASIN.rimLip * 2, BOARDWALK_BASIN.waterY));
      anim.waters.push({ tex: waterTex, jet: null, normalTex: basinNormal });
      instanced(
        new THREE.CylinderGeometry(0.035, 0.045, BOARDWALK_RAILING.postH, 8), mats.darkMetal,
        BOARDWALK_RAILING_POSTS.map((p) => ({ x: p.x, y: BOARDWALK_RAILING.postH / 2, z: p.z })),
      );
      const railLen = BOARDWALK_RAILING.toX - BOARDWALK_RAILING.fromX;
      const railCx = (BOARDWALK_RAILING.fromX + BOARDWALK_RAILING.toX) / 2;
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(railLen, 0.06, 0.09), mats.gold);
      topRail.position.set(railCx, BOARDWALK_RAILING.railY, BOARDWALK_RAILING.z);
      g.add(topRail);
      const midRail = new THREE.Mesh(new THREE.BoxGeometry(railLen, 0.04, 0.05), mats.goldDark);
      midRail.position.set(railCx, 0.55, BOARDWALK_RAILING.z);
      g.add(midRail);
    }

    /* Benches: the water benches facing south over the basin
     * and the strip benches facing the gate — instanced seats,
     * backs (on the side away from what they face) and legs,
     * the plaza benches' construction. */
    {
      const seatPlaces: Array<{ x: number; y: number; z: number }> = [];
      const backPlaces: Array<{ x: number; y: number; z: number }> = [];
      const legPlaces: Array<{ x: number; y: number; z: number }> = [];
      for (const b of BOARDWALK_BENCHES) {
        seatPlaces.push({ x: b.x, y: BENCH.seatY, z: b.z });
        backPlaces.push({ x: b.x, y: BENCH.seatY + 0.28, z: b.z - b.facing * 0.24 });
        for (const endOff of [-0.8, 0.8]) {
          legPlaces.push({ x: b.x + endOff, y: BENCH.seatY / 2, z: b.z });
        }
      }
      instanced(sharedGeometry("bench-seat", () => new THREE.BoxGeometry(BENCH.len, 0.09, BENCH.depth)), mats.stoneFor(2, 0.4), seatPlaces);
      instanced(sharedGeometry("bench-back", () => new THREE.BoxGeometry(BENCH.len, 0.5, 0.08)), mats.stoneFor(2, 0.5), backPlaces);
      instanced(sharedGeometry("bench-legs", () => new THREE.BoxGeometry(0.09, BENCH.seatY, BENCH.depth - 0.1)), mats.darkMetal, legPlaces);
    }

    /* The planted strips: stone-edged beds against the south
     * wall in each north strip, green-topped, with planting
     * crowns along each bed (instanced, item-18 variation). */
    {
      for (const p of BOARDWALK_PLANTERS) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mats.stoneFor(p.w, p.h));
        bed.position.set(p.cx, p.cy, p.cz);
        bed.castShadow = shadows;
        bed.receiveShadow = shadows;
        g.add(bed);
        const green = new THREE.Mesh(
          new THREE.BoxGeometry(p.w - 0.2, 0.07, p.d - 0.2),
          new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 1, metalness: 0 }),
        );
        green.position.set(p.cx, p.h + 0.035, p.cz);
        g.add(green);
      }
      const crownInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.4, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        BOARDWALK_PLANTER_CROWNS.length,
      );
      const crownColor = new THREE.Color(0x2e5d33);
      BOARDWALK_PLANTER_CROWNS.forEach((c, i) => {
        const cv = propVariation("crown", 1300 + i);
        dummy.position.set(c.x, 0.55 + 0.28 * cv.scaleY, c.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale, cv.scale * cv.scaleY, cv.scale);
        dummy.updateMatrix();
        crownInst.setMatrixAt(i, dummy.matrix);
        crownInst.setColorAt(i, crownColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      crownInst.castShadow = shadows;
      g.add(crownInst);
    }

    /* Banner poles flanking the bandstand approach: a dark
     * pole, a gold crossarm, and a hanging banner in the look's
     * cloth, hung across the approach so it reads from the
     * gate. */
    for (const p of BOARDWALK_BANNER_POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, BOARDWALK_BANNER_POLE.h, 8), mats.darkMetal);
      pole.position.set(p.x, BOARDWALK_BANNER_POLE.h / 2, p.z);
      pole.castShadow = shadows;
      g.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mats.gold);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(p.x, BOARDWALK_BANNER_POLE.h - 0.15, p.z);
      g.add(arm);
      const bannerPivot = new THREE.Group();
      bannerPivot.position.set(p.x, BOARDWALK_BANNER_POLE.h - 0.2, p.z);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.7, 0.05), mats.fabric);
      banner.position.set(0, -0.85, 0);
      banner.castShadow = shadows;
      bannerPivot.add(banner);
      g.add(bannerPivot);
      /* Stack-100 #2 item 30: district banners sway like the hall's —
       * registered in both looks, never under reduced motion. */
      if (!this.reducedMotion) anim.bannerSways.push({ pivot: bannerPivot, phase: 7.1 + (p.x + p.z) });
    }

    /* The quarter's lantern standards — plaza-life's LAMP
     * build, instanced: stone plinths, dark posts, gold cages,
     * emissive glass, glow sprites after dark. Zero real
     * lights. */
    {
      instanced(
        sharedGeometry("lamp-plinth", () => new THREE.BoxGeometry(0.42, 0.18, 0.42)), mats.stoneFor(0.5, 0.2),
        BOARDWALK_LAMPS.map((l) => ({ x: l.x, y: 0.09, z: l.z })),
      );
      instanced(
        sharedGeometry(`lamp-post:${LAMP.postH}`, () => new THREE.CylinderGeometry(0.055, 0.085, LAMP.postH, 10)), mats.darkMetal,
        BOARDWALK_LAMPS.map((l) => ({ x: l.x, y: 0.18 + LAMP.postH / 2, z: l.z })),
      );
      instanced(
        sharedGeometry("lamp-cage", () => new THREE.BoxGeometry(0.3, 0.36, 0.3)), mats.gold,
        BOARDWALK_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY, z: l.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      const glass = new THREE.InstancedMesh(
        sharedGeometry("lamp-glass", () => new THREE.BoxGeometry(0.21, 0.27, 0.21)),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        BOARDWALK_LAMPS.length,
      );
      BOARDWALK_LAMPS.forEach((l, i) => {
        dummy.position.set(l.x, LAMP.headY, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      });
      glass.instanceMatrix.needsUpdate = true;
      g.add(glass);
      instanced(
        sharedGeometry("lamp-cap", () => new THREE.ConeGeometry(0.3, 0.22, 4)), mats.goldDark,
        BOARDWALK_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY + 0.29, z: l.z, rotY: Math.PI / 4 })),
      );
      if (look.candles) {
        BOARDWALK_LAMPS.forEach((l, i) => {
          this.addLanternGlow(g, anim, l.x, LAMP.headY, l.z, LAMP.glowBase, i * 1.31);
        });
      }
    }

    // The way back, labeled from the district side of the gate.
    this.doorPlate(g, "THE KING'S PLAZA", 0, PALACE_DOOR_HEIGHT + 0.66, 34.45, 0, 2.6);

    // The district's door-station: the Boardwalk Slate at the deck's head.
    this.buildStationMarkers(g, mats, BOARDWALK_ID);

    group.add(g);
    this.shellGroups.set(BOARDWALK_ID, g);
  }

  /** Creator Heights (Stage C item 36): the creators' residential
   *  quarter — a walled enclave on the plaza's north-east
   *  quadrant, built entirely from creator-heights.ts placement
   *  data (the same data palace-layout derives the room's
   *  blocked list from, so every body built here is solid
   *  there). Residence fronts on the north wall, overlook
   *  terraces on the court's south edge, benches, planted beds,
   *  banner poles, lantern standards — emissive + item-27 glow
   *  sprites after dark, ZERO new real PointLights. */
  private buildCreatorHeightsShell(group: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const g = new THREE.Group();
    const shadows = QUALITY[this.quality].shadows;
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; rotY?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY ?? 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
      return im;
    };

    /* The ground: the look's paving over the whole quarter (the
     * shell floor — the courtyard's tiling cedes this footprint
     * to this shell), with the whole-tile wearing slabs
     * instanced over it. */
    const pavingSurface = { url: look.pavingTextureUrl, metresPerTile: PAVING_METRES_PER_TILE };
    this.shellFloor(g, look, mats, HEIGHTS_INTERIOR, "paving", pavingSurface);
    {
      const slabs = pavingSlabsFor(HEIGHTS_INTERIOR);
      const slabInst = new THREE.InstancedMesh(
        sharedGeometry("paving-slab", () => new THREE.BoxGeometry(4, 0.03, 4)), mats.pavingFor(4, 4), slabs.length,
      );
      slabs.forEach((s, i) => {
        dummy.position.set(s.cx, 0.015, s.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        slabInst.setMatrixAt(i, dummy.matrix);
      });
      slabInst.instanceMatrix.needsUpdate = true;
      slabInst.receiveShadow = shadows;
      g.add(slabInst);
    }

    /* The quarter's own enclosure: low marble walls with gold
     * caps — the west wall in two runs flanking the open gate on
     * the old marker's spot, the north run and the south run.
     * The east side is the plaza's own east wall, already
     * standing in the courtyard shell. */
    for (const run of HEIGHTS_WALL_RUNS) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(run.w, 1.05, run.d), mats.marbleFor(Math.max(run.w, run.d), 1.05),
      );
      wall.position.set(run.x, 0.525, run.z);
      wall.castShadow = shadows;
      g.add(wall);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(run.w === 0.35 ? 0.47 : run.w, 0.07, run.d === 0.35 ? 0.47 : run.d), mats.gold,
      );
      cap.position.set(run.x, 1.09, run.z);
      g.add(cap);
    }
    /* Grounded piers on the north wall's line (item 43's build).
     * No south-west pier: the south bridge lane passes there. */
    buildPierSet(g, mats, shadows, HEIGHTS_PIERS);

    /* The gate walkway: a marble strip on the gate's line from
     * the gate east to the residents' court, gold strips on its
     * edges — the plaza spine's language, turned east. Flat
     * accent, no collision, like every path on the grounds. */
    {
      const len = HEIGHTS_WALKWAY.toX - HEIGHTS_WALKWAY.fromX;
      const cx = (HEIGHTS_WALKWAY.fromX + HEIGHTS_WALKWAY.toX) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.016, HEIGHTS_WALKWAY.w), mats.marble);
      slab.position.set(cx, 0.022, HEIGHTS_WALKWAY.cz);
      g.add(slab);
      for (const sz of [-1.03, 1.03]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.07), mats.goldDark);
        strip.position.set(cx, 0.028, HEIGHTS_WALKWAY.cz + sz);
        g.add(strip);
      }
    }

    /* The residence fronts: four posts per front (instanced), a
     * fabric canopy with a gold-dark edge on their heads, and
     * the residence door closing each front's back — a dark
     * metal panel with a gold trim and a lit transom window
     * above it (emissive only, the lamp-glass law; NO real
     * light behind it). Scenery honouring the creator-rooms
     * concept: the creators' doors on their quarter. */
    {
      instanced(
        new THREE.CylinderGeometry(0.07, 0.09, FRONT_KIT.postH, 10), mats.darkMetal,
        HEIGHTS_FRONT_POSTS.map((p) => ({ x: p.x, y: FRONT_KIT.postH / 2, z: p.z })),
      );
      for (const f of HEIGHTS_FRONTS) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(FRONT_KIT.canopyW + 0.1, 0.05, FRONT_KIT.canopyD + 0.1), mats.goldDark);
        trim.position.set(f.x, FRONT_KIT.canopyY - 0.04, f.z);
        g.add(trim);
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(FRONT_KIT.canopyW, 0.08, FRONT_KIT.canopyD), mats.fabric);
        canopy.position.set(f.x, FRONT_KIT.canopyY, f.z);
        canopy.castShadow = shadows;
        g.add(canopy);
      }
      instanced(
        new THREE.BoxGeometry(FRONT_KIT.doorW, FRONT_KIT.doorH, FRONT_KIT.doorD), mats.darkMetal,
        HEIGHTS_FRONT_DOORS.map((d) => ({ x: d.cx, y: d.cy, z: d.cz })),
      );
      instanced(
        new THREE.BoxGeometry(FRONT_KIT.doorW, 0.05, 0.05), mats.gold,
        HEIGHTS_FRONT_DOORS.map((d) => ({ x: d.cx, y: FRONT_KIT.doorH - 0.06, z: d.cz + FRONT_KIT.doorD / 2 + 0.02 })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      instanced(
        new THREE.BoxGeometry(1.2, 0.35, 0.06),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.35, metalness: 0.1,
        }),
        HEIGHTS_FRONT_DOORS.map((d) => ({ x: d.cx, y: FRONT_KIT.doorH - 0.28, z: d.cz + FRONT_KIT.doorD / 2 + 0.01 })),
      );
    }

    /* The overlook terraces: raised stone masses on the court's
     * south edge with a gold trim line, ceremonial steps on
     * their north faces (inside the blocked footprints), and
     * planting crowns along their tops (instanced, item-18
     * variation). The elevation is visual only — flat-plane
     * movement does not climb (the item-38 precedent), and each
     * terrace's whole footprint is honestly blocked. */
    {
      for (const t of HEIGHTS_TERRACES) {
        const mass = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), mats.stoneFor(t.w, t.h));
        mass.position.set(t.cx, t.cy, t.cz);
        mass.castShadow = shadows;
        mass.receiveShadow = shadows;
        g.add(mass);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.05, 0.07), mats.gold);
        trim.position.set(t.cx, t.h + 0.025, t.cz - t.d / 2 + 0.1);
        g.add(trim);
      }
      instanced(
        new THREE.BoxGeometry(2.0, 0.15, 0.5), mats.stoneFor(2, 0.3),
        HEIGHTS_TERRACE_STEPS.map((s) => ({ x: s.cx, y: s.cy, z: s.cz })),
      );
      const crownInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.4, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        HEIGHTS_TERRACE_CROWNS.length,
      );
      const crownColor = new THREE.Color(0x2e5d33);
      HEIGHTS_TERRACE_CROWNS.forEach((c, i) => {
        const cv = propVariation("crown", 1500 + i);
        dummy.position.set(c.x, 0.45 + 0.28 * cv.scaleY, c.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale, cv.scale * cv.scaleY, cv.scale);
        dummy.updateMatrix();
        crownInst.setMatrixAt(i, dummy.matrix);
        crownInst.setColorAt(i, crownColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      crownInst.castShadow = shadows;
      g.add(crownInst);
    }

    /* Benches on the residents' court: instanced seats, backs
     * (on the side away from what they face) and legs, the
     * plaza benches' construction. */
    {
      const seatPlaces: Array<{ x: number; y: number; z: number }> = [];
      const backPlaces: Array<{ x: number; y: number; z: number }> = [];
      const legPlaces: Array<{ x: number; y: number; z: number }> = [];
      for (const b of HEIGHTS_BENCHES) {
        seatPlaces.push({ x: b.x, y: BENCH.seatY, z: b.z });
        backPlaces.push({ x: b.x, y: BENCH.seatY + 0.28, z: b.z - b.facing * 0.24 });
        for (const endOff of [-0.8, 0.8]) {
          legPlaces.push({ x: b.x + endOff, y: BENCH.seatY / 2, z: b.z });
        }
      }
      instanced(sharedGeometry("bench-seat", () => new THREE.BoxGeometry(BENCH.len, 0.09, BENCH.depth)), mats.stoneFor(2, 0.4), seatPlaces);
      instanced(sharedGeometry("bench-back", () => new THREE.BoxGeometry(BENCH.len, 0.5, 0.08)), mats.stoneFor(2, 0.5), backPlaces);
      instanced(sharedGeometry("bench-legs", () => new THREE.BoxGeometry(0.09, BENCH.seatY, BENCH.depth - 0.1)), mats.darkMetal, legPlaces);
    }

    /* The planted beds: stone-edged boxes of green against the
     * west wall and in the north-east corner, with planting
     * crowns along their tops (instanced, item-18 variation). */
    {
      for (const p of HEIGHTS_PLANTERS) {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mats.stoneFor(p.w, p.h));
        bed.position.set(p.cx, p.cy, p.cz);
        bed.castShadow = shadows;
        bed.receiveShadow = shadows;
        g.add(bed);
        const green = new THREE.Mesh(
          new THREE.BoxGeometry(p.w - 0.2, 0.07, p.d - 0.2),
          new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 1, metalness: 0 }),
        );
        green.position.set(p.cx, p.h + 0.035, p.cz);
        g.add(green);
      }
      const crownInst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(0.4, 1),
        new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
        HEIGHTS_PLANTER_CROWNS.length,
      );
      const crownColor = new THREE.Color(0x2e5d33);
      HEIGHTS_PLANTER_CROWNS.forEach((c, i) => {
        const cv = propVariation("crown", 1600 + i);
        dummy.position.set(c.x, 0.55 + 0.28 * cv.scaleY, c.z);
        dummy.rotation.set(0, cv.rotY, 0);
        dummy.scale.set(cv.scale, cv.scale * cv.scaleY, cv.scale);
        dummy.updateMatrix();
        crownInst.setMatrixAt(i, dummy.matrix);
        crownInst.setColorAt(i, crownColor.clone().offsetHSL(cv.hueShift, 0, cv.lightnessShift));
      });
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      crownInst.castShadow = shadows;
      g.add(crownInst);
    }

    /* Banner poles flanking the walkway where it meets the
     * court: a dark pole, a gold crossarm, and a hanging banner
     * in the look's cloth. */
    for (const p of HEIGHTS_BANNER_POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, HEIGHTS_BANNER_POLE.h, 8), mats.darkMetal);
      pole.position.set(p.x, HEIGHTS_BANNER_POLE.h / 2, p.z);
      pole.castShadow = shadows;
      g.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mats.gold);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(p.x, HEIGHTS_BANNER_POLE.h - 0.15, p.z);
      g.add(arm);
      const bannerPivot = new THREE.Group();
      bannerPivot.position.set(p.x, HEIGHTS_BANNER_POLE.h - 0.2, p.z);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.95), mats.fabric);
      banner.position.set(0, -0.85, 0);
      banner.castShadow = shadows;
      bannerPivot.add(banner);
      g.add(bannerPivot);
      /* Stack-100 #2 item 30: district banners sway like the hall's —
       * registered in both looks, never under reduced motion. */
      if (!this.reducedMotion) anim.bannerSways.push({ pivot: bannerPivot, phase: 8.7 + (p.x + p.z) });
    }

    /* The quarter's lantern standards — plaza-life's LAMP build,
     * instanced: stone plinths, dark posts, gold cages, emissive
     * glass, glow sprites after dark. Zero real lights. */
    {
      instanced(
        sharedGeometry("lamp-plinth", () => new THREE.BoxGeometry(0.42, 0.18, 0.42)), mats.stoneFor(0.5, 0.2),
        HEIGHTS_LAMPS.map((l) => ({ x: l.x, y: 0.09, z: l.z })),
      );
      instanced(
        sharedGeometry(`lamp-post:${LAMP.postH}`, () => new THREE.CylinderGeometry(0.055, 0.085, LAMP.postH, 10)), mats.darkMetal,
        HEIGHTS_LAMPS.map((l) => ({ x: l.x, y: 0.18 + LAMP.postH / 2, z: l.z })),
      );
      instanced(
        sharedGeometry("lamp-cage", () => new THREE.BoxGeometry(0.3, 0.36, 0.3)), mats.gold,
        HEIGHTS_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY, z: l.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      const glass = new THREE.InstancedMesh(
        sharedGeometry("lamp-glass", () => new THREE.BoxGeometry(0.21, 0.27, 0.21)),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        HEIGHTS_LAMPS.length,
      );
      HEIGHTS_LAMPS.forEach((l, i) => {
        dummy.position.set(l.x, LAMP.headY, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      });
      glass.instanceMatrix.needsUpdate = true;
      g.add(glass);
      instanced(
        sharedGeometry("lamp-cap", () => new THREE.ConeGeometry(0.3, 0.22, 4)), mats.goldDark,
        HEIGHTS_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY + 0.29, z: l.z, rotY: Math.PI / 4 })),
      );
      if (look.candles) {
        HEIGHTS_LAMPS.forEach((l, i) => {
          this.addLanternGlow(g, anim, l.x, LAMP.headY, l.z, LAMP.glowBase, i * 1.61);
        });
      }
    }

    /* Stack-100 #2 item 20: the residents' roster plates — a
     * gold-framed plate over each residence door, lettered with
     * the resident's real name from the room's live roster
     * (creator-heights' shaping; VACANT until a resident stands
     * there). The materials register in heightsPlateMats so
     * setHeightsRoster re-letters them when the roster changes,
     * the monument board's discipline. */
    {
      const lines = heightsPlateLines(heightsRosterCurrent);
      HEIGHTS_PLATES.forEach((p, i) => {
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(HEIGHTS_PLATE.w + 0.1, HEIGHTS_PLATE.h + 0.1, 0.04), mats.goldDark,
        );
        frame.position.set(p.x, HEIGHTS_PLATE.y, p.z - 0.03);
        g.add(frame);
        const mat = new THREE.MeshBasicMaterial({ map: doorPlateTexture(lines[i]!), toneMapped: false });
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(HEIGHTS_PLATE.w, HEIGHTS_PLATE.h), mat);
        plate.position.set(p.x, HEIGHTS_PLATE.y, p.z);
        g.add(plate);
        this.heightsPlateMats.push(mat);
      });
    }

    /* Stack-100 #2 item 21: the front desk, dressed — a stone
     * counter with a gold trim on the court west of the Slate,
     * its bell, lamp and papers on top, the keeper's chair
     * behind it. Desk and chair are solid from HEIGHTS_DESK's
     * own data (HEIGHTS_BLOCKED); the dressing rides the
     * counter. The lamp glows by emissive glass — no real light. */
    {
      const d = HEIGHTS_DESK;
      const counter = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), mats.stoneFor(d.w, d.h));
      counter.position.set(d.cx, d.h / 2, d.cz);
      counter.castShadow = shadows;
      counter.receiveShadow = shadows;
      g.add(counter);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.05, 0.05), mats.gold);
      trim.position.set(d.cx, d.h - 0.06, d.cz + d.d / 2 + 0.01);
      g.add(trim);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mats.gold);
      bell.position.set(d.cx + d.bellDx, d.h + 0.04, d.cz);
      g.add(bell);
      const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 8), mats.darkMetal);
      lampPost.position.set(d.cx + d.lampDx, d.h + 0.11, d.cz);
      g.add(lampPost);
      const glassStyle = lampGlassStyle(look.theme);
      const lampGlass = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.13, 0.11),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
      );
      lampGlass.position.set(d.cx + d.lampDx, d.h + 0.28, d.cz);
      g.add(lampGlass);
      for (const [off, rot] of [[0, 0.12], [0.09, -0.2]] as const) {
        const paper = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.012, 0.4),
          new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.9, metalness: 0 }),
        );
        paper.position.set(d.cx + d.papersDx + off, d.h + 0.008, d.cz);
        paper.rotation.y = rot;
        g.add(paper);
      }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.5), mats.stoneFor(0.6, 0.3));
      seat.position.set(d.chair.x, 0.46, d.chair.z);
      seat.castShadow = shadows;
      g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.55, 0.07), mats.stoneFor(0.6, 0.6));
      back.position.set(d.chair.x, 0.78, d.chair.z - 0.24);
      g.add(back);
      for (const endOff of [-0.22, 0.22]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.06), mats.darkMetal);
        leg.position.set(d.chair.x + endOff, 0.23, d.chair.z);
        g.add(leg);
      }
    }

    /* Stack-100 #2 items 25–26: the court runner (a fabric strip
     * over the walkway's marble) and the arrival threshold (a
     * flat gold band + flanking stones just inside the gate) —
     * flat inlay both, no collision, by the arrival law. */
    {
      const len = HEIGHTS_RUNNER.toX - HEIGHTS_RUNNER.fromX;
      const runner = new THREE.Mesh(new THREE.BoxGeometry(len, 0.008, HEIGHTS_RUNNER.w), mats.fabric);
      runner.position.set((HEIGHTS_RUNNER.fromX + HEIGHTS_RUNNER.toX) / 2, 0.036, HEIGHTS_RUNNER.cz);
      runner.receiveShadow = shadows;
      g.add(runner);
      const band = HEIGHTS_THRESHOLD.band;
      const bandMesh = new THREE.Mesh(new THREE.BoxGeometry(band.w, 0.012, band.d), mats.gold);
      bandMesh.position.set(band.x, 0.03, band.z);
      g.add(bandMesh);
      for (const s of HEIGHTS_THRESHOLD.stones) {
        const stone = new THREE.Mesh(
          new THREE.BoxGeometry(HEIGHTS_THRESHOLD.stoneW, 0.012, HEIGHTS_THRESHOLD.stoneD), mats.stoneFor(1, 0.2),
        );
        stone.position.set(s.x, 0.03, s.z);
        g.add(stone);
      }
    }

    // The way back, labeled from the district side of the gate.
    this.doorPlate(g, "THE KING'S PLAZA", 13.75, PALACE_DOOR_HEIGHT + 0.66, 24.6, Math.PI / 2, 2.6);

    // The district's door-station: the Heights Slate on the court.
    this.buildStationMarkers(g, mats, HEIGHTS_ID);

    group.add(g);
    this.shellGroups.set(HEIGHTS_ID, g);
  }

  /** Plaza life (Stage C batch C3), built entirely from
   *  plaza-life.ts placement data — the same data palace-layout
   *  derives PLAZA_LIFE_BLOCKED from, so every body built here is
   *  solid there. Draw discipline: repeated pieces instance
   *  (lamp posts/heads, bench parts, urn parts, table tops); the
   *  two stalls and the pool are one-offs. Light discipline: ZERO
   *  new real lights — the lamps glow by emissive glass + the
   *  item-27 lantern-glow sprites after dark. */
  private buildPlazaLife(g: THREE.Group, look: HallLook, mats: LookMaterials, anim: LookAnim): void {
    const shadows = QUALITY[this.quality].shadows;
    const dummy = new THREE.Object3D();
    const instanced = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      places: Array<{ x: number; y: number; z: number; rotY?: number }>,
    ): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, places.length);
      places.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY ?? 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
      return im;
    };

    /* ── Item 28: the reflecting pool + fountain ───────────────
     * A stone rim ring (four runs) proud of the paving, the water
     * surface held just under its lip wearing the look's water
     * texture (cloned, so its shimmer scroll never drags the
     * backdrop moat's surface with it), and the fountain at its
     * heart: basin, column, upper bowl, and a translucent jet
     * cone the tick pulses. The whole footprint is POOL_BLOCKED
     * in the layout — a walker rounds the rim, never wades. */
    {
      const rimMat = mats.stoneFor(POOL.w, POOL.rimH);
      const rimRuns: Array<{ w: number; d: number; x: number; z: number }> = [
        { w: POOL.w, d: POOL.rimLip, x: POOL.cx, z: POOL.cz - POOL.d / 2 + POOL.rimLip / 2 },
        { w: POOL.w, d: POOL.rimLip, x: POOL.cx, z: POOL.cz + POOL.d / 2 - POOL.rimLip / 2 },
        { w: POOL.rimLip, d: POOL.d - POOL.rimLip * 2, x: POOL.cx - POOL.w / 2 + POOL.rimLip / 2, z: POOL.cz },
        { w: POOL.rimLip, d: POOL.d - POOL.rimLip * 2, x: POOL.cx + POOL.w / 2 - POOL.rimLip / 2, z: POOL.cz },
      ];
      for (const r of rimRuns) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(r.w, POOL.rimH, r.d), rimMat);
        rim.position.set(r.x, POOL.rimH / 2, r.z);
        rim.castShadow = shadows;
        rim.receiveShadow = shadows;
        g.add(rim);
      }
      /* A gold trim line along the rim's outer top edge. */
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(POOL.w + 0.06, 0.04, POOL.d + 0.06), mats.goldDark,
      );
      trim.position.set(POOL.cx, POOL.rimH - 0.02, POOL.cz);
      g.add(trim);
      const tint = poolWaterTint(look.theme);
      const waterTex = hallTexture(look.waterTextureUrl, 3, 1.25).clone();
      waterTex.needsUpdate = true;
      const poolNormal = this.rippleNormalFor(3, 1.25);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(POOL.w - POOL.rimLip * 2, POOL.d - POOL.rimLip * 2),
        new THREE.MeshStandardMaterial({
          map: waterTex, color: tint.color, roughness: tint.roughness,
          normalMap: poolNormal, normalScale: new THREE.Vector2(MATERIAL_NORMAL_SCALES.water, MATERIAL_NORMAL_SCALES.water),
          metalness: 0.35, envMapIntensity: 0.9,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(POOL.cx, POOL.waterY, POOL.cz);
      g.add(water);
      g.add(this.wetEdgeRect(POOL.cx, POOL.cz, POOL.w - POOL.rimLip * 2, POOL.d - POOL.rimLip * 2, POOL.waterY));
      /* The fountain: a marble basin on a short column at the
       * pool's heart, a smaller upper bowl, and the jet — a
       * translucent cone whose pulse is the water's life. */
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(FOUNTAIN.basinR, FOUNTAIN.basinR * 0.8, 0.22, 18), mats.facadeMarbleFor(1.7, 0.5));
      basin.position.set(FOUNTAIN.x, FOUNTAIN.basinTopY - 0.11, FOUNTAIN.z);
      basin.castShadow = shadows;
      g.add(basin);
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, FOUNTAIN.basinTopY - 0.22, 12), mats.facadeMarbleFor(0.4, 0.8));
      column.position.set(FOUNTAIN.x, (FOUNTAIN.basinTopY - 0.22) / 2, FOUNTAIN.z);
      g.add(column);
      const jet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.17, FOUNTAIN.jetTopY - FOUNTAIN.jetBaseY, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: look.theme === "dark" ? 0x9fc4d8 : 0xeaf6ff, transparent: true,
          opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      jet.position.set(FOUNTAIN.x, (FOUNTAIN.jetBaseY + FOUNTAIN.jetTopY) / 2, FOUNTAIN.z);
      jet.renderOrder = 4;
      g.add(jet);
      /* Stack-100 #2 item 7: the fall + the landing. The sheet
       * drops from the basin's rim to the pool (the gardens
       * fountain's construction, plaza twin), breathing with the
       * water model; the impact ripple is a flat ring on the pool
       * around the column that the model expands and fades. */
      const fallMat = new THREE.MeshBasicMaterial({
        color: look.theme === "dark" ? 0x9fc4d8 : 0xeaf6ff, transparent: true,
        opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
      });
      const fall = new THREE.Mesh(
        new THREE.CylinderGeometry(FOUNTAIN_FALL.topR, FOUNTAIN_FALL.bottomR, FOUNTAIN_FALL.topY - FOUNTAIN_FALL.bottomY, 20, 1, true),
        fallMat,
      );
      fall.position.set(FOUNTAIN.x, (FOUNTAIN_FALL.topY + FOUNTAIN_FALL.bottomY) / 2, FOUNTAIN.z);
      fall.renderOrder = 4;
      g.add(fall);
      const ripple = new THREE.Mesh(
        new THREE.RingGeometry(FOUNTAIN_FALL.rippleInnerR, FOUNTAIN_FALL.rippleOuterR, 36),
        new THREE.MeshBasicMaterial({
          color: look.theme === "dark" ? 0xcfe4ee : 0xffffff, transparent: true,
          opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(FOUNTAIN.x, FOUNTAIN_FALL.rippleY, FOUNTAIN.z);
      ripple.renderOrder = 3;
      g.add(ripple);
      /* Plaza-solids (item 43): the fountain dams — two capped
       * weir walls across the water at the pool's third-points,
       * rim to rim, dividing it into three basins. A falling
       * sheet on each face shares the fountain fall's material,
       * so the dams breathe with the pool's ONE registered water
       * entry — no second push, no second water model. Their
       * collision is plaza-solids' own rects, inside the pool's
       * blocked rectangle. */
      for (const dam of PLAZA_DAMS) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(DAM.thickness, DAM.capTopY, DAM.spanD), mats.stoneFor(0.6, 3.9),
        );
        wall.position.set(dam.x, DAM.capTopY / 2, dam.z);
        wall.castShadow = shadows;
        wall.receiveShadow = shadows;
        g.add(wall);
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(DAM.thickness + DAM.capLip * 2, 0.07, DAM.spanD + DAM.capLip * 2), mats.goldDark,
        );
        cap.position.set(dam.x, DAM.capTopY - 0.035, dam.z);
        cap.castShadow = shadows;
        g.add(cap);
        for (const side of [-1, 1]) {
          const sheet = new THREE.Mesh(
            new THREE.PlaneGeometry(DAM.spanD - 0.12, DAM.capTopY - 0.08 - POOL.waterY),
            fallMat,
          );
          sheet.rotation.y = (side * Math.PI) / 2;
          sheet.position.set(
            dam.x + side * (DAM.thickness / 2 + 0.012),
            (DAM.capTopY - 0.08 + POOL.waterY) / 2, dam.z,
          );
          sheet.renderOrder = 4;
          g.add(sheet);
        }
      }
      anim.waters.push({ tex: waterTex, jet, normalTex: poolNormal, fall, fallBase: 0.42, ripple });
    }

    /* ── Item 29: lamp standards ───────────────────────────────
     * Instanced stone posts on plinths, instanced gold cage
     * frames, one instanced emissive glass set — and after dark
     * each head carries an item-27 lantern-glow sprite. No real
     * lights: the night rig's real points stay the braziers'. */
    {
      instanced(
        sharedGeometry("lamp-plinth", () => new THREE.BoxGeometry(0.42, 0.18, 0.42)), mats.stoneFor(0.5, 0.2),
        PLAZA_LAMPS.map((l) => ({ x: l.x, y: 0.09, z: l.z })),
      );
      instanced(
        sharedGeometry(`lamp-post:${LAMP.postH}`, () => new THREE.CylinderGeometry(0.055, 0.085, LAMP.postH, 10)), mats.darkMetal,
        PLAZA_LAMPS.map((l) => ({ x: l.x, y: 0.18 + LAMP.postH / 2, z: l.z })),
      );
      instanced(
        sharedGeometry("lamp-cage", () => new THREE.BoxGeometry(0.3, 0.36, 0.3)), mats.gold,
        PLAZA_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY, z: l.z })),
      );
      const glassStyle = lampGlassStyle(look.theme);
      const glass = new THREE.InstancedMesh(
        sharedGeometry("lamp-glass", () => new THREE.BoxGeometry(0.21, 0.27, 0.21)),
        new THREE.MeshStandardMaterial({
          color: glassStyle.color, emissive: glassStyle.emissive,
          emissiveIntensity: glassStyle.emissiveIntensity, roughness: 0.4,
        }),
        PLAZA_LAMPS.length,
      );
      PLAZA_LAMPS.forEach((l, i) => {
        dummy.position.set(l.x, LAMP.headY, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      });
      glass.instanceMatrix.needsUpdate = true;
      g.add(glass);
      instanced(
        sharedGeometry("lamp-cap", () => new THREE.ConeGeometry(0.3, 0.22, 4)), mats.goldDark,
        PLAZA_LAMPS.map((l) => ({ x: l.x, y: LAMP.headY + 0.29, z: l.z, rotY: Math.PI / 4 })),
      );
      if (look.candles) {
        PLAZA_LAMPS.forEach((l, i) => {
          this.addLanternGlow(g, anim, l.x, LAMP.headY, l.z, LAMP.glowBase, i * 1.31);
          /* Fake light pool: the lamps carry NO real light — the
           * pool is what grounds their glow on the paving. */
          this.addFakePool(g, l.x, l.z, "lamp");
        });
      }
    }

    /* ── Item 30: benches, table sets, urns, stalls ─────────── */
    {
      /* Benches: instanced seats, backs and legs — the back
       * stands on the side AWAY from what the bench faces (the
       * monument pair faces south/north by their row; the pool
       * pair faces the water). Facing is encoded by rotY: the
       * alongX benches north of the monument face it (+z), the
       * south row faces it too (−z), the pool pair face ±x. */
      const benchPose = PLAZA_BENCHES.map((b) => {
        if (b.alongZ) return { ...b, rotY: b.x < POOL.cx ? 0 : Math.PI, faceX: true };
        return { ...b, rotY: b.z < 19.7 ? 0 : Math.PI, faceX: false };
      });
      const seatPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      const backPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      const legPlaces: Array<{ x: number; y: number; z: number; rotY?: number }> = [];
      for (const b of benchPose) {
        const backOff = 0.24;
        const alongX = !b.faceX;
        const backSign = b.rotY === 0 ? -1 : 1;
        seatPlaces.push({ x: b.x, y: BENCH.seatY, z: b.z, rotY: b.faceX ? Math.PI / 2 : 0 });
        backPlaces.push({
          x: b.faceX ? b.x + backSign * backOff : b.x,
          y: BENCH.seatY + 0.28,
          z: b.faceX ? b.z : b.z + backSign * backOff,
          rotY: b.faceX ? Math.PI / 2 : 0,
        });
        for (const endOff of [-0.8, 0.8]) {
          legPlaces.push({
            x: alongX ? b.x + endOff : b.x,
            y: BENCH.seatY / 2,
            z: alongX ? b.z : b.z + endOff,
            rotY: b.faceX ? Math.PI / 2 : 0,
          });
        }
      }
      instanced(sharedGeometry("bench-seat", () => new THREE.BoxGeometry(BENCH.len, 0.09, BENCH.depth)), mats.stoneFor(2, 0.4), seatPlaces);
      instanced(sharedGeometry("bench-back", () => new THREE.BoxGeometry(BENCH.len, 0.5, 0.08)), mats.stoneFor(2, 0.5), backPlaces);
      instanced(sharedGeometry("bench-legs", () => new THREE.BoxGeometry(0.09, BENCH.seatY, BENCH.depth - 0.1)), mats.darkMetal, legPlaces);

      /* Table sets: an instanced marble top + pedestal per set,
       * two stone stools flanking each (instanced too). */
      instanced(
        new THREE.CylinderGeometry(0.55, 0.55, 0.07, 16), mats.facadeMarbleFor(1.1, 0.2),
        PLAZA_TABLE_SETS.map((t) => ({ x: t.x, y: 0.74, z: t.z })),
      );
      instanced(
        new THREE.CylinderGeometry(0.07, 0.12, 0.7, 10), mats.darkMetal,
        PLAZA_TABLE_SETS.map((t) => ({ x: t.x, y: 0.37, z: t.z })),
      );
      instanced(
        new THREE.CylinderGeometry(0.24, 0.24, 0.42, 12), mats.stoneFor(0.5, 0.4),
        PLAZA_TABLE_SETS.flatMap((t) => [
          { x: t.x - 0.85, y: 0.21, z: t.z },
          { x: t.x + 0.85, y: 0.21, z: t.z },
        ]),
      );

      /* Urns: the monument's finial language at plaza scale —
       * instanced pedestals, bellies (item-18 finial variation
       * lives in the per-instance scale/rotation) and lips. */
      const urnVar = PLAZA_URNS.map((_, i) => propVariation("finial", 700 + i));
      const belly = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.21, 12, 10), mats.gold, PLAZA_URNS.length,
      );
      PLAZA_URNS.forEach((u, i) => {
        const v = urnVar[i]!;
        dummy.position.set(u.x, URN.pedestalH + 0.22, u.z);
        dummy.rotation.set(0, v.rotY, 0);
        dummy.scale.set(v.scale, v.scale * v.scaleY * 1.25, v.scale);
        dummy.updateMatrix();
        belly.setMatrixAt(i, dummy.matrix);
      });
      belly.instanceMatrix.needsUpdate = true;
      belly.castShadow = shadows;
      g.add(belly);
      instanced(
        new THREE.BoxGeometry(0.36, URN.pedestalH, 0.36), mats.facadeMarbleFor(0.4, URN.pedestalH),
        PLAZA_URNS.map((u) => ({ x: u.x, y: URN.pedestalH / 2, z: u.z })),
      );
      instanced(
        new THREE.CylinderGeometry(0.16, 0.11, 0.08, 10), mats.gold,
        PLAZA_URNS.map((u) => ({ x: u.x, y: URN.topY - 0.12, z: u.z })),
      );

      /* Market stalls: counter, four posts, a sloped fabric
       * canopy with a gold trim edge — two builds, each a small
       * group in the gate kit's spirit.
       * Perf round 2 (item 88): the whole kit instances — five
       * draws for both stalls, per-part shadow flags preserved
       * (counter + canopy cast; skirt, posts and trim bar never
       * did), the canopy's -0.13 slope on its instance matrix. */
      instancedPart(
        g, sharedGeometry("plaza-stall-counter", () => new THREE.BoxGeometry(STALL.w, 0.08, STALL.d)),
        mats.stoneFor(2.6, 0.4), PLAZA_STALLS.length,
        (d, i) => d.position.set(PLAZA_STALLS[i].x, STALL.counterY, PLAZA_STALLS[i].z),
        { castShadow: shadows },
      );
      instancedPart(
        g, sharedGeometry("plaza-stall-skirt", () => new THREE.BoxGeometry(STALL.w, STALL.counterY, STALL.d - 0.15)),
        mats.darkMetal, PLAZA_STALLS.length,
        (d, i) => d.position.set(PLAZA_STALLS[i].x, STALL.counterY / 2, PLAZA_STALLS[i].z),
      );
      const stallPostOffsets: Array<{ dx: number; dz: number }> = [];
      for (const px of [-STALL.w / 2 + 0.1, STALL.w / 2 - 0.1]) {
        for (const pz of [-STALL.d / 2 + 0.08, STALL.d / 2 - 0.08]) stallPostOffsets.push({ dx: px, dz: pz });
      }
      instancedPart(
        g, sharedGeometry("plaza-stall-post", () => new THREE.CylinderGeometry(0.04, 0.04, STALL.canopyY, 8)),
        mats.darkMetal, PLAZA_STALLS.length * stallPostOffsets.length,
        (d, k) => {
          const s = PLAZA_STALLS[Math.floor(k / stallPostOffsets.length)];
          const o = stallPostOffsets[k % stallPostOffsets.length];
          d.position.set(s.x + o.dx, STALL.canopyY / 2, s.z + o.dz);
        },
      );
      instancedPart(
        g, sharedGeometry("plaza-stall-canopy", () => new THREE.BoxGeometry(STALL.w + 0.3, 0.05, STALL.d + 0.45)),
        mats.fabric, PLAZA_STALLS.length,
        (d, i) => {
          d.position.set(PLAZA_STALLS[i].x, STALL.canopyY + 0.12, PLAZA_STALLS[i].z);
          d.rotation.x = -0.13;
        },
        { castShadow: shadows },
      );
      instancedPart(
        g, sharedGeometry("plaza-stall-trim", () => new THREE.BoxGeometry(STALL.w + 0.3, 0.05, 0.06)),
        mats.gold, PLAZA_STALLS.length,
        (d, i) => d.position.set(PLAZA_STALLS[i].x, STALL.canopyY + 0.03, PLAZA_STALLS[i].z + (STALL.d + 0.45) / 2),
      );
    }

    /* ── Item 40: the spawn arrival dressing ───────────────────
     * Flat inlay only (no collision by design): a gold medallion
     * centred on the spawn stance, a fine inner ring, threshold
     * stones flanking the spine, and the gold threshold band
     * across it — the first-look axis runs medallion → monument
     * → arch → façade from exactly where the walker lands. */
    {
      const medallion = new THREE.Mesh(
        new THREE.RingGeometry(SPAWN_DRESSING.medallionInnerR, SPAWN_DRESSING.medallionOuterR, 48), mats.gold,
      );
      medallion.rotation.x = -Math.PI / 2;
      medallion.position.set(SPAWN_DRESSING.cx, 0.018, SPAWN_DRESSING.cz);
      medallion.renderOrder = 3;
      g.add(medallion);
      const inner = new THREE.Mesh(
        new THREE.RingGeometry(SPAWN_DRESSING.innerRingInnerR, SPAWN_DRESSING.innerRingOuterR, 32), mats.goldDark,
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(SPAWN_DRESSING.cx, 0.018, SPAWN_DRESSING.cz);
      inner.renderOrder = 3;
      g.add(inner);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(SPAWN_DRESSING.band.w, 0.014, SPAWN_DRESSING.band.d), mats.goldDark,
      );
      band.position.set(SPAWN_DRESSING.cx, 0.02, SPAWN_DRESSING.band.cz);
      g.add(band);
      for (const st of SPAWN_DRESSING.stones) {
        const stone = new THREE.Mesh(
          new THREE.BoxGeometry(SPAWN_DRESSING.stoneW, 0.03, SPAWN_DRESSING.stoneD), mats.stoneFor(1, 0.2),
        );
        stone.position.set(st.x, 0.015, st.z);
        stone.receiveShadow = shadows;
        g.add(stone);
      }
    }

    /* ── Plaza-solids: the lions + the compass rose ────────────
     * The façade's guardians and the yard's medallion, built
     * from plaza-solids' placement data — the same numbers the
     * collision derives from, so a body can never drift off its
     * own shadow. Static dressing: no real lights, no animation,
     * the same geometry in both looks (the looks differ by
     * texture and tint, as everywhere on the plaza). */
    {
      const lionMat = mats.facadeMarbleFor(1.4, 1.2);
      const plinthMat = mats.stoneFor(1, 0.4);
      for (const lion of PLAZA_LIONS) {
        const grp = new THREE.Group();
        grp.position.set(lion.x, 0, lion.z);
        grp.rotation.y = lion.rotY;
        const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, y, z);
          m.castShadow = shadows;
          grp.add(m);
          return m;
        };
        /* The plinth: stone, gold-trimmed at its top edge — the
         * pool rim's language at a statue's scale. */
        part(new THREE.BoxGeometry(LION.plinthW, LION.plinthH, LION.plinthD), plinthMat, 0, LION.plinthH / 2, 0);
        part(new THREE.BoxGeometry(LION.plinthW + 0.05, 0.045, LION.plinthD + 0.05), mats.goldDark, 0, LION.plinthH - 0.022, 0);
        const top = LION.plinthH;
        /* The seated body: haunches behind, chest forward. */
        const haunch = part(new THREE.SphereGeometry(1, 20, 14), lionMat, 0, top + 0.36, -0.3);
        haunch.scale.set(0.34, 0.4, 0.48);
        const chest = part(new THREE.SphereGeometry(1, 20, 14), lionMat, 0, top + 0.44, 0.2);
        chest.scale.set(0.32, 0.46, 0.34);
        /* Straight front legs, paws forward on the plinth, and
         * an ear above the mane on each side. */
        for (const sx of [-1, 1]) {
          part(new THREE.CylinderGeometry(0.07, 0.08, 0.6, 10), lionMat, sx * 0.16, top + 0.3, 0.4);
          part(new THREE.BoxGeometry(0.15, 0.08, 0.3), lionMat, sx * 0.16, top + 0.04, 0.5);
          part(new THREE.SphereGeometry(0.055, 10, 8), lionMat, sx * 0.13, top + 1.05, 0.33);
        }
        /* The mane (its top is LION.topY), the head, the muzzle. */
        const mane = part(new THREE.SphereGeometry(1, 20, 14), lionMat, 0, top + 0.92, 0.28);
        mane.scale.set(0.38, 0.35, 0.28);
        const head = part(new THREE.SphereGeometry(0.2, 18, 12), lionMat, 0, top + 0.89, 0.4);
        head.scale.set(0.95, 0.9, 1.05);
        part(new THREE.BoxGeometry(0.19, 0.12, 0.17), lionMat, 0, top + 0.78, 0.56);
        /* The gold collar — the guardians wear the house gold. */
        const collar = part(new THREE.TorusGeometry(0.23, 0.028, 10, 24), mats.gold, 0, top + 0.67, 0.3);
        collar.rotation.x = 1.15;
        /* The tail, curled flat around the right haunch. */
        const tail = part(new THREE.TorusGeometry(0.3, 0.04, 8, 20, Math.PI * 1.1), lionMat, 0.16, top + 0.06, -0.4);
        tail.rotation.x = Math.PI / 2;
        tail.rotation.z = -0.5;
        g.add(grp);
      }
      /* The compass rose: relief set into the yard's paving —
       * a marble base disc, a raised gold rim ring standing
       * proud of the floor (item 44's relief), a gold ring
       * inlay, and an eight-point star under a gold hub. */
      const rose = new THREE.Group();
      rose.position.set(COMPASS_ROSE.cx, 0, COMPASS_ROSE.cz);
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(COMPASS_ROSE.outerR, COMPASS_ROSE.outerR + 0.08, COMPASS_ROSE.baseTopY, 44),
        mats.facadeMarbleFor(3.4, 0.2),
      );
      disc.position.y = COMPASS_ROSE.baseTopY / 2;
      disc.receiveShadow = shadows;
      rose.add(disc);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(COMPASS_ROSE.rimR, COMPASS_ROSE.rimTube, 10, 48), mats.goldDark,
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = COMPASS_ROSE.rimTopY - COMPASS_ROSE.rimTube;
      rim.castShadow = shadows;
      rose.add(rim);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(COMPASS_ROSE.ringInnerR, COMPASS_ROSE.ringOuterR, 44),
        mats.gold,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = COMPASS_ROSE.baseTopY + 0.004;
      rose.add(ring);
      /* The star: four long gold cardinals, four short dark
       * diagonals — flattened four-sided cones lying on the
       * disc, tips out, bases tucked under the hub. */
      const spike = (angle: number, len: number, mat: THREE.Material) => {
        const holder = new THREE.Group();
        holder.rotation.y = angle;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, len, 4), mat);
        cone.rotation.x = Math.PI / 2;
        cone.scale.set(1, 1, 0.22);
        cone.position.set(0, COMPASS_ROSE.baseTopY + 0.02, len / 2 - 0.12);
        holder.add(cone);
        rose.add(holder);
      };
      for (let i = 0; i < 4; i++) spike((i * Math.PI) / 2, COMPASS_ROSE.starR, mats.gold);
      for (let i = 0; i < 4; i++) spike((i * Math.PI) / 2 + Math.PI / 4, COMPASS_ROSE.starR * 0.68, mats.darkMetal);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(
          COMPASS_ROSE.hubR, COMPASS_ROSE.hubR + 0.04, COMPASS_ROSE.hubTopY - COMPASS_ROSE.baseTopY, 24,
        ),
        mats.gold,
      );
      hub.position.y = (COMPASS_ROSE.baseTopY + COMPASS_ROSE.hubTopY) / 2;
      hub.castShadow = shadows;
      rose.add(hub);
      g.add(rose);
    }

    /* ── Item 26: daylight pollen ──────────────────────────────
     * A Points field over the courtyard air, day look only, at
     * the ladder's particle scale — and never built at all under
     * reduced motion (the field rests by not existing). */
    if (look.theme === "light" && !this.reducedMotion) {
      const count = pollenCountForScale(QUALITY[this.quality].particleScale);
      if (count > 0) {
        const field = createPollenField(count, "courtyard");
        const positions = new Float32Array(count * 3);
        field.forEach((m, i) => {
          const p = pollenPositionAt(m, 0);
          positions[i * 3] = p.x;
          positions[i * 3 + 1] = p.y;
          positions[i * 3 + 2] = p.z;
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const points = new THREE.Points(geo, new THREE.PointsMaterial({
          map: hazeTexture(), size: 0.07, transparent: true, opacity: 0.55, color: 0xfff2c4,
          blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
        }));
        points.renderOrder = 5;
        points.frustumCulled = false;
        g.add(points);
        anim.pollen = { points, field };
      }
    }
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
      mat.emissiveMap = tex;
      mat.needsUpdate = true;
    }
  }

  /** The Heights roster seam (Stack-100 #2 item 20): the page
   *  hands the residents' real names — the room's live roster,
   *  in front order — and the plates over the residence doors
   *  re-letter when (and only when) the words change. */
  setHeightsRoster(roster: readonly string[]): void {
    const sig = heightsRosterSignature(roster);
    if (sig === this.heightsRosterSig && heightsRosterCurrent.length > 0) return;
    this.heightsRosterSig = sig;
    heightsRosterCurrent = roster;
    const lines = heightsPlateLines(roster);
    this.heightsPlateMats.forEach((mat, i) => {
      mat.map = doorPlateTexture(lines[i] ?? "VACANT");
      mat.needsUpdate = true;
    });
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
      existing.target = { x: peer.x, y: peer.y, z: peer.z, rotY: peer.rotY };
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
    /* The figure stands ON its ground (item 54): ground height
     * under the stride bob + the action's own lift — never
     * instead of them. */
    rig.group.position.y = rig.groundY + mover.bobY + rig.poseY;
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

  setPeerTarget(peerId: string, x: number, z: number, rotY: number, y?: number): void {
    const rig = this.avatars.get(peerId);
    if (rig) rig.target = { x, y: y ?? rig.target.y, z, rotY };
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
    /* Item 53: a spawn is a placement, not a walk — the figure
     * materializes ON the destination's ground (a lawn spawn
     * stands on the grass, a Boardwalk arrival on the deck),
     * never sunk to the room floor or floating over it. */
    this.rig.position.set(p.x, groundHeightAt(p.x, p.z), p.z);
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
    /* The step back is a settle too (item 53): land on this
     * side's ground at the clamped point, at its own height. */
    this.rig.position.y = groundHeightAt(p.x, p.z);
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
      /* The Stage Grounds and the plaza see each other through
       * the open west gate (item 31): standing in either, the
       * other stays built — the gate is a real sightline, and a
       * vanishing district (or plaza) through it would be a lie.
       * The Listening Gardens and the plaza share the same law
       * through the open south gate (item 32), Creation Row
       * and the plaza through the open east gate (item 33), and
       * the Ateliers and the plaza through the east wall's south
       * gate (item 34). */
      const gateVisible =
        (id === STAGE_GROUNDS_ID && this.currentRoom === COURTYARD_ID) ||
        (id === COURTYARD_ID && this.currentRoom === STAGE_GROUNDS_ID) ||
        (id === LISTENING_GARDENS_ID && this.currentRoom === COURTYARD_ID) ||
        (id === COURTYARD_ID && this.currentRoom === LISTENING_GARDENS_ID) ||
        (id === CREATION_ROW_ID && this.currentRoom === COURTYARD_ID) ||
        (id === COURTYARD_ID && this.currentRoom === CREATION_ROW_ID) ||
        (id === ATELIERS_ID && this.currentRoom === COURTYARD_ID) ||
        (id === COURTYARD_ID && this.currentRoom === ATELIERS_ID) ||
        /* The Ateliers and Creation Row share a wall (the Row's
         * south run is the Ateliers' north wall, item 34): the
         * wall is low, so each district is genuinely visible
         * over it from the other — standing in either, the other
         * stays built. */
        (id === ATELIERS_ID && this.currentRoom === CREATION_ROW_ID) ||
        (id === CREATION_ROW_ID && this.currentRoom === ATELIERS_ID) ||
        /* The Boardwalk and the plaza see each other through the
         * open south gate (item 35): standing in either, the
         * other stays built — the gate is a real sightline. The
         * Boardwalk also shares its west wall with the Listening
         * Gardens and its east wall with the Ateliers (their own
         * runs, already standing): the walls are low, so each
         * neighbour is genuinely visible over them from the
         * other — standing in any of the three, the others stay
         * built. */
        (id === BOARDWALK_ID && this.currentRoom === COURTYARD_ID) ||
        (id === COURTYARD_ID && this.currentRoom === BOARDWALK_ID) ||
        (id === BOARDWALK_ID && this.currentRoom === LISTENING_GARDENS_ID) ||
        (id === LISTENING_GARDENS_ID && this.currentRoom === BOARDWALK_ID) ||
        (id === BOARDWALK_ID && this.currentRoom === ATELIERS_ID) ||
        (id === ATELIERS_ID && this.currentRoom === BOARDWALK_ID) ||
        /* Creator Heights and the plaza see each other through
         * the open gate in the enclave's west wall (item 36):
         * standing in either, the other stays built. The
         * Heights also shares the plaza's east wall with
         * Creation Row — the wall is low, so each is genuinely
         * visible over it from the other. */
        (id === HEIGHTS_ID && this.currentRoom === COURTYARD_ID) ||
        (id === COURTYARD_ID && this.currentRoom === HEIGHTS_ID) ||
        (id === HEIGHTS_ID && this.currentRoom === CREATION_ROW_ID) ||
        (id === CREATION_ROW_ID && this.currentRoom === HEIGHTS_ID);
      g.visible = this.currentRoom === HALL_ROOM_ID || this.currentRoom === id || creatorVisible || gateVisible;
    }
    const plaza = this.shellGroups.get(COURTYARD_ID);
    if (plaza) this.plazaBaseVisible = plaza.visible;
    this.applyAreaAtmosphere();
    this.applyLightScoping();
  }

  /* ── Perf systems (items 23/24/99): scoped lights, portal culling,
   * LOD, and runtime rung application. The RULES live in
   * visibility.ts / quality.ts (pure, unit-tested); these methods
   * only collect the scene's facts and apply the verdicts. ── */

  /** Collect every point/spot light in the look with its world
   *  position and range. Ambient/hemisphere/directional lights are
   *  global by nature and never scoped. */
  private collectScopedLights(group: THREE.Group): void {
    this.scopedLights = [];
    group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    group.traverse((obj) => {
      if (obj instanceof THREE.PointLight || obj instanceof THREE.SpotLight) {
        obj.getWorldPosition(v);
        this.scopedLights.push({ light: obj, x: v.x, z: v.z, range: obj.distance ?? 0 });
      }
    });
  }

  /** Item 13 [PICK — conservative top-rung version]: the brazier
   *  point lights (plaza + hall dais, ONE class) cast shadows on
   *  the HIGH rung only. Cube maps at 512, near/far fitted to the
   *  light's own range, radius from the rung's softness table.
   *  The flames flicker in INTENSITY only — positions are static,
   *  so the frozen-map discipline keeps their shadows honest and
   *  the cost lands on refresh frames, never per frame. This is
   *  also the hall's indoor night shadow light: indoors after
   *  dark the directional is out (the look's sun is absent), and
   *  the dais braziers are the fire the room is lit by. */
  private applyLocalShadowLights(): void {
    const rung = QUALITY[this.quality];
    for (const light of this.brazierShadowLights) {
      light.castShadow = rung.localShadowLights;
      if (rung.localShadowLights) {
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 0.3;
        light.shadow.camera.far = light.distance > 0 ? light.distance : 12;
        light.shadow.radius = rung.shadowRadius;
        light.shadow.bias = -0.005;
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
    }
    if (rung.localShadowLights) this.renderer.shadowMap.needsUpdate = true;
  }

  /** A fake light pool (night-life's FAKE_POOL): an additive
   *  radial glow laid on the ground under a flame that carries
   *  no (or not enough) real light — the plaza lamps above all.
   *  Dressing, not a light: no shadow, no cost beyond one quad. */
  private addFakePool(group: THREE.Group, x: number, z: number, kind: "lamp" | "brazier", groundY = 0.02): void {
    const r = FAKE_POOL[kind].radius;
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(r, 24),
      new THREE.MeshBasicMaterial({
        map: flameTexture(), transparent: true,
        opacity: fakePoolOpacity(kind, this.quality),
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, groundY, z);
    pool.renderOrder = 2;
    group.add(pool);
  }

  /** Item 24: switch off lights whose range provably cannot reach
   *  the walker's current room (visibility.ts carries the proof);
   *  everything that could reach stays on — the look inside an
   *  area is unchanged. */
  private applyLightScoping(): void {
    for (const entry of this.scopedLights) {
      entry.light.visible = !lightScopedOff(entry, this.currentRoom);
    }
  }

  /** Item 23 portal culling + the reflector gate + item 99 LOD,
   *  run per frame from the tick with the CAMERA's facts. */
  private servicePerfSystems(presenting: boolean): void {
    this.camera.getWorldPosition(SCRATCH_VEC);
    const camX = SCRATCH_VEC.x;
    const camZ = SCRATCH_VEC.z;
    /* The visible sky (items 3/4) rides the camera: the dome is
     * centred on the walker, so its 90 m radius is the distance
     * in EVERY direction — always inside the far plane, never
     * fogged into a wall (its shader takes no fog). */
    if (this.skyGroup) this.skyGroup.position.set(camX, 0, camZ);
    const area = areaForRoom(this.currentRoom);
    if (this.hallGroup) {
      this.hallGroup.visible = !hallInteriorCulled(camX, camZ, this.yaw, area);
    }
    const plaza = this.shellGroups.get(COURTYARD_ID);
    if (plaza && this.plazaBaseVisible) {
      plaza.visible = !plazaDressingCulled(camX, camZ, this.yaw, area);
    }
    if (this.floorReflector) {
      const rung = QUALITY[this.quality];
      this.floorReflector.visible = reflectorShouldRender({
        camX,
        camZ,
        camYaw: this.yaw,
        area,
        reflectorSize: rung.reflectorSize,
        glimpseEveryN: rung.reflectorGlimpseEveryN,
        frameIndex: this.frameIndex,
        presenting,
      });
    }
    // LOD service on a slow cadence — dressing distances change
    // at walking pace, not frame pace.
    if (this.frameIndex % 10 === 0 && this.lodItems.length > 0) {
      const draw = QUALITY[this.quality].lodDrawDistance;
      for (const item of this.lodItems) {
        const tier = lodTierAt(camX, camZ, item.x, item.z, draw);
        item.obj.visible = tier !== "far";
        for (const d of item.detail) d.visible = tier === "near";
      }
    }
  }

  /** The user's quality preference (world chrome control). An
   *  explicit rung pins the ladder; Auto hands it back to the
   *  frame-time monitor, which resumes from the current rung. */
  setQualityPreference(pref: QualityPreference): void {
    this.qualityPref = pref;
    storeQualityPreference(pref);
    if (pref === "auto") {
      this.frameMonitor?.reset(this.quality, performance.now());
      return;
    }
    this.frameMonitor?.reset(pref, performance.now());
    this.applyTierToRenderer(pref);
  }

  get qualityPreference(): QualityPreference {
    return this.qualityPref;
  }

  get currentQualityTier(): QualityTier {
    return this.quality;
  }

  /** Apply a rung to the live renderer (item 22 steps + item 99
   *  axes). Pixel ratio, shadow maps (size + on/off), the
   *  reflector (size / overlay blend), anisotropy and particle
   *  draw-range all move at runtime. Two build-time facts cannot:
   *  MSAA (renderer construction) and which decorative lights
   *  were BUILT (quality.ts documents both) — item 24's scoping
   *  already keeps built lights from shading unreachable areas. */
  private applyTierToRenderer(tier: QualityTier): void {
    if (tier === this.quality) return;
    this.quality = tier;
    const rung = QUALITY[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rung.pixelRatio));
    if (this.renderer.shadowMap.enabled !== rung.shadows) {
      this.renderer.shadowMap.enabled = rung.shadows;
      // Toggling shadow maps at runtime needs materials to recompile.
      this.scene.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
        for (const m of mats) m.needsUpdate = true;
      });
    }
    if (this.sunLight) {
      this.sunLight.castShadow = rung.shadows;
      if (rung.shadows && rung.shadowMapSize > 0) {
        this.sunLight.shadow.mapSize.set(rung.shadowMapSize, rung.shadowMapSize);
        this.sunLight.shadow.radius = rung.shadowRadius;
        this.sunLight.shadow.bias = -0.0004;
        this.sunLight.shadow.normalBias = 0.03;
        if (this.sunLight.shadow.map) {
          this.sunLight.shadow.map.dispose();
          this.sunLight.shadow.map = null;
        }
      }
    }
    /* Item 13/14: a ladder step re-rules the local shadow lights
     * and the softness they carry, in the same pass. */
    this.applyLocalShadowLights();
    this.renderer.shadowMap.needsUpdate = true;
    if (this.floorReflector) {
      /* Item 92: the target is truly the rung's size in both
       * directions. Stepping down resizes it (1024 → 512); stepping
       * to the low rung (size 0 — the visibility gate never renders
       * it) shrinks it to a 1×1 stub so the low rung does not keep
       * a full-size half-float target (~8 MB at 1024²) allocated
       * for a mirror it will never draw. Stepping back up restores
       * the rung size before the gate can show it again. */
      const targetSize = rung.reflectorSize > 0 ? rung.reflectorSize : 1;
      this.floorReflector.getRenderTarget().setSize(targetSize, targetSize);
    }
    if (this.floorOverlayMat) {
      const look = hallLookFor(this.theme);
      this.floorOverlayMat.opacity = rung.reflectorSize > 0 ? look.floorOverlayOpacity : 0.97;
    }
    activeRungAnisotropy = rung.anisotropy;
    activeTextureScale = rung.textureScale;
    textureCache.forEach((tex) => {
      tex.anisotropy = surfaceAnisotropy();
      tex.needsUpdate = true;
    });
    /* Items 82/84/94: the tier pass reaches EVERY surface map, not
     * just the colour cache — the derived PBR sets and the brushed
     * gold maps (the district gates' caps and headers, the lantern
     * gilt) registered at birth, so a step re-ranges them too. */
    for (const tex of rungSurfaceTextures) {
      tex.anisotropy = surfaceAnisotropy();
      tex.needsUpdate = true;
    }
    const dust = this.lookAnim.dust;
    if (dust) {
      const total = dust.geometry.getAttribute("position")?.count ?? 0;
      dust.geometry.setDrawRange(0, Math.floor(total * rung.particleScale));
    }
    /* Item 82: the rung's particleScale drives the ember and pollen
     * fields too, not just the dust — a step down used to leave the
     * braziers pouring a high-rung ember count forever. The fields
     * were BUILT from a tier count (night-life's table); the draw
     * range is the rung fraction of the built field, so it can never
     * exceed what was built, and the tick (which pours every field
     * position each frame) needs no change. */
    for (const e of this.lookAnim.embers) {
      e.points.geometry.setDrawRange(0, Math.floor(e.field.length * rung.particleScale));
    }
    if (this.lookAnim.pollen) {
      const pollen = this.lookAnim.pollen;
      pollen.points.geometry.setDrawRange(0, Math.floor(pollen.field.length * rung.particleScale));
    }
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

  localPose(): { x: number; y: number; z: number; rotY: number } {
    return { x: this.rig.position.x, y: this.rig.position.y, z: this.rig.position.z, rotY: this.yaw };
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
    this.frameIndex++;

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
      /* My figure stands at my walk rig's height (item 54):
       * groundY mirrors it, and applyActionPose composes the
       * bob + pose lift on top below. */
      this.selfRig.groundY = this.rig.position.y;
      this.selfRig.group.position.set(this.rig.position.x, this.rig.position.y, this.rig.position.z);
      this.selfRig.group.rotation.y = this.yaw;
      this.selfRig.group.visible = !presenting && this.viewMode === "third";
      // Your own name plate never hangs over your own third-person
      // view — the billboard sits between the follow camera and your
      // figure and reads as a giant floating sign (see view-mode's
      // selfPlateVisible). Peers' plates are not touched.
      this.selfRig.sprite.visible = selfPlateVisible(this.viewMode);
    }
    // Perf systems (items 22/23/24/99): the Auto ladder watches
    // frame time (XR excluded — the headset owns its budget), and
    // the portal/reflector/LOD services run on the camera's facts.
    if (this.qualityPref === "auto" && !presenting && this.frameMonitor) {
      const stepped = this.frameMonitor.sample(dt * 1000, performance.now());
      if (stepped) this.applyTierToRenderer(stepped);
    }
    this.servicePerfSystems(presenting);

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
        /* A teleport carries its height outright — no gliding
         * down from a terrace the peer no longer stands on. */
        rig.groundY = rig.target.y;
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
      /* Height (item 54): the standing height eases toward the
       * height the peer's presence reports — a creator on a
       * terrace renders on the terrace for everyone, climbing
       * and settling with the same follow my own figure uses. */
      rig.groundY = easeFigureHeight(rig.groundY, rig.target.y, dt);
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
    // Footsteps raise their dust (item 57) — the mover's step
    // counter finally has its reader.
    this.serviceStepDust(dt);

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
    /* Night-sky life (Stack-100 #2 item 1): the visible dome's
     * uTime advances so its stars twinkle, carry magnitude and
     * drift — under reduced motion the sky rests at t=0. */
    if (this.skyDomeMaterial && !this.reducedMotion) {
      this.skyDomeMaterial.uniforms.uTime!.value = t;
    }
    for (const c of anim.clouds) {
      c.sprite.position.x = cloudDriftX(c.def, t);
      /* Day-sky parity (item 2): each cloud is tinted by where it
       * rides relative to the sun side — lit bodies, not decals. */
      const shade = cloudShadeAt(c.def, t);
      (c.sprite.material as THREE.SpriteMaterial).color.setRGB(shade.r, shade.g, shade.b);
    }
    /* Plaza life (Stage C batch C3): banner sway + pollen drift
     * (item 26 — registered only in the light look and never
     * under reduced motion, so these loops are empty otherwise),
     * and the pool water's shimmer + fountain pulse (item 28 —
     * applied only when reduced motion is off; the surface rests
     * still otherwise). */
    for (const b of anim.bannerSways) {
      const sway = bannerSwayAt(t, b.phase);
      b.pivot.rotation.x = sway.rotX;
      b.pivot.rotation.z = sway.rotZ;
    }
    /* Stack-100 #2 item 29: the spinners (the boardwalk prize
     * wheel) turn on their own angle functions. */
    for (const sp of anim.spinners) {
      sp.obj.rotation.z = sp.angleAt(t);
    }
    if (anim.pollen) {
      const attr = anim.pollen.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < anim.pollen.field.length; i++) {
        const p = pollenPositionAt(anim.pollen.field[i]!, t);
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
    }
    if (!this.reducedMotion) {
      const ws = waterSurfaceAt(t);
      for (const w of anim.waters) {
        w.tex.offset.set(ws.offsetX, ws.offsetY);
        /* Ripple normals counter-scroll against the colour layer
         * (items 5–7): the surface bends light in motion. */
        if (w.normalTex) w.normalTex.offset.set(ws.normalOffsetX, ws.normalOffsetY);
        if (w.jet) w.jet.scale.set(ws.jetPulse, ws.jetHeightPulse, ws.jetPulse);
        if (w.fall) (w.fall.material as THREE.MeshBasicMaterial).opacity = (w.fallBase ?? 0.42) * ws.fallOpacity;
        if (w.ripple) {
          w.ripple.scale.set(ws.rippleScale, ws.rippleScale, 1);
          (w.ripple.material as THREE.MeshBasicMaterial).opacity = ws.rippleOpacity;
        }
      }
    }

    // Report my pose when it meaningfully changed (client throttles).
    // Height rides along (item 48): a pure Y change — settling onto
    // a lawn's edge as the ease finishes — reports too, at a finer
    // threshold, so the room's truth converges to the authored
    // number instead of stranding a centimetre off.
    const pose = this.localPose();
    if (
      Math.abs(pose.x - this.lastPose.x) > 0.03 ||
      Math.abs(pose.z - this.lastPose.z) > 0.03 ||
      Math.abs(pose.y - this.lastPose.y) > 0.01 ||
      Math.abs(pose.rotY - this.lastPose.rotY) > 0.03
    ) {
      this.lastPose = pose;
      this.onPose?.(pose.x, pose.z, pose.rotY, pose.y);
    }

    /* Item 18: the frozen shadow map re-renders on the slow
     * cadence while ANIMATED casters exist (swaying banners, the
     * spinning wheel) — their shadows track instead of resting at
     * the build pose. Static scenes and reduced motion pay
     * nothing (the sway itself is still under reduced motion). */
    if (
      !this.reducedMotion &&
      shadowRefreshDue(this.frameIndex, anim.bannerSways.length + anim.spinners.length, this.renderer.shadowMap.enabled)
    ) {
      this.renderer.shadowMap.needsUpdate = true;
    }

    /* Day/night crossfade: ease exposure / background / fog from
     * the outgoing look's values until the fade completes. */
    if (this.lookFade) {
      const p = lookFadeProgress(performance.now() - this.lookFade.startedAtMs);
      this.renderer.toneMappingExposure =
        this.lookFade.fromExposure + (this.lookFade.toExposure - this.lookFade.fromExposure) * p;
      if (this.scene.background instanceof THREE.Color) this.scene.background.lerpColors(this.lookFade.fromBg, this.lookFade.toBg, p);
      if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.lerpColors(this.lookFade.fromFog, this.lookFade.toFog, p);
      if (p >= 1) this.lookFade = null;
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
  /** Footstep dust (item 57): every figure's mover counts its
   *  completed steps (movement.ts); this is the hook that reads
   *  them. Each fresh step raises one faint puff at the figure's
   *  feet — mine and every peer's alike — and the pool ages them
   *  out in half a second. A reduced-motion walker's screen stays
   *  still: no new puffs are raised (standing puffs finish their
   *  half-second and are gone). The cloud is built lazily at the
   *  first footfall and lives on the scene root, so look rebuilds
   *  never tear it down mid-walk. */
  private serviceStepDust(dt: number): void {
    if (!this.reducedMotion) {
      const raise = (count: number, x: number, y: number, z: number) => {
        const n = Math.min(count, 3);
        for (let i = 0; i < n; i++) spawnStepPuff(this.stepDust, x, y, z);
      };
      const selfSteps = stepsLanded(this.selfLastStepCount, this.selfMover.stepCount);
      this.selfLastStepCount = this.selfMover.stepCount;
      if (selfSteps > 0) {
        raise(selfSteps, this.rig.position.x, 0.04, this.rig.position.z);
      }
      for (const rig of this.avatars.values()) {
        const landed = stepsLanded(rig.lastStepCount, rig.mover.stepCount);
        rig.lastStepCount = rig.mover.stepCount;
        if (landed > 0) {
          raise(landed, rig.group.position.x, rig.group.position.y + 0.04, rig.group.position.z);
        }
      }
    }
    advanceStepDust(this.stepDust, dt);
    if (!this.stepDustPoints) {
      if (this.stepDust.spawns === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(this.stepDustPos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("color", new THREE.BufferAttribute(this.stepDustCol, 3).setUsage(THREE.DynamicDrawUsage));
      const points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          map: hazeTexture(), size: 0.16, transparent: true, opacity: 0.55, vertexColors: true,
          blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
        }),
      );
      points.renderOrder = 5;
      points.frustumCulled = false;
      this.scene.add(points);
      this.stepDustPoints = points;
    }
    const alive = writeStepDustBuffers(this.stepDust, this.stepDustPos, this.stepDustCol);
    const geo = this.stepDustPoints.geometry;
    geo.setDrawRange(0, alive);
    geo.getAttribute("position")!.needsUpdate = true;
    geo.getAttribute("color")!.needsUpdate = true;
  }

  private serviceLoopFeeds(): void {
    const entries = this.loopEntriesScratch;
    let count = 0;
    const collect = (rig: AvatarRig | null) => {
      if (rig?.loopFeed && !rig.loopFeed.failed && rig.portrait) {
        const feed = rig.loopFeed;
        let slot = entries[count];
        if (!slot) {
          slot = { rig, feed };
          entries[count] = slot;
        } else {
          slot.rig = rig;
          slot.feed = feed;
        }
        count++;
      }
    };
    for (const rig of this.avatars.values()) collect(rig);
    collect(this.selfRig);
    entries.length = count;
    if (!count) return;
    this.camera.getWorldPosition(SCRATCH_VEC);
    if (!this.loopFrustum) this.loopFrustum = new THREE.Frustum();
    const frustum = this.loopFrustum;
    frustum.setFromProjectionMatrix(
      LOOP_SCRATCH_MAT.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    const decorated = this.loopDecoratedScratch;
    for (let i = 0; i < count; i++) {
      const { rig, feed } = entries[i]!;
      const p = rig.group.position;
      LOOP_SCRATCH_SPHERE.center.set(p.x, 1, p.z);
      const inView =
        rig === this.selfRig ? rig.group.visible : rig.group.visible && frustum.intersectsSphere(LOOP_SCRATCH_SPHERE);
      let d = decorated[i];
      if (!d) {
        d = { key: `f${feed.id}`, distance: 0, visible: false, feed };
        decorated[i] = d;
      } else if (d.feed !== feed) {
        d.feed = feed;
        d.key = `f${feed.id}`;
      }
      d.distance = Math.hypot(p.x - SCRATCH_VEC.x, p.z - SCRATCH_VEC.z);
      d.visible = inView;
    }
    decorated.length = count;
    const live = selectLiveLoops(decorated);
    for (let i = 0; i < count; i++) {
      const d = decorated[i]!;
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
      /* Camera collision (item 44): the clamp box stops the
       * camera leaving the room, but a prop inside the box — the
       * monument, a pier, a planter — used to swallow it whole.
       * Pull the spot in toward the figure along its own ray
       * until it stands clear of every solid footprint (the
       * layout's pullInCamera; heights are untouched, the pull is
       * planar, exactly like the clamp it extends). */
      const pulled = pullInCamera(
        this.currentRoom,
        { x: this.rig.position.x, z: this.rig.position.z },
        { x: SCRATCH_VEC.x, z: SCRATCH_VEC.z },
      );
      SCRATCH_VEC.x = pulled.x;
      SCRATCH_VEC.z = pulled.z;
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
      this.reducedMotion ? 0 : 1,
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
    /* Height (items 50/55): my y eases toward the ground under
     * the resolved step. The resolver already refused any step
     * whose rise or drop exceeds the step limits (its samples
     * are height-gated), so the ground here is always honestly
     * reachable: treads and tiers are climbed by their steps, a
     * step off an edge resolves down within the step-down rule,
     * and an edge beyond it never resolves at all — no void
     * falls, no teleport pops. */
    this.rig.position.y = easeFigureHeight(
      this.rig.position.y,
      groundHeightAt(res.x, res.z),
      dt,
    );
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
      if (intent.voiceBack) this.onPadVoiceBack?.();
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
    if (this.stepDustPoints) {
      this.scene.remove(this.stepDustPoints);
      this.stepDustPoints.geometry.dispose();
      (this.stepDustPoints.material as THREE.Material).dispose();
      this.stepDustPoints = null;
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
