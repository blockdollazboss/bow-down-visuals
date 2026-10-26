/**
 * Courtesies (lib/world/courtesies) — the fixture posts offer the
 * right performance to a member standing at them, in the right
 * room, inside the range — and stay silent everywhere else.
 */
import { describe, it, expect } from "vitest";
import { nearestCourtesy, courtesyPointOf, COURTESY_RANGE_M } from "./courtesies";
import { WORLD_FIXTURES, type WorldFixtureDef } from "./guard-fixtures";
import {
  HALL_ROOM_ID,
  COURTYARD_ID,
  PALACE_LAYOUT,
  PALACE_DOORS,
  isStandable,
  type PalaceRect,
} from "./palace-layout";

const king = WORLD_FIXTURES.find((f) => f.body === "king")!;
const hallGuard = WORLD_FIXTURES.find((f) => f.area === "hall" && f.body !== "king")!;
const plazaGuard = WORLD_FIXTURES.find((f) => f.area === "plaza")!;

describe("nearestCourtesy", () => {
  it("at the King's post: a bow, offered in the hall", () => {
    const c = nearestCourtesy(HALL_ROOM_ID, king.position.x, king.position.z + 1.2);
    expect(c?.fixture.body).toBe("king");
    expect(c?.action).toBe("bow");
    expect(c?.label).toBe("Bow to the King");
    expect(c?.distance).toBeCloseTo(1.2);
  });

  it("at a guard's post, hall or plaza: a salute", () => {
    const hall = nearestCourtesy(HALL_ROOM_ID, hallGuard.position.x + 0.8, hallGuard.position.z);
    expect(hall?.action).toBe("salute");
    expect(hall?.label).toBe("Salute the guard");
    const plaza = nearestCourtesy(COURTYARD_ID, plazaGuard.position.x, plazaGuard.position.z - 1.5);
    expect(plaza?.action).toBe("salute");
    expect(plaza?.fixture.area).toBe("plaza");
  });

  it("the room rules: the King's post in the wrong room offers nothing", () => {
    expect(nearestCourtesy(COURTYARD_ID, king.position.x, king.position.z)).toBeNull();
    expect(nearestCourtesy(HALL_ROOM_ID, plazaGuard.position.x, plazaGuard.position.z)).toBeNull();
    expect(nearestCourtesy("world:music-hall", king.position.x, king.position.z)).toBeNull();
  });

  it("range rules: just inside answers, just outside stays silent", () => {
    const inside = nearestCourtesy(
      HALL_ROOM_ID,
      king.position.x,
      king.position.z + COURTESY_RANGE_M - 0.05,
    );
    expect(inside?.fixture.body).toBe("king");
    const outside = nearestCourtesy(
      HALL_ROOM_ID,
      king.position.x,
      king.position.z + COURTESY_RANGE_M + 0.05,
    );
    expect(outside).toBeNull();
  });

  it("the middle of the hall floor offers nothing", () => {
    expect(nearestCourtesy(HALL_ROOM_ID, 0, 6)).toBeNull();
    expect(nearestCourtesy(COURTYARD_ID, 0, -30)).toBeNull();
  });
});

/**
 * Q169 geometry proof (QC-200 FAIL): a courtesy can only fire if
 * some point a walker may actually STAND on lies within
 * COURTESY_RANGE_M of the fixture's courtesy point. Before the
 * fix the two hall guards failed this outright — bodies at
 * (±6.9, −14.3), walk floor ending at z = −11.6: 2.70 m > 2.2 m.
 * The proof runs per post over the REAL standable ground (every
 * room's walk rect + grounds + step zones, plus door portals —
 * the same union isStandable answers from), not a hand-picked
 * spot, so a future layout or post move that strands a courtesy
 * fails here instead of in the owner's walk.
 */
const ROOM_OF_AREA: Readonly<Record<WorldFixtureDef["area"], string>> = {
  hall: HALL_ROOM_ID,
  plaza: COURTYARD_ID,
};

