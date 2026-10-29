/**
 * guard-fixtures.ts — the palace's PERMANENT figures (pure decisions).
 *
 * Why this exists (Oct 24, 2026): the live World rendered figures ONLY
 * for connected presences — flat PNG/capsule avatars built per peer.
 * The house guards and the King were presence COSTUMES: nobody home
 * meant nobody standing anywhere, and the 3D bodies "installed" into
 * public/world were only ever read by the proof stage
 * (src/world-3d-proof), never by the live scene. The owner walked his
 * own palace and found it empty.
 *
 * Fixtures fix the architecture, not the symptom: the King and his
 * guards stand at their posts as part of the SCENE, independent of who
 * is connected. This module holds the pure facts — which bodies, which
 * posts, which way they face, how a raw TRELLIS body is normalized to
 * its post (the proof loader's math, from-glb.ts), and what stands at
 * the post when the 3D body cannot (the fallback law). The three.js
 * builder lives in guard-fixtures-scene.ts; hall-scene.ts only wires
 * visibility + the tick.
 *
 * Presence avatars are NOT fixtures and are unchanged by this module:
 * visitors still wear the flat figure this round (stated plainly in
 * the lane report — fixtures first).
 */
import {
  DEFAULT_CHARACTER_FEMALE_PATH,
  DEFAULT_CHARACTER_PATH,
  DEFAULT_FIGURE_HEIGHT,
  KING_PORTRAIT_PATH,
} from "./figure";

export type FixtureBodyId = "guard-male" | "guard-female" | "king";
export type FixtureArea = "hall" | "plaza";

export interface FixtureBodyDef {
  id: FixtureBodyId;
  /** public/ slot the live scene loads (resolved through mediaUrl). */
  glbPath: string;
  /** Standing height the raw body is scaled to, metres. */
  height: number;
  /**
   * Y rotation that turns the RAW body to face +Z. All three bodies'
   * fronts are +Z as exported — settled by the LIVE scene, not the
   * proof stage: the first rig capture (.lane/proof/, Oct 24) stood
   * the female guard in full profile (snout + tail sideways) under
   * the -90° the proof notes claimed she needed, while the male at
   * 0° faced the camera square. The proof stage's facing notes were
   * written against an earlier body in the same slot and never
   * re-verified after the v6 swap. If a future body reads wrong in
   * the live frame, THIS constant is the whole fix.
   */
  rawRotY: number;
}

/** The King stands taller than his guards — he is the King. */
export const KING_FIXTURE_HEIGHT = 2.35;

export const FIXTURE_BODIES: Readonly<Record<FixtureBodyId, FixtureBodyDef>> = {
  "guard-male": {
    id: "guard-male",
    glbPath: "/world/guard-gen.glb",
    height: DEFAULT_FIGURE_HEIGHT,
    rawRotY: 0,
  },
  "guard-female": {
    id: "guard-female",
    glbPath: "/world/guard-gen-female.glb",
    height: DEFAULT_FIGURE_HEIGHT,
    rawRotY: 0,
  },
  king: {
    id: "king",
    glbPath: "/world/king-gen.glb",
    height: KING_FIXTURE_HEIGHT,
    rawRotY: 0,
  },
};

export type FixtureFallback =
  | { kind: "matte"; src: string }
  | { kind: "portrait"; src: string }
  | { kind: "capsule"; color: number };

/**
 * What stands at a post before the body lands — and forever, if the
 * body cannot load. A post is NEVER empty (the fallback law), and
 * what stands there must be DIGNIFIED — a figure of the person, not
 * a bare placeholder shape.
 *  - Guards fall back to the same approved matte the presence figures
 *    wear (figure.ts owns those paths).
 *  - The King has no matte (his portrait art carries a studio
 *    backdrop, so it cannot stand as a fake cut-out body) — but he
 *    HAS a portrait figure: the presence system stands him on the
 *    gold-framed easel panel (figure.ts's "portrait" kind), where
 *    the backdrop is honest because the panel presents AS a
 *    portrait. His post falls back to exactly that: his portrait
 *    on the easel. A picture of the King beats a capsule — on
 *    Oct 27 the capsule is what the owner got, for a whole session.
 *  - The capsule remains only as the scene-level last resort, if a
 *    post's fallback ART itself cannot load (guard-fixtures-scene).
 */
