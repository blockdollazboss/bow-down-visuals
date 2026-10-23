/**
 * creator-heights.ts — CREATOR HEIGHTS district, as pure placement
 * data (Open World Overhaul, Stage C batch C9: board item 36).
 *
 * Until this batch Creator Heights was the plaza's LAST MARKER —
 * a signpost freestanding on the plaza floor at (13.5, 24.6), a
 * named district with nothing behind it. This batch builds the
 * real residential quarter the marker always promised, following
 * the Stage Grounds / Listening Gardens / Creation Row /
 * Ateliers / Boardwalk pattern (items 31–35) — with one honest
 * difference of geography, stated plainly:
 *
 * Every outward line from the marker is already built over.
 * North is the King's Hall itself; east is Creation Row and the
 * Ateliers; south is the Creator Rooms building and, beyond the
 * south wall, the Boardwalk; west is the plaza's heart and,
 * beyond the west wall, the Stage Grounds and the Listening
 * Gardens. No wall line from the marker opens into unbuilt
 * ground, so the quarter cannot stand beyond a perimeter wall
 * like its five siblings. It stands instead on the one piece of
 * ground floor-plan law leaves: the plaza's own north-east
 * quadrant — the only quadrant no prior batch dressed (the
 * monument, the pool and the colonnade stations all stand west
 * and south of it) — as a walled residential enclave within the
 * plaza grounds. The marker is reclassified to an OPEN gate
 * standing on the marker's exact spot (13.5, 24.6), in the
 * enclave's own new west wall on the marker's own line (x 13.5),
 * and the portal in palace-layout runs from that gate straight
 * into the quarter (district-gates.ts + palace-layout's
 * PLAZA_GATES, in agreement). The quarter is smaller than its
 * 26 m × 26 m siblings — an enclave court, not a sprawl — and
 * that is the honest consequence of being the last district
 * built: every larger ground was already a district.
 *
 * The plaza keeps its promises around the enclave (the
 * courtyard's walk/grounds restructure lives in palace-layout):
 * the Row gate stays reachable across the north-east lane north
 * of the enclave's north wall, and the south-east yard (the way
 * to the Ateliers gate) stays reachable by the south bridge
 * lane between the enclave's south wall and the Creator Rooms
 * building's north wall.
 *
 * The quarter is the creators' residential quarter — where the
 * Creator Rooms live conceptually: residence fronts lining the
 * north wall (a door, a canopy, a lit window's warmth at dusk —
 * scenery honouring the creator-rooms concept; the rooms
 * themselves still stand through their arch south of the
 * plaza), a residents' court at its heart, overlook terraces
 * along its south edge (visual elevation on the item-38
 * precedent: flat-plane movement does not climb, so each
 * terrace's whole footprint is honestly blocked), benches,
 * planted beds, lantern standards, banner poles, and ONE
 * station, the Heights Slate, on the Kingdom Board pattern like
 * the slates before it (the registry law: one station per
 * district, no new verbs, guests included).
 *
 * The house laws this module follows (boardwalk / ateliers /
 * creation-row / listening-gardens / stage-grounds /
 * palace-grounds / plaza-life):
 *   1. Every SOLID is registered as a blocked rect in
 *      palace-layout DERIVED from this same data
 *      (HEIGHTS_BLOCKED below) — a visible body and its
 *      collision can never drift.
 *   2. The ground wears the OUTDOOR system: the look's paving
 *      at whole-tile slabs (palace-grounds' pavingSlabsFor over
 *      the district floor rect) — never interior marble. The
 *      marble survives only as the gate walkway's accent, exactly
 *      as on the plaza.
 *   3. NO new real lights. The quarter's lantern standards and
 *      residence windows glow by emissive glass + the item-27
 *      lantern-glow sprites after dark, inside the ladder's
 *      existing budget.
 *   4. Repeated pieces are placed as lists so the scene
 *      instances them (front posts, door panels, bench parts,
 *      lamp parts, planting crowns).
 *
 * The look (Living Night Palace + its golden-day twin) is worn
 * through hall-looks' textures; geometry here is look-independent.
 */
