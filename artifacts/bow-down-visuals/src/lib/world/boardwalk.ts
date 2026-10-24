/**
 * boardwalk.ts — THE BOARDWALK district, as pure placement data
 * (Open World Overhaul, Stage C batch C8: board item 35).
 *
 * Until this batch the Boardwalk was a BARRED GATE — a real gap
 * in the plaza's south wall at (0, 34.0), closed by a gold bar
 * because nothing existed beyond it. This batch builds the real
 * waterfront quarter the gate always promised, following the
 * Stage Grounds / Listening Gardens / Creation Row / Ateliers
 * pattern (items 31–34): the bar comes off, the gate is
 * reclassified OPEN (district-gates.ts + palace-layout's
 * PLAZA_GATES, in agreement), and the gap becomes a true passage
 * into a new palace room (`world:boardwalk` in palace-layout,
 * mirrored server-side in world-palace.ts).
 *
 * The quarter's geography has one honest complication the other
 * districts did not face, stated plainly: the ground directly
 * south of the south wall is not all empty. The Creator Rooms
 * building stands in the middle of the strip (its template
 * interior runs x 2.6..16.4, z 26.4..38.0, poking south of the
 * wall line), so the Boardwalk threads AROUND it, never through
 * it — palace floor-plan law is a partition: walk rects never
 * overlap another room's. An entry corridor west of the
 * building carries the gate walk south from the wall; a pocket
 * east of the building dresses the strip's east end; and the
 * main deck — the waterfront promenade proper — opens out
 * south of the building, spanning the full Gardens-to-Ateliers
 * width (x −13..28.2) down to the water at z 60.
 *
 * The quarter is a waterfront promenade: a TIMBER DECK (dark
 * warm wood with gold trim at dusk, pale sun-bleached by day —
 * the deck-style law below; NOT interior marble, and not the
 * outdoor paving either: a boardwalk is wood), promenade
 * stalls, benches facing the water, lantern standards, banner
 * poles, a small BANDSTAND as the quarter's heart (a raised
 * platform with posts and a roof — visual elevation, its whole
 * footprint honestly blocked, the stage-grounds platform
 * precedent), and along the south edge a WATER BASIN in a stone
 * rim holding real animated water (the pool/rill construction:
 * a cloned water texture the tick scrolls) behind a railing —
 * the backdrop moat's near edge glints just beyond the south
 * wall, so the quarter's south edge meets water inside and out.
 * ONE station, the Boardwalk Slate, on the Kingdom Board panel
 * pattern like the slates before it (the registry law: one
 * station per district, no new verbs, guests included).
 *
 * The house laws this module follows (ateliers / creation-row /
 * listening-gardens / stage-grounds / palace-grounds /
 * plaza-life):
 *   1. Every SOLID is registered as a blocked rect in
 *      palace-layout DERIVED from this same data
 *      (BOARDWALK_BLOCKED below) — a visible body and its
 *      collision can never drift.
 *   2. The ground wears its own system: timber deck planks over
 *      a paving underlay — never interior marble.
 *   3. NO new real lights. The quarter's lantern standards glow
 *      by emissive glass + the item-27 lantern-glow sprites
 *      after dark, inside the ladder's existing budget.
 *   4. Repeated pieces are placed as lists so the scene
 *      instances them (deck planks, stall posts, bench parts,
 *      lamp parts, railing posts, planting crowns).
 *
 * The look (Living Night Palace + its golden-day twin) is worn
 * through hall-looks' textures and the deck style below;
 * geometry here is look-independent.
 */
import type { PalaceRect, PlazaWallRun } from "./palace-layout";
import type { GroundsBox } from "./palace-grounds";
import type { HallTheme } from "./hall-looks";
import { BENCH, LAMP, pollenVolumeForInterior, type PollenVolume } from "./plaza-life";
import { STALL_KIT, stallBench, stallPosts, type RowStall } from "./creation-row";

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
 * The main deck fills the ground south of the Creator Rooms
 * building, between the Listening Gardens (west, x −13) and the
 * Ateliers (east, x 28.2): interior x −13..28.2, z 38..60. The
 * two north strips (the grounds in palace-layout) dress the
 * strip south of the plaza wall on either side of the building:
 * the entry strip west of it (x −13..2.6, z 34..38, carrying the
 * gate corridor on the gate's own line, x 0) and the east pocket
 * (x 16.4..28.2, z 34..38). Inside the 90 m sky dome from every
 * viewpoint; the backdrop moat's inner edge (radius 44 from
 * (0, 23)) passes ~7 m south of the deck's south wall on the
 * gate's line and closer still toward its east end — the water
 * is genuinely near. */