export function fixtureFallbackFor(body: FixtureBodyId): FixtureFallback {
  switch (body) {
    case "guard-male":
      return { kind: "matte", src: DEFAULT_CHARACTER_PATH };
    case "guard-female":
      return { kind: "matte", src: DEFAULT_CHARACTER_FEMALE_PATH };
    case "king":
      return { kind: "portrait", src: KING_PORTRAIT_PATH };
  }
}

/** The easel panel box a portrait fallback is fitted into, metres:
 *  the panel never exceeds these bounds, and the art's aspect is
 *  preserved inside them (never stretched). Sized against the King
 *  post: his 3D body stands 2.35 m; the portrait panel on its easel
 *  (base 0.5 m, panel ≤1.5 m) tops out at 2.0 m — present, not
 *  pretending to his full stature. */
export const FIXTURE_PORTRAIT_MAX_W = 1.7;
export const FIXTURE_PORTRAIT_MAX_H = 1.5;

/** Fit an aspect (w/h) into the portrait panel box. A degenerate
 *  aspect falls back to the panel's own box aspect. */
export function fixturePortraitPanelSize(aspect: number): { w: number; h: number } {
  const boxAspect = FIXTURE_PORTRAIT_MAX_W / FIXTURE_PORTRAIT_MAX_H;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : boxAspect;
  if (a >= boxAspect) return { w: FIXTURE_PORTRAIT_MAX_W, h: FIXTURE_PORTRAIT_MAX_W / a };
  return { w: FIXTURE_PORTRAIT_MAX_H * a, h: FIXTURE_PORTRAIT_MAX_H };
}

export interface WorldFixtureDef {
  id: string;
  body: FixtureBodyId;
  area: FixtureArea;
  /** Post position, scene metres. y = the floor the post stands on. */
  position: { x: number; y: number; z: number };
  /**
   * Extra Y rotation for the POST (the body's rawRotY is applied on
   * top). 0 = face +Z. Every post below faces +Z: in the hall that is
   * toward the entering court; on the plaza steps it is toward the
   * arriving visitor walking from the monument to the arch.
   */
  postRotY: number;
  /**
   * Where a walker ADDRESSES this figure — the point courtesies.ts
   * measures COURTESY_RANGE_M from. Absent = the post itself.
   *
   * Q169 (QC-200): the two hall guards stand at (±6.9, −14.3),
   * flanking the dais, but the hall's walk floor ends at z = −11.6 —
   * the closest a walker may stand is 2.70 m from either body,
   * beyond the 2.2 m courtesy range, so "Salute the guard" could
   * never fire. The bodies stay at their posts (the scene design
   * is the owner's); each guard's anchor stands at the foot of the
   * post instead, on the line a visitor stops on to address them:
   * (±6.9, −12.6) — 1.0 m from the walk floor's edge, 1.7 m in
   * front of the body. The King needs no anchor (his post is
   * 1.5 m from the walk edge) and neither do the plaza guards
   * (they stand on walkable step platforms).
   */
  courtesyAnchor?: { x: number; z: number };
}

/** The hall stage's top surface (hall-scene buildStage: a
 *  22 × 5.8 slab centred (0, -15.1), 0.7 thick — top y = 0.7,
 *  footprint z -18..-12.2, x ±11). Every hall post stands ON it. */
export const HALL_STAGE_TOP_Y = 0.7;

