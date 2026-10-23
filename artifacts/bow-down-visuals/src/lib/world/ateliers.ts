/**
 * ateliers.ts — THE ATELIERS district, as pure placement data
 * (Open World Overhaul, Stage C batch C7: board item 34).
 *
 * Until this batch the Ateliers were a MARKER — a signpost at
 * (27.0, 22.5) on the plaza floor in front of the solid east
 * wall, a named district with nothing behind it. This batch
 * builds the real fine-work quarter the marker always promised,
 * following the Creation Row (item 33) pattern exactly — with
 * one honest difference of geography, stated plainly:
 *
 * The marker's own line (z 22.5) cannot carry its gate: east of
 * that line stands CREATION ROW, built in item 33 — its quarter
 * fills x 28.2..54.2, z 1.5..27.5, and a gap at z 22.5 would open
 * into the Row's own southern stalls, not into a new district.
 * The Ateliers quarter therefore stands SOUTH of Creation Row,
 * sharing the Row's south wall (z 27.5) as its north wall, and
 * its gate stands in the plaza east wall's south run — the one
 * east-wall line that truly opens into the new quarter (gap
 * z 29.4..31.6, gate centre z 30.5). The marker is reclassified
 * to that OPEN gate (district-gates.ts + palace-layout's
 * PLAZA_GATES, in agreement), and reaching it is honest too:
 * the plaza's south-east yard — walled-off floor since item 42
 * — becomes walkable plaza ground in this batch (the notch wall
 * that hid its invisible boundary is gone; the yard now ends at
 * real walls and at the Ateliers gate itself).
 *
 * The quarter is a fine-work yard: a marble-striped lane running
 * east from the gate, glazed workshop bays lining both sides —
 * studio fronts whose glass glows warm at dusk (emissive only;
 * zero new real lights) — display vitrines along the lane's
 * edges, sculpture plinths, work yards north and south with
 * materials dressing (crates, raw stone stacks, tool benches),
 * planted edges, banner poles, lantern standards, and ONE
 * station, the Ateliers Slate, on the Kingdom Board panel
 * pattern like the Row Slate before it (the registry law: one
 * station per district, no new verbs, guests included).
 *
 * The house laws this module follows (creation-row /
 * listening-gardens / stage-grounds / palace-grounds /
 * plaza-life):
 *   1. Every SOLID is registered as a blocked rect in
 *      palace-layout DERIVED from this same data
 *      (ATELIERS_BLOCKED below) — a visible body and its
 *      collision can never drift.
 *   2. The ground wears the OUTDOOR system: the look's paving at
 *      whole-tile slabs (palace-grounds' pavingSlabsFor over the
 *      district floor rect) and planted beds for the edges —
 *      never interior marble. The marble survives only as the
 *      lane strip's accent, exactly as on the plaza.
 *   3. NO new real lights. The quarter's lantern standards and
 *      glazed bay fronts glow by emissive glass + the item-27
 *      lantern-glow sprites after dark, inside the ladder's
 *      existing budget.
 *   4. Repeated pieces are placed as lists so the scene instances
 *      them (bay posts, bench/panel bodies, lamp parts, vitrine
 *      bodies, crate bodies, planting crowns).
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
 * The district fills the ground south-east of the plaza, south
 * of Creation Row: interior x 28.2..54.2, z 27.5..53.5 (26 m ×
 * 26 m, the other districts' measure). Its north wall is the
 * Row's own south wall (z 27.5, already built and blocked as the
 * Row's); its west side is the plaza's east wall north of z 34
 * (with the new gate gap in it) and its own west run south of
 * the plaza. The lane stands on the quarter's centre line
 * (z 40.5); the gate (z 30.5) enters the quarter's west side
 * north of the lane, so an arriving walker crosses the north
 * work yard and sees the bays, the lane and the far wall open
 * out ahead of them. Inside the 90 m sky dome from every
 * viewpoint. */

export const ATELIERS_INTERIOR: PalaceRect = {
  minX: 28.2, maxX: 54.2, minZ: 27.5, maxZ: 53.5,
};

/** Where a figure's centre may stand: inside the quarter's own
 *  perimeter walls by the plaza's house clearance (the wall face
 *  plus 0.175 m), and west to the plaza wall's face — the doorway
 *  portal in palace-layout bridges the wall band itself. */
export const ATELIERS_WALK: PalaceRect = {
  minX: 28.55, maxX: 53.85, minZ: 27.85, maxZ: 53.15,
};

export const ATELIERS_CAM_CLAMP: PalaceRect = {
  minX: 28.0, maxX: 54.0, minZ: 27.3, maxZ: 53.3,
};

