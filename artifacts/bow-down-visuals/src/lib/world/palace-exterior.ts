/**
 * palace-exterior.ts — the palace's OUTSIDE, as pure placement data
 * (Open World Overhaul, Stage C batch C1: board items 1 and 2).
 *
 * Until this module the palace had no exterior at all (audit
 * geometry #7/#8, Sev 5): from the King's Plaza you faced the
 * INSIDE of the hall's back wall, its top edge flat against a flat
 * sky, and from any raised angle the single-sided ceilings made
 * the whole building see-through. This module is the plan the
 * scene builds from — every façade and roofline piece is a box /
 * cylinder / disc described here in world metres, so the tests can
 * pin the two laws the build must obey without a GL context:
 *
 *   1. NOTHING at ground level crosses the plaza's walk line. The
 *      courtyard walk rect starts at z = 12.55 (palace-layout);
 *      the hall's back wall outer face stands at z = 12.40. Every
 *      ground-level façade piece lives in that 0.15 m band or
 *      above head height — the façade dresses the wall, it never
 *      becomes an invisible (or visible) obstacle, and no walk
 *      rect or door logic changes for it.
 *   2. The skin ABUTS the wall (back face at z = 12.40, the wall's
 *      outer face) — no coplanar overlap, no z-fighting, and the
 *      arch opening (x −2.2..2.2, up to the door lintel at 3.6 m)
 *      stays exactly the opening the hall already has: the
 *      doorway seam is untouched.
 *
 * The look (Living Night Palace, the owner's Gate-1 pick) is worn
 * through hall-looks' per-look texture URLs — stone courses and
 * gold-vein marble, dark or cream — and the window glass style
 * below: warm lit glass at night, pale quiet glass by day. The
 * geometry here is look-independent; only materials change.
 */
import { PALACE_DOOR_HEIGHT } from "./palace-layout";
import type { HallTheme } from "./hall-looks";

/* ── The hall block the exterior dresses ────────────────────────── */

/** The hall block's footprint and the wall the façade skins. */
export const HALL_BLOCK = {
  minX: -14.4,
  maxX: 14.4,
  minZ: -18.4,
  maxZ: 12.4,
  /** The hall walls' height — the interior ceiling line. */
  wallHeight: 6.5,
  /** The back wall's CENTRE plane (its box is 0.4 thick). */
  backWallZ: 12.2,
  /** The back wall's outer (plaza-facing) face. */
  backWallOuterZ: 12.4,
} as const;

/** The plaza walk rect's north edge (palace-layout COURTYARD walk
 *  minZ): no ground-level exterior piece may cross it. */
export const PLAZA_WALK_MIN_Z = 12.55;

/** One texture tile of the façade stone courses, in metres — the
 *  ashlar blocks read at palace scale at ~3 m per tile, and every
 *  stone surface agrees (per-metre repeats, item 7). */
export const FACADE_STONE_METRES_PER_TILE = 3;
/** One tile of the gold-vein accent marble (plinth, pilasters,
 *  pediment, dome) — the palace marble's own scale. */
export const FACADE_MARBLE_METRES_PER_TILE = 4;

/* ── Item 1: the façade ─────────────────────────────────────────── */

export interface ExteriorBox {
  cx: number;
  cy: number;
  cz: number;
  w: number;
  h: number;
  d: number;
}

/** The façade skin: a thin stone-course veneer over the back wall,
 *  rising past the hall's 6.5 m wall line to the 7.4 m parapet so
 *  the plaza reads a palace front, not a room's back. Three runs —
 *  west of the arch, east of the arch, and the lintel band over
 *  it — so the arch opening stays exactly the hall's own. */
export const FACADE = {
  skinCenterZ: 12.45,
  skinDepth: 0.1,
  /** Plaza-facing surface of the skin. */
  skinFrontZ: 12.5,
  topY: 7.4,
  archSpanMin: -2.2,
  archSpanMax: 2.2,
  archTopY: PALACE_DOOR_HEIGHT,
} as const;

export function facadeSkinRuns(): ExteriorBox[] {
  const { skinCenterZ, skinDepth, topY, archSpanMin, archSpanMax, archTopY } = FACADE;
  const mk = (x0: number, x1: number, y0: number, y1: number): ExteriorBox => ({
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    cz: skinCenterZ,
    w: x1 - x0,
    h: y1 - y0,
    d: skinDepth,
  });
  return [
    mk(HALL_BLOCK.minX, archSpanMin, 0, topY),
    mk(archSpanMax, HALL_BLOCK.maxX, 0, topY),
    mk(archSpanMin, archSpanMax, archTopY, topY),
  ];
}

/** The gold-vein marble plinth band along the façade's foot —
 *  two runs flanking the arch (the doorway threshold is the hall's
 *  own gold, already there). Front face at 12.54, inside the walk
 *  line. */
