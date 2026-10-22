/**
 * Instancing placement tests (lib/world/perf-instancing) — item 25.
 * The instanced kits must stand EXACTLY where the per-mesh builder
 * put them (appearance is other lanes' — only the draw changes),
 * and the by-construction draw-call count must show the saving.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_GATE_POSTS,
  ALL_PLANTER_CROWNS,
  COLUMN_SPOTS,
  GATE_SPOTS,
  LOW_WALL_RUNS,
  PLANTER_SPOTS,
  gatePosts,
  instancingCounts,
  lowWallCapRun,
  planterCrowns,
} from "./perf-instancing";

describe("placements match the shipped courtyard build", () => {
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
  it("six columns at the wall turns and mid-runs", () => {
    expect(COLUMN_SPOTS).toHaveLength(6);
    expect(COLUMN_SPOTS).toContainEqual({ x: -28.2, z: 12.6 });
    expect(COLUMN_SPOTS).toContainEqual({ x: 2.35, z: 34.0 });
  });
  it("five low-wall runs with the standing cap rule", () => {
    expect(LOW_WALL_RUNS).toHaveLength(5);
    expect(lowWallCapRun({ w: 0.35, d: 6.0, x: -28.2, z: 15.4 })).toEqual({ w: 0.47, d: 6.0, x: -28.2, z: 15.4 });
    expect(lowWallCapRun({ w: 27.1, d: 0.35, x: -14.65, z: 34.0 })).toEqual({ w: 27.1, d: 0.47, x: -14.65, z: 34.0 });
  });
  it("six gates, two posts each at ±1.1 along their axis", () => {
    expect(GATE_SPOTS).toHaveLength(6);
    expect(gatePosts({ name: "X", x: 0, z: 34.0, axis: "x" })).toEqual([
      { x: -1.1, z: 34.0 },
      { x: 1.1, z: 34.0 },
    ]);
    expect(gatePosts({ name: "X", x: -28.2, z: 19.5, axis: "z" })).toEqual([
      { x: -28.2, z: 18.4 },
      { x: -28.2, z: 20.6 },
    ]);
    expect(ALL_GATE_POSTS).toHaveLength(12);
    expect(GATE_SPOTS.map((g) => g.name)).toContain("CREATOR HEIGHTS");
  });
});

describe("draw-call accounting (by construction)", () => {
  it("79 naive meshes collapse to 10 instanced draws (−69)", () => {
    const c = instancingCounts();
    expect(c.naiveMeshes).toBe(79);
    expect(c.instancedDraws).toBe(10);
    expect(c.saved).toBe(69);
  });
});
