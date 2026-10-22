/**
 * perf-instancing.ts — placement data for the plaza's repeated
 * static kits (Overhaul Stage B, item 25). Pure data + counting
 * (no three.js), so the draw-call arithmetic is unit-testable;
 * hall-scene.ts turns these lists into InstancedMesh draws.
 *
 * The placements are EXACTLY the positions the courtyard builder
 * has always used — instancing changes how the kits are drawn,
 * never where they stand or what they're made of (same geometry
 * dimensions, same materials, same shadow flags per part). The
 * monument is NOT here (another lane owns it) and gate headers /
 * bars / plates stay individual meshes (their structure is
 * another lane's; only the repeated post+cap kit is instanced).
 *
 * Draw-call accounting, by construction (one mesh = one draw call;
 * one InstancedMesh = one draw call for all its instances):
 *   planters:  9 troughs + 18 crowns        = 27 → 3 draws
 *              (trough-along-Z, trough-along-X, crowns)
 *   columns:   6 × (plinth + shaft + cap)   = 18 → 3 draws
 *   low walls: 5 × (wall + cap)             = 10 → 2 draws
 *   gate kits: 6 × (2 posts + 2 caps)       = 24 → 2 draws
 *   TOTAL                                   = 79 → 10 draws (−69)
 * On top of the shadow pass saving the same again for the
 * shadow-casting parts (crowns, shafts, posts).
 */

export interface PlanterSpot {
  x: number;
  z: number;
  alongZ: boolean;
}

/** The nine planters: side walls + promenade, as built today. */
export const PLANTER_SPOTS: readonly PlanterSpot[] = [
  { x: -27.3, z: 15.8, alongZ: true },
  { x: -27.3, z: 22.6, alongZ: true },
  { x: 27.3, z: 15.8, alongZ: true },
  { x: 27.3, z: 22.6, alongZ: true },
  { x: -27.3, z: 28.8, alongZ: true },
  { x: -27.3, z: 32.3, alongZ: true },
  { x: 2.2, z: 29.5, alongZ: true },
  { x: -20, z: 33.1, alongZ: false },
  { x: -8, z: 33.1, alongZ: false },
] as const;

/** Crown positions for a planter: two blobs at ±0.5 along its axis. */
export function planterCrowns(spot: PlanterSpot): Array<{ x: number; z: number }> {
  return [-0.5, 0.5].map((off) => ({
    x: spot.alongZ ? spot.x : spot.x + off,
    z: spot.alongZ ? spot.z + off : spot.z,
  }));
}

export const ALL_PLANTER_CROWNS: Array<{ x: number; z: number }> = PLANTER_SPOTS.flatMap(planterCrowns);

/** The six plaza columns (plinth + shaft + cap each). */
export const COLUMN_SPOTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -28.2, z: 12.6 },
  { x: 28.2, z: 12.6 },
  { x: -28.2, z: 33.8 },
  { x: 2.35, z: 34.0 },
  { x: -28.2, z: 23.2 },
  { x: 28.2, z: 19.2 },
] as const;

export interface LowWallRun {
  w: number;
  d: number;
  x: number;
  z: number;
}

/** The five low-wall runs (the plaza's open-side enclosure). */
export const LOW_WALL_RUNS: readonly LowWallRun[] = [
  { w: 0.35, d: 6.0, x: -28.2, z: 15.4 },
  { w: 0.35, d: 13.4, x: -28.2, z: 27.3 },
  { w: 0.35, d: 13.6, x: 28.2, z: 19.2 },
  { w: 27.1, d: 0.35, x: -14.65, z: 34.0 },
  { w: 1.25, d: 0.35, x: 1.725, z: 34.0 },
] as const;

/** The cap run for a low wall — the builder's standing rule: a
 *  thin wall (0.35) gets a 0.47 cap; a long run caps at its width. */
export function lowWallCapRun(run: LowWallRun): LowWallRun {
  return {
    w: run.w === 0.35 ? 0.47 : run.w,
    d: run.d === 0.35 ? 0.47 : run.d,
    x: run.x,
    z: run.z,
  };
}

export interface GateSpot {
  name: string;
  x: number;
  z: number;
  axis: "x" | "z";
}

/** The six district gates — only their post+cap kits instance;
 *  headers, bars and name plates stay as built today. */
export const GATE_SPOTS: readonly GateSpot[] = [
  { name: "STAGE GROUNDS", x: -28.2, z: 19.5, axis: "z" },
  { name: "THE BOARDWALK", x: 0, z: 34.0, axis: "x" },
  { name: "LISTENING GARDENS", x: -26, z: 33.8, axis: "x" },
  { name: "CREATION ROW", x: 28.2, z: 14.5, axis: "z" },
  { name: "THE ATELIERS", x: 28.2, z: 22.5, axis: "z" },
  { name: "CREATOR HEIGHTS", x: 13.5, z: 24.6, axis: "x" },
] as const;

/** Post positions for a gate: two posts at ±1.1 along its axis. */
export function gatePosts(spot: GateSpot): Array<{ x: number; z: number }> {
  return [-1.1, 1.1].map((s) => ({
    x: spot.axis === "x" ? spot.x + s : spot.x,
    z: spot.axis === "x" ? spot.z : spot.z + s,
  }));
}

export const ALL_GATE_POSTS: Array<{ x: number; z: number }> = GATE_SPOTS.flatMap(gatePosts);

/* ── Draw-call accounting (by construction) ─────────────────────── */

export interface InstancingCounts {
  naiveMeshes: number;
  instancedDraws: number;
  saved: number;
}

export function instancingCounts(): InstancingCounts {
  const planterNaive = PLANTER_SPOTS.length + ALL_PLANTER_CROWNS.length; // troughs + crowns
  const planterDraws = 3; // troughZ + troughX + crowns
  const columnNaive = COLUMN_SPOTS.length * 3; // plinth + shaft + cap
  const columnDraws = 3;
  const wallNaive = LOW_WALL_RUNS.length * 2; // wall + cap
  const wallDraws = 2;
  const gateNaive = ALL_GATE_POSTS.length * 2; // post + cap per post
  const gateDraws = 2;
  const naiveMeshes = planterNaive + columnNaive + wallNaive + gateNaive;
  const instancedDraws = planterDraws + columnDraws + wallDraws + gateDraws;
  return { naiveMeshes, instancedDraws, saved: naiveMeshes - instancedDraws };
}