/**
 * The posts. Coordinates read off the built geometry:
 *  - The stage (hall-scene buildStage): the slab above; the dais
 *    sits ON it (centred (0, -15.7), front edge z = -13.5, its top
 *    look-dependent 0.96/1.13). The King stands ON THE STAGE at
 *    the dais foot (0, -13.1) — 0.4 m in front of the dais edge,
 *    his feet on the stage top (y = HALL_STAGE_TOP_Y). An earlier
 *    reading put the hall posts on "the floor" at y = 0: at these
 *    z the floor is the stage slab itself, so y = 0 buried the
 *    King and both guards 0.7 m inside it — only their upper
 *    bodies cleared the stage surface.
 *  - Hall guards flank the dais just outside its 6 m half-width,
 *    on the stage, a step behind the King's line: (±6.9, -14.3).
 *  - Plaza guards stand ON the ceremonial step platforms flanking
 *    the arch approach (palace-grounds HALL_STEPS: platform top
 *    y = 0.36, step runs centred x = ±3.85, platform z 15.16-16.4):
 *    (±3.85, 0.36, 15.7), facing the plaza they guard.
 *  - The hall guards' courtesyAnchor points (see the field): the
 *    bodies do NOT move; only where a walker addresses them does.
 *  - The King ALSO greets on the plaza (stack300, Oct 27 — the
 *    owner's live walk found flat characters at spawn and no King
 *    at all: his only post was the throne, ~45 m in). The greeter
 *    stands at (2.6, 0, 27.0): on the arrival court's east flank,
 *    5.2 m from the spawn stance (0, 31.5) at ~30° off the arrival
 *    axis — inside the first frame a visitor sees, facing +Z,
 *    toward the arriving visitor, the plaza guards' convention.
 *    x = 2.6 keeps the walk spine (|x| ≤ 1.8, plaza-life) clear
 *    with the body's own half-width to spare; z = 27.0 stands in
 *    the open paving band between the monument's south furniture
 *    line (lamps ±2.9 @ z 24.2, benches ±3.4 @ z 23.2, urns ±2.85
 *    @ z 21.9 — the diagnosis's suggested (3.2, ~24) pocket is
 *    INSIDE that furniture) and the spawn cluster (planter trough
 *    (2.2, 29.5), urns ±2.7 @ z 31.5), clear of every blocked rect,
 *    on flat plaza floor (y = 0 — no platform there). One King,
 *    one greeter: the plaza's mirrored pairs are furniture and
 *    guards; the King is singular, as he is on the throne axis.
 *    The same loaded king body clones here (one load, every post)
 *    with the same fallback law — the gold capsule until he lands.
 */
export const WORLD_FIXTURES: readonly WorldFixtureDef[] = [
  { id: "hall-king", body: "king", area: "hall", position: { x: 0, y: HALL_STAGE_TOP_Y, z: -13.1 }, postRotY: 0 },
  { id: "hall-guard-male", body: "guard-male", area: "hall", position: { x: -6.9, y: HALL_STAGE_TOP_Y, z: -14.3 }, postRotY: 0, courtesyAnchor: { x: -6.9, z: -12.6 } },
  { id: "hall-guard-female", body: "guard-female", area: "hall", position: { x: 6.9, y: HALL_STAGE_TOP_Y, z: -14.3 }, postRotY: 0, courtesyAnchor: { x: 6.9, z: -12.6 } },
  { id: "plaza-guard-male", body: "guard-male", area: "plaza", position: { x: -3.85, y: 0.36, z: 15.7 }, postRotY: 0 },
  { id: "plaza-guard-female", body: "guard-female", area: "plaza", position: { x: 3.85, y: 0.36, z: 15.7 }, postRotY: 0 },
  { id: "plaza-king", body: "king", area: "plaza", position: { x: 2.6, y: 0, z: 27.0 }, postRotY: 0 },
];

/** The total Y rotation a fixture's group carries: post ∘ raw. */
export function fixtureRotY(def: WorldFixtureDef): number {
  return def.postRotY + FIXTURE_BODIES[def.body].rawRotY;
}

/** The plaza arrival stance — the courtyard spawn, pinned in
 *  palace-layout (PALACE_LAYOUT[COURTYARD_ID].spawn = (0, 31.5)).
 *  Duplicated here as a literal so this module stays free of the
 *  layout import; guard-fixtures.test.ts pins the two together. */
export const PLAZA_SPAWN = { x: 0, z: 31.5 } as const;

