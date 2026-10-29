/**
 * Spawn integrity — the World's entry paths pinned against the
 * reseat rule (Stack800 Lane 7, items 1–2; board #88, QC Q167
 * code half).
 *
 * Every way a walker arrives somewhere — a doorway crossing, a
 * directory / room-card / deep-entry JUMP, a district gate, a
 * cold landing — ends at one of two placements: the crossing pose
 * (which rode with the transfer) or the room's authored spawn.
 * The page then decides whether the local rig must be re-placed
 * on the welcome's landing: `transferNeedsReseat`. Its distance
 * half alone cannot tell "standing in the doorway of the room I
 * jumped to" from "standing on ANOTHER room's floor behind a
 * wall, 2.3 m from its spawn" — and the palace has both shapes:
 *
 * - the Game Rooms spawn stands 2.25 m from the Music Hall's
 *   north floor strip, wall between, NO door (and its mirror:
 *   Create Wing floor → Branding Atelier spawn);
 * - the Creator Heights spawn stands ~2.25 m from open Courtyard
 *   ground;
 *
 * so a jump from those floors used to leave the rig standing in
 * a room the scene had stopped rendering — the owner's Oct 24
 * walk ("stood inside the floor") at seams the spawn-to-spawn
 * distances (min 4.70 m) never exposed. The rule therefore also
 * carries the membership half: a rig the floor plan does not
 * claim for the destination room is re-placed on the landing,
 * always. Doorway walks are untouched — a crossing pose stands
 * past the plane, already claimed by the destination.
 *
 * Pinned here, over the shipped layout data itself:
 * - every authored spawn (14 fixed rooms + the creator-room
 *   template, registered) stands on standable ground, is claimed
 *   by its own room, clamps to itself, and stands at its authored
 *   ground height;
 * - every doorway's apron is standable end to end, and a step
 *   across every door's plane lands in the room on the other
 *   side (both directions, the creator arch included);
 * - the reseat rule at the proven seams, at doorway poses, and
 *   across a full sweep of every spawn's no-reseat disc — the
 *   class net, so the next room pair can't reopen the hole.
 */
import { describe, it, expect } from "vitest";
import {
  PALACE_LAYOUT,
  PALACE_DOORS,
  CREATOR_ROOM_TEMPLATE,
  registerCreatorRoomLayout,
  palaceRoomLayout,
  groundHeightAt,
  isStandable,
  roomAt,
  clampToRoom,
  pointInRect,
  resolvePalaceMove,
  HALL_ROOM_ID,
  MUSIC_HALL_ID,
  GAME_ROOMS_ID,
  CREATE_WING_ID,
  BRANDING_ATELIER_ID,
  COURTYARD_ID,
  BOARDWALK_ID,
  HEIGHTS_ID,
  type PalaceRoomLayout,
} from "./palace-layout";
import { transferNeedsReseat, TRANSFER_RESEAT_DISTANCE_M } from "./world-client";

/** roomAt fallback that no room can claim — "the plan does not
 *  claim this point" must read as a mismatch everywhere below. */
const NOWHERE = "world:__nowhere__";

const creator = registerCreatorRoomLayout("spawn-audit");
const ROOMS: PalaceRoomLayout[] = [...Object.values(PALACE_LAYOUT), creator];

/** The authored ground height under each room's spawn, measured
 *  off the shipped layout: every spawn stands on its room's floor
 *  (0) except the Boardwalk's, which materializes on the deck. */
const EXPECTED_SPAWN_GROUND: Record<string, number> = {
  [HALL_ROOM_ID]: 0,
  "world:music-hall": 0,
  [GAME_ROOMS_ID]: 0,
  [CREATE_WING_ID]: 0,
  "world:treasury": 0,
  "world:royal-court": 0,
  [BRANDING_ATELIER_ID]: 0,
  [COURTYARD_ID]: 0,
  "world:stage-grounds": 0,
  "world:listening-gardens": 0,
  "world:creation-row": 0,
  "world:ateliers": 0,
  [BOARDWALK_ID]: 0.03,
  [HEIGHTS_ID]: 0,
  [creator.id]: 0,
};