export function facadePlinthRuns(): ExteriorBox[] {
  const mk = (x0: number, x1: number): ExteriorBox => ({
    cx: (x0 + x1) / 2,
    cy: 0.45,
    cz: 12.47,
    w: x1 - x0,
    h: 0.9,
    d: 0.14,
  });
  return [mk(HALL_BLOCK.minX, FACADE.archSpanMin), mk(FACADE.archSpanMax, HALL_BLOCK.maxX)];
}

/** Pilaster centre lines: a steady rhythm either side of the arch,
 *  clear of the arch span, the windows and the banners. */
export const FACADE_PILASTER_XS: readonly number[] = [
  -13.0, -9.75, -6.5, -3.35, 3.35, 6.5, 9.75, 13.0,
];

/** One pilaster: shaft, capital, base — three boxes at one x. The
 *  shaft's front face lands exactly on the walk line (12.55); its
 *  back is buried in the wall, so it reads as relief, never as an
 *  obstacle. */
export function facadePilaster(x: number): { shaft: ExteriorBox; capital: ExteriorBox; base: ExteriorBox } {
  return {
    shaft: { cx: x, cy: FACADE.topY / 2, cz: 12.42, w: 0.66, h: FACADE.topY, d: 0.26 },
    capital: { cx: x, cy: FACADE.topY - 0.28, cz: 12.4, w: 0.86, h: 0.34, d: 0.3 },
    base: { cx: x, cy: 0.32, cz: 12.4, w: 0.86, h: 0.64, d: 0.3 },
  };
}

/** Façade windows: two rows between the pilasters. The upper row
 *  lights the hall's gallery line; the lower row sits above the
 *  plinth. Glass is emissive (never a real light — the perf law),
 *  warm at night, pale by day (facadeWindowStyle). */
export const FACADE_WINDOW_W = 1.3;
export const FACADE_WINDOW_H = 1.9;
export const FACADE_WINDOWS: ReadonlyArray<{ x: number; y: number }> = [
  ...[-11.4, -8.1, -4.9, 4.9, 8.1, 11.4].map((x) => ({ x, y: 5.15 })),
  ...[-11.4, -8.1, -4.9, 4.9, 8.1, 11.4].map((x) => ({ x, y: 2.0 })),
];

/** The glass plane's z: recessed 0.03 behind its gold frame's
 *  front (12.55), proud of the skin (12.50) so it catches light. */
export const FACADE_WINDOW_GLASS_Z = 12.52;
/** Window frame bars (gold): top/bottom span the window's width,
 *  sides its height — the scene instances one bar geometry. */
export function facadeWindowFrameBars(win: { x: number; y: number }): ExteriorBox[] {
  const w = FACADE_WINDOW_W + 0.16;
  const h = FACADE_WINDOW_H + 0.16;
  const cz = 12.49;
  const d = 0.12;
  const t = 0.09;
  return [
    { cx: win.x, cy: win.y + h / 2 - t / 2, cz, w, h: t, d },
    { cx: win.x, cy: win.y - h / 2 + t / 2, cz, w, h: t, d },
    { cx: win.x - w / 2 + t / 2, cy: win.y, cz, w: t, h, d },
    { cx: win.x + w / 2 - t / 2, cy: win.y, cz, w: t, h, d },
  ];
}

export interface FacadeWindowStyle {
  /** Glass base colour. */
  color: number;
  /** Emissive colour — the lit-window warmth. */
  emissive: number;
  /** Emissive strength: lit at night, a whisper by day. */
  emissiveIntensity: number;
  roughness: number;
}

/** The window glass per look (the direction: DARK = lit windows,
 *  DAY = pale warm glass, low emissive). */
export function facadeWindowStyle(theme: HallTheme): FacadeWindowStyle {
  if (theme === "dark") {
    return { color: 0x2a1a08, emissive: 0xffa64d, emissiveIntensity: 2.4, roughness: 0.4 };
  }
  return { color: 0xf7ead0, emissive: 0xffe9bb, emissiveIntensity: 0.3, roughness: 0.15 };
}

/** The cornice: a stone ledge crowning the skin at the wall line,
 *  with a gold trim strip under it. It stands at 6.9 m — far above
 *  any walker — so it may project past the walk line to throw its
 *  shadow line across the façade. */
export const FACADE_CORNICE: ExteriorBox = {
  cx: 0, cy: 7.08, cz: 12.62, w: HALL_BLOCK.maxX - HALL_BLOCK.minX + 0.5, h: 0.36, d: 0.85,
};
export const FACADE_CORNICE_TRIM: ExteriorBox = {
  cx: 0, cy: 6.84, cz: 12.56, w: HALL_BLOCK.maxX - HALL_BLOCK.minX + 0.24, h: 0.1, d: 0.6,
};

/** The pediment over the King's Hall arch: a gold-vein marble
 *  tympanum triangle in the skin's plane, two sloped gold slabs
 *  raking its edges, a gold finial at the apex. Static geometry —
 *  described here as numbers the scene turns into a triangle +
 *  rotated boxes. */
