/**
 * stage-grounds.ts — the STAGE GROUNDS district, as pure placement
 * data (Open World Overhaul, Stage C batch C4: board item 31).
 *
 * Until this batch the Stage Grounds were a barred gate in the
 * plaza's west wall (item 37's honest gate: a real gap at
 * (−28.2, z ≈ 19.5), closed by a gold bar because nothing existed
 * beyond it). This batch builds the district the gate always
 * promised: a real outdoor stage quarter west of the plaza — an
 * outdoor stage with a backdrop shell and curtain, speaker stacks,
 * a lighting truss with emissive lamps, bench rows on an audience
 * lawn, and the quarter's own lamps, banners and perimeter — and
 * the gate OPENS: the bar comes off and the gap becomes a true
 * passage into a new palace room (`world:stage-grounds` in
 * palace-layout, mirrored server-side in world-palace.ts).
 *
 * The house laws this module follows (palace-grounds / plaza-life):
 *   1. Every SOLID is registered as a blocked rect in
 *      palace-layout DERIVED from this same data (STAGE_BLOCKED
 *      below) — a visible body and its collision can never drift.
 *   2. The ground wears the OUTDOOR system: the look's paving at
 *      whole-tile slabs (palace-grounds' pavingSlabsFor over the
 *      district floor rect) and a real lawn panel for the audience
 *      ground — never interior marble. The marble survives only
 *      as the entry path's accent, exactly as on the plaza.
 *   3. NO new real lights. The truss lamps and the quarter's lamp
 *      standards glow by emissive glass + the item-27 lantern-glow
 *      sprites after dark, inside the ladder's existing budget.
 *   4. Repeated pieces are placed as lists so the scene instances
 *      them (bench parts, lamp parts, truss lamp heads).
 *
 * The look (Living Night Palace + its golden-day twin) is worn
 * through hall-looks' textures; geometry here is look-independent.
 */
import type { PalaceRect, PlazaWallRun } from "./palace-layout";
import { LAWN_BED, type GroundsBox, type LawnPanel } from "./palace-grounds";
import { BENCH, LAMP, pollenVolumeForInterior, type PollenVolume } from "./plaza-life";

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
 * The district fills the ground west of the plaza's west wall:
 * interior x −54.2..−28.2, z 10.0..36.0 (26 m × 26 m) — inside the
 * 90 m sky dome from every viewpoint, and deep enough that the
 * stage at its west end reads across a real audience ground from
 * the gate. The stage's axis is the district's centre line
 * (z 23); the gate (z 19.5) enters the audience ground's east
 * side, so an arriving walker sees the stage ahead of them across
 * the lawn the moment they step through. */

export const STAGE_GROUNDS_INTERIOR: PalaceRect = {
  minX: -54.2, maxX: -28.2, minZ: 10.0, maxZ: 36.0,
};

/** Daylight motes (Stack-100 #3, item-4 retry): the quarter's
 *  air volume for plaza-life's pollen system — the day look's
 *  drifting motes, inset from the walls past their wander. */
export const STAGE_MOTES: PollenVolume = pollenVolumeForInterior(STAGE_GROUNDS_INTERIOR);

/** Where a figure's centre may stand: inside the quarter's own
 *  perimeter walls by the plaza's house clearance (the wall face
 *  plus 0.175 m), and east to the plaza wall's face — the doorway
 *  portal in palace-layout bridges the wall band itself. */
export const STAGE_GROUNDS_WALK: PalaceRect = {
  minX: -53.85, maxX: -28.55, minZ: 10.35, maxZ: 35.65,
};

export const STAGE_GROUNDS_CAM_CLAMP: PalaceRect = {
  minX: -54.0, maxX: -28.0, minZ: 10.2, maxZ: 35.8,
};

/** Where a transfer with no crossing point lands: just inside
 *  the gate, on the entry path, facing the stage. */
export const STAGE_GROUNDS_SPAWN = { x: -30.2, z: 19.5 } as const;

/** The quarter's own low walls (the plaza enclosure's language:
 *  0.35 m thick, gold-capped in the scene): west, north and south
 *  runs closing the district. The east side is the plaza's own
 *  west wall — with the gate gap in it, now a true passage. */
export const STAGE_WALL_RUNS: readonly PlazaWallRun[] = [
  { w: 0.35, d: 26.0, x: -54.2, z: 23.0 },
  { w: 26.0, d: 0.35, x: -41.2, z: 10.0 },
  { w: 26.0, d: 0.35, x: -41.2, z: 36.0 },
];

/** Grounded piers on the quarter's wall line (item 43's language):
 *  the two west corners and the west wall's midpoint. */
export const STAGE_PIERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -54.2, z: 10.0 },
  { x: -54.2, z: 23.0 },
  { x: -54.2, z: 36.0 },
];