export const BOARDWALK_INTERIOR: PalaceRect = {
  minX: -13.0, maxX: 28.2, minZ: 38.0, maxZ: 60.0,
};

/** Daylight motes (Stack-100 #3, item-4 retry): the quarter's
 *  air volume for plaza-life's pollen system — the day look's
 *  drifting motes, inset from the walls past their wander. */
export const BOARDWALK_MOTES: PollenVolume = pollenVolumeForInterior(BOARDWALK_INTERIOR);

/** The two north strips' floor rects (the scene decks them like
 *  the main quarter; palace-layout carries them as the room's
 *  `grounds`). Neither touches the Creator Rooms building's
 *  footprint (x 2.6..16.4, z ..38): the entry strip stops at its
 *  west wall line, the pocket starts at its east wall line. */
export const BOARDWALK_NORTH_FLOORS: readonly PalaceRect[] = [
  { minX: -13.0, maxX: 2.6, minZ: 34.0, maxZ: 38.0 },
  { minX: 16.4, maxX: 28.2, minZ: 34.0, maxZ: 38.0 },
];

/** Every floor rect the scene decks (main + the north strips). */
export const BOARDWALK_FLOOR_RECTS: readonly PalaceRect[] = [
  BOARDWALK_INTERIOR,
  ...BOARDWALK_NORTH_FLOORS,
];

/** Where a figure's centre may stand on the main deck: inside
 *  the quarter's own perimeter walls by the plaza's house
 *  clearance (the wall face plus 0.175 m). The north strips are
 *  the room's grounds (palace-layout), overlapping this rect's
 *  north edge so a step may pass between them. */
export const BOARDWALK_WALK: PalaceRect = {
  minX: -12.65, maxX: 27.85, minZ: 38.35, maxZ: 59.65,
};

/** The room's walkable grounds beyond the main deck: the entry
 *  strip (with the gate corridor) west of the Creator Rooms
 *  building, and the east pocket. Both overlap BOARDWALK_WALK's
 *  north edge; neither overlaps the building's walk rect
 *  (x 2.95..16.05, z ..37.65) — the strips stop at its wall
 *  lines with the house clearance to spare. */
export const BOARDWALK_GROUNDS: readonly PalaceRect[] = [
  { minX: -12.65, maxX: 2.35, minZ: 34.35, maxZ: 38.6 },
  { minX: 16.6, maxX: 27.85, minZ: 34.35, maxZ: 38.6 },
];

export const BOARDWALK_CAM_CLAMP: PalaceRect = {
  minX: -12.8, maxX: 28.0, minZ: 33.8, maxZ: 59.8,
};

/** Where a transfer with no crossing point lands: just inside
 *  the gate, on the entry corridor, facing the deck. */
export const BOARDWALK_SPAWN = { x: 0, z: 36.2 } as const;

/** The quarter's own low walls (the plaza enclosure's language:
 *  0.35 m thick, gold-capped in the scene): the main deck's west,
 *  south and east-south runs, and the two short flanks closing
 *  the north strips against the Creator Rooms building's walls.
 *  The rest of the perimeter is shared and already standing:
 *  the west strip's west edge and the deck's west edge north of
 *  z 38 are the Gardens' east wall; the east edge north of
 *  z 53.5 is the Ateliers' west wall; the strips' north edge is
 *  the plaza's own south wall, with the gate gap in it, now a
 *  true passage. */
export const BOARDWALK_WALL_RUNS: readonly PlazaWallRun[] = [
  { w: 0.35, d: 22.0, x: -13.0, z: 49.0 },
  { w: 41.2, d: 0.35, x: 7.6, z: 60.0 },
  { w: 0.35, d: 6.5, x: 28.2, z: 56.75 },
  { w: 0.35, d: 4.0, x: 2.6, z: 36.0 },
  { w: 0.35, d: 4.0, x: 16.4, z: 36.0 },
];