/**
 * The order body loads START in, judged from the arrival: a post
 * wears its flat stand-in until its body lands, so the bodies an
 * arriving visitor sees FIRST should be requested first. Bodies
 * with a plaza post outrank hall-only bodies; within that, the
 * body whose nearest post stands closest to the spawn stance
 * goes first (the King's greeter at 5.2 m, then the plaza guards
 * at 15.8 m); table order breaks ties. Every body appears once.
 *
 * The loads themselves still run concurrently (one load per body,
 * each walking its own retry plan) — this orders the requests'
 * initiation, it does not serialise them: serialising would hold
 * the guards hostage to the King's 4.3 MB, the opposite of the
 * intent. Until Oct 27 the iteration was FIXTURE_BODIES' record
 * order (guards, then the King) and the loads fired at the END of
 * applyLook, behind the whole look-texture burst — the greeter's
 * body was the last request of the entry burst.
 */
export function fixtureBodyLoadOrder(
  fixtures: readonly WorldFixtureDef[] = WORLD_FIXTURES,
): FixtureBodyId[] {
  const rank = new Map<FixtureBodyId, { plaza: boolean; nearest: number; first: number }>();
  fixtures.forEach((def, i) => {
    const d = Math.hypot(def.position.x - PLAZA_SPAWN.x, def.position.z - PLAZA_SPAWN.z);
    const cur = rank.get(def.body);
    if (!cur) {
      rank.set(def.body, { plaza: def.area === "plaza", nearest: d, first: i });
    } else {
      cur.plaza = cur.plaza || def.area === "plaza";
      cur.nearest = Math.min(cur.nearest, d);
    }
  });
  return [...rank.entries()]
    .sort((a, b) =>
      a[1].plaza !== b[1].plaza
        ? a[1].plaza
          ? -1
          : 1
        : a[1].nearest !== b[1].nearest
          ? a[1].nearest - b[1].nearest
          : a[1].first - b[1].first,
    )
    .map(([body]) => body);
}

export interface BoundsLike {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface FixtureNormalization {
  /** Uniform scale that makes the body's raw height the target. */
  scale: number;
  /** Inner-group offset (applied INSIDE the scale): centres X/Z on
   *  the post and grounds the feet at y = 0. */
  offset: { x: number; y: number; z: number };
}

/**
 * The proof loader's normalization (guard3d/from-glb.ts), kept pure:
 * TRELLIS bodies arrive at arbitrary scale with feet off the floor.
 * Scale so the raw height becomes targetHeight; then centre and
 * ground. Degenerate bounds (empty/zero-height body) return null —
 * the caller keeps the fallback standing rather than divide by zero.
 */
export function fixtureNormalization(
  bounds: BoundsLike,
  targetHeight: number,
): FixtureNormalization | null {
  const rawHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(rawHeight) || rawHeight <= 0 || !(targetHeight > 0)) return null;
  const scale = targetHeight / rawHeight;
  const clean = (n: number) => (n === 0 ? 0 : n); // -0 → 0
  return {
    scale,
    offset: {
      x: clean(-(bounds.min.x + bounds.max.x) / 2),
      y: clean(-bounds.min.y),
      z: clean(-(bounds.min.z + bounds.max.z) / 2),
    },
  };
}

/** Deterministic idle-sway phase per fixture (radians, 0..2π). */
export function fixtureSwayPhase(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 628) / 100;
}

/**
 * The idle sway itself (radians): statues barely breathe — a whisper
 * of rotation so the court does not read as a photograph, kept an
 * order of magnitude under anything that would look like motion.
 */
export function fixtureSway(id: string, nowMs: number): { rotY: number; rotZ: number } {
  const phase = fixtureSwayPhase(id);
  const t = nowMs / 1000;
  return {
    rotY: Math.sin(t * 0.45 + phase) * 0.012,
    rotZ: Math.sin(t * 0.31 + phase * 1.7) * 0.004,
  };
}

