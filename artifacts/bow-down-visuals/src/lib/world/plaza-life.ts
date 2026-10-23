/**
 * plaza-life.ts — the King's Plaza LIVES (Open World Overhaul,
 * Stage C batch C3: board items 26, 28, 29, 30, 40).
 *
 * C1/C2 gave the plaza its architecture and grounds; the middle
 * ~900 m² still held one monument and hologram rings, the light
 * look had ZERO animated life outdoors (audit lighting D1), no
 * water existed anywhere in the world (geometry #17), the night
 * rig hung on nothing (geometry #17/#20), and spawn was a bare
 * point on the paving (geometry #6). This module is the plan the
 * scene builds the life from — pure placement data + the pure
 * animation arithmetic — following palace-grounds' pattern:
 *
 *   1. Every SOLID here is registered as a blocked rect in
 *      palace-layout DERIVED from this same data (PLAZA_LIFE_BLOCKED
 *      below) — a visible body and its collision can never drift.
 *   2. The walk paths stay clear BY PLACEMENT, pinned in tests:
 *      the arch→monument→Boardwalk spine (|x| ≤ 1.8), the station
 *      points, the arch spur and the spawn stance itself.
 *   3. Ambient animation follows the house laws: counts scale by
 *      the quality ladder's particleScale, and EVERY animated
 *      system here is disabled under reduced motion (the scene
 *      simply never registers it — banners hang still, pollen is
 *      never built, the water surface rests).
 *   4. NO new real lights. The lamps (item 29) carry the night
 *      rig VISUALLY: emissive heads + the item-27 lantern-glow
 *      sprites. The scene adds zero PointLights for this batch.
 *
 * The look (Living Night Palace + its golden-day twin) is worn
 * through hall-looks' textures — the pool wears water-dark.jpg at
 * night and the same file tinted bright by day. Geometry here is
 * look-independent.
 */
import { hashSeed, seededRandom } from "./prop-variation";
import type { PalaceRect } from "./palace-layout";

const rectAround = (x: number, z: number, hx: number, hz: number): PalaceRect => ({
  minX: x - hx,
  maxX: x + hx,
  minZ: z - hz,
  maxZ: z + hz,
});

/* ── Item 26: daylight life ───────────────────────────────────────
 * The façade banners (palace-exterior's FACADE_BANNERS, built
 * static in C1) wave gently in the LIGHT look, and pollen/dust
 * motes drift over the grounds in daylight. Night has its embers
 * already (night-life.ts); this is the day twin. Both systems are
 * pure functions of time here; the scene pours them into meshes,
 * and registers NOTHING under reduced motion. */

/** One banner's sway at one moment: a gentle pivot swing about
 *  its rod — small angles, slow, phase-shifted per banner so the
 *  façade never moves in lockstep. Amplitudes are in radians and
 *  deliberately small (a hanging cloth in light air, not a flag
 *  in a gale). */
export function bannerSwayAt(tSec: number, phase: number): { rotX: number; rotZ: number } {
  return {
    rotX: 0.055 * Math.sin(tSec * 0.9 + phase) + 0.02 * Math.sin(tSec * 2.3 + phase * 1.7),
    rotZ: 0.03 * Math.sin(tSec * 0.7 + phase * 2.1),
  };
}

/** Pollen motes over the grounds at full particle scale; the
 *  ladder's particleScale draws a prefix of the field (the dust
 *  system's own law, buildDust in hall-scene). */
export const POLLEN_BASE_COUNT = 130;

export function pollenCountForScale(particleScale: number): number {
  return Math.floor(POLLEN_BASE_COUNT * Math.min(1, Math.max(0, particleScale)));
}

/** The volume the pollen drifts in: the whole courtyard air,
 *  knee-to-head height, clear of the hall interior. */
export const POLLEN_FIELD = {
  minX: -26, maxX: 26, minY: 0.3, maxY: 3.4, minZ: 13.2, maxZ: 33.2,
} as const;

export interface PollenMote {
  x: number;
  y: number;
  z: number;
  /** Wander phase + fall speed, per mote. */
  phase: number;
  fall: number;
}

