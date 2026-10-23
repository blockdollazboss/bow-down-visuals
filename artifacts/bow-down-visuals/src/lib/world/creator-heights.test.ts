/**
 * Creator Heights (board item 36) — the sixth built district,
 * pinned.
 *
 * Creator Heights was a FREESTANDING MARKER on the plaza floor
 * at (13.5, 24.6) — a named district with nothing behind it.
 * This batch reclassifies the marker to an OPEN gate on its
 * exact spot and builds the residential quarter it leads to.
 * The quarter's geography has one honest complication the other
 * districts did not face, stated plainly in creator-heights.ts:
 * every outward line from the marker is already built over
 * (hall north, Row/Ateliers east, Creator Rooms + Boardwalk
 * south, Stage/Gardens west), so the quarter stands on the
 * plaza's own north-east quadrant as a walled enclave, behind
 * its own new west wall on the marker's line. The laws pinned
 * here:
 *   - the district is a real palace room with exactly one door —
 *     the marker's gate — whose plane/span are the gate gap's
 *     own numbers (district-gates' DISTRICT_GATE_GAPS);
 *   - the passage walks END TO END with no loading/teleport: a
 *     step sequence crosses the plaza, the portal and the wall
 *     plane into the Heights (membership flips at the plane),
 *     rides the gate walkway onto the residents' court, and
 *     back again;
 *   - the floor-plan partition holds: the Heights' walk rect
 *     overlaps NO other room's walk rect or grounds, and the
 *     plaza keeps its own promises around the enclave — the
 *     Creation Row gate still walks across the north-east lane,
 *     and the south-east yard (the Ateliers approach) still
 *     walks by the south bridge lane;
 *   - every solid the scene builds from creator-heights.ts
 *     (walls, piers, front posts and doors, terraces, benches,
 *     planters, lamps, poles) is honestly blocked from the same
 *     data;
 *   - the working ground stays walkable: the spawn, the gate
 *     walkway, the residents' court, the Heights Slate station
 *     point, the residence fronts' open mouths;
 *   - the ground is the OUTDOOR paving system, not marble:
 *     whole-tile slabs inside the interior — and the C2 backdrop
 *     ring stands clear of the enclave it now surrounds on the
 *     plaza.
 */
import { describe, it, expect } from "vitest";
import {
  ATELIERS_ID,
  COURTYARD_ID,
  CREATION_ROW_ID,
  HEIGHTS_ID,
  PALACE_DOORS,
  PALACE_LAYOUT,
  cameraPointFree,
  isWalkable,
  pointInRect,
  resolvePalaceMove,
} from "./palace-layout";
import { DISTRICT_GATE_GAPS } from "./district-gates";
import {
  FRONT_KIT,
  HEIGHTS_BENCHES,
  HEIGHTS_BLOCKED,
  HEIGHTS_DESK,
  HEIGHTS_FRONT_DOORS,
  HEIGHTS_FRONT_POSTS,
  HEIGHTS_FRONTS,
  HEIGHTS_INTERIOR,
  HEIGHTS_LAMPS,
  HEIGHTS_PIERS,
  HEIGHTS_PLANTERS,
  HEIGHTS_PLANTER_CROWNS,
  HEIGHTS_BANNER_POLES,
  HEIGHTS_PLATE,
  HEIGHTS_PLATES,
  HEIGHTS_RUNNER,
  HEIGHTS_TALL_BLOCKED,
  HEIGHTS_TERRACES,
  HEIGHTS_TERRACE_CROWNS,
  HEIGHTS_TERRACE_STEPS,
  HEIGHTS_THRESHOLD,
  HEIGHTS_WALK,
  HEIGHTS_WALL_RUNS,
  heightsPlateLine,
  heightsPlateLines,
  heightsRosterFromDirectory,
  heightsRosterSignature,
} from "./creator-heights";
import { BACKDROP_GARDENS, backdropGroundRects, pavingSlabsFor } from "./palace-grounds";

const room = PALACE_LAYOUT[HEIGHTS_ID]!;