/** The texture slots a parsed body material can carry — named as
 *  three.js names them on a real material: a glTF
 *  metallicRoughnessTexture lands SPLIT across metalnessMap +
 *  roughnessMap (three has no metallicRoughnessMap property; the
 *  alias stays honoured for plain material-shaped inputs). */
export interface BodyMaterialLike {
  map?: unknown;
  metalnessMap?: unknown;
  roughnessMap?: unknown;
  metallicRoughnessMap?: unknown;
  normalMap?: unknown;
  emissiveMap?: unknown;
  aoMap?: unknown;
}

/** A texture slot counts as landed when it holds a texture object
 *  whose image — when the image reports a width at all — actually
 *  has pixels. The texture-less parse leaves the slots unset (see
 *  bodyTexturesLanded); a zero-width image is a decode that
 *  produced nothing standing in the same clothes. */
function textureSlotLanded(tex: unknown): boolean {
  if (!tex || typeof tex !== "object") return false;
  const img = (tex as { image?: { width?: unknown } | null }).image;
  if (img && typeof img.width === "number") return img.width > 0;
  return true;
}

/**
 * Did the body's textures actually LAND? The fixture GLBs declare
 * their textures in the file; a loader path that drops them (the
 * EXT_texture_webp-only exports did exactly this in the owner's
 * Chrome — the body material has no baseColorFactor to fall back
 * on) still parses "successfully" and swaps in a flat-white statue.
 * A body whose file declares textures but whose parsed materials
 * carry none has NOT loaded in any sense that matters: the caller
 * treats it as a load failure, so the next source is tried and the
 * fallback keeps the post rather than a white clay figure standing
 * in for a guard. A body that declares no textures is honest as-is.
 */
export function bodyTexturesLanded(
  declaredTextures: number,
  materials: readonly unknown[],
): boolean {
  if (declaredTextures <= 0) return true;
  return materials.some((m) => {
    if (!m || typeof m !== "object") return false;
    const s = m as BodyMaterialLike;
    return [
      s.map,
      s.metalnessMap,
      s.roughnessMap,
      s.metallicRoughnessMap,
      s.normalMap,
      s.emissiveMap,
      s.aoMap,
    ].some(textureSlotLanded);
  });
}

/* ── The texture repair plan ───────────────────────────────────────
   WHY a parse lands texture-less, mechanically (proven Oct 29,
   stack600/world-textures): three.js GLTFLoader (0.180) decodes
   embedded images through ImageBitmapLoader, which fetches a
   blob: object URL per image. When that fetch is refused — the
   production CSP's connect-src lacked blob:, and fetch answers to
   connect-src, not img-src — loadTextureImage CATCHES the failure
   and resolves the texture to null; assignTexture then leaves the
   slot unset and the parse "succeeds". Source alternation cannot
   save the step (the decode dies identically on every source) and
   a decode can die other deaths too (memory pressure mid-burst on
   a weak machine). The texture step therefore gets its OWN second
   mechanism: repair in place from the file's declared material
   assignments, decoding the embedded images through the <img>
   path (THREE.TextureLoader), which answers to img-src and never
   touches the fetch policy. This module decides WHICH slots
   should hold WHAT texture; the scene does the decoding. Only
   EMBEDDED images (a bufferView, no uri) are repairable this way —
   their bytes are already in hand inside the parsed file. */

export interface GlbTextureRefLike {
  index?: number;
}

export interface GlbMaterialLike {
  pbrMetallicRoughness?: {
    baseColorTexture?: GlbTextureRefLike;
    metallicRoughnessTexture?: GlbTextureRefLike;
  };
  normalTexture?: GlbTextureRefLike;
  emissiveTexture?: GlbTextureRefLike;
  occlusionTexture?: GlbTextureRefLike;
}

export interface GlbTextureDefLike {
  source?: number;
  sampler?: number;
}

export interface GlbImageLike {
  bufferView?: number;
  mimeType?: string;
  uri?: string;
}

/** A glTF sampler's raw enum values — the scene maps them onto
 *  three's filter/wrap constants when it rebuilds a texture. */
export interface GlbSamplerLike {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
}