/** Grounded piers on the quarter's south wall line — the other
 *  districts' language: the two corners and the midpoint. */
export const BOARDWALK_PIERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -13.0, z: 60.0 },
  { x: 7.6, z: 60.0 },
  { x: 28.2, z: 60.0 },
];

/* ── The timber deck ──────────────────────────────────────────────
 * The promenade's ground: timber planks laid along the deck's
 * length (east–west), each a 4 m board-length at most, with a
 * board's gap between rows — built as ONE instanced draw in the
 * scene from the lists below. The palette is the direction's:
 * dark warm wood with the gold of the trim at dusk; pale
 * sun-bleached boards by day. Rough, never glossy — a deck is
 * walked on in all weathers. */

export const DECK_PLANK = {
  /** Board length along X (the promenade's run). */
  len: 4,
  /** Row pitch along Z and the board's own depth (the gap
   *  between boards is pitch − depth). */
  pitch: 0.94,
  depth: 0.86,
  /** Board thickness; the deck's top stands this proud of the
   *  underlay. */
  h: 0.03,
} as const;

/** The deck's palette per look (the deck-style law, kin to
 *  palace-grounds' backdropWindowStyle): black-marble night
 *  gets dark warm timber; the golden day gets sun-bleached
 *  boards. Trim gold is the look's own, in the scene. */
export function boardwalkDeckStyle(theme: HallTheme): { color: number; roughness: number } {
  return theme === "dark"
    ? { color: 0x4a3018, roughness: 1 }
    : { color: 0xc9a877, roughness: 0.95 };
}

/** Whole board-length planks covering one floor rect: columns of
 *  at most DECK_PLANK.len along X (the rect's width divided
 *  evenly so no board overhangs), rows at the plank pitch along
 *  Z, centred so the margins split evenly. Every plank lies
 *  inside its rect, by construction. */
export function deckPlanksFor(rect: PalaceRect): GroundsBox[] {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  const nx = Math.max(1, Math.ceil(w / DECK_PLANK.len));
  const pw = w / nx;
  const nz = Math.max(1, Math.floor(d / DECK_PLANK.pitch));
  const z0 = rect.minZ + (d - nz * DECK_PLANK.pitch) / 2;
  const out: GroundsBox[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      out.push({
        cx: rect.minX + (ix + 0.5) * pw,
        cy: DECK_PLANK.h / 2,
        cz: z0 + (iz + 0.5) * DECK_PLANK.pitch,
        w: pw - 0.04,
        h: DECK_PLANK.h,
        d: DECK_PLANK.depth,
      });
    }
  }
  return out;
}

/** Every deck plank on the quarter (the scene instances these —
 *  one draw for the whole promenade's wearing surface). */
export const BOARDWALK_DECK_PLANKS: readonly GroundsBox[] =
  BOARDWALK_FLOOR_RECTS.flatMap(deckPlanksFor);

/* ── The promenade stalls ─────────────────────────────────────────
 * Six stalls in the Creation Row kit (imported, not reinvented):
 * four along the deck's north edge opening south onto the
 * promenade, two on its south reach opening north toward the
 * bandstand — the boardwalk's pitches: prints, refreshments,
 * waterfront wares. The posts and the workbench are solid; the
 * canopy rides above the walker's head (its posts are). */

export type BoardwalkStall = RowStall;

export const BOARDWALK_STALLS: readonly BoardwalkStall[] = [
  { x: -8.0, z: 41.3, side: 1 },
  { x: 3.0, z: 41.3, side: 1 },
  { x: 14.0, z: 41.3, side: 1 },
  { x: 24.5, z: 41.3, side: 1 },
  { x: -4.0, z: 52.5, side: -1 },
  { x: 18.0, z: 52.5, side: -1 },
];

export const BOARDWALK_STALL_POSTS: ReadonlyArray<{ x: number; z: number }> =
  BOARDWALK_STALLS.flatMap(stallPosts);

export const BOARDWALK_STALL_BENCHES: readonly GroundsBox[] = BOARDWALK_STALLS.map(stallBench);

export { STALL_KIT };

