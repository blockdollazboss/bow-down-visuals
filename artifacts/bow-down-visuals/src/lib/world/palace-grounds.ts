/**
 * palace-grounds.ts — the King's Plaza GROUNDS, as pure placement
 * data (Open World Overhaul, Stage C batch C2: board items 5, 6,
 * 8, 17, 38).
 *
 * Until this batch the plaza's outdoors were an indoor room turned
 * sideways (audit geometry #1/#4/#5/#15): the broad floor was the
 * hall's interior marble, the two lawns were flat plastic-colour
 * slabs covering ~37% of the grounds, the monument was a modest
 * stele with 0.09 m sphere finials in a 974 m² plaza, the world
 * ended at a 1.05 m wall against void, and everything stood dead
 * flat. This module is the plan the scene builds the grounds from
 * — every piece in world metres — so the tests can pin the laws
 * without a GL context:
 *
 *   1. WALK SEMANTICS NEVER MOVE. The movement system is a flat
 *      plane (palace-layout's resolvePalaceMove has no Y). Every
 *      solid this module adds either stands OUTSIDE the courtyard
 *      walk/grounds rects entirely, or is registered as a blocked
 *      rect in palace-layout DERIVED from this same data — a
 *      visible body and its collision can never drift apart.
 *   2. The monument keeps its heart: same centre (0, 19.7), same
 *      plate drum centre height, same four lettered faces at the
 *      same size (item 16's real headlines render exactly as
 *      before) — it grows AROUND that heart: a wider stepped
 *      plinth, a taller bevelled stele, relief banding, and a real
 *      crown-and-orb finial in place of the 0.09 m spheres.
 *   3. The backdrop ring (item 5) lives beyond the perimeter wall,
 *      inside the camera's far plane from every plaza viewpoint
 *      (and inside the 90 m sky dome from the plaza's heart),
 *      built from fog-accepting
 *      materials on purpose: the per-area courtyard fog is what
 *      gives it depth. Silhouettes, not detail — unlit masses, a
 *      handful of draws, emissive windows only (never a light).
 *
 * The look (Living Night Palace + its golden-day twin) is worn
 * through hall-looks' per-look texture URLs — paving, lawn, water,
 * stone, gold-vein marble. Geometry here is look-independent.
 */
import type { HallTheme } from "./hall-looks";
import type { PalaceRect } from "./palace-layout";

export interface GroundsBox {
  cx: number;
  cy: number;
  cz: number;
  w: number;
  h: number;
  d: number;
}

const rectOf = (b: GroundsBox): PalaceRect => ({
  minX: b.cx - b.w / 2,
  maxX: b.cx + b.w / 2,
  minZ: b.cz - b.d / 2,
  maxZ: b.cz + b.d / 2,
});

/* ── Item 6: the outdoor ground system ────────────────────────────
 * The broad plaza floor stops being interior marble: the three
 * shell-floor rects of the courtyard become real PAVING (the art
 * lane's setts), at per-metre repeats with INTEGRAL tile counts
 * (the texture manifest's paving rule: joints stay even only when
 * a rect spans whole tiles). The shipped rects are NOT whole
 * tiles at 4 m/tile (56.4 m wide = 14.1 tiles), so the paving is
 * laid as a grid of whole-tile slabs — 4 m × 4 m each — with the
 * uncovered margins left to the rects' own underlay (the same
 * paving texture at a fractional repeat: the setts continue, only
 * the wearing slabs are guaranteed whole tiles). The marble language survives as the accent it always
 * was indoors: the central path, the arch spur, the gold trim. */

/** Paving slab size: exactly one texture tile (4 m at
 *  PAVING_METRES_PER_TILE) — every slab's repeat is exactly 1×1,
 *  integral by construction. */
export const PAVING_SLAB_M = 4;

/** The courtyard's floor rects (the scene's three shell floors,
 *  unchanged footprints) — the ground system's coverage plan. */
export const COURTYARD_FLOOR_RECTS: readonly PalaceRect[] = [
  { minX: -28.2, maxX: 28.2, minZ: 12.4, maxZ: 26.0 },
  { minX: -28.2, maxX: 2.6, minZ: 26.0, maxZ: 34.0 },
  { minX: 16.4, maxX: 28.2, minZ: 26.0, maxZ: 34.0 },
];

/** Whole-tile paving slabs covering one floor rect: a centred
 *  grid of PAVING_SLAB_M squares; margins split evenly on both
 *  sides so no slab is ever a partial tile. */