export interface GlbJsonLike {
  materials?: readonly GlbMaterialLike[];
  textures?: readonly GlbTextureDefLike[];
  images?: readonly GlbImageLike[];
  samplers?: readonly GlbSamplerLike[];
}

/** A three.js material texture slot a repair step can fill. */
export type FixtureTextureSlot =
  | "map"
  | "metalnessMap"
  | "roughnessMap"
  | "normalMap"
  | "emissiveMap"
  | "aoMap";

export interface FixtureTextureRepairStep {
  /** Index of the glTF material whose three material gets the slot. */
  materialIndex: number;
  slot: FixtureTextureSlot;
  textureIndex: number;
  imageIndex: number;
  /** Where the image bytes sit inside the file's binary chunk. */
  bufferView: number;
  mimeType: string;
  /** Colour textures (base colour, emissive) decode as sRGB; data
   *  textures (metalness/roughness, normal, occlusion) stay linear. */
  colorSpace: "srgb" | "linear";
  sampler?: GlbSamplerLike;
}

/**
 * The repair steps a parsed body's file declares: one per
 * (material, slot) texture assignment whose image is embedded.
 * A glTF metallicRoughnessTexture yields TWO steps (metalnessMap
 * + roughnessMap — three splits the one texture across both).
 * Materials without textures, textures without a source, and
 * external-uri images yield none.
 */
export function fixtureTextureRepairPlan(
  json: GlbJsonLike | null | undefined,
): FixtureTextureRepairStep[] {
  const steps: FixtureTextureRepairStep[] = [];
  if (!json) return steps;
  const textures = json.textures ?? [];
  const images = json.images ?? [];
  const samplers = json.samplers ?? [];
  const push = (
    materialIndex: number,
    slot: FixtureTextureSlot,
    ref: GlbTextureRefLike | undefined,
    colorSpace: "srgb" | "linear",
  ): void => {
    if (!ref || typeof ref.index !== "number") return;
    const texture = textures[ref.index];
    if (!texture || typeof texture.source !== "number") return;
    const image = images[texture.source];
    if (!image || typeof image.bufferView !== "number" || image.uri) return;
    steps.push({
      materialIndex,
      slot,
      textureIndex: ref.index,
      imageIndex: texture.source,
      bufferView: image.bufferView,
      mimeType: image.mimeType ?? "image/png",
      colorSpace,
      sampler:
        typeof texture.sampler === "number" ? samplers[texture.sampler] : undefined,
    });
  };
  (json.materials ?? []).forEach((mat, i) => {
    const pbr = mat.pbrMetallicRoughness ?? {};
    push(i, "map", pbr.baseColorTexture, "srgb");
    push(i, "metalnessMap", pbr.metallicRoughnessTexture, "linear");
    push(i, "roughnessMap", pbr.metallicRoughnessTexture, "linear");
    push(i, "normalMap", mat.normalTexture, "linear");
    push(i, "emissiveMap", mat.emissiveTexture, "srgb");
    push(i, "aoMap", mat.occlusionTexture, "linear");
  });
  return steps;
}

/**
 * The ordered sources a fixture body load walks, and the pause
 * before each attempt. Until Oct 26 the load was ONE CDN attempt
 * plus ONE origin attempt, fired last in the World-entry request
 * burst: a single transient failure — a rate-limiter shed on the
 * origin leg, a crash-severed transfer — rejected the load, and
 * with no retry anywhere the stand-in held the post for the whole
 * session. The plan alternates CDN ↔ origin for four attempts
 * with growing backoff, so the burst peak that shed attempt one
 * has passed by the later attempts; when the CDN is disabled
 * (mediaUrl returns the origin path itself) the plan is three
 * origin attempts. The LAST error is the one reported.
 */
export function fixtureLoadPlan(cdnUrl: string, originPath: string): string[] {
  if (cdnUrl === originPath) return [originPath, originPath, originPath];
  return [cdnUrl, originPath, cdnUrl, originPath];
}

