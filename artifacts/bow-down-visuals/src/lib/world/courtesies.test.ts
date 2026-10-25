/**
 * Courtesies (lib/world/courtesies) — the fixture posts offer the
 * right performance to a member standing at them, in the right
 * room, inside the range — and stay silent everywhere else.
 */
import { describe, it, expect } from "vitest";
import { nearestCourtesy, COURTESY_RANGE_M } from "./courtesies";
import { WORLD_FIXTURES } from "./guard-fixtures";
import { HALL_ROOM_ID, COURTYARD_ID } from "./palace-layout";

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
