/**
 * Visibility tests (lib/world/visibility) — items 23, 24, 99-LOD.
 * The culling rules must be CONSERVATIVE: anything that could be
 * on screen stays on screen. These tests pin the geometry the
 * rules rely on (the one arch, z = 12.2, span ±2.2).
 */
import { describe, it, expect } from "vitest";
import {
  ARCH,
  areaForRoom,
  hallInteriorCulled,
  lightScopedOff,
  lodTierAt,
  lodTierForDistance,
  plazaDressingCulled,
  pointInViewCone,
  pointToRectDistance,
  reflectorShouldRender,
  reflectorZone,
  walkRectForRoom,
} from "./visibility";
import { COURTYARD_ID, HALL_ROOM_ID, MUSIC_HALL_ID, STAGE_GROUNDS_ID, creatorRoomId } from "./palace-layout";

const FACING_STAGE = Math.PI; // heading convention: yaw π looks toward −Z... (see below)
/* In visibility.ts the camera forward in atan2(dx,dz) space is
 * yaw + π. A walker at spawn (0, 31.5) facing the palace (toward
 * −Z, i.e. toward the arch) has heading atan2(0,-1)=π there, so
 * their yaw is 0. We use yaw=0 for "facing the palace" and yaw=π
 * for "facing away (south)". */
const FACE_PALACE = 0;
const FACE_AWAY = Math.PI;

describe("areaForRoom", () => {
  it("classifies hall / plaza / side room / creator room", () => {
    expect(areaForRoom(HALL_ROOM_ID)).toBe("hall");
    expect(areaForRoom(COURTYARD_ID)).toBe("plaza");
    /* The Stage Grounds (item 31) are outdoor like the plaza. */
    expect(areaForRoom(STAGE_GROUNDS_ID)).toBe("plaza");
    expect(areaForRoom(MUSIC_HALL_ID)).toBe("indoor");
    expect(areaForRoom(creatorRoomId("someone"))).toBe("creator");
  });
});

describe("pointInViewCone", () => {
  it("a point straight ahead is in view; straight behind is not", () => {
    expect(pointInViewCone(0, 31.5, FACE_PALACE, 0, 12.2)).toBe(true);
    expect(pointInViewCone(0, 31.5, FACE_AWAY, 0, 12.2)).toBe(false);
  });
  it("near points are always in view (point-blank rule)", () => {
    expect(pointInViewCone(0, 14, FACE_AWAY, 0, 12.2)).toBe(true);
  });
  it("the arch stays in view from the promenade while facing the palace", () => {
    expect(pointInViewCone(-20, 30, FACE_PALACE, ARCH.centerX, ARCH.planeZ)).toBe(true);
  });
});

describe("portal culling (item 23)", () => {
  it("never culls inside the hall, a side room, or near the arch", () => {
    expect(hallInteriorCulled(0, 20, FACE_AWAY, "hall")).toBe(false);
    expect(hallInteriorCulled(20, 30, FACE_AWAY, "indoor")).toBe(false);
    // On the near plaza, even facing away — the apron is too close.
    expect(hallInteriorCulled(0, 14.5, FACE_AWAY, "plaza")).toBe(false);
    expect(hallInteriorCulled(0, 13, FACE_AWAY, "plaza")).toBe(false);
  });
  it("culls the hall interior only from deep plaza with the arch out of view", () => {
    // Spawn, back turned to the palace: the hall cannot be seen.
    expect(hallInteriorCulled(0, 31.5, FACE_AWAY, "plaza")).toBe(true);
    // Same spot facing the palace: the arch glimpse must survive.
    expect(hallInteriorCulled(0, 31.5, FACE_PALACE, "plaza")).toBe(false);
    // Far corner, facing along the south wall (arch far off-axis
    // behind): the widened cone still acquits facing the palace…
    expect(hallInteriorCulled(26, 33, FACE_PALACE, "plaza")).toBe(false);
    // …and convicts facing away.
    expect(hallInteriorCulled(26, 33, FACE_AWAY, "plaza")).toBe(true);
  });
  it("plaza dressing culls symmetrically from deep inside, arch behind", () => {
    expect(plazaDressingCulled(0, -10, FACE_PALACE, "hall")).toBe(true); // facing the stage (north = away from arch)
    expect(plazaDressingCulled(0, -10, FACE_AWAY, "hall")).toBe(false); // facing the arch
    expect(plazaDressingCulled(0, 10, FACE_PALACE, "hall")).toBe(false); // near the arch: never
    expect(plazaDressingCulled(0, 20, FACE_PALACE, "plaza")).toBe(false); // not indoors
    void FACING_STAGE;
  });
});