export function pavingSlabsFor(rect: PalaceRect): GroundsBox[] {
  const w = rect.maxX - rect.minX;
  const d = rect.maxZ - rect.minZ;
  const nx = Math.floor(w / PAVING_SLAB_M);
  const nz = Math.floor(d / PAVING_SLAB_M);
  const x0 = rect.minX + (w - nx * PAVING_SLAB_M) / 2;
  const z0 = rect.minZ + (d - nz * PAVING_SLAB_M) / 2;
  const out: GroundsBox[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      out.push({
        cx: x0 + (ix + 0.5) * PAVING_SLAB_M,
        cy: 0,
        cz: z0 + (iz + 0.5) * PAVING_SLAB_M,
        w: PAVING_SLAB_M,
        h: 0,
        d: PAVING_SLAB_M,
      });
    }
  }
  return out;
}

/** Every paving slab on the grounds (the scene instances these —
 *  one draw for the whole outdoor floor's wearing surface). */
export const PAVING_SLABS: readonly GroundsBox[] = COURTYARD_FLOOR_RECTS.flatMap(pavingSlabsFor);

/* ── Item 8: lawns & planting ─────────────────────────────────────
 * The two flat slabs become real lawns: textured grass at
 * per-metre repeats, sitting in a stone-edged bed, with a simple
 * parterre — a gold-trimmed centre medallion ring and low planting
 * masses in the planter-crown language. The panels keep EXACTLY
 * their shipped footprints (20.5 × 11.0 at (±16.75, 19.2)): lawn
 * walk semantics are untouched (lawns were never blocked and are
 * still not — you stroll across the grass as before; the beds and
 * edging stand at the panel's rim, inside its own footprint). */

export interface LawnPanel {
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** Top of the grass surface (the shipped slab's top: 0.05). */
  topY: number;
}

export const LAWN_PANELS: readonly LawnPanel[] = [
  { cx: -16.75, cz: 19.2, w: 20.5, d: 11.0, topY: 0.05 },
  { cx: 16.75, cz: 19.2, w: 20.5, d: 11.0, topY: 0.05 },
];

/** The stone bed each lawn sits in: a shallow ashlar rim proud of
 *  the paving by a hand's breadth, the grass inset within it. */
export const LAWN_BED = {
  /** Rim height above the ground plane. */
  rimH: 0.09,
  /** The grass surface's inset from the panel edge (the rim's
   *  visible width). */
  inset: 0.28,
} as const;

/** Stone edging runs around one lawn panel: four low ashlar
 *  strips on the panel's rim line. */
export function lawnEdgingRuns(panel: LawnPanel): GroundsBox[] {
  const t = LAWN_BED.inset;
  const y = LAWN_BED.rimH / 2;
  const { cx, cz, w, d } = panel;
  return [
    { cx, cy: y, cz: cz - d / 2 + t / 2, w, h: LAWN_BED.rimH, d: t },
    { cx, cy: y, cz: cz + d / 2 - t / 2, w, h: LAWN_BED.rimH, d: t },
    { cx: cx - w / 2 + t / 2, cy: y, cz, w: t, h: LAWN_BED.rimH, d: d - 2 * t },
    { cx: cx + w / 2 - t / 2, cy: y, cz, w: t, h: LAWN_BED.rimH, d: d - 2 * t },
  ];
}

/** The parterre's planting masses: low crown blobs (the planter
 *  crown language — icosahedron foliage with the item-18 variation
 *  system) in a symmetric pattern on each lawn: a ring of six
 *  around the medallion + four at the quarters. Positions are
 *  panel-local; lawnPlantingSpots resolves them to world. */
export const PARTERRE_RING_R = 2.6;
export const PARTERRE_SPOTS_LOCAL: ReadonlyArray<{ dx: number; dz: number }> = [
  ...[0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2;
    return { dx: Math.cos(a) * PARTERRE_RING_R, dz: Math.sin(a) * PARTERRE_RING_R };
  }),
  { dx: -7.6, dz: -3.4 },
  { dx: 7.6, dz: -3.4 },
  { dx: -7.6, dz: 3.4 },
  { dx: 7.6, dz: 3.4 },
];

export function lawnPlantingSpots(panel: LawnPanel): Array<{ x: number; z: number }> {
  return PARTERRE_SPOTS_LOCAL.map((s) => ({ x: panel.cx + s.dx, z: panel.cz + s.dz }));
}

/** The parterre medallion: a gold ring inlay at each lawn's heart,
 *  in the floor inlay's language (radii in metres). */
export const PARTERRE_MEDALLION = { innerR: 1.5, outerR: 1.62 } as const;

