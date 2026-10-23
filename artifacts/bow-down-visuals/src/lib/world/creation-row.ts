/**
 * creation-row.ts — the CREATION ROW district, as pure placement
 * data (Open World Overhaul, Stage C batch C6: board item 33).
 *
 * Until this batch Creation Row was a MARKER — a signpost at
 * (27.0, 14.5) on the plaza floor in front of the solid east
 * wall, a named district with nothing behind it. This batch
 * builds the real makers' row the marker always promised,
 * following the Stage Grounds (item 31) and Listening Gardens
 * (item 32) pattern exactly: a real outdoor quarter EAST of the
 * plaza beyond the east wall, entered through a REAL new gap in
 * that wall on the marker's own line (z 14.5) — the marker is
 * reclassified to an OPEN gate (district-gates.ts +
 * palace-layout's PLAZA_GATES, in agreement) and the gap becomes
 * a true passage into a new palace room (`world:creation-row`
 * in palace-layout, mirrored server-side in world-palace.ts).
 *
 * The Row is a makers' street: a marble-striped paving street
 * running east from the gate, workbench stalls with canopies
 * lining both sides, display plinths along the street's edges
 * (an outdoor gallery of the craft), materials dressing —
 * crates, canvas stacks, tool benches — planted edges closing
 * the quarter's north and south reaches, banner poles, lantern
 * standards, and ONE station, the Row Slate, on the Kingdom
 * Board panel pattern like the Stage Bill and the Gardens Slate
 * (the registry law: one station per district, no new verbs,
 * guests included).
 *
 * The house laws this module follows (stage-grounds /
 * listening-gardens / palace-grounds / plaza-life):
 *   1. Every SOLID is registered as a blocked rect in
 *      palace-layout DERIVED from this same data (ROW_BLOCKED
 *      below) — a visible body and its collision can never drift.
 *   2. The ground wears the OUTDOOR system: the look's paving at
 *      whole-tile slabs (palace-grounds' pavingSlabsFor over the
 *      district floor rect) and planted beds for the edges —
 *      never interior marble. The marble survives only as the
 *      street strip's accent, exactly as on the plaza.
 *   3. NO new real lights. The quarter's lantern standards glow
 *      by emissive glass + the item-27 lantern-glow sprites
 *      after dark, inside the ladder's existing budget.
 *   4. Repeated pieces are placed as lists so the scene instances
 *      them (stall posts, bench parts, lamp parts, plinth bodies,
 *      crate bodies, planting crowns).
 *
 * The look (Living Night Palace + its golden-day twin) is worn
 * through hall-looks' textures; geometry here is look-independent.
 */
import type { PalaceRect, PlazaWallRun } from "./palace-layout";
import type { GroundsBox } from "./palace-grounds";
import { LAMP } from "./plaza-life";

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
 * The district fills the ground east of the plaza's east wall:
 * interior x 28.2..54.2, z 1.5..27.5 (26 m × 26 m, the Stage
 * Grounds' and the Gardens' measure) — centred exactly on the
 * marker's line (z 14.5), so the new east-wall gap, the street,
 * the stalls and the banner poles all stand on one axis a walker
 * can read the moment they step through: gate, street, stalls,
 * the far wall. Inside the 90 m sky dome from every viewpoint. */

export const ROW_INTERIOR: PalaceRect = {
  minX: 28.2, maxX: 54.2, minZ: 1.5, maxZ: 27.5,
};

/** Where a figure's centre may stand: inside the quarter's own
 *  perimeter walls by the plaza's house clearance (the wall face
 *  plus 0.175 m), and west to the plaza wall's face — the doorway
 *  portal in palace-layout bridges the wall band itself. */
export const ROW_WALK: PalaceRect = {
  minX: 28.55, maxX: 53.85, minZ: 1.85, maxZ: 27.15,
};

export const ROW_CAM_CLAMP: PalaceRect = {
  minX: 28.0, maxX: 54.0, minZ: 1.7, maxZ: 27.3,
};

/** Where a transfer with no crossing point lands: just inside
 *  the gate, on the street, facing the Row. */
export const ROW_SPAWN = { x: 30.2, z: 14.5 } as const;

/** The quarter's own low walls (the plaza enclosure's language:
 *  0.35 m thick, gold-capped in the scene): east, north and south
 *  runs closing the district. The west side is the plaza's own
 *  east wall — with the gate gap in it, now a true passage. */
export const ROW_WALL_RUNS: readonly PlazaWallRun[] = [
  { w: 0.35, d: 26.0, x: 54.2, z: 14.5 },
  { w: 26.0, d: 0.35, x: 41.2, z: 1.5 },
  { w: 26.0, d: 0.35, x: 41.2, z: 27.5 },
];

/** Grounded piers on the quarter's far (east) wall line — the
 *  Stage Grounds' language: the two corners and the midpoint. */
export const ROW_PIERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 54.2, z: 1.5 },
  { x: 54.2, z: 14.5 },
  { x: 54.2, z: 27.5 },
];