/* ── The bandstand ────────────────────────────────────────────────
 * The quarter's heart, on the deck's centre (x 7.6 — the south
 * wall's midpoint line, the gate's axis continued): a raised
 * round platform with six slender posts, a gold ring beam and a
 * shallow cone roof — a viewing platform and a small stage for
 * whoever takes it. Like the Stage Grounds' platform (and item
 * 38's precedent), the elevation is VISUAL: flat-plane movement
 * does not climb, so the whole footprint is honestly blocked —
 * you watch from the deck, and the steps on its north face read
 * as ceremony. The posts are solid on the platform's own
 * footprint, already inside its blocked rect. */

export const BANDSTAND = {
  cx: 7.6,
  cz: 49.0,
  /** The platform: a low round deck of the promenade's timber
   *  on a stone rim. */
  platformR: 3.1,
  platformH: 0.45,
  /** The posts' ring radius and height. */
  postR: 2.55,
  postH: 2.7,
  /** The roof: a shallow cone above the posts, gold-trimmed. */
  roofY: 2.95,
  roofR: 3.6,
  roofH: 0.9,
  postBlockHalf: 0.16,
  /** The blocked half-extent: the platform's radius plus a
   *  walker's clearance — the rect palace-layout blocks. */
  blockHalf: 3.3,
} as const;

/** The six post positions, evenly around the ring. */
export const BANDSTAND_POSTS: ReadonlyArray<{ x: number; z: number }> = [0, 1, 2, 3, 4, 5].map((i) => {
  const a = (i / 6) * Math.PI * 2;
  return {
    x: Math.round((BANDSTAND.cx + Math.cos(a) * BANDSTAND.postR) * 100) / 100,
    z: Math.round((BANDSTAND.cz + Math.sin(a) * BANDSTAND.postR) * 100) / 100,
  };
});

/** The ceremonial steps on the platform's north face: two
 *  shallow rises INSIDE the blocked footprint (they dress the
 *  platform's edge, never the walk path — the footprint is
 *  blocked whole, steps included). */
export const BANDSTAND_STEPS: readonly GroundsBox[] = [
  { cx: BANDSTAND.cx, cy: 0.075, cz: BANDSTAND.cz - 2.95, w: 2.2, h: 0.15, d: 0.5 },
  { cx: BANDSTAND.cx, cy: 0.15, cz: BANDSTAND.cz - 2.75, w: 2.2, h: 0.3, d: 0.5 },
];

export const BANDSTAND_BLOCKED: PalaceRect =
  rectAround(BANDSTAND.cx, BANDSTAND.cz, BANDSTAND.blockHalf, BANDSTAND.blockHalf);

/* ── The water basin and its railing ──────────────────────────────
 * A long basin of real water along the deck's south edge, in a
 * low stone rim (the gardens rill / plaza pool construction,
 * stretched the promenade's length): still animated water — a
 * cloned texture the tick scrolls — held just under the rim.
 * A railing runs along its deck edge: gold-capped posts and two
 * rails, so the promenade's end reads as a waterfront, not a
 * wall. The basin is solid like the pool: a walker rounds it or
 * watches from the railing, never wades. The backdrop moat
 * glints beyond the south wall behind it. */

export const BOARDWALK_BASIN = {
  cx: 7.6,
  cz: 57.7,
  /** Outer footprint (the rim's outside edge). */
  w: 39.2,
  d: 3.4,
  /** The stone rim: height above the deck, width of its lip. */
  rimH: 0.3,
  rimLip: 0.25,
  /** The water surface's height — held just below the rim's top. */
  waterY: 0.23,
} as const;

/** The railing on the basin's deck edge: posts at a steady
 *  spacing along its north line, a top rail at hand height. The
 *  posts stand inside BASIN_BLOCKED — the water's blocked band
 *  covers the railing line, so the railing needs no rects of its
 *  own. */
export const BOARDWALK_RAILING = {
  fromX: -12.0,
  toX: 27.2,
  z: 55.65,
  postEvery: 2.18,
  railY: 0.95,
  postH: 0.95,
} as const;

export const BOARDWALK_RAILING_POSTS: ReadonlyArray<{ x: number; z: number }> = (() => {
  const posts: Array<{ x: number; z: number }> = [];
  const n = Math.round((BOARDWALK_RAILING.toX - BOARDWALK_RAILING.fromX) / BOARDWALK_RAILING.postEvery);
  const step = (BOARDWALK_RAILING.toX - BOARDWALK_RAILING.fromX) / n;
  for (let i = 0; i <= n; i++) {
    posts.push({
      x: Math.round((BOARDWALK_RAILING.fromX + i * step) * 100) / 100,
      z: BOARDWALK_RAILING.z,
    });
  }
  return posts;
})();