/** A deterministic pollen field — same seed, same sky, on every
 *  client (the ember fields' law). */
export function createPollenField(count: number, seedKey: string): PollenMote[] {
  const rng = seededRandom(hashSeed(`pollen:${seedKey}`));
  const { minX, maxX, minY, maxY, minZ, maxZ } = POLLEN_FIELD;
  const out: PollenMote[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: minX + rng() * (maxX - minX),
      y: minY + rng() * (maxY - minY),
      z: minZ + rng() * (maxZ - minZ),
      phase: rng() * Math.PI * 2,
      fall: 0.02 + rng() * 0.05,
    });
  }
  return out;
}

/** Where one mote stands at one moment: a slow sinusoidal wander
 *  around its home point plus a gentle sinking that wraps within
 *  the field's height — motes never leave the courtyard air. */
export function pollenPositionAt(m: PollenMote, tSec: number): { x: number; y: number; z: number } {
  const h = POLLEN_FIELD.maxY - POLLEN_FIELD.minY;
  const sunk = (m.y - POLLEN_FIELD.minY + m.fall * tSec) % h;
  return {
    x: m.x + Math.sin(tSec * 0.11 + m.phase) * 0.9,
    y: POLLEN_FIELD.minY + (h - sunk),
    z: m.z + Math.cos(tSec * 0.09 + m.phase * 1.3) * 0.9,
  };
}

/* ── Item 28: the water — a reflecting pool + fountain ────────────
 * The promenade's west reach was the grounds' emptiest designed
 * ground: a broad paved apron between the spine and the west
 * wall, crossed by nothing, holding two planters at its far edge.
 * The pool takes its heart — a long still mirror on the
 * promenade's own axis, a fountain basin at its centre — placed
 * so every working line survives: the spine runs 6.7 m east of
 * its rim, the Marketplace/Community stations stand north of it,
 * and a walker rounds it on all four sides (≥ 1.4 m of open paving
 * north, ≥ 2 m south, the whole spine side east, the wall side
 * west). The basin is solid: POOL_BLOCKED is its honest footprint
 * and palace-layout blocks from it. */

export const POOL = {
  cx: -14,
  cz: 29.3,
  /** Outer footprint (the rim's outside edge). */
  w: 11,
  d: 4.6,
  /** The stone rim: height above the paving, width of its lip. */
  rimH: 0.34,
  rimLip: 0.3,
  /** The water surface's height — held just below the rim's top,
   *  so the mirror reads as held water, not a floor decal. */
  waterY: 0.26,
} as const;

/** The fountain at the pool's heart: a raised basin on a short
 *  column, its jet a translucent cone the tick pulses. It stands
 *  INSIDE POOL_BLOCKED — no collision of its own is needed. */
export const FOUNTAIN = {
  x: POOL.cx,
  z: POOL.cz,
  basinR: 0.85,
  basinTopY: 0.95,
  jetBaseY: 0.95,
  jetTopY: 1.75,
} as const;

export const POOL_BLOCKED: PalaceRect = rectAround(POOL.cx, POOL.cz, POOL.w / 2, POOL.d / 2);

/** The water surface's animation at one moment: a slow two-axis
 *  texture scroll (the shimmer) — offsets wrap in 0..1 so the
 *  scroll loops seamlessly over any span. Under reduced motion
 *  the scene never applies it and the surface rests still.
 *
 *  Stack-100 #2 water round 2: the ONE water model now also
 *  drives the ripple NORMAL layer (a counter-scrolling normal
 *  map, so the surface bends light instead of only sliding a
 *  picture), the fountain jet's HEIGHT pulse, the falling
 *  sheet's breathing opacity, and the impact ripple where the
 *  fall lands (an expanding ring that fades as it grows). Every
 *  water body in the world — plaza pool, gardens rill + basin,
 *  boardwalk basin, backdrop moat — reads this same model. */
