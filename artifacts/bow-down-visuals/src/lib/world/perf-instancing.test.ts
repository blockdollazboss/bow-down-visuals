/**
 * Instancing placement tests (lib/world/perf-instancing) — item 25.
 * After the Stage B integration the instanced kit is the planter
 * troughs, and their placements DERIVE from palace-layout's
 * PLAZA_PLANTERS (the single source collision also derives from) —
 * pinned here so the two can never drift. The draw-call count
 * states the composed build's saving honestly.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_PLANTER_CROWNS,
  PLANTER_SPOTS,
  instancingCounts,
  planterCrowns,
} from "./perf-instancing";
import { PLAZA_PLANTERS } from "./palace-layout";

describe("trough placements derive from the layout's single source", () => {
  it("PLANTER_SPOTS is PLAZA_PLANTERS, position for position", () => {
    expect(PLANTER_SPOTS).toHaveLength(PLAZA_PLANTERS.length);
    expect(PLANTER_SPOTS).toEqual(
      PLAZA_PLANTERS.map((p) => ({ x: p.x, z: p.z, alongZ: p.alongZ })),
    );
  });
  it("nine planters: seven along-Z, two along-X on the promenade", () => {
    expect(PLANTER_SPOTS).toHaveLength(9);
    expect(PLANTER_SPOTS.filter((p) => p.alongZ)).toHaveLength(7);
    expect(PLANTER_SPOTS.filter((p) => !p.alongZ)).toHaveLength(2);
    expect(PLANTER_SPOTS).toContainEqual({ x: 2.2, z: 29.5, alongZ: true });
    expect(PLANTER_SPOTS).toContainEqual({ x: -20, z: 33.1, alongZ: false });
  });
  it("each planter grows two crowns at ±0.5 along its axis", () => {
    expect(planterCrowns({ x: -27.3, z: 15.8, alongZ: true })).toEqual([
      { x: -27.3, z: 15.3 },
      { x: -27.3, z: 16.3 },
    ]);
    expect(planterCrowns({ x: -20, z: 33.1, alongZ: false })).toEqual([
      { x: -20.5, z: 33.1 },
      { x: -19.5, z: 33.1 },
    ]);
    expect(ALL_PLANTER_CROWNS).toHaveLength(18);
  });
});

describe("draw-call accounting (by construction)", () => {
  it("9 trough meshes collapse to 2 instanced draws (−7)", () => {
    const c = instancingCounts();
    expect(c.naiveMeshes).toBe(9);
    expect(c.instancedDraws).toBe(2);
    expect(c.saved).toBe(7);
  });
});
