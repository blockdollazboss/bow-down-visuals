/**
 * listening-gardens.ts — the LISTENING GARDENS district, as pure
 * placement data (Open World Overhaul, Stage C batch C5: board
 * item 32).
 *
 * Until this batch the Listening Gardens were a MARKER — a
 * signpost at (−26, 33.8) on the promenade, a named district with
 * nothing behind it. This batch builds the real gardens quarter
 * the marker always promised, following the Stage Grounds (item
 * 31) pattern exactly: a real outdoor quarter SOUTH of the
 * promenade beyond the south wall, entered through a REAL new
 * gap in that wall on the marker's own line (x −26) — the marker
 * is reclassified to an OPEN gate (district-gates.ts +
 * palace-layout's PLAZA_GATES, in agreement) and the gap becomes
 * a true passage into a new palace room
 * (`world:listening-gardens` in palace-layout, mirrored
 * server-side in world-palace.ts).
 *
 * The gardens are a look/listen quarter: quiet, green, furnished
 * for sitting. Lawns and a parterre around a narrow reflecting
 * rill, hedged listening nooks with benches on both sides, a
 * small open pavilion at the south end, lantern standards, banner
 * poles, planting crowns with item-18 variation — and ONE
 * station, the Gardens Slate, on the Kingdom Board panel pattern
 * like the Stage Bill (the registry law: one station per
 * district, no new verbs, guests included).
 *
 * The house laws this module follows (stage-grounds /
 * palace-grounds / plaza-life):
 *   1. Every SOLID is registered as a blocked rect in
 *      palace-layout DERIVED from this same data (GARDENS_BLOCKED
 *      below) — a visible body and its collision can never drift.
 *   2. The ground wears the OUTDOOR system: the look's paving at
 *      whole-tile slabs (palace-grounds' pavingSlabsFor over the
 *      district floor rect) and a real lawn panel for the
 *      parterre — never interior marble. The marble survives
 *      only as the entry path's accent, exactly as on the plaza.
 *   3. NO new real lights. The quarter's lantern standards glow
 *      by emissive glass + the item-27 lantern-glow sprites
 *      after dark, inside the ladder's existing budget.
 *   4. Repeated pieces are placed as lists so the scene instances
 *      them (hedge runs, bench parts, lamp parts, pavilion
 *      posts, planting crowns).
 *
 * The look (Living Night Palace + its golden-day twin) is worn
 * through hall-looks' textures; geometry here is look-independent.
 */
import type { PalaceRect, PlazaWallRun } from "./palace-layout";
import { LAWN_BED, type GroundsBox, type LawnPanel } from "./palace-grounds";
import { BENCH, LAMP } from "./plaza-life";

const rectAround = (x: number, z: number, hx: number, hz: number): PalaceRect => ({
  minX: x - hx,
  maxX: x + hx,
  minZ: z - hz,
  maxZ: z + hz,
});

const rectOf = (b: GroundsBox): PalaceRect => ({
  minX: b.cx - b.w / 2,
  maxX: b.cx + b.w / 2,
  minZ: b.cz - b.d / 2,
  maxZ: b.cz + b.d / 2,
});

/* ── The quarter's plan ───────────────────────────────────────────
 * The district fills the ground south of the promenade:
 * interior x −39..−13, z 34.0..60.0 (26 m × 26 m, the Stage
 * Grounds' measure) — centred exactly on the marker's line
 * (x −26), so the new south-wall gap, the entry path, the
 * parterre and the pavilion all stand on one axis a walker can
 * read the moment they step through: path, lawn, rill, pavilion.
 * Inside the 90 m sky dome from every viewpoint. */

export const GARDENS_INTERIOR: PalaceRect = {
  minX: -39.0, maxX: -13.0, minZ: 34.0, maxZ: 60.0,
};

/** Where a figure's centre may stand: inside the quarter's own
 *  perimeter walls by the plaza's house clearance (the wall face
 *  plus 0.175 m), and north to the promenade wall's face — the
 *  doorway portal in palace-layout bridges the wall band itself. */
export const GARDENS_WALK: PalaceRect = {
  minX: -38.65, maxX: -13.35, minZ: 34.35, maxZ: 59.65,
};

export const GARDENS_CAM_CLAMP: PalaceRect = {
  minX: -38.8, maxX: -13.2, minZ: 33.8, maxZ: 59.8,
};

/** Where a transfer with no crossing point lands: just inside
 *  the gate, on the entry path, facing the gardens. */
export const GARDENS_SPAWN = { x: -26, z: 36.2 } as const;

/** The quarter's own low walls (the plaza enclosure's language:
 *  0.35 m thick, gold-capped in the scene): west, east and south
 *  runs closing the district. The north side is the promenade's
 *  own south wall — with the gate gap in it, now a true passage. */