describe("authored spawns — every room, every district, the creator template", () => {
  it("the inventory is the 14 fixed rooms plus the registered creator room", () => {
    expect(ROOMS).toHaveLength(15);
    expect(palaceRoomLayout(creator.id)?.spawn).toEqual(CREATOR_ROOM_TEMPLATE.spawn);
  });

  it("every spawn stands on standable ground its own room claims", () => {
    for (const room of ROOMS) {
      const s = room.spawn;
      expect(isStandable(s.x, s.z), `${room.id} spawn standable`).toBe(true);
      expect(roomAt(s.x, s.z, NOWHERE), `${room.id} spawn claimed by its room`).toBe(room.id);
    }
  });

  it("every spawn clamps to itself — a placement never files an arrival elsewhere", () => {
    for (const room of ROOMS) {
      expect(clampToRoom(room.id, room.spawn.x, room.spawn.z), room.id).toEqual(room.spawn);
    }
  });

  it("every spawn stands at its authored ground height", () => {
    for (const room of ROOMS) {
      expect(
        groundHeightAt(room.spawn.x, room.spawn.z),
        `${room.id} spawn ground height`,
      ).toBe(EXPECTED_SPAWN_GROUND[room.id]);
    }
  });

  it("spawn-to-spawn, the closest pair still clears the reseat distance", () => {
    let min = Infinity;
    let pair: string[] = [];
    for (let i = 0; i < ROOMS.length; i++) {
      for (let j = i + 1; j < ROOMS.length; j++) {
        const a = ROOMS[i]!.spawn;
        const b = ROOMS[j]!.spawn;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < min) {
          min = d;
          pair = [ROOMS[i]!.id, ROOMS[j]!.id];
        }
      }
    }
    // A jump that starts ON a spawn always reseats on distance
    // alone — the membership half exists for the floors BETWEEN.
    expect(min).toBeGreaterThan(TRANSFER_RESEAT_DISTANCE_M);
    expect(pair.sort()).toEqual([BOARDWALK_ID, COURTYARD_ID].sort());
    expect(min).toBeCloseTo(4.7, 1);
  });
});