function standableRects(): PalaceRect[] {
  const rects: PalaceRect[] = [];
  for (const room of Object.values(PALACE_LAYOUT)) {
    rects.push(room.walk);
    if (room.grounds) rects.push(...room.grounds);
    if (room.steps) for (const s of room.steps) rects.push(s.rect);
  }
  for (const door of PALACE_DOORS) rects.push(door.portal);
  return rects;
}

function blockedRects(): PalaceRect[] {
  const rects: PalaceRect[] = [];
  for (const room of Object.values(PALACE_LAYOUT)) {
    if (room.blocked) rects.push(...room.blocked);
  }
  return rects;
}

/**
 * The nearest point to (x, z) a walker may actually stand on.
 * Candidates: the clamp into every standable rect, PLUS — for
 * when that clamp lands inside a solid (the plaza guards' own
 * spots sit inside their platform's blocked footprint; nobody
 * stands inside the guard) — the projection onto each blocked
 * rect's boundary, nudged a hair outside it (pointInRect is
 * edge-inclusive, so the boundary itself still reads blocked).
 * Every candidate is filtered through isStandable itself, so the
 * winner is standable by the movement law's own word.
 */
function nearestStandablePoint(x: number, z: number): { x: number; z: number; distance: number } {
  const candidates: { x: number; z: number }[] = [];
  for (const r of standableRects()) {
    candidates.push({
      x: Math.min(Math.max(x, r.minX), r.maxX),
      z: Math.min(Math.max(z, r.minZ), r.maxZ),
    });
  }
  const EPS = 0.001;
  for (const b of blockedRects()) {
    const cx = Math.min(Math.max(x, b.minX), b.maxX);
    const cz = Math.min(Math.max(z, b.minZ), b.maxZ);
    candidates.push(
      { x: cx, z: b.minZ - EPS },
      { x: cx, z: b.maxZ + EPS },
      { x: b.minX - EPS, z: cz },
      { x: b.maxX + EPS, z: cz },
    );
  }
  let best = { x, z, distance: Number.POSITIVE_INFINITY };
  for (const c of candidates) {
    if (!isStandable(c.x, c.z)) continue;
    const distance = Math.hypot(x - c.x, z - c.z);
    if (distance < best.distance) best = { x: c.x, z: c.z, distance };
  }
  return best;
}

describe("Q169 — every courtesy post is reachable from standable ground", () => {
  for (const fixture of WORLD_FIXTURES) {
    it(`${fixture.id}: nearest standable ground is within courtesy range, and the courtesy fires from there`, () => {
      const point = courtesyPointOf(fixture);
      const nearest = nearestStandablePoint(point.x, point.z);
      // The winning point is genuinely standable (not inside a
      // solid, not a rect the movement law would refuse).
      expect(isStandable(nearest.x, nearest.z)).toBe(true);
      expect(nearest.distance).toBeLessThanOrEqual(COURTESY_RANGE_M);
      // And standing exactly there offers THIS fixture's courtesy.
      const offered = nearestCourtesy(ROOM_OF_AREA[fixture.area], nearest.x, nearest.z);
      expect(offered?.fixture.id).toBe(fixture.id);
    });
  }

  it("the hall guards' bodies still stand at their posts — 2.70 m out, as designed; only the anchor moved", () => {
    for (const guard of WORLD_FIXTURES.filter((f) => f.area === "hall" && f.body !== "king")) {
      const fromBody = nearestStandablePoint(guard.position.x, guard.position.z);
      expect(fromBody.distance).toBeCloseTo(2.7, 1);
      expect(fromBody.distance).toBeGreaterThan(COURTESY_RANGE_M);
      const fromAnchor = nearestStandablePoint(guard.courtesyAnchor!.x, guard.courtesyAnchor!.z);
      expect(fromAnchor.distance).toBeCloseTo(1.0, 1);
      expect(fromAnchor.distance).toBeLessThanOrEqual(COURTESY_RANGE_M);
    }
  });
});