import type { PalaceRect, PlazaWallRun } from "./palace-layout";
import type { GroundsBox } from "./palace-grounds";
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
 * The enclave fills the plaza's north-east quadrant: interior
 * x 13.5..28.2, z 15.9..25.7. Its east side is the plaza's own
 * east wall (the solid run z 15.6..26.0 — Creation Row's gate
 * gap at z 13.4..15.6 and the Ateliers' at z 29.4..31.6 both
 * stand outside the quarter's z reach, on plaza ground that
 * stays the plaza's); its west wall is new, on the marker's line
 * (x 13.5), with the gate gap in it on the marker's spot
 * (z 23.6..25.6, centre 24.6); its north and south walls are new.
 * North of the north wall runs the plaza's north-east lane (the
 * way to the Row gate); south of the south wall runs the south
 * bridge lane (the way to the south-east yard and the Ateliers
 * gate). Inside the 90 m sky dome from every viewpoint — it
 * stands inside the plaza itself. */

export const HEIGHTS_INTERIOR: PalaceRect = {
  minX: 13.5, maxX: 28.2, minZ: 15.9, maxZ: 25.7,
};

/** Where a figure's centre may stand: inside the quarter's own
 *  walls by the plaza's house clearance (the wall face plus
 *  0.175 m), and west to the gate wall's face — the doorway
 *  portal in palace-layout bridges the wall band itself. */
export const HEIGHTS_WALK: PalaceRect = {
  minX: 13.85, maxX: 27.85, minZ: 16.25, maxZ: 25.35,
};

export const HEIGHTS_CAM_CLAMP: PalaceRect = {
  minX: 13.3, maxX: 28.0, minZ: 15.7, maxZ: 25.9,
};

/** Where a transfer with no crossing point lands: just inside
 *  the gate, on the gate walkway, facing the court. */
export const HEIGHTS_SPAWN = { x: 14.6, z: 24.6 } as const;

/** The quarter's own low walls (the plaza enclosure's language:
 *  0.35 m thick, gold-capped in the scene): the west wall in two
 *  runs flanking the gate gap (z 23.6..25.6 — the marker's spot,
 *  now a true passage), the north run and the south run. The
 *  east side is the plaza's own east wall — shared, already
 *  standing, its solid run closing the quarter's east edge. */
export const HEIGHTS_WALL_RUNS: readonly PlazaWallRun[] = [
  { w: 0.35, d: 7.7, x: 13.5, z: 19.75 },
  { w: 0.35, d: 0.1, x: 13.5, z: 25.65 },
  { w: 14.7, d: 0.35, x: 20.85, z: 15.9 },
  { w: 14.7, d: 0.35, x: 20.85, z: 25.7 },
];

/** Grounded piers on the quarter's north wall line — the other
 *  districts' language: the north-west corner (shared with the
 *  west wall's head) and the north run's midpoint. The east
 *  corners carry the plaza's own columns already (28.2, 19.2)
 *  stands mid-east-wall and (28.2, 26.05) just south of the
 *  south-east corner; the south-west corner carries no pier —
 *  the south bridge lane passes there, and a pier's footprint
 *  would seal it. */
export const HEIGHTS_PIERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 13.5, z: 15.9 },
  { x: 20.85, z: 15.9 },
];

/* ── The gate walkway ─────────────────────────────────────────────
 * A marble strip on the gate's line (z 24.6) running east from
 * the gate to the residents' court, with gold edge strips — the
 * plaza spine's language, turned east, exactly as the Row's
 * street and the Ateliers' lane. Flat accent only: no
 * collision, like every path on the grounds. The fronts, the
 * terraces and the lamps all address the court it leads to. */

export const HEIGHTS_WALKWAY = {
  fromX: 13.5, toX: 20.85, cz: 24.6, w: 2.2,
} as const;

/* ── The residence fronts ─────────────────────────────────────────
 * Three residence fronts lining the north wall, opening south
 * onto the court: four posts, a fabric canopy on their heads,
 * and a DOOR PANEL closing the front's back — a residence door
 * in dark metal with a gold trim, its transom window warm at
 * dusk (emissive only; zero new real lights). The fronts are
 * scenery honouring the creator-rooms concept: the creators'
 * doors on the quarter where their rooms live. The posts and
 * the door panel are solid; the canopy rides above the walker's
 * head (its posts are). */

export interface HeightsFront {
  /** The front's centre. */
  x: number;
  z: number;
}

export const HEIGHTS_FRONTS: readonly HeightsFront[] = [
  { x: 17.3, z: 17.6 },
  { x: 20.85, z: 17.6 },
  { x: 24.4, z: 17.6 },
];