/* ── Item 17: the monument, grown ─────────────────────────────────
 * Same heart, bigger presence. The plinth widens (3.4 → 4.3 m
 * trim square) and gains a third step; the stele grows taller and
 * bevelled, wearing relief bands and a gold relief panel; the
 * crown becomes a real finial — a fluted crown cap, an orb and a
 * spike — and the four 0.09 m plinth-corner spheres are replaced
 * by proper urn finials on pedestals. The plate drum is UNCHANGED
 * (1.74 m housing, faces 1.4 × 1.96 at ±0.88, centre y 2.09):
 * item 16's headlines render exactly as today. The blocked rect
 * below is the new plinth's honest footprint — palace-layout
 * derives PLAZA_BLOCKED from it (same commit, by law). */

export const MONUMENT = {
  cx: 0,
  cz: 19.7,
  /** Plinth tiers, bottom to top (square footprints). */
  tier1: { size: 4.3, h: 0.24, topY: 0.24 },
  tier1Trim: { size: 4.46, h: 0.06 },
  tier2: { size: 3.5, h: 0.24, topY: 0.48 },
  tier2Trim: { size: 3.64, h: 0.05 },
  tier3: { size: 2.7, h: 0.22, topY: 0.7 },
  /** The stele: bevelled (wider at its foot), from tier3's top.
   *  topD is the taper's consequence (topW × baseD/baseW ≈ 0.49),
   *  recorded so the relief-band math follows the real surface. */
  stele: { baseW: 1.9, topW: 1.66, baseD: 0.56, topD: 0.49, baseY: 0.7, topY: 4.06 },
  /** Gold relief bands across the stele's front/back. */
  reliefBandYs: [1.06, 3.72] as readonly number[],
  /** The plate drum — item 16's housing, untouched. */
  drum: { size: 1.74, h: 2.1, centerY: 2.09, faceOffset: 0.88, faceW: 1.4, faceH: 1.96 },
  /** The crown: cap, orb, spike. */
  crown: { capBaseY: 4.06, capTopY: 4.62, capR: 1.18, orbY: 4.86, orbR: 0.21, spikeTopY: 5.42 },
  /** Urn finials on the plinth's corners (replacing the spheres):
   *  pedestals stand on tier 2's surface (half-width 1.75), so the
   *  corner line is ±1.55 and the urn base sits at tier2Top +
   *  pedestalH. */
  urns: { at: 1.55, pedestalH: 0.3, urnBaseY: 0.78, urnTopY: 1.38, urnR: 0.19 },
  /** The ground ring inlay around the plinth. */
  ring: { innerR: 3.0, outerR: 3.12 },
} as const;

/** The monument's solid footprint: the tier-1 trim square
 *  (4.46 m) plus a walker's clearance — the rect palace-layout
 *  blocks. (Was 3.7 × 3.7 m for the old 3.55 m trim; the design
 *  deliberately moves this pin — see the C2 report.) */
export const MONUMENT_BLOCKED: PalaceRect = {
  minX: MONUMENT.cx - 2.3,
  maxX: MONUMENT.cx + 2.3,
  minZ: MONUMENT.cz - 2.3,
  maxZ: MONUMENT.cz + 2.3,
};

/** Monument plinth steps (item 38's third clause): the three
 *  tiers ARE the massing steps up the plinth — climbable-Y is
 *  parked (flat-plane movement), so the steps read as ceremony,
 *  and the whole footprint stays inside MONUMENT_BLOCKED. */

/* ── Item 38: elevation around the walk paths ─────────────────────
 * Ceremonial steps FLANK the hall-arch approach (they dress the
 * path's edges, never the path: the 3.6 m marble run stays clear),
 * terraces mass the grounds' east and west edges, and the
 * monument's tiers (above) step its plinth. Everything here is
 * VISUAL elevation around flat-plane walking — no step enters a
 * walk path, and every mass that stands in walkable ground is in
 * TERRACE_BLOCKED (palace-layout blocks from it). True climbable
 * Y is parked: resolvePalaceMove has no Y and this batch does not
 * give it one. */

/** One ceremonial step run flanking the arch approach: three
 *  shallow steps up to a low platform, mirrored east/west of the
 *  path at the façade's foot. x from the path edge (1.8) out. */
export const HALL_STEPS = {
  /** The runs' z band, at the façade's foot. */
  z0: 13.0,
  z1: 16.4,
  /** Step treads: three rises of 0.12 m marching north (toward
   *  the façade) — depth per tread, footprint x-extent per side. */
  rises: [0.12, 0.24, 0.36] as readonly number[],
  treadD: 0.72,
  sideX0: 2.1,
  sideX1: 5.6,
  /** The low platform crowning each run. */
  platformTopY: 0.36,
} as const;

