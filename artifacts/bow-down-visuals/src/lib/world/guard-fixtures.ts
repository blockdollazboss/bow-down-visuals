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