export const FRONT_KIT = {
  /** Post offsets from the front's centre, and their height. */
  postDx: 1.5,
  postDz: 0.9,
  postH: 2.6,
  postBlockHalf: 0.14,
  /** The canopy slab the posts carry. */
  canopyW: 3.6,
  canopyD: 2.4,
  canopyY: 2.68,
  /** The door panel closing the front's back (its north line):
   *  a residence door with a lit transom above it. */
  doorW: 1.6,
  doorH: 2.3,
  doorD: 0.16,
  doorBackOff: 0.9,
} as const;

/** One front's post positions. */
export function frontPosts(front: HeightsFront): Array<{ x: number; z: number }> {
  return [
    { x: front.x - FRONT_KIT.postDx, z: front.z - FRONT_KIT.postDz },
    { x: front.x + FRONT_KIT.postDx, z: front.z - FRONT_KIT.postDz },
    { x: front.x - FRONT_KIT.postDx, z: front.z + FRONT_KIT.postDz },
    { x: front.x + FRONT_KIT.postDx, z: front.z + FRONT_KIT.postDz },
  ];
}

export const HEIGHTS_FRONT_POSTS: ReadonlyArray<{ x: number; z: number }> =
  HEIGHTS_FRONTS.flatMap(frontPosts);

/** One front's door panel, as a box (on the front's back line,
 *  between its back posts). */
export function frontDoor(front: HeightsFront): GroundsBox {
  return {
    cx: front.x, cy: FRONT_KIT.doorH / 2, cz: front.z - FRONT_KIT.doorBackOff,
    w: FRONT_KIT.doorW, h: FRONT_KIT.doorH, d: FRONT_KIT.doorD,
  };
}

export const HEIGHTS_FRONT_DOORS: readonly GroundsBox[] = HEIGHTS_FRONTS.map(frontDoor);

/* ── The overlook terraces ────────────────────────────────────────
 * Two raised stone terraces along the court's south edge — the
 * quarter's overlooks, where residents stand above the court in
 * the telling. Like the Stage Grounds' platform, the Boardwalk
 * bandstand and item 38's terraces, the elevation is VISUAL:
 * flat-plane movement does not climb, so each terrace's whole
 * footprint is honestly blocked — you take the view from the
 * court, and the steps on its north face read as ceremony.
 * Planting crowns dress each terrace's top. */

export const HEIGHTS_TERRACES: readonly GroundsBox[] = [
  { cx: 21.0, cy: 0.225, cz: 24.3, w: 4.2, h: 0.45, d: 1.7 },
  { cx: 25.9, cy: 0.225, cz: 24.3, w: 3.0, h: 0.45, d: 1.7 },
];

/** The ceremonial steps on each terrace's north face: a shallow
 *  rise INSIDE the terrace's blocked footprint (it dresses the
 *  terrace's edge, never the walk path — the footprint is
 *  blocked whole, steps included). */
export const HEIGHTS_TERRACE_STEPS: readonly GroundsBox[] =
  HEIGHTS_TERRACES.map((t) => ({
    cx: t.cx, cy: 0.075, cz: t.cz - t.d / 2 + 0.25, w: 2.0, h: 0.15, d: 0.5,
  }));

/** Planting crowns along each terrace's top, evenly spaced —
 *  placed as a list so the scene instances them with item-18
 *  variation, and pinned here so a crown can never drift off
 *  its terrace. */
export const HEIGHTS_TERRACE_CROWNS: ReadonlyArray<{ x: number; z: number }> =
  HEIGHTS_TERRACES.flatMap((t) => {
    const crowns: Array<{ x: number; z: number }> = [];
    const n = Math.max(2, Math.round(t.w / 1.4));
    for (let i = 0; i < n; i++) {
      crowns.push({ x: t.cx - t.w / 2 + (i + 0.5) * (t.w / n), z: t.cz });
    }
    return crowns;
  });

/* ── Benches, planters, lamps, banners ──────────────────────────── */

/** Benches on the residents' court: two facing each other across
 *  the court's heart, and one north of the terraces facing south
 *  over them — the sitting the quarter is furnished for.
 *  `facing` is the direction a sitter looks, along Z: +1 south,
 *  −1 north (the Boardwalk bench law). */
export const HEIGHTS_BENCHES: ReadonlyArray<{ x: number; z: number; facing: 1 | -1 }> = [
  { x: 17.4, z: 20.0, facing: 1 },
  { x: 24.3, z: 20.0, facing: -1 },
  { x: 20.85, z: 22.6, facing: 1 },
];

/** Planting beds dressing the quarter: a long bed against the
 *  west wall south of the gate walkway's north side, and a bed
 *  in the north-east corner east of the last residence front —
 *  stone-edged boxes of green with planting crowns along their
 *  tops. The beds are solid. */