/** Where a transfer with no crossing point lands: just inside
 *  the gate, on the lane's line west end. */
export const ATELIERS_SPAWN = { x: 30.2, z: 40.5 } as const;

/** The quarter's own low walls (the plaza enclosure's language:
 *  0.35 m thick, gold-capped in the scene): the east and south
 *  runs, and the west run south of the plaza (z 34.0..53.5). The
 *  north side is Creation Row's south wall — shared, already
 *  standing — and the west side north of z 34 is the plaza's own
 *  east wall, with the gate gap in it, now a true passage. */
export const ATELIERS_WALL_RUNS: readonly PlazaWallRun[] = [
  { w: 0.35, d: 26.0, x: 54.2, z: 40.5 },
  { w: 26.0, d: 0.35, x: 41.2, z: 53.5 },
  { w: 0.35, d: 19.5, x: 28.2, z: 43.75 },
];

/** Grounded piers on the quarter's far (east) wall line — the
 *  other districts' language: the midpoint and the south corner.
 *  The north corner pier (54.2, 27.5) is Creation Row's own,
 *  already standing on the shared corner. */
export const ATELIERS_PIERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 54.2, z: 40.5 },
  { x: 54.2, z: 53.5 },
];

/* ── The lane ─────────────────────────────────────────────────────
 * The fine-work lane: a marble strip on the quarter's centre
 * line (z 40.5) running east from the plaza wall deep into the
 * quarter, with gold edge strips — the plaza spine's language,
 * turned east, exactly as the Row's street. Flat accent only:
 * no collision, like every path on the grounds. The bays, the
 * vitrines and the lamps all address it. */

export const ATELIERS_LANE = {
  fromX: 28.2, toX: 51.5, cz: 40.5, w: 2.2,
} as const;

/* ── The workshop bays ────────────────────────────────────────────
 * Six glazed bays, three to a side, lining the lane: four posts,
 * a fabric canopy on their heads, a worktable inside against the
 * bay's back, and — the Ateliers' own note — a GLAZED studio
 * front closing the bay's back: a warm-lit glass panel (emissive
 * at dusk, pale by day) behind the worktable, so each bay reads
 * as a working studio, not a stall. The posts, the table and the
 * glazed panel are solid; the canopy rides above the walker's
 * head and is not collision (its posts are). */

export interface AtelierBay {
  /** The bay's centre. */
  x: number;
  z: number;
  /** +1: the bay stands NORTH of the lane, opening south.
   *  −1: SOUTH of the lane, opening north. */
  side: 1 | -1;
}

export const ATELIER_BAYS: readonly AtelierBay[] = [
  { x: 37.0, z: 34.6, side: 1 },
  { x: 43.0, z: 34.6, side: 1 },
  { x: 49.0, z: 34.6, side: 1 },
  { x: 37.0, z: 46.4, side: -1 },
  { x: 43.0, z: 46.4, side: -1 },
  { x: 49.0, z: 46.4, side: -1 },
];

export const BAY_KIT = {
  /** Post offsets from the bay's centre, and their height. */
  postDx: 1.9,
  postDz: 1.4,
  postH: 2.7,
  postBlockHalf: 0.14,
  /** The canopy slab the posts carry. */
  canopyW: 4.6,
  canopyD: 3.6,
  canopyY: 2.78,
  /** The worktable against the bay's back: a deep table box,
   *  its centre offset from the bay's centre toward the back. */
  tableW: 3.2,
  tableD: 1.0,
  tableH: 0.92,
  tableBackOff: 0.7,
  /** The glazed studio front closing the bay's back: a glass
   *  panel on the bay's back line, warm with interior light at
   *  dusk (emissive only — no real light stands behind it). */
  panelW: 3.8,
  panelH: 2.6,
  panelD: 0.18,
  panelBackOff: 1.4,
} as const;

/** One bay's post positions. */
export function bayPosts(bay: AtelierBay): Array<{ x: number; z: number }> {
  return [
    { x: bay.x - BAY_KIT.postDx, z: bay.z - BAY_KIT.postDz },
    { x: bay.x + BAY_KIT.postDx, z: bay.z - BAY_KIT.postDz },
    { x: bay.x - BAY_KIT.postDx, z: bay.z + BAY_KIT.postDz },
    { x: bay.x + BAY_KIT.postDx, z: bay.z + BAY_KIT.postDz },
  ];
}

export const ATELIER_BAY_POSTS: ReadonlyArray<{ x: number; z: number }> =
  ATELIER_BAYS.flatMap(bayPosts);

