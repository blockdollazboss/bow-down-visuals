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
  | { kind: "capsule"; color: number };

/**
 * What stands at a post before the body lands — and forever, if the
 * body cannot load. A post is NEVER empty (the fallback law).
 *  - Guards fall back to the same approved matte the presence figures
 *    wear (figure.ts owns those paths).
 *  - The King has no matte (his portrait art carries a studio
 *    backdrop — a raw rectangle in the hall would be a lie), so he
 *    falls back to the house capsule in gold: the same stand-in the
 *    figure system itself uses while a portrait loads.
 */
export function fixtureFallbackFor(body: FixtureBodyId): FixtureFallback {
  switch (body) {
    case "guard-male":
      return { kind: "matte", src: DEFAULT_CHARACTER_PATH };
    case "guard-female":
      return { kind: "matte", src: DEFAULT_CHARACTER_FEMALE_PATH };
    case "king":
      return { kind: "capsule", color: 0xc9a227 };
  }
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
 */
export const WORLD_FIXTURES: readonly WorldFixtureDef[] = [
  { id: "hall-king", body: "king", area: "hall", position: { x: 0, y: HALL_STAGE_TOP_Y, z: -13.1 }, postRotY: 0 },
  { id: "hall-guard-male", body: "guard-male", area: "hall", position: { x: -6.9, y: HALL_STAGE_TOP_Y, z: -14.3 }, postRotY: 0, courtesyAnchor: { x: -6.9, z: -12.6 } },
  { id: "hall-guard-female", body: "guard-female", area: "hall", position: { x: 6.9, y: HALL_STAGE_TOP_Y, z: -14.3 }, postRotY: 0, courtesyAnchor: { x: 6.9, z: -12.6 } },
  { id: "plaza-guard-male", body: "guard-male", area: "plaza", position: { x: -3.85, y: 0.36, z: 15.7 }, postRotY: 0 },
  { id: "plaza-guard-female", body: "guard-female", area: "plaza", position: { x: 3.85, y: 0.36, z: 15.7 }, postRotY: 0 },
];

/** The total Y rotation a fixture's group carries: post ∘ raw. */
export function fixtureRotY(def: WorldFixtureDef): number {
  return def.postRotY + FIXTURE_BODIES[def.body].rawRotY;
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

/** The texture slots a parsed body material can carry. */
export interface BodyMaterialLike {
  map?: unknown;
  metallicRoughnessMap?: unknown;
  normalMap?: unknown;
  emissiveMap?: unknown;
  aoMap?: unknown;
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
    return !!(s.map || s.metallicRoughnessMap || s.normalMap || s.emissiveMap || s.aoMap);
  });
}