const overlaps = (
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe("Creator Heights — the room and its door (item 36)", () => {
  it("is a registered palace room named for the district", () => {
    expect(room).toBeDefined();
    expect(room.name).toBe("Creator Heights");
    expect(room.walk).toEqual(HEIGHTS_WALK);
    expect(room.interior).toEqual(HEIGHTS_INTERIOR);
    expect(room.spawn).toEqual({ x: 14.6, z: 24.6 });
  });

  it("has exactly one door: the marker's gate, at the gate gap's own numbers", () => {
    const doors = PALACE_DOORS.filter((d) => d.roomId === HEIGHTS_ID);
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    const gap = DISTRICT_GATE_GAPS["CREATOR HEIGHTS"]!;
    expect(door.axis).toBe("x");
    expect(door.plane).toBe(gap.at);
    expect(door.spanMin).toBe(gap.min);
    expect(door.spanMax).toBe(gap.max);
    expect(door.negRoom).toBe(COURTYARD_ID);
    expect(door.posRoom).toBe(HEIGHTS_ID);
    /* The portal covers the wall band with aprons on both faces,
     * and its span stops inside the gate posts' footprints. */
    expect(door.portal.minX).toBeLessThan(door.plane);
    expect(door.portal.maxX).toBeGreaterThan(door.plane);
    expect(door.portal.minZ).toBeGreaterThan(gap.min);
    expect(door.portal.maxZ).toBeLessThan(gap.max);
  });

  it("keeps the floor-plan partition: its walk rect overlaps no other room's walk or grounds", () => {
    for (const [id, other] of Object.entries(PALACE_LAYOUT)) {
      if (id === HEIGHTS_ID) continue;
      expect(overlaps(HEIGHTS_WALK, other.walk), id).toBe(false);
      for (const g of other.grounds ?? []) {
        expect(overlaps(HEIGHTS_WALK, g), `${id} grounds`).toBe(false);
      }
    }
    /* The enclave's east wall is the plaza's east wall, shared:
     * the walk stops at its face with the house clearance. */
    expect(HEIGHTS_WALK.maxX).toBe(27.85);
    expect(HEIGHTS_INTERIOR.maxX).toBe(28.2);
  });

  it("walks from the plaza through the gate, along the walkway, onto the residents' court — no teleport, membership flips at the wall plane", () => {
    let pos = { x: 11.5, z: 24.6, room: COURTYARD_ID };
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const step = resolvePalaceMove(pos, pos.x + 0.6, pos.z);
      expect(step.x).toBeGreaterThan(pos.x); // every step lands — the way is never blocked
      pos = { x: step.x, z: step.z, room: step.room };
      if (step.entered) seen.push(step.entered);
    }
    expect(seen).toEqual([HEIGHTS_ID]);
    expect(pos.room).toBe(HEIGHTS_ID);
    expect(pos.x).toBeGreaterThan(14.6); // past the spawn, inside the gate
    /* East along the gate walkway, north onto the court, east
     * to the Heights Slate — every step landing. */
    let walk = { x: pos.x, z: pos.z, room: pos.room };
    for (let i = 0; i < 6; i++) {
      const step = resolvePalaceMove(walk, walk.x + 0.6, walk.z);
      expect(step.x).toBeGreaterThan(walk.x);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.x).toBeGreaterThan(18.0); // the walkway's run, clear of the terraces
    for (let i = 0; i < 7; i++) {
      const step = resolvePalaceMove(walk, walk.x, walk.z - 0.6);
      expect(step.z).toBeLessThan(walk.z);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.z).toBeLessThan(21.0); // the residents' court
    for (let i = 0; i < 4; i++) {
      const step = resolvePalaceMove(walk, walk.x + 0.6, walk.z);
      expect(step.x).toBeGreaterThan(walk.x);
      walk = { x: step.x, z: step.z, room: step.room };
    }
    expect(walk.room).toBe(HEIGHTS_ID);
    expect(isWalkable(20.85, 20.8)).toBe(true); // the Slate's point, reached
  });

  it("walks back west through the gate onto the plaza", () => {
    const back = resolvePalaceMove({ x: 13.9, z: 24.6, room: HEIGHTS_ID }, 13.3, 24.6);
    expect(back.room).toBe(COURTYARD_ID);
    expect(back.entered).toBe(COURTYARD_ID);
  });

  it("the wall beside the gate stays solid, and the gate posts are solid — the passage is between them", () => {
    expect(isWalkable(13.5, 20.0)).toBe(false); // the west wall's north run
    expect(isWalkable(13.5, 17.0)).toBe(false);
    const bonk = resolvePalaceMove({ x: 12.9, z: 20.0, room: COURTYARD_ID }, 13.7, 20.0);
    expect(bonk.x).toBe(12.9);
    expect(bonk.entered).toBeNull();
    expect(isWalkable(13.5, 23.6)).toBe(false); // the north post
    expect(isWalkable(13.5, 25.6)).toBe(false); // the south post
    /* The gap itself, once a signpost's plinth, now walks. */
    expect(isWalkable(13.5, 24.6)).toBe(true);
  });

  it("the plaza keeps its promises around the enclave: the Row gate still walks across the north-east lane", () => {
    let pos = { x: 13.0, z: 14.5, room: COURTYARD_ID };
    const seen: string[] = [];
    for (let i = 0; i < 26; i++) {
      const step = resolvePalaceMove(pos, pos.x + 0.6, pos.z);
      expect(step.x).toBeGreaterThan(pos.x);
      pos = { x: step.x, z: step.z, room: step.room };
      if (step.entered) seen.push(step.entered);
    }
    expect(seen).toEqual([CREATION_ROW_ID]);
    expect(pos.room).toBe(CREATION_ROW_ID);
    /* And the enclave's north wall is solid from the lane: a
     * step south off the lane stops at it. */
    expect(isWalkable(20.85, 15.9)).toBe(false);
    const bonk = resolvePalaceMove({ x: 20.85, z: 15.4, room: COURTYARD_ID }, 20.85, 16.2);
    expect(bonk.z).toBe(15.4);
  });

  it("the plaza keeps its promises around the enclave: the south-east yard still walks by the south bridge lane", () => {
    /* South off the main walk into the bridge lane's west
     * band, east along it under the enclave's south wall, and
     * into the yard — every step plaza ground, no room line
     * crossed. The east band runs wholly south of the enclave's
     * wall and the gate's south post, so no step stands inside
     * either. */
    let pos = { x: 12.9, z: 25.65, room: COURTYARD_ID };
    const jog = resolvePalaceMove(pos, 12.9, 25.97);
    expect(jog.z).toBeCloseTo(25.97);
    expect(jog.room).toBe(COURTYARD_ID);
    pos = { x: jog.x, z: jog.z, room: jog.room };
    for (let i = 0; i < 11; i++) {
      const step = resolvePalaceMove(pos, pos.x + 0.55, pos.z);
      expect(step.x).toBeGreaterThan(pos.x);
      pos = { x: step.x, z: step.z, room: step.room };
    }
    expect(pos.x).toBeGreaterThan(16.6); // the yard's west edge
    expect(pos.room).toBe(COURTYARD_ID);
    const intoYard = resolvePalaceMove(pos, pos.x, 26.6);
    expect(intoYard.z).toBeCloseTo(26.6);
    expect(intoYard.room).toBe(COURTYARD_ID);
    expect(PALACE_LAYOUT[ATELIERS_ID]).toBeDefined();
    /* The enclave's south wall is solid from the lane too. */
    expect(isWalkable(20.85, 25.7)).toBe(false);
  });

  it("the shared boundary stays coherent: the plaza's east wall is solid from the Heights side", () => {
    expect(isWalkable(28.2, 20.8)).toBe(false);
    const out = resolvePalaceMove({ x: 27.5, z: 20.8, room: HEIGHTS_ID }, 28.4, 20.8);
    expect(out.x).toBe(27.5);
    expect(out.entered).toBeNull();
  });
});