/** The basin's blocked band: the water's footprint widened
 *  north to swallow the railing line — deck to rim, one honest
 *  rect a walker stops at. */
export const BASIN_BLOCKED: PalaceRect = {
  minX: BOARDWALK_BASIN.cx - BOARDWALK_BASIN.w / 2,
  maxX: BOARDWALK_BASIN.cx + BOARDWALK_BASIN.w / 2,
  minZ: BOARDWALK_RAILING.z - 0.15,
  maxZ: BOARDWALK_BASIN.cz + BOARDWALK_BASIN.d / 2,
};

/* ── Benches, planters, lamps, banners ──────────────────────────── */

/** Benches on the promenade: three along the water railing
 *  facing south over the basin (backs to the deck), and one in
 *  each north strip facing the gate line (backs to the south) —
 *  the sitting the quarter is furnished for. `facing` is the
 *  direction a sitter looks, along Z: +1 south, −1 north. */
export const BOARDWALK_BENCHES: ReadonlyArray<{ x: number; z: number; facing: 1 | -1 }> = [
  { x: -6.0, z: 54.3, facing: 1 },
  { x: 7.6, z: 54.3, facing: 1 },
  { x: 20.0, z: 54.3, facing: 1 },
  { x: -8.0, z: 37.3, facing: -1 },
  { x: 22.0, z: 37.3, facing: -1 },
];

/** Planting beds dressing the two north strips: a stone-edged
 *  box of green with planting crowns along its top, set against
 *  the south wall in each strip — the soft edge between the
 *  plaza wall and the deck. The beds are solid. */
export const BOARDWALK_PLANTERS: readonly GroundsBox[] = [
  { cx: -8.0, cy: 0.275, cz: 35.2, w: 6.0, h: 0.55, d: 1.2 },
  { cx: 22.0, cy: 0.275, cz: 35.2, w: 6.0, h: 0.55, d: 1.2 },
];

/** Planting crowns along each bed's top, evenly spaced — placed
 *  as a list so the scene instances them with item-18 variation,
 *  and pinned here so a crown can never drift off its bed. */
export const BOARDWALK_PLANTER_CROWNS: ReadonlyArray<{ x: number; z: number }> =
  BOARDWALK_PLANTERS.flatMap((p) => {
    const crowns: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 4; i++) {
      crowns.push({ x: p.cx - 2.25 + i * 1.5, z: p.cz });
    }
    return crowns;
  });

/** The quarter's lantern standards (plaza-life's LAMP
 *  construction): pairs flanking the promenade's run and the
 *  bandstand approach. Emissive heads + glow sprites after
 *  dark; zero real lights. */
export const BOARDWALK_LAMPS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -11.0, z: 42.5 },
  { x: 0.0, z: 44.0 },
  { x: 15.0, z: 44.0 },
  { x: 26.0, z: 42.5 },
  { x: -11.0, z: 52.0 },
  { x: 26.0, z: 52.0 },
];

/** Banner poles flanking the bandstand's north approach: a
 *  gold-rod pole with a hanging fabric banner in the look's
 *  cloth — the quarter's colours at its heart, answering the
 *  gate's plate at its entry. */
export const BOARDWALK_BANNER_POLES: ReadonlyArray<{ x: number; z: number }> = [
  { x: 3.4, z: 44.6 },
  { x: 11.8, z: 44.6 },
];
export const BOARDWALK_BANNER_POLE = { h: 4.2, blockHalf: 0.2 } as const;

/* ── Stack-100 #2: the prize wheel (item 29) ──────────────────────
 * The boardwalk's game stand, west of the bandstand: a gold-rimmed
 * wheel on a dark post over a stone base, segment pegs around its
 * rim and a pointer at its head. It MOVES — the boardwalk's first
 * animated game: an idle creep, and a full spin on a slow cycle
 * (wheelAngleAt below — pure, so the motion is pinned without a
 * renderer). The stand is solid from this same data. */

