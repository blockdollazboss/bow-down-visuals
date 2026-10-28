/**
 * wayfinding.ts — the walker's quiet compass.
 *
 * The palace's doors only offer themselves inside a 2.3 m radius
 * (stations.ts STATION_PROMPT_RADIUS), but at spawn the nearest
 * offer stands 7+ metres away and nothing pointed at it — a fresh
 * walker's first E presses all landed on "Nothing in reach"
 * (audit §A6). This module picks the one target worth pointing
 * at and does the compass maths for the chip that points:
 *
 *  - Normally: the nearest station in the room, however far.
 *  - For a fresh walker (no desk opened yet this visit): the
 *    nearest CREATION desk in the room if one stands here — the
 *    "you can make things in this world" objective — and in a
 *    room with no creation desk, the nearest station, with the
 *    view flagged `first-steps` so the chip can say where the
 *    making happens.
 *
 * The chip itself (pages/world.tsx) renders only while nothing
 * is in reach and no panel is open: the moment a real prompt
 * takes over, the compass steps aside. Pure functions — the
 * page's station tick feeds them the pose; the tests pin the
 * maths.
 */
import { isCreateDesk, type PalaceStation } from "./stations";

export interface GuideTarget {
  station: PalaceStation;
  /** Metres from the walker, uncapped. */
  distance: number;
  /** The target is a creation desk. */
  create: boolean;
  /** A creation desk stands somewhere in this room at all. */
  roomHasCreate: boolean;
}

/** Pick the compass's one target among a room's stations. */
export function pickGuideTarget(
  stations: PalaceStation[],
  x: number,
  z: number,
  fresh: boolean,
): GuideTarget | null {
  let nearest: PalaceStation | null = null;
  let nearestDist = Infinity;
  let nearestCreate: PalaceStation | null = null;
  let nearestCreateDist = Infinity;
  for (const s of stations) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < nearestDist) {
      nearest = s;
      nearestDist = d;
    }
    if (isCreateDesk(s) && d < nearestCreateDist) {
      nearestCreate = s;
      nearestCreateDist = d;
    }
  }
  if (!nearest) return null;
  if (fresh && nearestCreate) {
    return { station: nearestCreate, distance: nearestCreateDist, create: true, roomHasCreate: true };
  }
  return {
    station: nearest,
    distance: nearestDist,
    create: isCreateDesk(nearest),
    roomHasCreate: nearestCreate !== null,
  };
}

/** Degrees to rotate a north-up arrow (CSS rotate: clockwise is
 *  positive) so it points from the walker toward the target.
 *
 *  The scene's camera forward on the floor plane is
 *  (-sin(rotY), -cos(rotY)) (hall-scene.ts), so the yaw that
 *  would face the target is atan2(-dx, -dz). Yaw grows
 *  counter-clockwise seen from above while CSS rotation grows
 *  clockwise, so the screen angle is the negation of the yaw
 *  difference. 0 = straight ahead, +90 = hard right, ±180 =
 *  directly behind. Result in (-180, 180]. */
export function compassDeg(
  x: number,
  z: number,
  rotY: number,
  tx: number,
  tz: number,
): number {
  const yawTo = Math.atan2(-(tx - x), -(tz - z));
  let rel = yawTo - rotY;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  return (-rel * 180) / Math.PI;
}

/** The chip's render state, derived from a target + pose. */
export interface GuideView {
  id: string;
  name: string;
  /** Whole metres — the chip's distance read. */
  metres: number;
  /** Arrow rotation, snapped to 5° steps so the chip re-renders
   *  on real turns, not on every tick's jitter. */
  arrowDeg: number;
  /** create: a fresh walker is being pointed at a creation desk.
   *  first-steps: a fresh walker in a room with no creation desk
   *  (the chip adds where the making happens). nearest: the plain
   *  compass for a walker who has already found the doors. */
  mode: "create" | "first-steps" | "nearest";
}

export function guideView(
  target: GuideTarget,
  x: number,
  z: number,
  rotY: number,
  fresh: boolean,
): GuideView {
  return {
    id: target.station.id,
    name: target.station.name,
    metres: Math.max(1, Math.round(target.distance)),
    arrowDeg: Math.round(compassDeg(x, z, rotY, target.station.x, target.station.z) / 5) * 5,
    mode:
      fresh && target.create
        ? "create"
        : fresh && !target.roomHasCreate
          ? "first-steps"
          : "nearest",
  };
}

/** The tick's change test: re-render the chip only when what it
 *  would SAY changed (target, whole metres, snapped arrow, mode). */
export function sameGuideView(a: GuideView | null, b: GuideView | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.metres === b.metres && a.arrowDeg === b.arrowDeg && a.mode === b.mode;
}