/* ── The stage ────────────────────────────────────────────────────
 * A raised platform at the quarter's west end, a U-shaped
 * backdrop shell (back wall + two returns) with a fabric curtain
 * on its face, speaker stacks flanking its front, and a lighting
 * truss across its front line. The platform's top is VISUAL
 * elevation (flat-plane movement, like item 38's terraces): the
 * whole footprint is honestly blocked — performers reach the
 * stage by the room's programming, walkers watch from the lawn. */

export const STAGE_PLATFORM: GroundsBox = {
  cx: -50.6, cy: 0.45, cz: 23.0, w: 6.4, h: 0.9, d: 11.0,
};

/** The backdrop shell: a tall back wall behind the platform and
 *  two returns reaching east, forming the shell a curtain hangs
 *  in. Heights: back 6.0 m, returns 4.6 m. */
export const STAGE_SHELL_BACK: GroundsBox = {
  cx: -54.05, cy: 3.0, cz: 23.0, w: 0.5, h: 6.0, d: 13.0,
};
export const STAGE_SHELL_RETURNS: readonly GroundsBox[] = [
  { cx: -52.3, cy: 2.3, cz: 17.2, w: 3.0, h: 4.6, d: 0.4 },
  { cx: -52.3, cy: 2.3, cz: 28.8, w: 3.0, h: 4.6, d: 0.4 },
];

/** The curtain: a fabric panel on the back wall's east face,
 *  hanging from just under the shell's crown to the platform. */
export const STAGE_CURTAIN: GroundsBox = {
  cx: -53.72, cy: 3.05, cz: 23.0, w: 0.12, h: 4.3, d: 9.6,
};

/** Speaker stacks flanking the stage front: three cabinets each,
 *  2.55 m tall on a low plinth. */
export const SPEAKER_STACKS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -46.9, z: 17.9 },
  { x: -46.9, z: 28.1 },
];
export const SPEAKER_STACK = { w: 1.3, d: 1.3, cabinetH: 0.85, cabinets: 3, blockHalf: 0.75 } as const;

/** The lighting truss: two posts on the stage's front line and a
 *  crossbar spanning the stage between them, carrying five lamp
 *  heads. The heads are EMISSIVE (lit amber after dark, pale by
 *  day — the lamp-glass law); there is no real light on the truss. */
export const TRUSS = {
  postX: -46.6,
  postZs: [16.9, 29.1] as readonly number[],
  postH: 5.2,
  barY: 5.2,
  /** Lamp head z positions along the bar. */
  headZs: [18.6, 20.9, 23.0, 25.1, 27.4] as readonly number[],
  headY: 4.92,
  blockHalf: 0.2,
} as const;

/** Banner poles flanking the truss line: a gold-rod pole with a
 *  hanging fabric banner in the look's cloth — the quarter's
 *  colours at its door. */
export const BANNER_POLES: ReadonlyArray<{ x: number; z: number }> = [
  { x: -46.6, z: 15.2 },
  { x: -46.6, z: 30.8 },
];
export const BANNER_POLE = { h: 4.2, blockHalf: 0.2 } as const;

/* ── The audience ground ──────────────────────────────────────────
 * A real lawn panel (the plaza lawns' construction: stone-edged
 * bed, textured grass) centred on the stage's axis, holding three
 * rows of benches facing the stage. East of the lawn, the entry
 * path (marble accent, the plaza path's language) runs from the
 * gate to the lawn's edge; the rest of the floor is the outdoor
 * paving. The lawn is stroll-across ground, exactly like the
 * plaza's — only the benches on it are solid. */

export const AUDIENCE_LAWN: LawnPanel = { cx: -40.5, cz: 23.0, w: 17.0, d: 15.0, topY: 0.05 };

/** Bench rows on the lawn, facing the stage (their length runs
 *  along Z, backs to the east). Three rows × three benches. */
export const STAGE_BENCHES: ReadonlyArray<{ x: number; z: number; alongZ: true }> = [
  { x: -43.5, z: 19.0, alongZ: true },
  { x: -43.5, z: 23.0, alongZ: true },
  { x: -43.5, z: 27.0, alongZ: true },
  { x: -40.5, z: 19.0, alongZ: true },
  { x: -40.5, z: 23.0, alongZ: true },
  { x: -40.5, z: 27.0, alongZ: true },
  { x: -37.5, z: 19.0, alongZ: true },
  { x: -37.5, z: 23.0, alongZ: true },
  { x: -37.5, z: 27.0, alongZ: true },
];

/** The entry path: a marble strip on the gate's line (z 19.5)
 *  from the plaza wall to the lawn's east edge, with gold edge
 *  strips — the plaza spine's language, turned west. Flat accent
 *  only: no collision, like every path on the grounds. */
export const ENTRY_PATH = {
  fromX: -47.0, toX: -28.2, cz: 19.5, w: 2.2,
} as const;