export const BOARDWALK_WHEEL = {
  x: -9.5,
  z: 47.0,
  /** The wheel's radius and its axle height. */
  r: 0.85,
  axleY: 1.55,
  /** Segment pegs around the rim. */
  pegs: 12,
  blockHalf: 0.55,
} as const;

/** The wheel's angle (radians) at time `t` seconds: a gentle idle
 *  creep, plus one eased full spin inside every 24 s cycle (the
 *  spin runs t mod 24 ∈ [8, 14), smoothstepped so it starts and
 *  settles without a jolt). Deterministic — the same t always
 *  letters the same angle, in both looks. */
export function wheelAngleAt(t: number): number {
  const cycle = ((t % 24) + 24) % 24;
  let spin = 0;
  if (cycle >= 8) {
    const u = Math.min(1, (cycle - 8) / 6);
    spin = u * u * (3 - 2 * u) * Math.PI * 4;
  }
  return t * 0.12 + spin + Math.floor(t / 24) * Math.PI * 4;
}

/* ── The batch's collision, derived ───────────────────────────────
 * Every solid above, as blocked rects — palace-layout registers
 * this list as the room's `blocked`, so the quarter's walls,
 * piers, stall posts and benches, the bandstand's whole
 * footprint, the basin + railing band, the benches, planters,
 * lamps and poles are solid in the same commit that makes them
 * visible. The deck, the corridor and the stalls' open mouths
 * are ground, deliberately absent. The shared perimeter (the
 * Gardens' east wall, the Ateliers' west wall, the plaza's
 * south wall) is already blocked as those rooms' own — and
 * isWalkable judges every room's list, so the shared walls are
 * solid from this side too. */

export const BOARDWALK_BLOCKED: readonly PalaceRect[] = [
  ...BOARDWALK_WALL_RUNS.map((r) => rectAround(r.x, r.z, r.w / 2, r.d / 2)),
  ...BOARDWALK_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...BOARDWALK_STALL_POSTS.map((p) => rectAround(p.x, p.z, STALL_KIT.postBlockHalf, STALL_KIT.postBlockHalf)),
  ...BOARDWALK_STALL_BENCHES.map(rectOf),
  BANDSTAND_BLOCKED,
  ...BANDSTAND_POSTS.map((p) => rectAround(p.x, p.z, BANDSTAND.postBlockHalf, BANDSTAND.postBlockHalf)),
  BASIN_BLOCKED,
  ...BOARDWALK_BENCHES.map((b) => rectAround(b.x, b.z, BENCH.blockHalfX, BENCH.blockHalfZ)),
  ...BOARDWALK_PLANTERS.map(rectOf),
  ...BOARDWALK_LAMPS.map((l) => rectAround(l.x, l.z, LAMP.blockHalf, LAMP.blockHalf)),
  ...BOARDWALK_BANNER_POLES.map((p) => rectAround(p.x, p.z, BOARDWALK_BANNER_POLE.blockHalf, BOARDWALK_BANNER_POLE.blockHalf)),
  rectAround(BOARDWALK_WHEEL.x, BOARDWALK_WHEEL.z, BOARDWALK_WHEEL.blockHalf, BOARDWALK_WHEEL.blockHalf),
];

/** The district's camera-tall solids (item 44's rule): the wall
 *  piers (cap ~4.0 m), the banner poles (4.2 m), the stall posts
 *  (2.7 m — over the 2.45 m camera line, so the lens keeps off
 *  the canopies they carry) and the bandstand posts (2.7 m, so
 *  the lens keeps off its roof). The benches, planters, lamps,
 *  basin and low walls pass under the lens. */
export const BOARDWALK_TALL_BLOCKED: readonly PalaceRect[] = [
  ...BOARDWALK_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...BOARDWALK_BANNER_POLES.map((p) => rectAround(p.x, p.z, BOARDWALK_BANNER_POLE.blockHalf, BOARDWALK_BANNER_POLE.blockHalf)),
  ...BOARDWALK_STALL_POSTS.map((p) => rectAround(p.x, p.z, STALL_KIT.postBlockHalf, STALL_KIT.postBlockHalf)),
  ...BANDSTAND_POSTS.map((p) => rectAround(p.x, p.z, BANDSTAND.postBlockHalf, BANDSTAND.postBlockHalf)),
];