export function hallStepRuns(): GroundsBox[] {
  const out: GroundsBox[] = [];
  const { z0, rises, treadD, sideX0, sideX1 } = HALL_STEPS;
  for (const sx of [-1, 1] as const) {
    const cx = (sx * (sideX0 + sideX1)) / 2;
    const w = sideX1 - sideX0;
    rises.forEach((topY, i) => {
      out.push({
        cx, cy: topY / 2, cz: z0 + treadD * (i + 0.5), w, h: topY, d: treadD,
      });
    });
    // The platform behind the top step.
    out.push({
      cx, cy: HALL_STEPS.platformTopY / 2,
      cz: z0 + treadD * rises.length + (HALL_STEPS.z1 - z0 - treadD * rises.length) / 2,
      w, h: HALL_STEPS.platformTopY, d: HALL_STEPS.z1 - z0 - treadD * rises.length,
    });
  }
  return out;
}

/** The hall steps' footprints — they stand in the courtyard walk
 *  rect (z ≥ 12.55), flanking the path, so they are honestly
 *  blocked: a walker rounds them, never ghosts through them. */
export const HALL_STEPS_BLOCKED: readonly PalaceRect[] = [
  { minX: -HALL_STEPS.sideX1, maxX: -HALL_STEPS.sideX0, minZ: HALL_STEPS.z0, maxZ: HALL_STEPS.z1 },
  { minX: HALL_STEPS.sideX0, maxX: HALL_STEPS.sideX1, minZ: HALL_STEPS.z0, maxZ: HALL_STEPS.z1 },
];

/** Terraces at the grounds' edges: two stepped masses against the
 *  east and west walls, north of the lawns — three stone terraces
 *  rising toward the wall, each crowned with planting. They stand
 *  ON the main grounds (inside the walk rect), so their footprints
 *  are blocked from this same data. */
export const TERRACES = {
  /** Footprint: from the wall face inward. */
  depthX: 2.2,
  wallX: 28.2,
  z0: 13.4,
  z1: 16.6,
  /** Terrace tops, lowest (plaza side) to highest (wall side). */
  tops: [0.3, 0.62, 0.95] as readonly number[],
} as const;

export function terraceRuns(): GroundsBox[] {
  const out: GroundsBox[] = [];
  const stepD = TERRACES.depthX / TERRACES.tops.length;
  const cz = (TERRACES.z0 + TERRACES.z1) / 2;
  const len = TERRACES.z1 - TERRACES.z0;
  for (const sx of [-1, 1] as const) {
    TERRACES.tops.forEach((topY, i) => {
      // i = 0 is the plaza-side (inward) step; the mass rises
      // toward the wall.
      const inner = TERRACES.wallX - TERRACES.depthX + i * stepD;
      out.push({
        cx: sx * (inner + stepD / 2), cy: topY / 2, cz,
        w: stepD, h: topY, d: len,
      });
    });
  }
  return out;
}

export const TERRACE_BLOCKED: readonly PalaceRect[] = [
  {
    minX: -TERRACES.wallX, maxX: -(TERRACES.wallX - TERRACES.depthX),
    minZ: TERRACES.z0, maxZ: TERRACES.z1,
  },
  {
    minX: TERRACES.wallX - TERRACES.depthX, maxX: TERRACES.wallX,
    minZ: TERRACES.z0, maxZ: TERRACES.z1,
  },
];

/* ── Item 5: the backdrop ring ────────────────────────────────────
 * Beyond the 1.05 m perimeter wall the world used to end in void.
 * Now: a ground skirt runs out to the sky dome's skirts, a moat
 * strip glints along the south and east, garden masses (dark
 * hedges / pale topiary by look) mound the middle distance, and
 * two distant palace wings stand in the fog with a few lit windows
 * echoing the façade. Everything sits outside every walk rect,
 * inside the 90 m dome, and far enough out that the courtyard fog
 * (day 48→140, night 34→115) veils it into depth. Camera clamp
 * keeps the lens inside the plaza, so the nearest backdrop piece
 * is always ≥ ~7 m beyond the wall from any viewpoint. */

export const BACKDROP = {
  /** The ground skirt: a great dark disc under everything beyond
   *  the grounds, out to just inside the dome. */
  skirtR: 86,
  skirtY: -0.05,
  /** The moat: a water ring segment along the south + east,
   *  outside the walls. Inner/outer radii from the palace heart
   *  (0, 23) — the plaza's visual centre. */
  moatCenter: { x: 0, z: 23 },
  moatInnerR: 44,
  moatOuterR: 52,
  moatY: -0.02,
} as const;

