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
   * Y rotation that turns the RAW body to face +Z. The raw TRELLIS
   * outputs do not agree with each other: the male guard's front is
   * already +Z (the proof stage's judged front at rotY 0, camera on
   * +Z — world-3d-proof/showdown.ts); the female statue's front is
   * +X, so she takes -90°. The King's v3 body comes from the same
   * front-sheet family as the male guard and takes 0 — confirmed
   * against the preview-rig capture in .lane/proof/ (if he ever
   * reads backwards, THIS constant is the whole fix).
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
    rawRotY: -Math.PI / 2,
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
}

/**
 * The posts. Coordinates read off the built geometry:
 *  - The dais (both looks): a 12 m slab centred (0, -15.7), front edge
 *    z = -13.5, its top a metre up. The King stands on the FLOOR at
 *    the dais foot (0, -13.1) — floor height is look-independent, the
 *    dais top is not (0.96 vs 1.13), and a King floating or sunk by
 *    look is worse than a King at the foot of his throne.
 *  - Hall guards flank the dais just outside its 6 m half-width, on
 *    the floor, a step behind the King's line: (±6.9, -14.3).
 *  - Plaza guards stand ON the ceremonial step platforms flanking
 *    the arch approach (palace-grounds HALL_STEPS: platform top
 *    y = 0.36, step runs centred x = ±3.85, platform z 15.16-16.4):
 *    (±3.85, 0.36, 15.7), facing the plaza they guard.
 */
export const WORLD_FIXTURES: readonly WorldFixtureDef[] = [
  { id: "hall-king", body: "king", area: "hall", position: { x: 0, y: 0, z: -13.1 }, postRotY: 0 },
  { id: "hall-guard-male", body: "guard-male", area: "hall", position: { x: -6.9, y: 0, z: -14.3 }, postRotY: 0 },
  { id: "hall-guard-female", body: "guard-female", area: "hall", position: { x: 6.9, y: 0, z: -14.3 }, postRotY: 0 },
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