export const HEIGHTS_PLANTERS: readonly GroundsBox[] = [
  { cx: 15.9, cy: 0.275, cz: 20.8, w: 1.2, h: 0.55, d: 4.4 },
  { cx: 26.6, cy: 0.275, cz: 17.6, w: 2.2, h: 0.55, d: 1.2 },
];

/** Planting crowns along each bed's top — placed as a list so
 *  the scene instances them with item-18 variation, and pinned
 *  here so a crown can never drift off its bed. The west bed's
 *  crowns run along Z; the corner bed's run along X. */
export const HEIGHTS_PLANTER_CROWNS: ReadonlyArray<{ x: number; z: number }> = [
  ...[0, 1, 2, 3].map((i) => ({ x: 15.9, z: 19.15 + i * 1.1 })),
  ...[0, 1, 2].map((i) => ({ x: 25.9 + i * 0.7, z: 17.6 })),
];

/** The quarter's lantern standards (plaza-life's LAMP
 *  construction): flanking the gate walkway inside the gate, one
 *  on the court's east reach, one by the east terrace.
 *  Emissive heads + glow sprites after dark; zero real lights. */
export const HEIGHTS_LAMPS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 14.9, z: 21.6 },
  { x: 14.9, z: 25.0 },
  { x: 23.6, z: 19.3 },
  { x: 26.9, z: 23.0 },
];

/** Banner poles flanking the gate walkway where it meets the
 *  court: a gold-rod pole with a hanging fabric banner in the
 *  look's cloth — the quarter's colours at its heart, answering
 *  the gate's plate at its entry. */
export const HEIGHTS_BANNER_POLES: ReadonlyArray<{ x: number; z: number }> = [
  { x: 19.6, z: 23.2 },
  { x: 22.1, z: 23.2 },
];
export const HEIGHTS_BANNER_POLE = { h: 4.2, blockHalf: 0.2 } as const;

/* ── The batch's collision, derived ───────────────────────────────
 * Every solid above, as blocked rects — palace-layout registers
 * this list as the room's `blocked`, so the quarter's walls,
 * piers, front posts and doors, terraces, benches, planters,
 * lamps and poles are solid in the same commit that makes them
 * visible. The walkway, the paving and the fronts' open mouths
 * are ground, deliberately absent. The quarter's east side is
 * the plaza's own east wall — already blocked as the plaza's,
 * and isWalkable judges every room's list, so the shared wall
 * is solid from this side too. */

export const HEIGHTS_BLOCKED: readonly PalaceRect[] = [
  ...HEIGHTS_WALL_RUNS.map((r) => rectAround(r.x, r.z, r.w / 2, r.d / 2)),
  ...HEIGHTS_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...HEIGHTS_FRONT_POSTS.map((p) => rectAround(p.x, p.z, FRONT_KIT.postBlockHalf, FRONT_KIT.postBlockHalf)),
  ...HEIGHTS_FRONT_DOORS.map(rectOf),
  ...HEIGHTS_TERRACES.map(rectOf),
  ...HEIGHTS_BENCHES.map((b) => rectAround(b.x, b.z, BENCH.blockHalfX, BENCH.blockHalfZ)),
  ...HEIGHTS_PLANTERS.map(rectOf),
  ...HEIGHTS_LAMPS.map((l) => rectAround(l.x, l.z, LAMP.blockHalf, LAMP.blockHalf)),
  ...HEIGHTS_BANNER_POLES.map((p) => rectAround(p.x, p.z, HEIGHTS_BANNER_POLE.blockHalf, HEIGHTS_BANNER_POLE.blockHalf)),
];

/** The district's camera-tall solids (item 44's rule): the wall
 *  piers (cap ~4.0 m), the banner poles (4.2 m) and the front
 *  posts (2.6 m — over the 2.45 m camera line, so the lens keeps
 *  off the canopies they carry). The doors (2.3 m), terraces,
 *  benches, planters, lamps and low walls pass under the lens. */
export const HEIGHTS_TALL_BLOCKED: readonly PalaceRect[] = [
  ...HEIGHTS_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...HEIGHTS_BANNER_POLES.map((p) => rectAround(p.x, p.z, HEIGHTS_BANNER_POLE.blockHalf, HEIGHTS_BANNER_POLE.blockHalf)),
  ...HEIGHTS_FRONT_POSTS.map((p) => rectAround(p.x, p.z, FRONT_KIT.postBlockHalf, FRONT_KIT.postBlockHalf)),
];