/** One bay's worktable, as a box (against the back, so the bay's
 *  mouth stays open floor a maker stands in). */
export function bayTable(bay: AtelierBay): GroundsBox {
  return {
    cx: bay.x, cy: BAY_KIT.tableH / 2, cz: bay.z - bay.side * BAY_KIT.tableBackOff,
    w: BAY_KIT.tableW, h: BAY_KIT.tableH, d: BAY_KIT.tableD,
  };
}

export const ATELIER_BAY_TABLES: readonly GroundsBox[] = ATELIER_BAYS.map(bayTable);

/** One bay's glazed studio front, as a box (on the bay's back
 *  line, between its back posts). */
export function bayPanel(bay: AtelierBay): GroundsBox {
  return {
    cx: bay.x, cy: BAY_KIT.panelH / 2, cz: bay.z - bay.side * BAY_KIT.panelBackOff,
    w: BAY_KIT.panelW, h: BAY_KIT.panelH, d: BAY_KIT.panelD,
  };
}

export const ATELIER_BAY_PANELS: readonly GroundsBox[] = ATELIER_BAYS.map(bayPanel);

/* ── The display vitrines ─────────────────────────────────────────
 * Glass display cases along the lane's edges: a stone pedestal
 * carrying a glazed case with a small made thing inside (built
 * in the scene from the look's materials, the glass emissive-
 * warmed at dusk). Staggered north/south so the lane reads as a
 * gallery walk, never a corridor of boxes. The case is solid. */

export const ATELIER_VITRINES: ReadonlyArray<{ x: number; z: number }> = [
  { x: 34.5, z: 37.6 },
  { x: 40.5, z: 37.6 },
  { x: 46.5, z: 37.6 },
  { x: 37.5, z: 43.4 },
  { x: 43.5, z: 43.4 },
  { x: 49.2, z: 43.4 },
];
export const VITRINE = { w: 0.9, h: 1.25, blockHalf: 0.5 } as const;

/* ── The sculpture plinths ────────────────────────────────────────
 * Stone pedestals in the work yards carrying a small sculpted
 * piece each — the fine work on show outdoors, beyond the
 * vitrines' glass. The pedestal is solid; the piece rides above. */

export const ATELIER_PLINTHS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 34.5, z: 32.0 },
  { x: 48.0, z: 32.0 },
  { x: 38.0, z: 49.0 },
  { x: 46.0, z: 49.0 },
];
export const ATELIER_PLINTH = { w: 0.7, h: 1.05, blockHalf: 0.4 } as const;

/* ── Materials dressing ───────────────────────────────────────────
 * The yards at work: crate stacks where materials land, raw
 * stone block stacks waiting the chisel, and tool benches
 * against the far wall. Every body solid from this same data. */

export const ATELIER_CRATES: ReadonlyArray<{ x: number; z: number }> = [
  { x: 33.5, z: 31.0 },
  { x: 48.6, z: 30.7 },
  { x: 35.8, z: 50.0 },
];
export const ATELIER_CRATE = { size: 0.85, blockHalf: 0.5 } as const;

export const ATELIER_STONE_STACKS: readonly GroundsBox[] = [
  { cx: 50.5, cy: 0.25, cz: 30.9, w: 1.6, h: 0.5, d: 1.2 },
  { cx: 31.8, cy: 0.25, cz: 50.4, w: 1.6, h: 0.5, d: 1.2 },
];

export const ATELIER_TOOL_BENCHES: readonly GroundsBox[] = [
  { cx: 52.9, cy: 0.475, cz: 31.4, w: 0.9, h: 0.95, d: 2.4 },
  { cx: 52.9, cy: 0.475, cz: 49.6, w: 0.9, h: 0.95, d: 2.4 },
];

/* ── The planted edges ────────────────────────────────────────────
 * Long planting beds closing the quarter's north and south
 * reaches (the gardens' hedge language, lowered to a bed): a
 * stone-edged box of green with planting crowns along its top —
 * the soft edge between the working yards and the walls. The
 * beds are solid; a maker walks the lane side of them, never
 * through the planting. */

export const ATELIERS_PLANTERS: readonly GroundsBox[] = [
  { cx: 41.2, cy: 0.275, cz: 29.4, w: 20.0, h: 0.55, d: 1.4 },
  { cx: 41.2, cy: 0.275, cz: 51.6, w: 20.0, h: 0.55, d: 1.4 },
];

/** Planting crowns along each bed's top, evenly spaced — placed
 *  as a list so the scene instances them with item-18 variation,
 *  and pinned here so a crown can never drift off its bed. */
