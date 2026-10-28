/**
 * Wayfinding — the walker's quiet compass (audit §A6: at spawn
 * the nearest door stands 7+ metres away, the E radius is 2.3 m,
 * and nothing pointed anywhere). These pins cover the compass
 * maths (the scene's forward is (-sin yaw, -cos yaw) — a sign
 * error here points the arrow exactly wrong), the target pick
 * (fresh walkers are pointed at the making), and the snapped
 * view the chip renders.
 */
import { describe, it, expect } from "vitest";
import {
  compassDeg,
  guideView,
  pickGuideTarget,
  sameGuideView,
  type GuideTarget,
} from "./wayfinding";
import {
  isCreateDesk,
  nearestStationTarget,
  stationsInRoom,
  type PalaceStation,
} from "./stations";
import { HALL_ROOM_ID, CREATE_WING_ID } from "./palace-layout";

const st = (
  id: string,
  x: number,
  z: number,
  pattern?: "create" | "board",
): PalaceStation => ({
  id,
  roomId: "room:test",
  name: id,
  tagline: "",
  x,
  z,
  membersOnly: false,
  panel: pattern ? { kind: "native", pattern } : { kind: "custom", id },
  websitePath: null,
});

describe("compassDeg — the arrow follows the scene's own forward", () => {
  // Walker at the origin facing -Z (rotY 0): the palace's north.
  it("straight ahead is 0", () => {
    expect(compassDeg(0, 0, 0, 0, -10)).toBeCloseTo(0);
  });
  it("hard right is +90 (CSS-clockwise)", () => {
    expect(compassDeg(0, 0, 0, 10, 0)).toBeCloseTo(90);
  });
  it("hard left is -90", () => {
    expect(compassDeg(0, 0, 0, -10, 0)).toBeCloseTo(-90);
  });
  it("directly behind is ±180", () => {
    expect(Math.abs(compassDeg(0, 0, 0, 0, 10))).toBeCloseTo(180);
  });
  it("turning with the walker keeps a fixed target fixed on the compass", () => {
    // Facing +Z (rotY π): the thing to the south is straight ahead.
    expect(compassDeg(0, 0, Math.PI, 0, 10)).toBeCloseTo(0);
    // Facing -X (rotY π/2): north (-Z) is on the walker's right.
    expect(compassDeg(0, 0, Math.PI / 2, 0, -10)).toBeCloseTo(90);
  });
  it("wraps across the ±π seam instead of spinning the long way", () => {
    // Facing almost +X the long way round (rotY 3π/2): north is a
    // quarter-turn LEFT, not three quarters right.
    expect(compassDeg(0, 0, (3 * Math.PI) / 2, 0, -10)).toBeCloseTo(-90);
  });
  it("is translation-invariant", () => {
    expect(compassDeg(40, 31.5, 0, 40, 21.5)).toBeCloseTo(0);
    expect(compassDeg(40, 31.5, 0, 50, 31.5)).toBeCloseTo(90);
  });
});

describe("pickGuideTarget — one door worth pointing at", () => {
  const board = st("kingdom-board", 3, 0, "board");
  const song = st("song-desk", 20, 0, "create");
  const video = st("video-desk", 12, 0, "create");

  it("a seasoned walker is pointed at the nearest door, full stop", () => {
    const t = pickGuideTarget([board, song], 0, 0, false);
    expect(t?.station.id).toBe("kingdom-board");
    expect(t?.create).toBe(false);
    expect(t?.roomHasCreate).toBe(true);
  });

  it("a fresh walker is pointed at the making, even past a nearer board", () => {
    const t = pickGuideTarget([board, song], 0, 0, true);
    expect(t?.station.id).toBe("song-desk");
    expect(t?.create).toBe(true);
    expect(t?.distance).toBeCloseTo(20);
  });

  it("among creation desks the fresh walker gets the nearest", () => {
    const t = pickGuideTarget([board, song, video], 0, 0, true);
    expect(t?.station.id).toBe("video-desk");
  });

  it("a fresh walker in a room with no creation desk gets the nearest door, flagged", () => {
    const t = pickGuideTarget([board], 0, 0, true);
    expect(t?.station.id).toBe("kingdom-board");
    expect(t?.create).toBe(false);
    expect(t?.roomHasCreate).toBe(false);
  });

  it("an empty room points nowhere", () => {
    expect(pickGuideTarget([], 0, 0, true)).toBeNull();
  });
});

describe("guideView — the chip's snapped read", () => {
  const target: GuideTarget = {
    station: st("song-desk", 0, -13, "create"),
    distance: 13.4,
    create: true,
    roomHasCreate: true,
  };

  it("fresh + create target reads as the objective", () => {
    const v = guideView(target, 0, 0, 0, true);
    expect(v.mode).toBe("create");
    expect(v.metres).toBe(13);
    expect(v.arrowDeg).toBe(0);
  });

  it("fresh + no creation desk in the room reads as first-steps", () => {
    const v = guideView({ ...target, create: false, roomHasCreate: false }, 0, 0, 0, true);
    expect(v.mode).toBe("first-steps");
  });

  it("a seasoned walker always reads as the plain compass", () => {
    expect(guideView(target, 0, 0, 0, false).mode).toBe("nearest");
    expect(
      guideView({ ...target, create: false, roomHasCreate: false }, 0, 0, 0, false).mode,
    ).toBe("nearest");
  });

  it("the arrow snaps to 5° steps", () => {
    // Target ~13° off-axis: atan2 geometry — a point at (sin13°, -cos13°)·10.
    const a = (13 * Math.PI) / 180;
    const v = guideView({ ...target, station: st("x", Math.sin(a) * 10, -Math.cos(a) * 10) }, 0, 0, 0, false);
    expect(v.arrowDeg).toBe(15);
  });

  it("sameGuideView holds the tick's re-render gate", () => {
    const v = guideView(target, 0, 0, 0, true);
    expect(sameGuideView(v, { ...v })).toBe(true);
    expect(sameGuideView(v, { ...v, metres: v.metres + 1 })).toBe(false);
    expect(sameGuideView(v, null)).toBe(false);
    expect(sameGuideView(null, null)).toBe(true);
  });
});

describe("the registry reads the compass stands on", () => {
  it("isCreateDesk follows the registry's own create pattern", () => {
    const wing = stationsInRoom(CREATE_WING_ID);
    expect(wing.some(isCreateDesk)).toBe(true);
    expect(wing.filter(isCreateDesk).map((s) => s.id)).toContain("song-desk");
    const hall = stationsInRoom(HALL_ROOM_ID);
    expect(hall.some(isCreateDesk)).toBe(false);
  });

  it("nearestStationTarget is uncapped: it answers from across the palace", () => {
    const hall = stationsInRoom(HALL_ROOM_ID);
    expect(hall.length).toBeGreaterThan(0);
    const far = nearestStationTarget(HALL_ROOM_ID, 500, 500);
    expect(far).not.toBeNull();
    expect(far!.distance).toBeGreaterThan(100);
    const onTop = nearestStationTarget(HALL_ROOM_ID, hall[0].x, hall[0].z);
    expect(onTop?.station.id).toBe(hall[0].id);
    expect(onTop?.distance).toBeCloseTo(0);
  });
});