describe("reflector gating (item 23)", () => {
  const base = { camYaw: FACE_PALACE, reflectorSize: 1024, glimpseEveryN: 1, frameIndex: 0, presenting: false };
  it("always renders inside the hall", () => {
    expect(reflectorShouldRender({ ...base, camX: 5, camZ: 0, area: "hall" })).toBe(true);
    expect(reflectorShouldRender({ ...base, camX: -10, camZ: -12, camYaw: FACE_AWAY, area: "hall" })).toBe(true);
  });
  it("never renders while presenting, or on a reflector-less rung", () => {
    expect(reflectorShouldRender({ ...base, camX: 0, camZ: 0, area: "hall", presenting: true })).toBe(false);
    expect(reflectorShouldRender({ ...base, camX: 0, camZ: 0, area: "hall", reflectorSize: 0 })).toBe(false);
  });
  it("renders for the arch glimpse from the near plaza, arch in view", () => {
    expect(reflectorZone(0, 14.5, "plaza")).toBe("glimpse");
    expect(reflectorShouldRender({ ...base, camX: 0, camZ: 14.5, area: "plaza" })).toBe(true);
    // At the apron's outer edge with the back turned: no glimpse,
    // no render. (Point-blank in the portal itself the near rule
    // keeps it on — the floor is a step away and any turn shows it.)
    expect(reflectorShouldRender({ ...base, camX: 4.4, camZ: 16.5, camYaw: FACE_AWAY, area: "plaza" })).toBe(false);
    expect(reflectorShouldRender({ ...base, camX: 4.4, camZ: 16.5, camYaw: FACE_PALACE, area: "plaza" })).toBe(true);
  });
  it("never renders from deep plaza or a side room's interior", () => {
    expect(reflectorZone(0, 31.5, "plaza")).toBe("away");
    expect(reflectorShouldRender({ ...base, camX: 0, camZ: 31.5, area: "plaza" })).toBe(false);
    expect(reflectorZone(-21, -2, "indoor")).toBe("away");
    expect(reflectorShouldRender({ ...base, camX: -21, camZ: -2, area: "indoor" })).toBe(false);
  });
  it("a side doorway counts as glimpse (mirror edge plausibly visible)", () => {
    expect(reflectorZone(-13.8, -2, "indoor")).toBe("glimpse");
  });
  it("medium's glimpse cadence renders every 2nd frame only", () => {
    const med = { ...base, reflectorSize: 512, glimpseEveryN: 2, camX: 0, camZ: 14.5, area: "plaza" as const };
    expect(reflectorShouldRender({ ...med, frameIndex: 4 })).toBe(true);
    expect(reflectorShouldRender({ ...med, frameIndex: 5 })).toBe(false);
    // Inside the hall the cadence never applies.
    expect(reflectorShouldRender({ ...med, camX: 0, camZ: 0, area: "hall", frameIndex: 5 })).toBe(true);
  });
});

describe("room-scoped lights (item 24)", () => {
  it("point-to-rect distance is 0 inside and exact outside", () => {
    const r = { minX: -13.1, maxX: 13.1, minZ: -11.6, maxZ: 11.1 };
    expect(pointToRectDistance(0, 0, r)).toBe(0);
    expect(pointToRectDistance(0, 21.1, r)).toBeCloseTo(10, 5);
    expect(pointToRectDistance(23.1, 21.1, r)).toBeCloseTo(Math.hypot(10, 10), 5);
  });
  it("a hall light is scoped off only when its range cannot reach the walker's room", () => {
    // House point light at (0, z=2), range 26: from the plaza walk
    // rect (z ≥ 12.55) it is ~10.5 m away — well within range: ON.
    expect(lightScopedOff({ x: 0, z: 2, range: 26 }, COURTYARD_ID)).toBe(false);
    // A courtyard brazier (range 12) judged from the Music Hall
    // (x ≤ −14.35): ~13+ m away laterally — cannot reach: OFF.
    expect(lightScopedOff({ x: -3.4, z: 19.7, range: 12 }, MUSIC_HALL_ID)).toBe(true);
    // The same brazier judged from the plaza: inside its own room: ON.
    expect(lightScopedOff({ x: -3.4, z: 19.7, range: 12 }, COURTYARD_ID)).toBe(false);
    // A shell lantern (range 16) in the Music Hall, judged from the
    // hall next door: its range reaches across the shared wall: ON.
    expect(lightScopedOff({ x: -21.3, z: -2.75, range: 16 }, HALL_ROOM_ID)).toBe(false);
  });
  it("infinite-range and unknown-room lights are never scoped off", () => {
    expect(lightScopedOff({ x: 0, z: 0, range: 0 }, COURTYARD_ID)).toBe(false);
    expect(lightScopedOff({ x: 0, z: 0, range: Number.POSITIVE_INFINITY }, COURTYARD_ID)).toBe(false);
    expect(walkRectForRoom("world:nowhere")).toBeNull();
  });
  it("creator rooms scope against the template rect", () => {
    expect(walkRectForRoom(creatorRoomId("x"))).toEqual({ minX: 2.95, maxX: 16.05, minZ: 26.8, maxZ: 37.65 });
    // A hall stage spot (range 30) cannot reach the creator room
    // (~37 m south): OFF there. A courtyard brazier (range 12)
    // ~7 m from the template's walk rect stays ON.
    expect(lightScopedOff({ x: 0, z: -10.5, range: 30 }, creatorRoomId("x"))).toBe(true);
    expect(lightScopedOff({ x: 3.4, z: 19.7, range: 12 }, creatorRoomId("x"))).toBe(false);
  });
});

describe("LOD foundation (item 99)", () => {
  it("tiers split at half and full draw distance", () => {
    expect(lodTierForDistance(10, 60)).toBe("near");
    expect(lodTierForDistance(30, 60)).toBe("near");
    expect(lodTierForDistance(31, 60)).toBe("mid");
    expect(lodTierForDistance(60, 60)).toBe("mid");
    expect(lodTierForDistance(61, 60)).toBe("far");
  });
  it("the high rung never simplifies palace-scale distances", () => {
    // The plaza diagonal is ~62 m; high's draw distance is 120.
    expect(lodTierAt(0, 31.5, 28, 12.4, 120)).toBe("near");
    expect(lodTierAt(0, 31.5, 28, 12.4, 60)).toBe("mid");
  });
  it("a non-positive draw distance disables LOD (always near)", () => {
    expect(lodTierForDistance(500, 0)).toBe("near");
  });
});