export const ATELIERS_PLANTER_CROWNS: ReadonlyArray<{ x: number; z: number }> =
  ATELIERS_PLANTERS.flatMap((p) => {
    const crowns: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 8; i++) {
      crowns.push({ x: p.cx - 8.75 + i * 2.5, z: p.cz });
    }
    return crowns;
  });

/* ── Dressing: lamps, banners ───────────────────────────────────── */

/** The quarter's lantern standards (plaza-life's LAMP
 *  construction): a pair flanking the lane inside the gate's
 *  reach, and pairs down the lane's run. Emissive heads + glow
 *  sprites after dark; zero real lights. */
export const ATELIERS_LAMPS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 31.0, z: 37.8 },
  { x: 31.0, z: 43.2 },
  { x: 41.5, z: 37.0 },
  { x: 41.5, z: 44.0 },
  { x: 50.0, z: 37.0 },
  { x: 50.0, z: 44.0 },
];

/** Banner poles flanking the lane at its far end: a gold-rod
 *  pole with a hanging fabric banner in the look's cloth — the
 *  quarter's colours at its far end, answering the gate's plate
 *  at its near end. */
export const ATELIERS_BANNER_POLES: ReadonlyArray<{ x: number; z: number }> = [
  { x: 52.4, z: 36.8 },
  { x: 52.4, z: 44.2 },
];
export const ATELIERS_BANNER_POLE = { h: 4.2, blockHalf: 0.2 } as const;

/* ── The batch's collision, derived ───────────────────────────────
 * Every solid above, as blocked rects — palace-layout registers
 * this list as the room's `blocked`, so the quarter's walls,
 * piers, bay posts, tables and glazed panels, vitrines, plinths,
 * crates, stone stacks, tool benches, planters, lamps and poles
 * are solid in the same commit that makes them visible. The
 * lane, the paving and the bays' open mouths are ground,
 * deliberately absent. The quarter's north wall is Creation
 * Row's south run — already blocked as the Row's own, and
 * isWalkable judges every room's list, so the shared wall is
 * solid from this side too. */

export const ATELIERS_BLOCKED: readonly PalaceRect[] = [
  ...ATELIERS_WALL_RUNS.map((r) => rectAround(r.x, r.z, r.w / 2, r.d / 2)),
  ...ATELIERS_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...ATELIER_BAY_POSTS.map((p) => rectAround(p.x, p.z, BAY_KIT.postBlockHalf, BAY_KIT.postBlockHalf)),
  ...ATELIER_BAY_TABLES.map(rectOf),
  ...ATELIER_BAY_PANELS.map(rectOf),
  ...ATELIER_VITRINES.map((p) => rectAround(p.x, p.z, VITRINE.blockHalf, VITRINE.blockHalf)),
  ...ATELIER_PLINTHS.map((p) => rectAround(p.x, p.z, ATELIER_PLINTH.blockHalf, ATELIER_PLINTH.blockHalf)),
  ...ATELIER_CRATES.map((c) => rectAround(c.x, c.z, ATELIER_CRATE.blockHalf, ATELIER_CRATE.blockHalf)),
  ...ATELIER_STONE_STACKS.map(rectOf),
  ...ATELIER_TOOL_BENCHES.map(rectOf),
  ...ATELIERS_PLANTERS.map(rectOf),
  ...ATELIERS_LAMPS.map((l) => rectAround(l.x, l.z, LAMP.blockHalf, LAMP.blockHalf)),
  ...ATELIERS_BANNER_POLES.map((p) => rectAround(p.x, p.z, ATELIERS_BANNER_POLE.blockHalf, ATELIERS_BANNER_POLE.blockHalf)),
];

/** The district's camera-tall solids (item 44's rule): the wall
 *  piers (cap ~4.0 m), the banner poles (4.2 m), the bay posts
 *  (2.7 m — over the 2.45 m camera line, so the lens keeps off
 *  the canopies they carry) and the glazed bay panels (2.6 m —
 *  a hair over the line, so the lens keeps off the glass). The
 *  tables, vitrines, plinths, crates, planters, lamps and low
 *  walls pass under the lens. */
export const ATELIERS_TALL_BLOCKED: readonly PalaceRect[] = [
  ...ATELIERS_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...ATELIERS_BANNER_POLES.map((p) => rectAround(p.x, p.z, ATELIERS_BANNER_POLE.blockHalf, ATELIERS_BANNER_POLE.blockHalf)),
  ...ATELIER_BAY_POSTS.map((p) => rectAround(p.x, p.z, BAY_KIT.postBlockHalf, BAY_KIT.postBlockHalf)),
  ...ATELIER_BAY_PANELS.map(rectOf),
];