export interface WaterSurfaceState {
  offsetX: number;
  offsetY: number;
  /** Ripple-normal layer offsets: counter-scroll against the
   *  colour layer so the two never lock into one sliding sheet. */
  normalOffsetX: number;
  normalOffsetY: number;
  /** The fountain jet's girth pulse (±10%). */
  jetPulse: number;
  /** The fountain jet's HEIGHT pulse (±6%, phase-shifted from
   *  the girth so the jet breathes instead of throbbing). */
  jetHeightPulse: number;
  /** The falling sheet's opacity (0..1 of its built opacity). */
  fallOpacity: number;
  /** Impact ripple: phase 0..1 of one expansion cycle. */
  ripplePhase: number;
  /** Impact ripple ring scale at this phase (0.35 → 0.95). */
  rippleScale: number;
  /** Impact ripple opacity: strongest at birth, gone at full size. */
  rippleOpacity: number;
}

export function waterSurfaceAt(tSec: number): WaterSurfaceState {
  const ripplePhase = (tSec * 0.45) % 1;
  return {
    offsetX: (tSec * 0.008) % 1,
    offsetY: (tSec * 0.0053) % 1,
    normalOffsetX: (1 - (tSec * 0.013) % 1) % 1,
    normalOffsetY: (tSec * 0.0091) % 1,
    /* The fountain jet's breathing: ±10% around its true height. */
    jetPulse: 1 + 0.1 * Math.sin(tSec * 2.1),
    jetHeightPulse: 1 + 0.06 * Math.sin(tSec * 2.1 + 0.7),
    fallOpacity: 0.82 + 0.18 * Math.sin(tSec * 1.3 + 0.4),
    ripplePhase,
    rippleScale: 0.35 + 0.6 * ripplePhase,
    rippleOpacity: 0.5 * (1 - ripplePhase),
  };
}

/* ── The wet edge (Stack-100 #2 item 6) ──────────────────────────
 * Where water meets stone the shipped world drew a hard CG
 * line. The wet edge is a narrow dark band laid on the water at
 * the rim — stone that stays wet reads darker and glossier than
 * dry stone, and the eye accepts the join. One treatment for
 * every rectangular basin (pool, rill, boardwalk basin) and a
 * ring for the round gardens basin: same width, same opacity,
 * built from this one record. */
export const WET_EDGE = {
  /** Band width measured inward from the rim (m). */
  width: 0.22,
  /** Band opacity over the water (a stain, not a stripe). */
  opacity: 0.32,
  /** Hover above the water surface (m) — no z-fighting. */
  lift: 0.004,
  color: 0x0a1418,
} as const;

/** The plaza fountain's falling sheet + impact ripple geometry
 *  (Stack-100 #2 item 7): the plaza fountain had a jet and no
 *  fall — water rose and vanished. The sheet is a translucent
 *  cone from the basin's rim down to the pool's surface, and the
 *  ripple is a flat ring on the pool around the column, expanded
 *  and faded by waterSurfaceAt. The gardens fountain already had
 *  its fall (districts item 36); this is the plaza twin. */
export const FOUNTAIN_FALL = {
  /** Sheet top radius (at the basin rim) / bottom radius (at the pool). */
  topR: 0.78,
  bottomR: 1.18,
  /** Sheet spans basin rim → pool water surface. */
  topY: FOUNTAIN.basinTopY - 0.06,
  bottomY: POOL.waterY + 0.02,
  /** Impact ripple ring radii (unit ring, scaled by the model). */
  rippleInnerR: 0.92,
  rippleOuterR: 1.0,
  rippleY: POOL.waterY + 0.012,
} as const;

/** The water's tint per look: the art lane's one water file
 *  (water-dark.jpg) is the dark look's still dusk water; by day
 *  the same surface is tinted up into a bright reflecting sky
 *  mirror (hall-looks records the same one-file fact for the
 *  backdrop moat). */
export function poolWaterTint(theme: "light" | "dark"): { color: number; roughness: number } {
  return theme === "dark"
    ? { color: 0x8fa8b8, roughness: 0.12 }
    : { color: 0xeaf6ff, roughness: 0.05 };
}