/* ── The street ───────────────────────────────────────────────────
 * The makers' street: a marble strip on the gate's line
 * (z 14.5) running east from the plaza wall deep into the
 * quarter, with gold edge strips — the plaza spine's language,
 * turned east. Flat accent only: no collision, like every path
 * on the grounds. The stalls, plinths and lamps all address it. */

export const ROW_STREET = {
  fromX: 28.2, toX: 51.5, cz: 14.5, w: 2.2,
} as const;

/* ── The workbench stalls ─────────────────────────────────────────
 * Six stalls, three to a side, lining the street: four posts, a
 * fabric canopy on their heads, and a workbench inside against
 * the stall's back — the maker's pitch, roofed and honest. The
 * posts and the bench are solid; the canopy rides above the
 * walker's head and is not collision (its posts are). */

export interface RowStall {
  /** The stall's centre. */
  x: number;
  z: number;
  /** +1: the stall stands NORTH of the street, opening south.
   *  −1: SOUTH of the street, opening north. */
  side: 1 | -1;
}

export const ROW_STALLS: readonly RowStall[] = [
  { x: 37.0, z: 8.6, side: 1 },
  { x: 43.0, z: 8.6, side: 1 },
  { x: 49.0, z: 8.6, side: 1 },
  { x: 37.0, z: 20.4, side: -1 },
  { x: 43.0, z: 20.4, side: -1 },
  { x: 49.0, z: 20.4, side: -1 },
];

export const STALL_KIT = {
  /** Post offsets from the stall's centre, and their height. */
  postDx: 1.9,
  postDz: 1.4,
  postH: 2.7,
  postBlockHalf: 0.14,
  /** The canopy slab the posts carry. */
  canopyW: 4.6,
  canopyD: 3.6,
  canopyY: 2.78,
  /** The workbench against the stall's back: a deep bench box,
   *  its centre offset from the stall's centre toward the back. */
  benchW: 3.2,
  benchD: 1.0,
  benchH: 0.92,
  benchBackOff: 0.7,
} as const;

/** One stall's post positions. */
export function stallPosts(stall: RowStall): Array<{ x: number; z: number }> {
  return [
    { x: stall.x - STALL_KIT.postDx, z: stall.z - STALL_KIT.postDz },
    { x: stall.x + STALL_KIT.postDx, z: stall.z - STALL_KIT.postDz },
    { x: stall.x - STALL_KIT.postDx, z: stall.z + STALL_KIT.postDz },
    { x: stall.x + STALL_KIT.postDx, z: stall.z + STALL_KIT.postDz },
  ];
}

export const ROW_STALL_POSTS: ReadonlyArray<{ x: number; z: number }> =
  ROW_STALLS.flatMap(stallPosts);

/** One stall's workbench, as a box (against the back, so the
 *  stall's mouth stays open floor a maker stands in). */
export function stallBench(stall: RowStall): GroundsBox {
  return {
    cx: stall.x, cy: STALL_KIT.benchH / 2, cz: stall.z - stall.side * STALL_KIT.benchBackOff,
    w: STALL_KIT.benchW, h: STALL_KIT.benchH, d: STALL_KIT.benchD,
  };
}

export const ROW_STALL_BENCHES: readonly GroundsBox[] = ROW_STALLS.map(stallBench);

/* ── The display plinths ──────────────────────────────────────────
 * An outdoor gallery of the craft along the street's edges:
 * stone pedestals carrying a small made thing each (built in
 * the scene from the look's materials). Staggered north/south so
 * the street reads as a gallery walk, never a corridor of
 * boxes. The pedestal is solid; the piece on it rides above. */

export const ROW_PLINTHS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 34.5, z: 11.6 },
  { x: 40.5, z: 11.6 },
  { x: 46.5, z: 11.6 },
  { x: 37.5, z: 17.4 },
  { x: 43.5, z: 17.4 },
  { x: 49.2, z: 17.4 },
];
export const PLINTH = { w: 0.7, h: 1.05, blockHalf: 0.4 } as const;

/* ── Materials dressing ───────────────────────────────────────────
 * The Row at work: crate stacks where materials land, canvas
 * stacks waiting their turn, and tool benches against the far
 * wall. Every body solid from this same data. */

export const ROW_CRATES: ReadonlyArray<{ x: number; z: number }> = [
  { x: 33.5, z: 5.2 },
  { x: 48.6, z: 4.9 },
  { x: 35.8, z: 23.9 },
];
export const CRATE = { size: 0.85, blockHalf: 0.5 } as const;

export const ROW_CANVAS_STACKS: readonly GroundsBox[] = [
  { cx: 31.8, cy: 0.25, cz: 23.6, w: 1.6, h: 0.5, d: 1.2 },
  { cx: 50.5, cy: 0.25, cz: 24.3, w: 1.6, h: 0.5, d: 1.2 },
];