export const PEDIMENT = {
  centerX: 0,
  baseY: FACADE.topY,
  halfWidth: 3.6,
  apexY: 8.85,
  /** Tympanum plane z (proud of the skin, behind the raking slabs). */
  z: 12.53,
  /** Raking slab: length of the slope, its tilt from horizontal. */
  slabLength: Math.hypot(3.6, 8.85 - FACADE.topY),
  slabTiltRad: Math.atan2(8.85 - FACADE.topY, 3.6),
  finialY: 9.15,
} as const;

/** Banner hangings flanking the arch (item 1): cloth panels with
 *  gold trim, STATIC in this batch (the waving life is item 26's).
 *  They hang in the gap between the arch jamb (x ±2.2..2.4) and
 *  the first pilaster (x ±3.35) — clear of both. */
export const FACADE_BANNERS: ReadonlyArray<{ x: number }> = [{ x: -2.72 }, { x: 2.72 }];
export const BANNER = {
  w: 0.56,
  topY: 5.9,
  bottomY: 2.3,
  /** Panel plane z — proud of the skin, inside the walk line. */
  z: 12.53,
  rodY: 6.02,
} as const;

/* ── Item 2: roofline & silhouette ──────────────────────────────── */

/** Roof slabs: solid stone caps over every roofed block, laid at
 *  the ceiling line so from ANY raised angle the palace reads as a
 *  building, not a set of single-sided ceilings. The hall slab
 *  carries the dome + turrets; the side slabs close the west and
 *  east room blocks and the Creator Room block the same way. All
 *  of it stands at 6.5 m+, far above walk height — no walk rect
 *  ever meets it. */
export const ROOF_SLAB_Y = 6.72;
export const ROOF_SLAB_H = 0.36;
export const ROOF_SLABS: readonly ExteriorBox[] = [
  { cx: 0, cy: ROOF_SLAB_Y, cz: -3.0, w: 29.4, h: ROOF_SLAB_H, d: 31.4 }, // the hall block
  { cx: -21.3, cy: ROOF_SLAB_Y, cz: -3.0, w: 14.6, h: ROOF_SLAB_H, d: 31.4 }, // west rooms
  { cx: 21.3, cy: ROOF_SLAB_Y, cz: -3.0, w: 14.6, h: ROOF_SLAB_H, d: 31.4 }, // east rooms
  { cx: 9.5, cy: ROOF_SLAB_Y, cz: 32.2, w: 14.2, h: ROOF_SLAB_H, d: 12.2 }, // Creator Room block
];

/** Parapet runs around the hall block's roof edge (the plaza edge
 *  is already crowned by the façade skin + cornice, so the runs
 *  close the other three sides). */
export const ROOF_PARAPETS: readonly ExteriorBox[] = [
  { cx: 0, cy: 7.12, cz: -18.55, w: 29.4, h: 0.44, d: 0.3 },
  { cx: -14.55, cy: 7.12, cz: -3.0, w: 0.3, h: 0.44, d: 31.4 },
  { cx: 14.55, cy: 7.12, cz: -3.0, w: 0.3, h: 0.44, d: 31.4 },
];

/** Corner turrets: cylinders rising from the roof at the hall
 *  block's four corners (inset so the whole turret stands on the
 *  hall slab), gold cone caps. Roof furniture only — they begin
 *  at the ceiling line, so no room interior ever meets them. */
export const TURRETS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -13.4, z: -17.4 },
  { x: 13.4, z: -17.4 },
  { x: -13.4, z: 11.4 },
  { x: 13.4, z: 11.4 },
];
export const TURRET = { radius: 1.05, baseY: 6.54, topY: 9.0, capApexY: 9.95 } as const;

/** The central dome over the hall's heart: a gold-vein marble
 *  drum, a hemisphere, and a gold finial — the silhouette's crown,
 *  centred over the hall floor's medallion line (0, −3). */
export const DOME = {
  cx: 0,
  cz: -3,
  drumRadius: 3.3,
  drumBaseY: 6.9,
  drumTopY: 7.7,
  domeRadius: 3.3,
  finialBaseY: 11.0,
  finialTopY: 11.85,
} as const;

/** Every ground-level façade footprint as a rect (for the walk-
 *  law tests): skin runs, plinth, pilasters, window frames,
 *  banners. Roof pieces stand at 6.5 m+ and are excluded by
 *  construction. */
export function facadeGroundRects(): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  const boxes: ExteriorBox[] = [
    ...facadeSkinRuns(),
    ...facadePlinthRuns(),
    ...FACADE_PILASTER_XS.flatMap((x) => {
      const p = facadePilaster(x);
      return [p.shaft, p.capital, p.base];
    }),
    ...FACADE_WINDOWS.flatMap((win) => facadeWindowFrameBars(win)),
  ];
  return boxes.map((b) => ({
    minX: b.cx - b.w / 2,
    maxX: b.cx + b.w / 2,
    minZ: b.cz - b.d / 2,
    maxZ: b.cz + b.d / 2,
  }));
}