describe("Creator Heights — honest collision (item 36)", () => {
  it("the room's blocked list is the derived HEIGHTS_BLOCKED, and its tall list is a subset", () => {
    expect(room.blocked).toEqual([...HEIGHTS_BLOCKED]);
    expect(room.camBlocked).toEqual([...HEIGHTS_TALL_BLOCKED]);
    for (const b of HEIGHTS_TALL_BLOCKED) expect(HEIGHTS_BLOCKED).toContainEqual(b);
  });

  it("every built solid's centre is unwalkable", () => {
    const centres: Array<[string, number, number]> = [
      ...HEIGHTS_FRONT_POSTS.map((p, i) => [`front post ${i}`, p.x, p.z] as [string, number, number]),
      ...HEIGHTS_FRONT_DOORS.map((b, i) => [`front door ${i}`, b.cx, b.cz] as [string, number, number]),
      ...HEIGHTS_TERRACES.map((b, i) => [`terrace ${i}`, b.cx, b.cz] as [string, number, number]),
      ...HEIGHTS_BENCHES.map((b, i) => [`bench ${i}`, b.x, b.z] as [string, number, number]),
      ...HEIGHTS_PLANTERS.map((p, i) => [`planter ${i}`, p.cx, p.cz] as [string, number, number]),
      ...HEIGHTS_LAMPS.map((l, i) => [`lamp ${i}`, l.x, l.z] as [string, number, number]),
      ...HEIGHTS_BANNER_POLES.map((p, i) => [`banner pole ${i}`, p.x, p.z] as [string, number, number]),
      ...HEIGHTS_PIERS.map((p, i) => [`pier ${i}`, p.x, p.z] as [string, number, number]),
      ...HEIGHTS_WALL_RUNS.map((r, i) => [`wall run ${i}`, r.x, r.z] as [string, number, number]),
    ];
    for (const [name, x, z] of centres) {
      expect(isWalkable(x, z), name).toBe(false);
    }
  });

  it("the quarter's working ground stays walkable", () => {
    expect(isWalkable(14.6, 24.6)).toBe(true); // the spawn, inside the gate
    expect(isWalkable(20.85, 20.8)).toBe(true); // the Heights Slate station point
    expect(isWalkable(16.0, 24.6)).toBe(true); // the gate walkway
    expect(isWalkable(17.3, 17.6)).toBe(true); // a residence front's open mouth
    expect(isWalkable(24.4, 17.6)).toBe(true); // the east front's open mouth
    expect(isWalkable(27.0, 20.8)).toBe(true); // the court's east reach
    expect(isWalkable(20.85, 21.8)).toBe(true); // the court's heart, south of the Slate
  });

  it("the terraces' steps stand inside their blocked footprints — ceremony, never a climb", () => {
    HEIGHTS_TERRACE_STEPS.forEach((s, i) => {
      const t = HEIGHTS_TERRACES[i]!;
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(t.cx - t.w / 2);
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(t.cx + t.w / 2);
      expect(s.cz - s.d / 2).toBeGreaterThanOrEqual(t.cz - t.d / 2);
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(t.cz + t.d / 2);
    });
  });

  it("the camera keeps off the tall solids and roams the open court", () => {
    expect(cameraPointFree(HEIGHTS_ID, HEIGHTS_PIERS[0]!.x, HEIGHTS_PIERS[0]!.z)).toBe(false);
    expect(cameraPointFree(HEIGHTS_ID, HEIGHTS_BANNER_POLES[0]!.x, HEIGHTS_BANNER_POLES[0]!.z)).toBe(false);
    expect(cameraPointFree(HEIGHTS_ID, HEIGHTS_FRONT_POSTS[0]!.x, HEIGHTS_FRONT_POSTS[0]!.z)).toBe(false);
    expect(cameraPointFree(HEIGHTS_ID, 20.85, 20.8)).toBe(true);
    expect(cameraPointFree(HEIGHTS_ID, 14.6, 24.6)).toBe(true);
  });
});