export const ROW_TOOL_BENCHES: readonly GroundsBox[] = [
  { cx: 52.9, cy: 0.475, cz: 5.0, w: 0.9, h: 0.95, d: 2.4 },
  { cx: 52.9, cy: 0.475, cz: 24.0, w: 0.9, h: 0.95, d: 2.4 },
];

/* ── The planted edges ────────────────────────────────────────────
 * Long planting beds closing the quarter's north and south
 * reaches (the gardens' hedge language, lowered to a bed): a
 * stone-edged box of green with planting crowns along its top —
 * the soft edge between the working street and the walls. The
 * beds are solid; a maker walks the street side of them, never
 * through the planting. */

export const ROW_PLANTERS: readonly GroundsBox[] = [
  { cx: 41.2, cy: 0.275, cz: 3.4, w: 20.0, h: 0.55, d: 1.4 },
  { cx: 41.2, cy: 0.275, cz: 25.6, w: 20.0, h: 0.55, d: 1.4 },
];

/** Planting crowns along each bed's top, evenly spaced — placed
 *  as a list so the scene instances them with item-18 variation,
 *  and pinned here so a crown can never drift off its bed. */
export const ROW_PLANTER_CROWNS: ReadonlyArray<{ x: number; z: number }> =
  ROW_PLANTERS.flatMap((p) => {
    const crowns: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 8; i++) {
      crowns.push({ x: p.cx - 8.75 + i * 2.5, z: p.cz });
    }
    return crowns;
  });

/* ── Dressing: lamps, banners ───────────────────────────────────── */

/** The quarter's lantern standards (plaza-life's LAMP
 *  construction): a pair flanking the street inside the gate,
 *  and pairs down the street's run. Emissive heads + glow
 *  sprites after dark; zero real lights. */
export const ROW_LAMPS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 31.0, z: 11.8 },
  { x: 31.0, z: 17.2 },
  { x: 41.5, z: 11.0 },
  { x: 41.5, z: 18.0 },
  { x: 50.0, z: 11.0 },
  { x: 50.0, z: 18.0 },
];

/** Banner poles flanking the street at its far end: a gold-rod
 *  pole with a hanging fabric banner in the look's cloth — the
 *  quarter's colours at its far end, answering the gate's plate
 *  at its near end. */
export const ROW_BANNER_POLES: ReadonlyArray<{ x: number; z: number }> = [
  { x: 52.4, z: 10.8 },
  { x: 52.4, z: 18.2 },
];
export const ROW_BANNER_POLE = { h: 4.2, blockHalf: 0.2 } as const;

/* ── The batch's collision, derived ───────────────────────────────
 * Every solid above, as blocked rects — palace-layout registers
 * this list as the room's `blocked`, so the quarter's walls,
 * piers, stall posts and benches, plinths, crates, canvas
 * stacks, tool benches, planters, lamps and poles are solid in
 * the same commit that makes them visible. The street, the
 * paving and the stalls' open mouths are ground, deliberately
 * absent. */

export const ROW_BLOCKED: readonly PalaceRect[] = [
  ...ROW_WALL_RUNS.map((r) => rectAround(r.x, r.z, r.w / 2, r.d / 2)),
  ...ROW_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...ROW_STALL_POSTS.map((p) => rectAround(p.x, p.z, STALL_KIT.postBlockHalf, STALL_KIT.postBlockHalf)),
  ...ROW_STALL_BENCHES.map(rectOf),
  ...ROW_PLINTHS.map((p) => rectAround(p.x, p.z, PLINTH.blockHalf, PLINTH.blockHalf)),
  ...ROW_CRATES.map((c) => rectAround(c.x, c.z, CRATE.blockHalf, CRATE.blockHalf)),
  ...ROW_CANVAS_STACKS.map(rectOf),
  ...ROW_TOOL_BENCHES.map(rectOf),
  ...ROW_PLANTERS.map(rectOf),
  ...ROW_LAMPS.map((l) => rectAround(l.x, l.z, LAMP.blockHalf, LAMP.blockHalf)),
  ...ROW_BANNER_POLES.map((p) => rectAround(p.x, p.z, ROW_BANNER_POLE.blockHalf, ROW_BANNER_POLE.blockHalf)),
];

/** The district's camera-tall solids (item 44's rule): the wall
 *  piers (cap ~4.0 m), the banner poles (4.2 m) and the stall
 *  posts (2.7 m — over the 2.45 m camera line, so the lens keeps
 *  off the canopies they carry). The benches, plinths, crates,
 *  planters, lamps and low walls pass under the lens. */
export const ROW_TALL_BLOCKED: readonly PalaceRect[] = [
  ...ROW_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...ROW_BANNER_POLES.map((p) => rectAround(p.x, p.z, ROW_BANNER_POLE.blockHalf, ROW_BANNER_POLE.blockHalf)),
  ...ROW_STALL_POSTS.map((p) => rectAround(p.x, p.z, STALL_KIT.postBlockHalf, STALL_KIT.postBlockHalf)),
];
