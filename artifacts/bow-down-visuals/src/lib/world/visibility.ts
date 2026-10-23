/**
 * visibility.ts — portal culling, reflector gating, room-scoped
 * lights and the LOD foundation (Overhaul Stage B, items 23, 24
 * and the LOD half of 99). Pure geometry/logic — no three.js, no
 * DOM — so every rule is unit-testable without WebGL; hall-scene.ts
 * feeds it camera/walker positions and applies the verdicts.
 *
 * The geography it reasons about is palace-layout.ts: the hall
 * (z −18..12) opens to the plaza (z 12.4..34) through ONE arch in
 * the wall plane z = 12.2, span x −2.2..2.2 (the courtyard door in
 * PALACE_DOORS). That single fact drives everything here:
 *   - From the plaza, the hall interior is visible ONLY through
 *     the arch; from the hall, the plaza is visible only through
 *     it the other way. A portal cull is therefore provably safe
 *     when the arch itself cannot be in the camera's view cone.
 *   - The hall floor's planar Reflector re-renders the whole scene
 *     per frame (audit E3); it only needs to run when the mirror
 *     floor is plausibly on screen.
 * All culling rules are CONSERVATIVE: a generous FOV margin is
 * added to the real frustum, third-person camera offsets are the
 * caller's problem (the scene passes the CAMERA's position/yaw,
 * not the walker's), and anything ambiguous keeps the object drawn.
 */

import {
  COURTYARD_ID,
  HALL_ROOM_ID,
  PALACE_LAYOUT,
  STAGE_GROUNDS_ID,
  LISTENING_GARDENS_ID,
  CREATOR_ROOM_TEMPLATE,
  isCreatorRoomId,
  type PalaceRect,
} from "./palace-layout";

/** The hall⇄plaza arch (the courtyard door's span/plane). */
export const ARCH = { planeZ: 12.2, spanMin: -2.2, spanMax: 2.2, centerX: 0 } as const;

/** Coarse areas the perf systems switch on. Side rooms (Music
 *  Hall, Game Rooms, Create Wing, Treasury, Royal Court, Branding
 *  Atelier) are "indoor" like the hall; the plaza is "outdoor";
 *  a creator room is its own area south of the plaza. The Stage
 *  Grounds (item 31) and the Listening Gardens (item 32) are
 *  outdoor like the plaza they open off — same sky, same fog
 *  law, same sun. */
export type WorldArea = "hall" | "indoor" | "plaza" | "creator";

export function areaForRoom(roomId: string): WorldArea {
  if (roomId === HALL_ROOM_ID) return "hall";
  if (roomId === COURTYARD_ID) return "plaza";
  if (roomId === STAGE_GROUNDS_ID) return "plaza";
  if (roomId === LISTENING_GARDENS_ID) return "plaza";
  if (isCreatorRoomId(roomId)) return "creator";
  return "indoor";
}

/* ── Angle helpers ──────────────────────────────────────────────── */

/** Smallest absolute difference between two headings (radians). */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** Heading from a point toward a target, in the world's convention:
 *  rotY 0 faces −Z (the stage), +rotY turns toward −X... measured
 *  as atan2(dx, dz) flipped so it composes with angleDelta against
 *  a camera yaw of the same convention hall-scene uses for figures
 *  (atan2(dx, dz) from the viewer to the subject). */
export function headingTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/**
 * Can a camera at (x, z) with heading `yaw` plausibly see the
 * point (tx, tz)? The real vertical FOV is 68°; the horizontal is
 * wider, and third-person framing + look-drag pitch mean the arch
 * can enter the frame well off-axis. We test against a generous
 * half-angle (default 100° — past the screen edge on any aspect)
 * so a "no" is a proof, not a guess. Near the target, always yes:
 * at point-blank range the portal fills the world.
 */