describe("Creator Heights — Stack-100 #2 finishing (items 20–26)", () => {
  it("item 22 verified: the court already carries benches and lamps, built and blocked", () => {
    expect(HEIGHTS_BENCHES.length).toBeGreaterThanOrEqual(3);
    expect(HEIGHTS_LAMPS.length).toBeGreaterThanOrEqual(4);
  });

  it("item 20: one roster plate per front, centred over its door, above the door head and under the canopy", () => {
    expect(HEIGHTS_PLATES).toHaveLength(HEIGHTS_FRONTS.length);
    HEIGHTS_PLATES.forEach((p, i) => {
      const door = HEIGHTS_FRONT_DOORS[i]!;
      expect(p.x).toBe(door.cx);
      expect(p.z).toBeGreaterThan(door.cz);
      expect(HEIGHTS_PLATE.y - HEIGHTS_PLATE.h / 2).toBeGreaterThanOrEqual(FRONT_KIT.doorH);
      expect(HEIGHTS_PLATE.y + HEIGHTS_PLATE.h / 2).toBeLessThanOrEqual(FRONT_KIT.canopyY - 0.04);
    });
  });

  it("item 20: plate lines letter real names, VACANT when a front has no resident, trimmed to the plate", () => {
    expect(heightsPlateLines([])).toEqual(["VACANT", "VACANT", "VACANT"]);
    expect(heightsPlateLines(["Ada Lovelace"])).toEqual(["Ada Lovelace", "VACANT", "VACANT"]);
    expect(heightsPlateLine(["  Grace   Hopper "], 0)).toBe("Grace Hopper");
    expect(heightsPlateLine(["Averyveryverylongname"], 0)).toHaveLength(18);
    expect(heightsPlateLine(["A", "B", "C", "D"], 2)).toBe("C");
    expect(heightsRosterSignature(["Ada"])).not.toBe(heightsRosterSignature(["Grace"]));
    expect(heightsRosterSignature(["Ada"])).toBe(heightsRosterSignature(["Ada"]));
  });

  it("item 20: the roster comes from the directory's Heights entry — the monument's own read", () => {
    const directory = [
      { id: "world:courtyard", members: ["Someone Else"] },
      { id: HEIGHTS_ID, members: ["Ada Lovelace", "Grace Hopper"] },
    ];
    expect(heightsRosterFromDirectory(directory, HEIGHTS_ID)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(heightsRosterFromDirectory([], HEIGHTS_ID)).toEqual([]);
    expect(heightsRosterFromDirectory(directory, "world:nowhere")).toEqual([]);
  });

  it("item 21: the front desk and its chair are solid from the same data; the dressing rides the counter", () => {
    expect(isWalkable(HEIGHTS_DESK.cx, HEIGHTS_DESK.cz)).toBe(false);
    expect(isWalkable(HEIGHTS_DESK.chair.x, HEIGHTS_DESK.chair.z)).toBe(false);
    for (const dx of [HEIGHTS_DESK.bellDx, HEIGHTS_DESK.lampDx, HEIGHTS_DESK.papersDx]) {
      expect(Math.abs(dx)).toBeLessThan(HEIGHTS_DESK.w / 2);
    }
    /* The desk keeps the court's working ground open. */
    expect(isWalkable(20.85, 20.8)).toBe(true); // the Slate
    expect(isWalkable(20.85, 21.8)).toBe(true); // the court's heart
  });

  it("item 23: wall-bay planters complete the circuit — a bed on the east wall's bays too, crowns on beds", () => {
    expect(HEIGHTS_PLANTERS.length).toBeGreaterThanOrEqual(4);
    const eastBeds = HEIGHTS_PLANTERS.filter((p) => p.cx > 27);
    expect(eastBeds.length).toBeGreaterThanOrEqual(2);
    for (const b of eastBeds) expect(isWalkable(b.cx, b.cz)).toBe(false);
  });

  it("items 25–26: the runner and the arrival threshold are flat inlay — the gate passage still walks", () => {
    expect(HEIGHTS_RUNNER.cz).toBe(24.6);
    expect(isWalkable(HEIGHTS_THRESHOLD.band.x, HEIGHTS_THRESHOLD.band.z)).toBe(true);
    expect(isWalkable(16.0, 24.6)).toBe(true); // on the runner, on the walkway
    for (const r of HEIGHTS_BLOCKED) {
      const isBand = Math.abs(r.minX - (HEIGHTS_THRESHOLD.band.x - HEIGHTS_THRESHOLD.band.w / 2)) < 1e-9
        && Math.abs(r.minZ - (HEIGHTS_THRESHOLD.band.z - HEIGHTS_THRESHOLD.band.d / 2)) < 1e-9;
      expect(isBand).toBe(false);
    }
  });
});

describe("Creator Heights — the ground and the backdrop (item 36)", () => {
  it("the ground takes whole paving slabs, all inside the interior", () => {
    const slabs = pavingSlabsFor(HEIGHTS_INTERIOR);
    expect(slabs.length).toBeGreaterThan(0);
    for (const s of slabs) {
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(HEIGHTS_INTERIOR.minX - 1e-9);
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(HEIGHTS_INTERIOR.maxX + 1e-9);
      expect(s.cz - s.d / 2).toBeGreaterThanOrEqual(HEIGHTS_INTERIOR.minZ - 1e-9);
      expect(s.cz + s.d / 2).toBeLessThanOrEqual(HEIGHTS_INTERIOR.maxZ + 1e-9);
    }
  });

  it("every planter and terrace crown stands on its bed or terrace", () => {
    for (const c of HEIGHTS_PLANTER_CROWNS) {
      const onBed = HEIGHTS_PLANTERS.some((p) =>
        pointInRect(c.x, c.z, {
          minX: p.cx - p.w / 2, maxX: p.cx + p.w / 2,
          minZ: p.cz - p.d / 2, maxZ: p.cz + p.d / 2,
        }));
      expect(onBed, JSON.stringify(c)).toBe(true);
    }
    for (const c of HEIGHTS_TERRACE_CROWNS) {
      const onTop = HEIGHTS_TERRACES.some((t) =>
        pointInRect(c.x, c.z, {
          minX: t.cx - t.w / 2, maxX: t.cx + t.w / 2,
          minZ: t.cz - t.d / 2, maxZ: t.cz + t.d / 2,
        }));
      expect(onTop, JSON.stringify(c)).toBe(true);
    }
  });

  it("the residence fronts stand inside the interior, their doors on the north line", () => {
    for (const f of HEIGHTS_FRONTS) {
      expect(f.x - FRONT_KIT.postDx).toBeGreaterThan(HEIGHTS_INTERIOR.minX);
      expect(f.x + FRONT_KIT.postDx).toBeLessThan(HEIGHTS_INTERIOR.maxX);
      expect(f.z - FRONT_KIT.postDz).toBeGreaterThan(HEIGHTS_INTERIOR.minZ);
    }
    for (const d of HEIGHTS_FRONT_DOORS) {
      expect(d.cz).toBeGreaterThan(HEIGHTS_INTERIOR.minZ);
      expect(d.cz).toBeLessThan(HEIGHTS_WALK.minZ + 1);
    }
  });

  it("the C2 backdrop ring stands clear of the enclave — it rings the plaza the enclave stands in", () => {
    for (const r of backdropGroundRects()) {
      expect(overlaps(r, HEIGHTS_INTERIOR), JSON.stringify(r)).toBe(false);
      expect(overlaps(r, HEIGHTS_WALK), JSON.stringify(r)).toBe(false);
    }
    /* No mound moved for this district: the enclave stands
     * inside the plaza the ring already rings. */
    expect(BACKDROP_GARDENS).toContainEqual({ x: 68, z: 14, r: 7.5, h: 3.6 });
    expect(BACKDROP_GARDENS).toContainEqual({ x: 20, z: 68, r: 8, h: 3.4 });
  });
});
