/**
 * perf-instancing.ts — placement data for the plaza's instanced
 * kits (Overhaul Stage B, item 25). Pure data + counting (no
 * three.js), so the draw-call arithmetic is unit-testable;
 * hall-scene.ts turns these lists into InstancedMesh draws.
 *
 * INTEGRATION NOTE (Stage B merge, Oct 2026): this module shipped
 * with its own copies of every plaza placement (walls, columns,
 * gates, planters). The sibling Stage B clusters then moved the
 * placements into palace-layout.ts as the single source the
 * collision system derives from, and three of the four kits grew
 * per-instance variation (item 18), per-metre materials (item 7),
 * honest gate/marker forms (item 37) and grounded piers (item 43)
 * that one shared material/geometry cannot express. What remains
 * instanced — and it is the kit that repeats identically — is the
 * planter TROUGHS: one draw per orientation, each instance matrix
 * carrying that trough's variation jitter (rotation + scale).
 * Rim trims and crowns stay individual meshes (cloned tinted
 * materials, variant geometry). The placements below DERIVE from
 * palace-layout's PLAZA_PLANTERS — there is exactly one list.
 *
 * Draw-call accounting, by construction (one mesh = one draw call;
 * one InstancedMesh = one draw call for all its instances):
 *   planter troughs: 9 meshes → 2 draws (along-Z + along-X) = −7
 * The ladder/LOD/culling systems (items 22/23/24/99) carry the
 * larger frame savings; this module's job is the identical-kit
 * case only, stated honestly.
 */
import { PLAZA_PLANTERS } from "./palace-layout";

export interface PlanterSpot {
  x: number;
  z: number;
  alongZ: boolean;
}

/** The nine planters, from the layout's single source list. */
export const PLANTER_SPOTS: readonly PlanterSpot[] = PLAZA_PLANTERS.map((p) => ({
  x: p.x,
  z: p.z,
  alongZ: p.alongZ,
}));

/** Crown positions for a planter: two blobs at ±0.5 along its axis. */
export function planterCrowns(spot: PlanterSpot): Array<{ x: number; z: number }> {
  return [-0.5, 0.5].map((off) => ({
    x: spot.alongZ ? spot.x : spot.x + off,
    z: spot.alongZ ? spot.z + off : spot.z,
  }));
}

export const ALL_PLANTER_CROWNS: Array<{ x: number; z: number }> = PLANTER_SPOTS.flatMap(planterCrowns);

/* ── Draw-call accounting (by construction) ─────────────────────── */

export interface InstancingCounts {
  naiveMeshes: number;
  instancedDraws: number;
  saved: number;
}

export function instancingCounts(): InstancingCounts {
  const naiveMeshes = PLANTER_SPOTS.length; // one trough mesh each
  const instancedDraws = 2; // trough-along-Z + trough-along-X
  return { naiveMeshes, instancedDraws, saved: naiveMeshes - instancedDraws };
}