export function pointInViewCone(
  x: number,
  z: number,
  yaw: number,
  tx: number,
  tz: number,
  halfAngleRad = (100 * Math.PI) / 180,
  nearDist = 6,
): boolean {
  const dx = tx - x;
  const dz = tz - z;
  const dist = Math.hypot(dx, dz);
  if (dist <= nearDist) return true;
  // Camera yaw in three.js YXZ order: the camera looks along −Z
  // rotated by yaw, i.e. its forward heading in atan2(dx,dz) terms
  // is yaw + π. Convert both to that space before comparing.
  const heading = headingTo(x, z, tx, tz);
  const forward = yaw + Math.PI;
  return angleDelta(heading, forward) <= halfAngleRad;
}

/* ── Item 23: portal culling ──────────────────────────────────────
 * The hall interior group is culled only when the walker is OUT
 * on the plaza/creator side AND the arch cannot be in the camera's
 * (generously widened) view cone AND the camera is well south of
 * the wall — deep enough that its near plane can't clip through
 * the arch. Symmetrically, plaza dressing is culled when the
 * walker is inside and the arch is behind/out of view. Inside any
 * room or anywhere near the portal, nothing is ever culled: the
 * arch glimpse is preserved exactly where it can occur.
 */

/** Minimum camera z (south of the arch plane) before hall culling
 *  is even considered — inside the portal apron, never cull. */
export const HALL_CULL_MIN_Z = ARCH.planeZ + 3.5;
/** Minimum camera z-depth inside the hall before plaza culling. */
export const PLAZA_CULL_MAX_Z = ARCH.planeZ - 3.5;

export function hallInteriorCulled(camX: number, camZ: number, camYaw: number, area: WorldArea): boolean {
  if (area !== "plaza" && area !== "creator") return false;
  if (camZ < HALL_CULL_MIN_Z) return false;
  return !pointInViewCone(camX, camZ, camYaw, ARCH.centerX, ARCH.planeZ);
}

export function plazaDressingCulled(camX: number, camZ: number, camYaw: number, area: WorldArea): boolean {
  if (area !== "hall" && area !== "indoor") return false;
  if (camZ > PLAZA_CULL_MAX_Z) return false;
  return !pointInViewCone(camX, camZ, camYaw, ARCH.centerX, ARCH.planeZ);
}

/* ── Item 23: reflector gating ────────────────────────────────────
 * The Reflector's mirror floor lives in the hall. It needs a fresh
 * reflection render only when that floor is plausibly on screen:
 *   - the camera is IN the hall (any view — the floor fills it);
 *   - or the camera is in the portal apron / on the near plaza
 *     with the arch in view (the glimpse through the doors — at a
 *     reduced cadence on medium, per the rung table);
 *   - never from the side rooms (their doors open onto the hall's
 *     SIDE walls; the mirror floor spans the hall's centre and the
 *     door spans sit beyond its edge from those angles — and the
 *     apron rule below still catches a walker standing IN a side
 *     doorway: their position is inside the portal rect, which the
 *     apron test covers via the hall-adjacency of the portal band);
 *   - never while XR is presenting (three's Reflector and XR do
 *     not mix — the scene already rested it there).
 * `zone` is returned alongside the verdict so the scene (and the
 * tests) can see WHY.
 */
export type ReflectorZone = "hall" | "glimpse" | "away";

export function reflectorZone(camX: number, camZ: number, area: WorldArea): ReflectorZone {
  if (area === "hall") return "hall";
  // Portal apron: standing in/just outside the arch band, the hall
  // floor is a step away and swings into view with any turn.
  if (Math.abs(camX - ARCH.centerX) <= 4.5 && camZ >= ARCH.planeZ - 2.5 && camZ <= ARCH.planeZ + 5) {
    return "glimpse";
  }
  if (area === "indoor") {
    // In a side doorway the walker stands in the portal band at
    // x ≈ ±13.5 — the mirror's edge is plausibly visible. Treat
    // the doorway band (|x| 12.5..15.5, any hall-band z) as glimpse.
    if (Math.abs(camX) >= 12.5 && Math.abs(camX) <= 15.5 && camZ >= -17 && camZ <= 12) return "glimpse";
  }
  return "away";
}

