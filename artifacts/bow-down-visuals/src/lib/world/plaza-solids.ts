/**
 * plaza-solids.ts — the King's Plaza's named LANDMARKS (Stack-100
 * #2 add-on: the plaza-solids build that un-parks World-100 items
 * 40 and 42–44).
 *
 * The facet audits named three landmarks the plaza's collision
 * spec always assumed but the scene never built: the two marble
 * LIONS, the FOUNTAIN DAMS in the pool, and the COMPASS ROSE set
 * into the paving. Until this module they were walk-through
 * ghosts — worse, they did not exist at all, so the items that
 * named them (the fence kit's collision half, PL-2 plaza props,
 * PL-3 dam caps, PL-4 rose relief) parked rather than lie. This
 * module is the data-first home the palace always uses: the
 * placement lives HERE, the scene (hall-scene's buildPlazaLife)
 * builds the meshes from it, and the collision rectangles are
 * DERIVED from the same numbers in the same commit — a landmark
 * can never drift off its own shadow.
 *
 * PLACEMENTS (the audits named the landmarks, not their posts —
 * each post below is the plaza's own symmetry, and each was
 * swept against every shipped pin before it was written down):
 *
 * - THE LIONS flank the palace façade's ceremonial approach at
 *   (±6.05, 14.6). The hall steps run x ±(2.1..5.6) at this
 *   depth and the great lawns open at |x| 6.5 — the slots
 *   BETWEEN the step platforms and the lawn edges are the
 *   guardians' posts, facing south over the plaza they guard.
 *   (The monument's flanks were swept first and are provably
 *   full: its braziers, planters and the pinned bypass points
 *   at (±2.6, 19.7) leave no legal ground there.)
 * - THE COMPASS ROSE sits at the heart of the south-east yard
 *   (22.2, 29.75 — the yard ground rect centres at (22.225,
 *   29.75)): the one plaza court with no monument of its own,
 *   on the walk between the Creator Rooms bridge and the
 *   Ateliers gate. It is a RELIEF (item 44): a low marble disc
 *   whose raised rim stands proud of the paving — solid at its
 *   rim, so its whole disc joins the blocked spec (item 42).
 * - THE FOUNTAIN DAMS stand in the pool at its third-points
 *   (item 43): two capped weir walls running rim to rim across
 *   the water, dividing it into three basins the fountain's own
 *   basin commands. Their collision is their own honest
 *   footprint INSIDE the pool's blocked rectangle — the pool
 *   was already solid; the dams make the waterworks real, and
 *   their rects let the spec name them.
 *
 * Heights stay under the camera's ride line (2.45 m): the lions
 * top out at 1.62 m, the rose's rim at 0.24 m, the dam caps at
 * 0.5 m — so NONE of these joins PLAZA_TALL_BLOCKED; the camera
 * passes over them as it passes over the braziers and benches.
 */
import { POOL } from "./plaza-life";
import type { PalaceRect } from "./palace-layout";

const rectAround = (x: number, z: number, halfX: number, halfZ: number): PalaceRect => ({
  minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ,
});

/* ── The lions ────────────────────────────────────────────────
 * A seated marble lion on a stone plinth, gold-collared: haunches
 * and chest masses, straight front legs with paws forward, a
 * full mane, head up, facing the plaza. Both lions face SOUTH
 * (+z, rotY 0): they watch the court they guard, backs to the
 * façade. The plinth footprint IS the blocked footprint. */
export interface PlazaLion {
  x: number;
  z: number;
  /** Facing: 0 looks south (+z), toward arriving walkers. */
  rotY: number;
}

export const PLAZA_LIONS: readonly PlazaLion[] = [
  { x: -6.05, z: 14.6, rotY: 0 },
  { x: 6.05, z: 14.6, rotY: 0 },
];

export const LION = {
  /** The blocked footprint is the plinth's own plan. */
  blockHalfX: 0.44,
  blockHalfZ: 0.78,
  plinthW: 0.88,
  plinthD: 1.56,
  plinthH: 0.35,
  /** The mane's top — the whole statue's height. */
  topY: 1.62,
} as const;

/* ── The compass rose ─────────────────────────────────────────
 * A relief medallion set into the yard's paving: a marble base
 * disc, a raised gold rim ring standing proud of the floor, a
 * gold ring inlay, and an eight-point star (long gold cardinals,
 * short dark-marble diagonals) under a gold hub. The rim is the
 * relief item 44 asked for — and because the rim stands proud,
 * the whole disc is a solid a walker rounds, never crosses. */
export const COMPASS_ROSE = {
  cx: 22.2,
  cz: 29.75,
  /** Outer radius — also the blocked half-extent. */
  outerR: 1.7,
  baseTopY: 0.12,
  rimR: 1.56,
  rimTube: 0.08,
  /** The rim's top — the relief's proud height. */
  rimTopY: 0.24,
  ringInnerR: 1.28,
  ringOuterR: 1.44,
  /** The star points' reach from the centre. */
  starR: 1.18,
  /** The star inlay's relief height (proud of the disc by ~6 cm). */
  starTopY: 0.18,
  hubR: 0.3,
  hubTopY: 0.22,
} as const;

export const COMPASS_ROSE_BLOCKED: PalaceRect = rectAround(
  COMPASS_ROSE.cx, COMPASS_ROSE.cz, COMPASS_ROSE.outerR, COMPASS_ROSE.outerR,
);

/* ── The fountain dams ────────────────────────────────────────
 * Two weir walls across the pool at its third-points. Each dam:
 * a stone wall running rim to rim across the water, a gold cap
 * standing proud of the waterline (item 43's dam caps — the tops
 * read as bridges, so the caps are what the eye lands on), and
 * a falling sheet on each face, breathing with the pool's own
 * water entry (the scene shares the fountain fall's material —
 * ONE water model, items 5–7, no second registration). */
export interface PlazaDam {
  x: number;
  z: number;
}

export const PLAZA_DAMS: readonly PlazaDam[] = [
  { x: POOL.cx - POOL.w / 6, z: POOL.cz },
  { x: POOL.cx + POOL.w / 6, z: POOL.cz },
];

export const DAM = {
  thickness: 0.55,
  /** Rim inner face to rim inner face: the water's own span. */
  spanD: POOL.d - POOL.rimLip * 2,
  /** The cap's top — proud of the rim (0.34) and the water (0.26). */
  capTopY: 0.5,
  capLip: 0.06,
  blockHalfX: 0.275,
  blockHalfZ: (POOL.d - POOL.rimLip * 2) / 2,
} as const;

export const PLAZA_DAMS_BLOCKED: readonly PalaceRect[] = PLAZA_DAMS.map((d) =>
  rectAround(d.x, d.z, DAM.blockHalfX, DAM.blockHalfZ),
);

/* ── The aggregate the layout reads ───────────────────────────
 * palace-layout folds this into PLAZA_BLOCKED beside
 * PLAZA_LIFE_BLOCKED. The dams' rects live inside the pool's
 * blocked rectangle by construction (the one deliberate overlap
 * in the plaza's spec — a named sub-solid of an already-solid
 * body of water); the lions and the rose overlap NOTHING. */
export const PLAZA_SOLIDS_BLOCKED: readonly PalaceRect[] = [
  ...PLAZA_LIONS.map((l) => rectAround(l.x, l.z, LION.blockHalfX, LION.blockHalfZ)),
  COMPASS_ROSE_BLOCKED,
  ...PLAZA_DAMS_BLOCKED,
];