/** Distant palace wings: two long low masses on the skyline,
 *  north-west and north-east beyond the palace itself (seen over
 *  the roofline from the plaza) — silhouettes in the fog. */
export interface BackdropWing {
  cx: number;
  cy: number;
  cz: number;
  w: number;
  h: number;
  d: number;
  /** Lit windows on the wing's plaza-facing side: a few emissive
   *  planes echoing the façade (night) / pale glass (day). */
  windows: Array<{ dx: number; dy: number }>;
}

export const BACKDROP_WINGS: readonly BackdropWing[] = [
  {
    cx: -44, cy: 5, cz: -26, w: 30, h: 10, d: 9,
    windows: [
      { dx: -11, dy: 6.5 }, { dx: -4, dy: 6.5 }, { dx: 4, dy: 6.5 }, { dx: 11, dy: 6.5 },
      { dx: -7, dy: 3 }, { dx: 1, dy: 3 }, { dx: 9, dy: 3 },
    ],
  },
  {
    cx: 46, cy: 6, cz: -24, w: 32, h: 12, d: 10,
    windows: [
      { dx: -12, dy: 7.5 }, { dx: -4, dy: 7.5 }, { dx: 4, dy: 7.5 }, { dx: 12, dy: 7.5 },
      { dx: -8, dy: 3.5 }, { dx: 0, dy: 3.5 }, { dx: 8, dy: 3.5 },
    ],
  },
  /* A far garden pavilion south-east, low and wide — the skyline
   * behind the Boardwalk gate. */
  {
    cx: 40, cy: 3, cz: 46, w: 24, h: 6, d: 8,
    windows: [{ dx: -7, dy: 3.4 }, { dx: 0, dy: 3.4 }, { dx: 7, dy: 3.4 }],
  },
];

/** Garden masses: rounded planting mounds ringing the grounds
 *  beyond the walls — hedges by night silhouette, pale topiary
 *  masses by day. (x, z, radius, height) spheres squashed to
 *  mounds; instanced by the scene. The three WEST mounds moved
 *  out past x −66 in Stage C item 31: the ground they used to
 *  mound (x −53..−31, z 1..46) is the built Stage Grounds
 *  district now — they ring the district's own west wall instead,
 *  so the ring stays coherent around the grown palace. The
 *  SOUTH-CENTRE mound moved west in Stage C item 32 the same
 *  way: the ground it used to mound (x −28..−12, z 40..56) is
 *  the built Listening Gardens district now — it rings the
 *  gardens' west wall instead, at (−50, 50). */
export const BACKDROP_GARDENS: ReadonlyArray<{ x: number; z: number; r: number; h: number }> = [
  { x: -66, z: 4, r: 7, h: 3.2 },
  { x: -68, z: 24, r: 9, h: 4.0 },
  { x: -66, z: 44, r: 6.5, h: 2.8 },
  { x: -50, z: 50, r: 8, h: 3.4 },
  { x: 20, z: 48, r: 8, h: 3.4 },
  { x: 38, z: 40, r: 6.5, h: 2.8 },
  { x: 40, z: 10, r: 7.5, h: 3.6 },
  { x: 14, z: -38, r: 9, h: 4.2 },
  { x: -16, z: -40, r: 8, h: 3.8 },
];

export interface BackdropWindowStyle {
  color: number;
  emissive: number;
  emissiveIntensity: number;
}

/** Backdrop windows follow the façade's law, dimmer: lit gold at
 *  night (echoing the façade's windows), quiet pale glass by day. */
export function backdropWindowStyle(theme: HallTheme): BackdropWindowStyle {
  if (theme === "dark") {
    return { color: 0x2a1a08, emissive: 0xffa64d, emissiveIntensity: 1.6 };
  }
  return { color: 0xe9dcbc, emissive: 0xffe9bb, emissiveIntensity: 0.15 };
}

/** Every backdrop solid as a ground rect (for the tests: all of
 *  it beyond the walls, none of it in walkable ground, all of it
 *  inside the dome). Wings use their footprints; gardens their
 *  mound circles as squares. */
export function backdropGroundRects(): PalaceRect[] {
  return [
    ...BACKDROP_WINGS.map((w) => rectOf(w)),
    ...BACKDROP_GARDENS.map((g) => ({
      minX: g.x - g.r, maxX: g.x + g.r, minZ: g.z - g.r, maxZ: g.z + g.r,
    })),
  ];
}