describe("doorways — the crossing entry path", () => {
  it("every door's apron is standable end to end, the creator arch included", () => {
    /* The portal rect is the doorway ZONE (membership + aprons),
     * drawn generously — at the five plaza gates it overlaps the
     * gate POSTS' footprints at the span's edges, and a post is a
     * real solid a walker goes around, not a floor hole. The
     * invariant is therefore two-sided: the OPENING (the span
     * clear of the post bands) is standable across the whole
     * portal depth, and every non-standable apron point is
     * confined to a post band (within 0.45 m of a span end) —
     * an obstruction mid-opening fails this loudly. */
    const POST_BAND_M = 0.45;
    const doors = [
      ...PALACE_DOORS,
      // The dynamic arch, restated from registerCreatorRoomLayout
      // (palace-layout.ts) — the template's door is module state,
      // not an export.
      {
        roomId: creator.id,
        axis: "z" as const,
        plane: CREATOR_ROOM_TEMPLATE.door.plane,
        spanMin: CREATOR_ROOM_TEMPLATE.door.spanMin,
        spanMax: CREATOR_ROOM_TEMPLATE.door.spanMax,
        portal: { minX: 8.4, maxX: 10.6, minZ: 25.55, maxZ: 26.9 },
        negRoom: COURTYARD_ID,
        posRoom: creator.id,
      },
    ];
    const inOpening: string[] = [];
    const outsideBands: string[] = [];
    for (const door of doors) {
      const { portal } = door;
      for (let x = portal.minX; x <= portal.maxX + 1e-9; x += 0.2) {
        for (let z = portal.minZ; z <= portal.maxZ + 1e-9; z += 0.2) {
          if (isStandable(x, z)) continue;
          const along = door.axis === "x" ? z : x;
          const edgeDistance = Math.min(along - door.spanMin, door.spanMax - along);
          if (edgeDistance >= POST_BAND_M) {
            inOpening.push(`${door.roomId} opening (${x.toFixed(2)},${z.toFixed(2)})`);
          } else if (edgeDistance < 0) {
            outsideBands.push(`${door.roomId} beyond span (${x.toFixed(2)},${z.toFixed(2)})`);
          }
        }
      }
    }
    expect(inOpening).toEqual([]);
    expect(outsideBands).toEqual([]);
  });

  it("a step across every door's plane enters the room on the other side — both ways", () => {
    for (const door of PALACE_DOORS) {
      const mid = (door.spanMin + door.spanMax) / 2;
      const neg =
        door.axis === "x" ? { x: door.plane - 0.35, z: mid } : { x: mid, z: door.plane - 0.35 };
      const pos =
        door.axis === "x" ? { x: door.plane + 0.35, z: mid } : { x: mid, z: door.plane + 0.35 };
      const intoNeg = resolvePalaceMove({ ...pos, room: door.posRoom }, neg.x, neg.z);
      expect(intoNeg.entered, `${door.roomId} crossing to ${door.negRoom}`).toBe(door.negRoom);
      expect(roomAt(intoNeg.x, intoNeg.z, NOWHERE)).toBe(door.negRoom);
      const intoPos = resolvePalaceMove({ ...neg, room: door.negRoom }, pos.x, pos.z);
      expect(intoPos.entered, `${door.roomId} crossing to ${door.posRoom}`).toBe(door.posRoom);
      expect(roomAt(intoPos.x, intoPos.z, NOWHERE)).toBe(door.posRoom);
      // A doorway landing filed by the room clamp (the setSpawn /
      // step-back path) stays standable and stays claimed by its
      // own room — the clamp's footprint is walk ∪ grounds, so an
      // apron landing files to the room's edge, never into another
      // room or a wall. The filing distance is bounded by the
      // apron's own geometry: 0.75 m at the side doors and the
      // back arch, and a measured 2.04 m at the two FRONT doors,
      // whose aprons stand in the hall's stage alcoves north of
      // the walk rect (z −13.5 against a walk edge of −11.6) —
      // the step-back there is a longer stride, documented here
      // and cross-referenced to the scene lane; it is never a
      // strand (the filed point stands on the hall's own floor).
      for (const [roomId, landing] of [
        [door.negRoom, intoNeg],
        [door.posRoom, intoPos],
      ] as const) {
        const filed = clampToRoom(roomId, landing.x, landing.z);
        expect(isStandable(filed.x, filed.z), `${roomId} filed landing standable`).toBe(true);
        expect(roomAt(filed.x, filed.z, NOWHERE), `${roomId} filed landing claimed`).toBe(roomId);
        expect(Math.hypot(filed.x - landing.x, filed.z - landing.z)).toBeLessThanOrEqual(2.05);
      }
    }
  });

  it("the creator arch crosses from the Courtyard into the registered room", () => {
    const inCreator = resolvePalaceMove({ x: 9.5, z: 25.9, room: COURTYARD_ID }, 9.5, 26.5);
    expect(inCreator.entered).toBe(creator.id);
    const backOut = resolvePalaceMove({ x: 9.5, z: 26.5, room: creator.id }, 9.5, 25.9);
    expect(backOut.entered).toBe(COURTYARD_ID);
  });
});