/* ── Item 29: plaza lighting furniture ────────────────────────────
 * Lamp standards carrying the night rig visually: a stone post,
 * a gold cage head, an emissive lamp glass. Their glow at night
 * is the item-27 lantern-glow sprite system (breathing sprites,
 * no real light) — this batch adds ZERO PointLights, and the
 * existing brazier lights stay exactly where the ladder budgets
 * them. Placement: pairs flanking the spine at the façade foot
 * and at the monument's south line, a pair flanking the Boardwalk
 * threshold, and a loose triangle dressing the promenade + pool.
 * Every post is solid (its blocked rect below) and every post
 * stands clear of the spine, the stations and the gates. */

export interface PlazaLamp {
  x: number;
  z: number;
}

export const PLAZA_LAMPS: readonly PlazaLamp[] = [
  { x: -2.9, z: 14.2 },
  { x: 2.9, z: 14.2 },
  { x: -2.9, z: 24.2 },
  { x: 2.9, z: 24.2 },
  { x: -14, z: 25.9 },
  { x: -24.8, z: 29.3 },
  { x: -4.2, z: 29.3 },
  { x: -2.9, z: 32.6 },
  { x: 2.9, z: 32.6 },
];

export const LAMP = {
  /** Post height to the cage's foot; the head crowns it. */
  postH: 2.45,
  headY: 2.62,
  /** The lantern-glow sprite's base scale at the head (item 27's
   *  breathing applies on top). */
  glowBase: 1.05,
  /** Blocked half-extent: the post's plinth, honestly. */
  blockHalf: 0.19,
} as const;

/** The lamp glass per look: warm lit amber after dark, quiet
 *  pale glass by day (the façade windows' law). */
export function lampGlassStyle(theme: "light" | "dark"): { color: number; emissive: number; emissiveIntensity: number } {
  return theme === "dark"
    ? { color: 0x2a1a08, emissive: 0xffb35c, emissiveIntensity: 2.2 }
    : { color: 0xf3e6c8, emissive: 0xffe9bb, emissiveIntensity: 0.25 };
}

/* ── Item 30: the plaza furniture set ─────────────────────────────
 * Benches, table sets, urns and market stalls — physical
 * place-making across the grounds. Repeated pieces instance in
 * the scene and take item-18 variation where the system fits
 * (urns are finials; benches/stalls are architecture and stay
 * square to their lines, like gates). Placement law, pinned in
 * tests: the spine stays clear, every station point keeps ≥ 1.5 m
 * of open ground, the spur and the gates stay clear, and every
 * piece's blocked rect comes from this same data. */

export interface PlazaBench {
  x: number;
  z: number;
  /** True when the bench's length runs along Z (it faces ±X). */
  alongZ: boolean;
}

/** Benches: a pair north of the monument facing it across the
 *  braziers' line, a pair south of it on the stations' row (set
 *  back from every station point), and a pair facing the pool
 *  across its east and west ends. */
export const PLAZA_BENCHES: readonly PlazaBench[] = [
  { x: -3.4, z: 16.0, alongZ: false },
  { x: 3.4, z: 16.0, alongZ: false },
  { x: -3.4, z: 23.2, alongZ: false },
  { x: 3.4, z: 23.2, alongZ: false },
  { x: -20.8, z: 29.3, alongZ: true },
  { x: -7.2, z: 29.3, alongZ: true },
];

export const BENCH = { len: 1.9, depth: 0.62, seatY: 0.45, blockHalfX: 0.98, blockHalfZ: 0.34 } as const;

/** Table sets: a round café table with two stools — one on the
 *  promenade's south edge west of the Boardwalk approach, one in
 *  the promenade's north-west reach. One blocked rect per set
 *  covers table + stools together. */
export const PLAZA_TABLE_SETS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -5.4, z: 32.6 },
  { x: -24.6, z: 26.4 },
];

export const TABLE_SET = { tableR: 0.55, blockHalf: 1.0 } as const;

/** Urns (the monument's finial language at plaza scale): pairs
 *  flanking the spawn threshold (item 40's dressing), the board
 *  station's approach, and the façade's foot clear of the hall
 *  steps. */