/** Backoff before attempt `attemptIndex` (0-based); attempt 0 is immediate. */
export function fixtureRetryDelayMs(attemptIndex: number): number {
  const schedule = [0, 400, 1500, 3500];
  return schedule[Math.min(Math.max(attemptIndex, 0), schedule.length - 1)];
}

/**
 * Walk a load plan: try each source in order (with the retry
 * backoff between attempts) and return the first success. Every
 * attempt is the caller's full attempt — fetch AND validation —
 * so a texture-less parse retries exactly like a network failure.
 * Rejects with the final attempt's error after the plan runs out.
 */
export async function attemptLoadPlan<T>(
  plan: readonly string[],
  attempt: (url: string) => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < plan.length; i += 1) {
    const delay = fixtureRetryDelayMs(i);
    if (delay > 0) await sleep(delay);
    try {
      return await attempt(plan[i]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * The ceiling on ONE load attempt. Until now nothing timed a load
 * out: GLTFLoader's promise can hang forever on a texture step
 * that never settles, and a hung attempt is worse than a failed
 * one — the plan never advances, the beacon never fires, the heal
 * ring never starts, and the post stands on its fallback with no
 * record anywhere. 60 s is sized to the bodies themselves (the
 * largest is ~6 MB — a 1 Mbps link lands it in ~48 s): the
 * ceiling exists to burn a HUNG attempt, never a slow one, and
 * the heal ring owns anything longer than an attempt.
 */
export const FIXTURE_ATTEMPT_TIMEOUT_MS = 60_000;

export interface FixtureTimerDeps {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/**
 * Race an attempt against its ceiling: the attempt's own outcome
 * wins when it settles first (the timer is cleared); a timeout
 * error wins when the ceiling speaks first — and the attempt's
 * late outcome, success or failure, is then swallowed by the
 * handlers already attached, never an unhandled rejection and
 * never a second settle. A non-positive ceiling disables the
 * race and returns the attempt itself.
 */
export function withFixtureAttemptTimeout<T>(
  attempt: () => Promise<T>,
  ms: number,
  timers: FixtureTimerDeps,
): Promise<T> {
  if (!(ms > 0)) return attempt();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const handle = timers.setTimer(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`fixture load attempt timed out after ${ms}ms`));
    }, ms);
    attempt().then(
      (value) => {
        if (settled) return;
        settled = true;
        timers.clearTimer(handle);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        timers.clearTimer(handle);
        reject(err);
      },
    );
  });
}

/* ── The slow ring: a failed load is not final for the session ──────
   The fast plan above spends itself in ~5 s at World entry — inside
   the entry burst, where a shed or a severed transfer is most
   likely, and (Oct 27) a texture class the owner's own browser
   chokes on fails every attempt identically. Before this ring, that
   was the end of it: the stand-in held the post until re-entry, and
   the King stood as a bare gold capsule for the owner's whole
   session. The heal loop is the second, slower ring around the fast
   plan: it re-walks the SAME bounded plan minutes later, when the
   burst is long gone and a transient cause has had time to pass. */

/** Delay before heal attempt `healAttemptIndex` (0-based): a 1-minute
 *  first look, then 3, then 10, then a steady 15-minute cadence —
 *  at most 4 attempts per hour once settled, sparse enough to never
 *  become traffic, patient enough to outlast an outage. */
export function fixtureHealDelayMs(healAttemptIndex: number): number {
  const schedule = [60_000, 180_000, 600_000, 900_000];
  const i = Math.min(Math.max(Math.floor(healAttemptIndex) || 0, 0), schedule.length - 1);
  return schedule[i]!;
}

/** While the tab is hidden the loop re-checks on this cadence
 *  instead of attempting: a hidden tab must not spend loads nobody
 *  can see (and a throttled background timer makes the attempt
 *  unreliable anyway). A re-check never consumes a heal attempt. */
export const FIXTURE_HEAL_VISIBILITY_RECHECK_MS = 60_000;

