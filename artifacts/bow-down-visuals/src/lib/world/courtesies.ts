/**
 * courtesies.ts — the standing figures have manners now (design:
 * .lane/ACTIONS-DESIGN §2.4 in the world-actions lane).
 *
 * The world-figures lane stood the King and his guards in the
 * scene as permanent fixtures; until now they were scenery the
 * input system could not see. A courtesy is the interact those
 * posts offer a member standing close: bow to the King at his
 * dais, salute his guards at theirs. Pure proximity math over the
 * fixture post constants — the same registry the scene builds
 * the bodies from, so the courtesy can never drift away from the
 * figure it names.
 *
 * A courtesy is a PERFORMANCE, not a panel: it resolves to an
 * ordinary avatar action (the King gets a bow, a guard gets a
 * salute) performed through the same path as the action bar, and
 * it is a member act exactly like the emotes are — guests get
 * none (actionRoleOk in bindings.ts is the gate the page checks;
 * this module only answers "who is near, and what do they offer").
 */
import { WORLD_FIXTURES, type WorldFixtureDef } from "./guard-fixtures";
import { HALL_ROOM_ID, COURTYARD_ID } from "./palace-layout";
import type { WorldActionId } from "./actions";

/** How close a walker must stand for a post to offer its
 *  courtesy (scene metres, floor plane). A conversation's
 *  distance — inside the ring of the dais foot and the guard
 *  platforms, well outside bumping range. */
export const COURTESY_RANGE_M = 2.2;

export interface FixtureCourtesy {
  fixture: WorldFixtureDef;
  /** The performance the courtesy makes. */
  action: WorldActionId;
  /** The prompt's verb phrase, e.g. "Bow to the King". */
  label: string;
  /** Floor-plane distance from the walker to the post. */
  distance: number;
}

/** The room each fixture area is stood in: the hall fixtures live
 *  in the King's Hall; the plaza fixtures on the courtyard shell. */
const AREA_ROOM: Readonly<Record<WorldFixtureDef["area"], string>> = {
  hall: HALL_ROOM_ID,
  plaza: COURTYARD_ID,
};

function courtesyFor(fixture: WorldFixtureDef): { action: WorldActionId; label: string } {
  return fixture.body === "king"
    ? { action: "bow" as WorldActionId, label: "Bow to the King" }
    : { action: "salute" as WorldActionId, label: "Salute the guard" };
}

/**
 * The courtesy on offer at a spot, if any: the nearest fixture
 * post in this room inside COURTESY_RANGE_M. Fixtures stood in
 * other rooms (or other areas) never answer.
 */
export function nearestCourtesy(roomId: string, x: number, z: number): FixtureCourtesy | null {
  let best: FixtureCourtesy | null = null;
  for (const fixture of WORLD_FIXTURES) {
    if (AREA_ROOM[fixture.area] !== roomId) continue;
    const distance = Math.hypot(x - fixture.position.x, z - fixture.position.z);
    if (distance > COURTESY_RANGE_M) continue;
    if (best && distance >= best.distance) continue;
    best = { fixture, ...courtesyFor(fixture), distance };
  }
  return best;
}