export const PLAZA_URNS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -2.7, z: 31.5 },
  { x: 2.7, z: 31.5 },
  { x: -2.85, z: 21.9 },
  { x: 2.85, z: 21.9 },
  { x: -5.9, z: 13.1 },
  { x: 5.9, z: 13.1 },
];

export const URN = { blockHalf: 0.27, pedestalH: 0.32, topY: 1.15 } as const;

/** Market stalls on the promenade's south edge — the Boardwalk's
 *  market face: a counter, four posts, a sloped fabric canopy in
 *  the look's cloth. They back onto the south wall's line, clear
 *  of its planters, its marker and the gate. */
export const PLAZA_STALLS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -14, z: 33.0 },
  { x: -23.9, z: 33.0 },
];

export const STALL = { w: 2.6, d: 1.3, counterY: 0.95, canopyY: 2.15, blockHalfX: 1.3, blockHalfZ: 0.65 } as const;

/* ── Item 40: the spawn arrival moment ────────────────────────────
 * Spawn itself DOES NOT MOVE (0, 31.5, facing the palace — the
 * layout's pin, the tests'). What changes is the ground the
 * walker lands on: a gold medallion inlay centred exactly on the
 * spawn stance, threshold stones flanking the spine on the
 * arrival axis, and a gold threshold band across the spine south
 * of the stance — the first thing underfoot says "you have
 * arrived at a palace", and the eye's line from the medallion
 * runs straight up the spine: monument, arch, façade, pediment.
 * All of it is FLAT inlay (the monument ring's language) — no
 * collision, no blocked rect: arrival dressing must never trip
 * the arriving walker. The flanking urns + lamps that frame the
 * stance are items 29/30's, placed above to do exactly this. */

export const SPAWN_DRESSING = {
  cx: 0,
  cz: 31.5,
  medallionInnerR: 1.45,
  medallionOuterR: 1.62,
  /** A second, finer gold ring inside the medallion. */
  innerRingInnerR: 0.55,
  innerRingOuterR: 0.62,
  /** The gold threshold band across the spine, south of the
   *  stance (the Boardwalk side): you cross it as you leave the
   *  arrival court for the gate, and cross back as you arrive. */
  band: { w: 3.6, d: 0.5, cz: 33.05 },
  /** Threshold stones: flat stone slabs flanking the spine at
   *  the stance's own z and at the band's line. */
  stones: [
    { x: -1.55, z: 31.5 },
    { x: 1.55, z: 31.5 },
    { x: -1.55, z: 33.05 },
    { x: 1.55, z: 33.05 },
  ] as ReadonlyArray<{ x: number; z: number }>,
  stoneW: 0.9,
  stoneD: 0.55,
} as const;

/* ── The batch's collision, derived ───────────────────────────────
 * Every solid above, as blocked rects — palace-layout folds this
 * list into PLAZA_BLOCKED, so the furniture, lamps, pool and
 * stalls are solid in the same commit that makes them visible.
 * The spawn dressing is deliberately ABSENT: it is flat inlay. */

export const PLAZA_LIFE_BLOCKED: readonly PalaceRect[] = [
  POOL_BLOCKED,
  ...PLAZA_LAMPS.map((l) => rectAround(l.x, l.z, LAMP.blockHalf, LAMP.blockHalf)),
  ...PLAZA_BENCHES.map((b) =>
    b.alongZ
      ? rectAround(b.x, b.z, BENCH.blockHalfZ, BENCH.blockHalfX)
      : rectAround(b.x, b.z, BENCH.blockHalfX, BENCH.blockHalfZ),
  ),
  ...PLAZA_TABLE_SETS.map((t) => rectAround(t.x, t.z, TABLE_SET.blockHalf, TABLE_SET.blockHalf)),
  ...PLAZA_URNS.map((u) => rectAround(u.x, u.z, URN.blockHalf, URN.blockHalf)),
  ...PLAZA_STALLS.map((s) => rectAround(s.x, s.z, STALL.blockHalfX, STALL.blockHalfZ)),
];