/* ── The failure beacon ─────────────────────────────────────────────
   When a body's fast plan runs out, the failure must be visible
   somewhere besides the owner's screen and a console nobody opens:
   the scene POSTs one small report per post to the api-server
   (POST /api/world/fixture-failure), which logs it structured. The
   payload is built here so its shape stays pure and testable:
   strings are clamped (an error message must not become a log
   bomb) and the error flattens to name + message only. */

export interface FixtureFailureReport {
  postId: string;
  body: FixtureBodyId;
  /** Fast-plan attempts made before the plan ran out. The heal
   *  ring's later attempts are NOT beacons — one report per post
   *  per session says "this post is on its fallback"; the ring
   *  handles the rest. */
  attempts: number;
  errorName: string;
  errorMessage: string;
  userAgent: string;
}

const clampReportField = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) : s;

export function buildFixtureFailureReport(input: {
  postId: string;
  body: FixtureBodyId;
  attempts: number;
  err: unknown;
  userAgent: string;
}): FixtureFailureReport {
  const err = input.err;
  const errorName = err instanceof Error && err.name ? err.name : "Error";
  const errorMessage = err instanceof Error ? err.message : String(err ?? "unknown error");
  return {
    postId: clampReportField(String(input.postId || "unknown-post"), 64),
    body: input.body,
    attempts: Number.isFinite(input.attempts) ? Math.max(1, Math.floor(input.attempts)) : 1,
    errorName: clampReportField(errorName, 120),
    errorMessage: clampReportField(errorMessage || "unknown error", 500),
    userAgent: clampReportField(String(input.userAgent ?? ""), 300),
  };
}

/** Once per post per session — the beacon's rate discipline. The
 *  first claim(postId) returns true; every later claim for the same
 *  post returns false. Posts claim independently. */
export class FixtureBeaconLedger {
  private claimed = new Set<string>();

  claim(postId: string): boolean {
    if (this.claimed.has(postId)) return false;
    this.claimed.add(postId);
    return true;
  }
}

export interface FixtureHealLoopDeps {
  /** Run one heal attempt (the full load plan). Resolves true when
   *  the body landed. Must not reject. */
  attempt: () => Promise<boolean>;
  /** Is the world tab visible right now? Attempts run only visible. */
  isVisible: () => boolean;
  /** Timer injection (the scene passes setTimeout/clearTimeout;
   *  tests drive a manual clock). */
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Fired once when a heal attempt lands the body. */
  onHealed?: () => void;
}

/**
 * The slow ring itself, as an injectable state machine (the scene
 * does the loading; this decides WHEN). One loop per failed body.
 * start() after the fast plan exhausts; stop() on scene dispose or
 * once healed. A stopped loop never attempts again.
 */
export class FixtureHealLoop {
  private timer: unknown = null;
  private attempts = 0;
  private stopped = false;
  private inFlight = false;

  constructor(private deps: FixtureHealLoopDeps) {}

  /** Heal attempts actually run so far (visibility re-checks and
   *  armed-but-unfired timers do not count). */
  get attemptCount(): number {
    return this.attempts;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  start(): void {
    if (this.stopped || this.timer !== null) return;
    this.arm(fixtureHealDelayMs(this.attempts));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private arm(delayMs: number): void {
    if (this.stopped) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.tick();
    }, delayMs);
  }

  private tick(): void {
    if (this.stopped) return;
    if (!this.deps.isVisible() || this.inFlight) {
      /* Not now — look again shortly without spending an attempt. */
      this.arm(FIXTURE_HEAL_VISIBILITY_RECHECK_MS);
      return;
    }
    this.inFlight = true;
    this.attempts += 1;
    void this.deps.attempt().then(
      (landed) => {
        this.inFlight = false;
        if (this.stopped) return;
        if (landed) {
          this.stopped = true;
          this.deps.onHealed?.();
          return;
        }
        this.arm(fixtureHealDelayMs(this.attempts));
      },
      () => {
        /* attempt() contracts never to reject; a violation is a
         * failed attempt, not a dead loop. */
        this.inFlight = false;
        if (this.stopped) return;
        this.arm(fixtureHealDelayMs(this.attempts));
      },
    );
  }
}