export interface ReflectorGateInput {
  camX: number;
  camZ: number;
  camYaw: number;
  area: WorldArea;
  /** The live rung's reflector size (0 = rung has no reflector). */
  reflectorSize: number;
  /** The rung's glimpse cadence (update every Nth frame). */
  glimpseEveryN: number;
  frameIndex: number;
  presenting: boolean;
}

export function reflectorShouldRender(input: ReflectorGateInput): boolean {
  if (input.presenting) return false;
  if (input.reflectorSize <= 0) return false;
  const zone = reflectorZone(input.camX, input.camZ, input.area);
  if (zone === "hall") return true;
  if (zone === "away") return false;
  // Glimpse: the arch must actually be in the (generous) view cone,
  // and the cadence throttles the re-render — a 4.4 m sliver of
  // mirror at distance does not need 60 Hz reflections.
  if (!pointInViewCone(input.camX, input.camZ, input.camYaw, ARCH.centerX, ARCH.planeZ)) return false;
  const every = Math.max(1, Math.floor(input.glimpseEveryN) || 1);
  return input.frameIndex % every === 0;
}

/* ── Item 24: room-scoped lights ──────────────────────────────────
 * In the forward renderer every Point/Spot light in the scene
 * shades every fragment, whether or not its light can reach the
 * walker's area (~15–17 lights today, audit E6). A light may be
 * switched off only when it PROVABLY cannot affect the walker's
 * current room: the shortest distance from the light's position to
 * the room's walk rect exceeds the light's range. Lights with no
 * range (distance 0 in three = infinite) and the global rig
 * (ambient/hemisphere/directional) are never scoped.
 * Because the test is range-vs-rect, the look inside an area is
 * unchanged by construction: every light that could reach you is
 * still on when you're there.
 */

interface RectLike {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Shortest distance from a point to a rect (0 when inside). */
export function pointToRectDistance(x: number, z: number, r: RectLike): number {
  const dx = x < r.minX ? r.minX - x : x > r.maxX ? x - r.maxX : 0;
  const dz = z < r.minZ ? r.minZ - z : z > r.maxZ ? z - r.maxZ : 0;
  return Math.hypot(dx, dz);
}

/** The walk rect a room's light-scoping is judged against (the
 *  creator template answers for any creator room id). */
export function walkRectForRoom(roomId: string): PalaceRect | null {
  if (isCreatorRoomId(roomId)) return { ...CREATOR_ROOM_TEMPLATE.walk };
  return PALACE_LAYOUT[roomId]?.walk ?? null;
}

/**
 * May this light be off while the walker stands in `roomId`?
 * True only when the light has a finite range AND that range
 * cannot reach any point of the room's walk rect — with a safety
 * margin shaved off the range, so boundary cases stay on.
 */
export function lightScopedOff(
  light: { x: number; z: number; range: number },
  roomId: string,
  margin = 0.75,
): boolean {
  if (!Number.isFinite(light.range) || light.range <= 0) return false;
  const rect = walkRectForRoom(roomId);
  if (!rect) return false;
  return pointToRectDistance(light.x, light.z, rect) > light.range - margin;
}

/* ── Item 99: LOD foundation ──────────────────────────────────────
 * Distance tiers for dressing groups, judged from the CAMERA:
 *   near — full detail;
 *   mid  — simplified (detail children hidden);
 *   far  — the group itself is hidden.
 * The tier distances scale from the rung's lodDrawDistance: far
 * starts AT it, mid at half of it. At the high rung (120 m) no
 * palace dressing ever reaches mid — the foundation costs the
 * authored look nothing until a rung asks it to.
 */
export type LodTier = "near" | "mid" | "far";

export function lodTierForDistance(distance: number, drawDistance: number): LodTier {
  if (!Number.isFinite(drawDistance) || drawDistance <= 0) return "near";
  if (distance > drawDistance) return "far";
  if (distance > drawDistance / 2) return "mid";
  return "near";
}

export function lodTierAt(
  camX: number,
  camZ: number,
  anchorX: number,
  anchorZ: number,
  drawDistance: number,
): LodTier {
  return lodTierForDistance(Math.hypot(anchorX - camX, anchorZ - camZ), drawDistance);
}