/** The quarter's lamp standards (plaza-life's LAMP construction):
 *  a pair flanking the entry path inside the gate, and pairs on
 *  the lawn's north and south lines. Emissive heads + glow
 *  sprites after dark; zero real lights. */
export const STAGE_LAMPS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -31.0, z: 16.8 },
  { x: -31.0, z: 22.2 },
  { x: -36.0, z: 13.4 },
  { x: -45.0, z: 13.4 },
  { x: -36.0, z: 32.6 },
  { x: -45.0, z: 32.6 },
];

/* ── Stack-100 #2: the arrival arch (item 39) ─────────────────────
 * The district's threshold gets the proscenium's language at
 * garden scale: two marble columns flanking the entry path just
 * inside the gate, a gold arch band spanning them at 3.4 m, and
 * the district's name plate on the band facing the arriving
 * walker — the threshold reads as an entrance to a stage, not a
 * plain lintel in open floor. The columns are solid from this
 * same data; the band rides above the walker's head (its columns
 * are the collision, like every canopy in the world). */

export const STAGE_ARRIVAL_ARCH = {
  x: -29.8,
  /** The columns flank the entry path (its edges are z 18.4 and
   *  20.6 on the gate's line, cz 19.5). */
  columnZs: [17.6, 21.4] as readonly number[],
  columnH: 3.4,
  blockHalf: 0.3,
  /** The arch band's height and the name plate's seat on it. */
  bandY: 3.52,
  plateY: 3.52,
} as const;

/* ── The batch's collision, derived ───────────────────────────────
 * Every solid above, as blocked rects — palace-layout registers
 * this list as the room's `blocked`, so the stage, its shell, the
 * stacks, the truss, the benches, the lamps, the poles, the piers
 * and the quarter's own walls are solid in the same commit that
 * makes them visible. The lawn, the entry path and the paving are
 * ground, deliberately absent. */

export const STAGE_BLOCKED: readonly PalaceRect[] = [
  ...STAGE_WALL_RUNS.map((r) => rectAround(r.x, r.z, r.w / 2, r.d / 2)),
  ...STAGE_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  rectOf(STAGE_PLATFORM),
  rectOf(STAGE_SHELL_BACK),
  ...STAGE_SHELL_RETURNS.map(rectOf),
  ...SPEAKER_STACKS.map((s) => rectAround(s.x, s.z, SPEAKER_STACK.blockHalf, SPEAKER_STACK.blockHalf)),
  ...TRUSS.postZs.map((z) => rectAround(TRUSS.postX, z, TRUSS.blockHalf, TRUSS.blockHalf)),
  ...BANNER_POLES.map((p) => rectAround(p.x, p.z, BANNER_POLE.blockHalf, BANNER_POLE.blockHalf)),
  ...STAGE_BENCHES.map((b) => rectAround(b.x, b.z, BENCH.blockHalfZ, BENCH.blockHalfX)),
  ...STAGE_LAMPS.map((l) => rectAround(l.x, l.z, LAMP.blockHalf, LAMP.blockHalf)),
  ...STAGE_ARRIVAL_ARCH.columnZs.map((z) => rectAround(STAGE_ARRIVAL_ARCH.x, z, STAGE_ARRIVAL_ARCH.blockHalf, STAGE_ARRIVAL_ARCH.blockHalf)),
];

/** The district's camera-tall solids (item 44's rule): the shell
 *  (4.6–6.0 m), the truss posts (5.2 m), the banner poles (4.2 m),
 *  the wall piers (cap ~4.0 m) and the speaker stacks (2.55 m —
 *  a hair over the 2.45 m camera line, so the lens keeps off
 *  them). The platform (0.9 m), benches, lamps and low walls pass
 *  under the lens. */
export const STAGE_TALL_BLOCKED: readonly PalaceRect[] = [
  ...STAGE_ARRIVAL_ARCH.columnZs.map((z) => rectAround(STAGE_ARRIVAL_ARCH.x, z, STAGE_ARRIVAL_ARCH.blockHalf, STAGE_ARRIVAL_ARCH.blockHalf)),
  rectOf(STAGE_SHELL_BACK),
  ...STAGE_SHELL_RETURNS.map(rectOf),
  ...TRUSS.postZs.map((z) => rectAround(TRUSS.postX, z, TRUSS.blockHalf, TRUSS.blockHalf)),
  ...BANNER_POLES.map((p) => rectAround(p.x, p.z, BANNER_POLE.blockHalf, BANNER_POLE.blockHalf)),
  ...STAGE_PIERS.map((p) => rectAround(p.x, p.z, 0.45, 0.45)),
  ...SPEAKER_STACKS.map((s) => rectAround(s.x, s.z, SPEAKER_STACK.blockHalf, SPEAKER_STACK.blockHalf)),
];

/** Re-exported for the scene's lawn build (the plaza lawns' bed
 *  language is the district lawn's too). */
export { LAWN_BED };