export const GARDENS_WALL_RUNS: readonly PlazaWallRun[] = [
  { w: 0.35, d: 26.0, x: -39.0, z: 47.0 },
  { w: 0.35, d: 26.0, x: -13.0, z: 47.0 },
  { w: 26.0, d: 0.35, x: -26.0, z: 60.0 },
];

/** Grounded piers on the quarter's far (south) wall line — the
 *  Stage Grounds' language: the two corners and the midpoint. */
export const GARDENS_PIERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -39.0, z: 60.0 },
  { x: -26.0, z: 60.0 },
  { x: -13.0, z: 60.0 },
];

/* ── The parterre lawn and its rill ───────────────────────────────
 * A real lawn panel (the plaza lawns' construction: stone-edged
 * bed, textured grass, parterre planting crowns) centred on the
 * district's axis, holding the quarter's centrepiece: a narrow
 * reflecting rill running down its middle — still water in a
 * low stone rim (the plaza pool's construction, stretched
 * thin). The rill is solid like the pool: a walker rounds it or
 * crosses at its ends, never wades. The lawn itself is
 * stroll-across ground, exactly like the plaza's — only the
 * rill and the benches on it are solid. */

export const PARTERRE_LAWN: LawnPanel = { cx: -26.0, cz: 47.0, w: 17.0, d: 15.0, topY: 0.05 };

export const RILL = {
  cx: -26.0,
  cz: 47.0,
  /** Outer footprint (the rim's outside edge). */
  w: 1.4,
  d: 12.0,
  /** The stone rim: height above the lawn, width of its lip. */
  rimH: 0.3,
  rimLip: 0.25,
  /** The water surface's height — held just below the rim's top,
   *  still and cheap: the pool's water, one cloned texture. */
  waterY: 0.23,
} as const;

export const RILL_BLOCKED: PalaceRect = rectAround(RILL.cx, RILL.cz, RILL.w / 2, RILL.d / 2);

/** Benches on the lawn flanking the rill, facing it (their
 *  length runs along Z, backs away from the water): the sitting
 *  the quarter is furnished for — you sit and listen across the
 *  water. */
export const RILL_BENCHES: ReadonlyArray<{ x: number; z: number; alongZ: true }> = [
  { x: -29.8, z: 47.0, alongZ: true },
  { x: -22.2, z: 47.0, alongZ: true },
];

/* ── The hedged listening nooks ───────────────────────────────────
 * Four nooks in the paving strips flanking the lawn — two west,
 * two east — each a three-sided hedge enclosure (back + two
 * sides, 1.15 m clipped hedge) opening toward the lawn, with a
 * bench inside facing the green. A nook is a room within the
 * room for one or two listeners: hedges blocked from this same
 * data, the bench solid beside them. */

export interface GardenNook {
  /** The nook's centre (the bench stands here, facing the lawn). */
  x: number;
  z: number;
  /** +1: the nook stands WEST of the lawn, opening east.
   *  −1: EAST of the lawn, opening west. */
  side: 1 | -1;
}

export const GARDEN_NOOKS: readonly GardenNook[] = [
  { x: -36.7, z: 41.5, side: 1 },
  { x: -36.7, z: 52.5, side: 1 },
  { x: -15.3, z: 41.5, side: -1 },
  { x: -15.3, z: 52.5, side: -1 },
];

/** One nook's hedge runs, as boxes: a back run along Z on the
 *  district-wall side, two side runs along X reaching toward the
 *  lawn, the mouth between their ends left open. */
export function nookHedges(nook: GardenNook): GroundsBox[] {
  const backX = nook.x + nook.side * -1.5;
  const sideCx = nook.x + nook.side * -0.1;
  return [
    { cx: backX, cy: 0.575, cz: nook.z, w: 0.5, h: 1.15, d: 5.4 },
    { cx: sideCx, cy: 0.575, cz: nook.z - 2.6, w: 2.8, h: 1.15, d: 0.5 },
    { cx: sideCx, cy: 0.575, cz: nook.z + 2.6, w: 2.8, h: 1.15, d: 0.5 },
  ];
}

export const GARDEN_HEDGES: readonly GroundsBox[] = GARDEN_NOOKS.flatMap(nookHedges);

/** The nook benches: one per nook, inside the hedges, facing the
 *  lawn across the nook's open mouth. */
export const NOOK_BENCHES: ReadonlyArray<{ x: number; z: number; alongZ: true }> =
  GARDEN_NOOKS.map((n) => ({ x: n.x + n.side * -0.6, z: n.z, alongZ: true as const }));

/* ── The pavilion ─────────────────────────────────────────────────
 * A small open gazebo on the south paving, on the district's
 * axis: six slender posts on a low stone roundel, a shallow
 * gold-trimmed cone roof — a place to stand (or sit out of the
 * sun) and look back down the rill to the gate. The posts are
 * solid; the ground between them is open floor — you walk
 * through a pavilion, you don't collide with its roof. */