describe("the reseat rule — membership half", () => {
  it("a doorway pose past the plane is already the destination's — no reseat", () => {
    // The hall → Music Hall crossing: the pose rode with the
    // transfer, the landing is the server's clamp of it.
    const rig = { x: -14.3, z: -2 };
    expect(roomAt(rig.x, rig.z, NOWHERE)).toBe(MUSIC_HALL_ID);
    expect(transferNeedsReseat(rig, { x: -15, z: -2 }, MUSIC_HALL_ID)).toBe(false);
  });

  it("a same-room reconnect landing never reseats", () => {
    expect(transferNeedsReseat({ x: 0, z: 10.9 }, { x: 0, z: 10.4 }, HALL_ROOM_ID)).toBe(false);
  });

  it("PROVEN SEAM: the Music Hall's north floor jumping to the Game Rooms reseats", () => {
    // The strip the audit measured: standable Music Hall floor,
    // 2.25 m from the Game Rooms spawn, a wall between (there is
    // no music↔game door). Distance alone said "doorway" and left
    // the rig standing in a room the scene no longer rendered.
    const rig = { x: -15.6, z: 2.75 };
    const game = PALACE_LAYOUT[GAME_ROOMS_ID]!;
    expect(roomAt(rig.x, rig.z, NOWHERE)).toBe(MUSIC_HALL_ID);
    expect(Math.hypot(rig.x - game.spawn.x, rig.z - game.spawn.z)).toBeLessThan(
      TRANSFER_RESEAT_DISTANCE_M,
    );
    expect(transferNeedsReseat(rig, game.spawn, GAME_ROOMS_ID)).toBe(true);
  });

  it("PROVEN SEAM: the Create Wing's north floor jumping to the Branding Atelier reseats", () => {
    const rig = { x: 15.6, z: 2.75 };
    const branding = PALACE_LAYOUT[BRANDING_ATELIER_ID]!;
    expect(roomAt(rig.x, rig.z, NOWHERE)).toBe(CREATE_WING_ID);
    expect(transferNeedsReseat(rig, branding.spawn, BRANDING_ATELIER_ID)).toBe(true);
  });

  it("PROVEN SEAM: open Courtyard ground jumping to Creator Heights reseats", () => {
    const rig = { x: 12.35, z: 24.6 };
    const heights = PALACE_LAYOUT[HEIGHTS_ID]!;
    expect(roomAt(rig.x, rig.z, NOWHERE)).toBe(COURTYARD_ID);
    expect(Math.hypot(rig.x - heights.spawn.x, rig.z - heights.spawn.z)).toBeLessThan(
      TRANSFER_RESEAT_DISTANCE_M,
    );
    expect(transferNeedsReseat(rig, heights.spawn, HEIGHTS_ID)).toBe(true);
  });

  it("the class net: inside a spawn's no-reseat disc, only its own room's floor escapes reseat", () => {
    const failures: string[] = [];
    for (const dest of ROOMS) {
      const s = dest.spawn;
      for (let gx = s.x - 2.5; gx <= s.x + 2.501; gx += 0.25) {
        for (let gz = s.z - 2.5; gz <= s.z + 2.501; gz += 0.25) {
          if (Math.hypot(gx - s.x, gz - s.z) > TRANSFER_RESEAT_DISTANCE_M) continue;
          if (!isStandable(gx, gz)) continue;
          const owner = roomAt(gx, gz, NOWHERE);
          const reseat = transferNeedsReseat({ x: gx, z: gz }, s, dest.id);
          if (owner === dest.id && reseat) {
            failures.push(`${dest.id}: own floor (${gx.toFixed(2)},${gz.toFixed(2)}) reseated`);
          }
          if (owner !== dest.id && !reseat) {
            failures.push(
              `${dest.id}: foreign floor (${gx.toFixed(2)},${gz.toFixed(2)}) owned by ${owner} NOT reseated`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("portal aprons belong to the plane: points in a doorway read as the side they stand on", () => {
    // The membership truth the rule leans on — inside a portal,
    // roomAt is the plane rule, so a crossing in flight is never
    // misread as foreign floor by the room it is entering.
    for (const door of PALACE_DOORS) {
      const mid = (door.spanMin + door.spanMax) / 2;
      const negPoint =
        door.axis === "x" ? { x: door.plane - 0.1, z: mid } : { x: mid, z: door.plane - 0.1 };
      const posPoint =
        door.axis === "x" ? { x: door.plane + 0.1, z: mid } : { x: mid, z: door.plane + 0.1 };
      expect(pointInRect(negPoint.x, negPoint.z, door.portal)).toBe(true);
      expect(roomAt(negPoint.x, negPoint.z, NOWHERE)).toBe(door.negRoom);
      expect(roomAt(posPoint.x, posPoint.z, NOWHERE)).toBe(door.posRoom);
    }
  });
});