export const PAVILION = {
  cx: -26.0,
  cz: 57.2,
  /** The posts' ring radius and height. */
  postR: 2.0,
  postH: 2.9,
  /** The roof: a shallow cone above the posts, gold-trimmed. */
  roofY: 3.15,
  roofR: 2.9,
  roofH: 0.85,
  /** The low stone roundel the posts stand on (visual step,
   *  flat accent to walk over — like every path on the grounds,
   *  it is NOT collision). */
  roundelR: 2.6,
  blockHalf: 0.16,
} as const;

/** The six post positions, evenly around the ring. */
export const PAVILION_POSTS: ReadonlyArray<{ x: number; z: number }> = [0, 1, 2, 3, 4, 5].map((i) => {
  const a = (i / 6) * Math.PI * 2;
  return {
    x: Math.round((PAVILION.cx + Math.cos(a) * PAVILION.postR) * 100) / 100,
    z: Math.round((PAVILION.cz + Math.sin(a) * PAVILION.postR) * 100) / 100,
  };
});

/* ── Dressing: path, lamps, banners ─────────────────────────────── */

/** The entry path: a marble strip on the gate's line (x −26)
 *  from the promenade wall to the parterre's north edge, with
 *  gold edge strips — the plaza spine's language, turned south.
 *  Flat accent only: no collision, like every path on the
 *  grounds. */
export const GARDENS_ENTRY_PATH = {
  fromZ: 34.0, toZ: 39.5, cx: -26.0, w: 2.2,
} as const;

/** The quarter's lantern standards (plaza-life's LAMP
 *  construction): a pair flanking the entry path inside the
 *  gate, a pair on the lawn's north line, a pair flanking the
 *  pavilion. Emissive heads + glow sprites after dark; zero
 *  real lights. */
export const GARDENS_LAMPS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -28.4, z: 37.5 },
  { x: -23.6, z: 37.5 },
  { x: -35.5, z: 37.8 },
  { x: -16.5, z: 37.8 },
  { x: -29.5, z: 57.2 },
  { x: -22.5, z: 57.2 },
];

/** Banner poles flanking the pavilion approach on the lawn's
 *  south line: a gold-rod pole with a hanging fabric banner in
 *  the look's cloth — the quarter's colours at its far end,
 *  answering the gate's plate at its near end. */
export const GARDENS_BANNER_POLES: ReadonlyArray<{ x: number; z: number }> = [
  { x: -29.8, z: 55.6 },
  { x: -22.2, z: 55.6 },
];
export const GARDENS_BANNER_POLE = { h: 4.2, blockHalf: 0.2 } as const;

/* ── The batch's collision, derived ───────────────────────────────
 * Every solid above, as blocked rects — palace-layout registers
 * this list as the room's `blocked`, so the quarter's walls,
 * piers, hedges, benches, lamps, poles, pavilion posts and the
 * rill are solid in the same commit that makes them visible.
 * The lawn, the entry path, the paving and the pavilion's
 * roundel are ground, deliberately absent. */

export const GARDENS_BLOCKED: readonly PalaceRect[] = [
  ...GARDENS_WALL_RUNS.map((r) => rectAround(r.x, r.z, r.w / 2, r.d / 2)),
  ...GARDENS_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  RILL_BLOCKED,
  ...GARDEN_HEDGES.map(rectOf),
  ...NOOK_BENCHES.map((b) => rectAround(b.x, b.z, BENCH.blockHalfZ, BENCH.blockHalfX)),
  ...RILL_BENCHES.map((b) => rectAround(b.x, b.z, BENCH.blockHalfZ, BENCH.blockHalfX)),
  ...GARDENS_LAMPS.map((l) => rectAround(l.x, l.z, LAMP.blockHalf, LAMP.blockHalf)),
  ...GARDENS_BANNER_POLES.map((p) => rectAround(p.x, p.z, GARDENS_BANNER_POLE.blockHalf, GARDENS_BANNER_POLE.blockHalf)),
  ...PAVILION_POSTS.map((p) => rectAround(p.x, p.z, PAVILION.blockHalf, PAVILION.blockHalf)),
];

/** The district's camera-tall solids (item 44's rule): the wall
 *  piers (cap ~4.0 m), the banner poles (4.2 m) and the pavilion
 *  posts (2.9 m — over the 2.45 m camera line, so the lens keeps
 *  off the roof they carry). The hedges (1.15 m), benches, lamps
 *  and low walls pass under the lens. */
export const GARDENS_TALL_BLOCKED: readonly PalaceRect[] = [
  ...GARDENS_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...GARDENS_BANNER_POLES.map((p) => rectAround(p.x, p.z, GARDENS_BANNER_POLE.blockHalf, GARDENS_BANNER_POLE.blockHalf)),
  ...PAVILION_POSTS.map((p) => rectAround(p.x, p.z, PAVILION.blockHalf, PAVILION.blockHalf)),
];

/** Re-exported for the scene's lawn build (the plaza lawns' bed
 *  language is the district lawn's too). */
export { LAWN_BED };
