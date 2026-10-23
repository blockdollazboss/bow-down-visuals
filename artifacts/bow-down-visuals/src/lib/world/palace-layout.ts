/**
 * palace-layout.ts — The palace floor plan as pure geometry.
 *
 * The King's Hall stays exactly the room it has always been (same
 * walk bounds, same camera clamp); four more rooms hang off it:
 *
 *        ┌─────────────┬──────────────┬─────────────┐
 *        │             │  THE KING'S  │             │
 *        │ MUSIC HALL  │     HALL     │ CREATE WING │
 *        ├─────────────┤  (spawn +    ├─────────────┤
 *        │ GAME ROOMS  │   stage)     │             │
 *        └─────────────┴──────┬───────┴─────────────┘
 *                     THE KING'S PLAZA (back arch —
 *                the open-world front door, Phase 1)
 *
 * Movement is union-of-rects: a position is walkable when it stands
 * in a room's walk rect or in a doorway's portal rect. The walls
 * between rects are NOT walkable, so the only way from one room to
 * another is through a portal — a doorway — exactly like walking
 * the real palace. Membership flips at the wall plane inside the
 * portal: cross the plane inside the span and you are in the next
 * room (the scene reports it; the server transfers your presence).
 *
 * Server clamp bounds for the same rooms live in the API's
 * lib/world-palace.ts (a little generous at the doorway aprons, on
 * purpose — the clamp is anti-wall-parking, not physics).
 */

import { HALL_STEPS_BLOCKED, MONUMENT_BLOCKED, TERRACE_BLOCKED } from "./palace-grounds";
import { PLAZA_LIFE_BLOCKED } from "./plaza-life";
import {
  STAGE_BLOCKED,
  STAGE_GROUNDS_CAM_CLAMP,
  STAGE_GROUNDS_INTERIOR,
  STAGE_GROUNDS_SPAWN,
  STAGE_GROUNDS_WALK,
  STAGE_TALL_BLOCKED,
} from "./stage-grounds";
import {
  GARDENS_BLOCKED,
  GARDENS_CAM_CLAMP,
  GARDENS_INTERIOR,
  GARDENS_SPAWN,
  GARDENS_TALL_BLOCKED,
  GARDENS_WALK,
} from "./listening-gardens";
import {
  ROW_BLOCKED,
  ROW_CAM_CLAMP,
  ROW_INTERIOR,
  ROW_SPAWN,
  ROW_TALL_BLOCKED,
  ROW_WALK,
} from "./creation-row";
import {
  ATELIERS_BLOCKED,
  ATELIERS_CAM_CLAMP,
  ATELIERS_INTERIOR,
  ATELIERS_SPAWN,
  ATELIERS_TALL_BLOCKED,
  ATELIERS_WALK,
} from "./ateliers";
import {
  BOARDWALK_BLOCKED,
  BOARDWALK_CAM_CLAMP,
  BOARDWALK_GROUNDS,
  BOARDWALK_INTERIOR,
  BOARDWALK_SPAWN,
  BOARDWALK_TALL_BLOCKED,
  BOARDWALK_WALK,
} from "./boardwalk";

export const HALL_ROOM_ID = "world:kings-hall";
export const MUSIC_HALL_ID = "world:music-hall";
export const GAME_ROOMS_ID = "world:game-rooms";
export const CREATE_WING_ID = "world:create-wing";
export const COURTYARD_ID = "world:courtyard";
/* The second ring (palace follow-on): the front rooms flank the
 * stage end of the hall, the Branding Atelier mirrors the Game
 * Rooms on the east. Same door standard as the first ring — one
 * door each, straight off the hall. */
export const TREASURY_ID = "world:treasury";
export const ROYAL_COURT_ID = "world:royal-court";
export const BRANDING_ATELIER_ID = "world:branding-atelier";
/* The first built district (Stage C item 31): the outdoor stage
 * quarter west of the plaza, through the west wall's gate — now
 * a true passage. Its geometry lives in stage-grounds.ts. */
export const STAGE_GROUNDS_ID = "world:stage-grounds";
/* The second built district (Stage C item 32): the gardens
 * quarter south of the promenade, through a new gap in the south
 * wall on the old marker's line — now a true passage. Its
 * geometry lives in listening-gardens.ts. */
export const LISTENING_GARDENS_ID = "world:listening-gardens";
/* The third built district (Stage C item 33): the makers' row
 * east of the plaza, through a new gap in the east wall on the
 * old marker's line — now a true passage. Its geometry lives in
 * creation-row.ts. */
export const CREATION_ROW_ID = "world:creation-row";
/* The fourth built district (Stage C item 34): the fine-work
 * quarter south-east of the plaza, south of Creation Row —
 * through a new gap in the east wall's south run, now a true
 * passage. Its geometry lives in ateliers.ts. */
export const ATELIERS_ID = "world:ateliers";
/* The fifth built district (Stage C item 35): the waterfront
 * quarter south of the plaza, between the Listening Gardens and
 * the Ateliers — through the south wall's barred gate, now a
 * true passage. Its geometry lives in boardwalk.ts. */
export const BOARDWALK_ID = "world:boardwalk";

export interface PalaceRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PalaceRoomLayout {
  id: string;
  name: string;
  /** Where a figure's center may stand. */
  walk: PalaceRect;
  /** Extra walkable ground beyond the main rect — grounds and
   *  gardens that belong to the same room (one presence, one
   *  voice mesh, no doorway between). The King's Plaza carries
   *  its south promenade here (Open World Phase 1): the rects
   *  must touch or overlap `walk`, because a step may only pass
   *  through walkable ground. */
  grounds?: PalaceRect[];
  /** Solid footprints inside the walkable ground — furniture and
   *  monuments a body cannot pass through (overhaul stage 3: the
   *  shipped plaza let walkers stroll straight through the Kingdom
   *  Board monument's plinth). A point inside a blocked rect is
   *  not walkable even when it stands in `walk`/`grounds`. */
  blocked?: PalaceRect[];
  /** The subset of `blocked` tall enough to reach the third-person
   *  camera (which rides at 2.45 m): the camera pull-in (item 44)
   *  collides with these only — low walls, planters and braziers
   *  pass under the lens and must never yank it. Absent = the
   *  room's whole `blocked` list is camera-tall. */
  camBlocked?: PalaceRect[];
  /** The room's physical interior (wall face to wall face) — the
   *  shell builder floors and ceilings to this. */
  interior: PalaceRect;
  /** Third-person camera clamp inside this room. */
  camClamp: PalaceRect;
  /** Where you materialize when a transfer carries no crossing
   *  point: just inside the room's door. */
  spawn: { x: number; z: number };
}

/** Door height — the lintel/arch line every doorway shares. */
export const PALACE_DOOR_HEIGHT = 3.6;

/* ── The King's Plaza dressing plan (Open World Overhaul, Stage B
 * cluster 4: items 39/41/42/43) ────────────────────────────────────
 * The plaza's props, walls, columns and gates are DATA here, not
 * literals buried in the scene build: hall-scene's courtyard build
 * places every mesh from these lists, and the courtyard's
 * `blocked` rects below are DERIVED from the same lists — so a
 * prop's solid footprint and its visible body can never drift
 * apart (the layout↔scene agreement the tests pin). Coordinates
 * are world metres on the plaza's floor plan. */

export interface PlazaWallRun {
  /** Box width (X) and depth (Z) of the run, and its centre. */
  w: number;
  d: number;
  x: number;
  z: number;
}

/** Every low-wall run on the plaza, as one enclosure (item 42).
 *  The runs stand just outside the walkable bounds (wall face
 *  ~0.18 m beyond the walk edge, the house clearance), so the
 *  visible wall and the walk clamp agree everywhere: no gap a
 *  walker can see through, no invisible wall where floor runs on.
 *  The gate gaps (Stage Grounds west, Boardwalk south,
 *  Listening Gardens south, Creation Row east, Ateliers east)
 *  are real gaps in the runs. The Stage Grounds gap is a true
 *  passage since item 31, the Listening Gardens gap since
 *  item 32, the Creation Row gap since item 33, the Ateliers
 *  gap since item 34 and the Boardwalk gap since item 35 — the
 *  portals in PALACE_DOORS bridge them into the built districts
 *  beyond. */
export const PLAZA_WALL_RUNS: PlazaWallRun[] = [
  /* West wall x −28.2, split by the Stage Grounds gate gap
   * (z 18.4..20.6). */
  { w: 0.35, d: 6.0, x: -28.2, z: 15.4 },
  { w: 0.35, d: 13.4, x: -28.2, z: 27.3 },
  /* East wall x 28.2, split by the Creation Row gate gap
   * (z 13.4..15.6, on the old marker's line at z 14.5 — item 33)
   * and — since item 34 — by the Ateliers gate gap
   * (z 29.4..31.6, in the south run): a short run north of the
   * Row gap, the main run south of it, then the south run in two
   * pieces flanking the Ateliers gap, closing at z 34 beside
   * the Ateliers quarter's own west wall. */
  { w: 0.35, d: 1.0, x: 28.2, z: 12.9 },
  { w: 0.35, d: 10.4, x: 28.2, z: 20.8 },
  { w: 0.35, d: 3.4, x: 28.2, z: 27.7 },
  { w: 0.35, d: 2.4, x: 28.2, z: 32.8 },
  /* South wall z 34.0 across the promenade, split by the
   * Boardwalk gate gap (x −1.1..1.1) and — since item 32 — the
   * Listening Gardens gate gap (x −27.1..−24.9, on the old
   * marker's line at x −26): two runs west of the Boardwalk gap
   * carry the wall around the gardens' true passage. */
  { w: 1.1, d: 0.35, x: -27.65, z: 34.0 },
  { w: 23.8, d: 0.35, x: -13.0, z: 34.0 },
  { w: 1.25, d: 0.35, x: 1.725, z: 34.0 },
  /* The south-east yard's south run: from the Creator Room's east
   * wall to the east wall, closing the yard the SE floor patch
   * stands in (item 42). West of x 16.6 the Creator Room's own
   * walls close the line — its interior runs on to z 38. */
  { w: 11.6, d: 0.35, x: 22.4, z: 34.0 },
  /* The notch wall that stood here (item 42, along the main
   * grounds' south edge at z 26.05 east of the Creator Room) is
   * GONE since item 34 — deliberately: it existed to hide the
   * invisible boundary of the unwalkable south-east yard, and
   * the yard is walkable plaza ground now (see the Courtyard's
   * grounds below), ending at real walls and at the Ateliers
   * gate in the east wall. There is no invisible boundary left
   * for a notch to hide. */
  /* The Creator Rooms arch returns (item 41): two stubs returning
   * north from the creator wall's face, flanking the arch's
   * forecourt so the arch sits in architecture, not open floor. */
  { w: 0.35, d: 1.0, x: 7.55, z: 25.55 },
  { w: 0.35, d: 1.0, x: 11.45, z: 25.55 },
];

/** The plaza's wall-top columns, now grounded piers (item 43):
 *  plinth on the ground, shaft rising through the low wall's line
 *  to the same cap height as before. Positions: the enclosure's
 *  corners and turns, plus a mid-wall pier on each long side. */
export const PLAZA_COLUMNS: Array<{ x: number; z: number }> = [
  { x: -28.2, z: 12.6 },
  { x: 28.2, z: 12.6 },
  { x: -28.2, z: 33.8 },
  { x: 2.35, z: 34.0 },
  { x: -28.2, z: 23.2 },
  { x: 28.2, z: 19.2 },
  /* The completed enclosure's new corners (item 42). */
  { x: 28.2, z: 33.8 },
  { x: 28.2, z: 26.05 },
];

/** Planter troughs (item 39): a marble trough 2.0 m long, its two
 *  green crowns rounding the footprint to 0.44 m across. */
export const PLAZA_PLANTERS: Array<{ x: number; z: number; alongZ: boolean }> = [
  { x: -27.3, z: 15.8, alongZ: true },
  { x: -27.3, z: 22.6, alongZ: true },
  { x: 27.3, z: 15.8, alongZ: true },
  { x: 27.3, z: 22.6, alongZ: true },
  { x: -27.3, z: 28.8, alongZ: true },
  { x: -27.3, z: 32.3, alongZ: true },
  { x: 2.2, z: 29.5, alongZ: true },
  { x: -20, z: 33.1, alongZ: false },
  { x: -8, z: 33.1, alongZ: false },
];

/** Courtyard braziers (item 39): pedestal + bowl, 0.46 m bowl
 *  radius. The pedestal and bowl stand in BOTH looks (daytime
 *  furniture); only the coals, flame and light follow the dark
 *  look — so this footprint is honest in either theme. */
export const PLAZA_BRAZIERS: Array<{ x: number; z: number }> = [
  { x: -4.6, z: 18.6 },
  { x: 4.6, z: 18.6 },
  { x: -3.4, z: 19.7 },
  { x: 3.4, z: 19.7 },
];

export interface PlazaGate {
  name: string;
  x: number;
  z: number;
  /** "gate": a threshold standing in a REAL gap in a real wall
   *  (posts ±1.1 m, gold header; a CLOSED gate adds a gold bar,
   *  an OPEN gate is a true passage). "marker": a named district
   *  signpost on open floor — one post on a 0.78 m plinth, no
   *  span, no bar, nothing that implies a passage (item 37's
   *  honest classification; mirrors district-gates.ts, which
   *  drives the scene build — the two lists must agree, and a
   *  palace-layout test pins that they do). */
  kind: "gate" | "marker";
  /** "x": the gate spans X (posts east/west of centre); "z": spans Z. */
  axis: "x" | "z";
  plateRotY: number;
  /** The gold bar's offset from centre (wall gates' bars ride the
   *  wall's plaza face). Markers have no bar; neither does an
   *  OPEN gate. */
  barDx: number;
  barDz: number;
  /** Gates only: the district beyond is built and this gate is a
   *  true passage — its collision is its two posts alone, and the
   *  doorway portal (PALACE_DOORS) carries walkers through.
   *  Mirrors district-gates.ts' `open`. */
  open?: boolean;
}

/** The six district thresholds. Five are true gates in real
 *  wall gaps (Stage Grounds in the west wall — OPEN since item
 *  31, its district built; Listening Gardens in the south wall —
 *  OPEN since item 32, its district built, reclassified from the
 *  promenade marker that stood at (−26, 33.8); Creation Row in
 *  the east wall — OPEN since item 33, its district built,
 *  reclassified from the plaza-floor marker that stood at
 *  (27.0, 14.5); the Ateliers in the east wall's south run —
 *  OPEN since item 34, its district built south of Creation
 *  Row, reclassified from the plaza-floor marker that stood at
 *  (27.0, 22.5) — its gate could not stand on the marker's own
 *  line, because east of z 22.5 is Creation Row's built quarter;
 *  the gate stands at z 30.5, the one east-wall line that opens
 *  into the Ateliers quarter itself; the Boardwalk in the south
 *  wall — OPEN since item 35, its district built: the one gate
 *  that was always a gate, barred honestly until its quarter
 *  stood beyond it). One is a marker: the Creator Heights
 *  marker keeps its Phase-1 spot. Every footprint below matches
 *  the body the scene builds. */
export const PLAZA_GATES: PlazaGate[] = [
  { name: "STAGE GROUNDS", kind: "gate", x: -28.2, z: 19.5, axis: "z", plateRotY: Math.PI / 2, barDx: 0.22, barDz: 0, open: true },
  { name: "THE BOARDWALK", kind: "gate", x: 0, z: 34.0, axis: "x", plateRotY: Math.PI, barDx: 0, barDz: 0, open: true },
  { name: "LISTENING GARDENS", kind: "gate", x: -26, z: 34.0, axis: "x", plateRotY: Math.PI, barDx: 0, barDz: -0.22, open: true },
  { name: "CREATION ROW", kind: "gate", x: 28.2, z: 14.5, axis: "z", plateRotY: -Math.PI / 2, barDx: -0.22, barDz: 0, open: true },
  { name: "THE ATELIERS", kind: "gate", x: 28.2, z: 30.5, axis: "z", plateRotY: -Math.PI / 2, barDx: -0.22, barDz: 0, open: true },
  { name: "CREATOR HEIGHTS", kind: "marker", x: 13.5, z: 24.6, axis: "x", plateRotY: Math.PI, barDx: 0, barDz: 0 },
];

/** The Creator Rooms arch's pillars (0.55 m square) in world
 *  coordinates — the arch group stands at (9.5, 26.0), pillars at
 *  ±1.45 local X. They flank the arch portal (x 8.4..10.6) without
 *  touching it: the doorway stays fully walkable. */
export const CREATOR_ARCH_PILLARS: Array<{ x: number; z: number }> = [
  { x: 8.05, z: 26.0 },
  { x: 10.95, z: 26.0 },
];

const rectAround = (x: number, z: number, hx: number, hz: number): PalaceRect => ({
  minX: x - hx,
  maxX: x + hx,
  minZ: z - hz,
  maxZ: z + hz,
});

const wallRunRect = (run: PlazaWallRun): PalaceRect => rectAround(run.x, run.z, run.w / 2, run.d / 2);

/** A threshold's solid footprints. A marker is its plinth; a
 *  CLOSED gate is its whole span (posts + the bar between them —
 *  nothing passes); an OPEN gate is its two posts alone, at
 *  ±1.1 m along the span — the passage between them is walkable
 *  ground, bridged by the gate's portal. */
const gateRects = (gate: PlazaGate): PalaceRect[] => {
  if (gate.kind === "marker") return [rectAround(gate.x, gate.z, 0.39, 0.39)];
  if (gate.open) {
    return gate.axis === "x"
      ? [rectAround(gate.x - 1.1, gate.z, 0.2, 0.2), rectAround(gate.x + 1.1, gate.z, 0.2, 0.2)]
      : [rectAround(gate.x, gate.z - 1.1, 0.2, 0.2), rectAround(gate.x, gate.z + 1.1, 0.2, 0.2)];
  }
  return gate.axis === "x"
    ? [rectAround(gate.x, gate.z, 1.26, 0.16)]
    : [rectAround(gate.x, gate.z, 0.16, 1.26)];
};

/** The plaza's solid footprints (item 39), derived from the
 *  dressing plan above: the monument's plinth, every wall run,
 *  every column pier, planter, brazier and gate, and the arch's
 *  pillars. A step into any of them resolves like a wall — slide
 *  or stop — never a walk through a visible body. */
export const PLAZA_BLOCKED: PalaceRect[] = [
  /* The Kingdom Board monument's plinth — Stage C item 17 grew
   * the monument (4.46 m trim square at (0, 19.7)), and its
   * blocked rect grew with it, derived from palace-grounds'
   * MONUMENT_BLOCKED in the same batch (the old 3.7 m square was
   * banked in overhaul stage 3 for the old 3.55 m trim). */
  MONUMENT_BLOCKED,
  ...PLAZA_WALL_RUNS.map(wallRunRect),
  ...PLAZA_COLUMNS.map((c) => rectAround(c.x, c.z, 0.45, 0.45)),
  ...PLAZA_PLANTERS.map((p) => rectAround(p.x, p.z, p.alongZ ? 0.44 : 1.0, p.alongZ ? 1.0 : 0.44)),
  ...PLAZA_BRAZIERS.map((b) => rectAround(b.x, b.z, 0.46, 0.46)),
  ...PLAZA_GATES.flatMap(gateRects),
  ...CREATOR_ARCH_PILLARS.map((p) => rectAround(p.x, p.z, 0.275, 0.275)),
  /* Stage C item 38: the ceremonial hall steps flanking the arch
   * approach and the edge terraces — visual elevation AROUND the
   * walk paths, honestly blocked from the same placement data
   * (palace-grounds) the scene builds the masses from. */
  ...HALL_STEPS_BLOCKED,
  ...TERRACE_BLOCKED,
  /* Stage C batch C3 (items 28/29/30): the plaza life — the
   * reflecting pool, the lamp standards, the benches, table sets,
   * urns and market stalls — derived from plaza-life's placement
   * data in the same commit that builds the bodies. The item-40
   * spawn dressing is flat inlay and deliberately NOT here. */
  ...PLAZA_LIFE_BLOCKED,
];

/** The plaza's camera-tall solids (item 44): the monument (stele
 *  to ~4.2 m), the column piers (cap at ~4.0 m) and the arch
 *  pillars (cap at ~4.1 m). Everything else solid on the plaza —
 *  low walls (1.12 m), planters (~1.3 m), braziers (0.8 m), gate
 *  posts (2.0 m) — passes under the 2.45 m camera. */
export const PLAZA_TALL_BLOCKED: PalaceRect[] = [
  /* The grown monument (item 17): stele + crown now reach ~5.4 m
   * — still the plaza's camera-tall heart. */
  MONUMENT_BLOCKED,
  ...PLAZA_COLUMNS.map((c) => rectAround(c.x, c.z, 0.45, 0.45)),
  ...CREATOR_ARCH_PILLARS.map((p) => rectAround(p.x, p.z, 0.275, 0.275)),
];

export const PALACE_LAYOUT: Record<string, PalaceRoomLayout> = {
  [HALL_ROOM_ID]: {
    id: HALL_ROOM_ID,
    name: "The King's Hall",
    // The hall's long-standing walk bounds — unchanged.
    walk: { minX: -13.1, maxX: 13.1, minZ: -11.6, maxZ: 11.1 },
    interior: { minX: -14.0, maxX: 14.0, minZ: -18.0, maxZ: 12.0 },
    camClamp: { minX: -13.7, maxX: 13.7, minZ: -17.7, maxZ: 11.75 },
    spawn: { x: 0, z: 9.5 },
  },
  [MUSIC_HALL_ID]: {
    id: MUSIC_HALL_ID,
    name: "Music Hall",
    walk: { minX: -27.85, maxX: -14.35, minZ: -8.25, maxZ: 2.75 },
    interior: { minX: -28.2, maxX: -14.4, minZ: -8.6, maxZ: 3.1 },
    camClamp: { minX: -27.9, maxX: -14.7, minZ: -8.3, maxZ: 2.8 },
    spawn: { x: -15.6, z: -2 },
  },
  [GAME_ROOMS_ID]: {
    id: GAME_ROOMS_ID,
    name: "Game Rooms",
    walk: { minX: -27.85, maxX: -14.35, minZ: 3.85, maxZ: 11.55 },
    interior: { minX: -28.2, maxX: -14.4, minZ: 3.5, maxZ: 11.9 },
    camClamp: { minX: -27.9, maxX: -14.7, minZ: 3.8, maxZ: 11.6 },
    spawn: { x: -15.6, z: 5 },
  },
  [CREATE_WING_ID]: {
    id: CREATE_WING_ID,
    name: "Create Wing",
    walk: { minX: 14.35, maxX: 27.85, minZ: -8.25, maxZ: 2.75 },
    interior: { minX: 14.4, maxX: 28.2, minZ: -8.6, maxZ: 3.1 },
    camClamp: { minX: 14.7, maxX: 27.9, minZ: -8.3, maxZ: 2.8 },
    spawn: { x: 15.6, z: -2 },
  },
  /* The second ring. The two front rooms share the front band
   * (z −17.9..−9.2) on either side of the hall — their doors land
   * walkers on the hall's audience floor beside the stage (the
   * stage itself spans |x| ≤ 11, so the aprons at |x| 13.05..14.4
   * are clear floor). The Branding Atelier mirrors the Game Rooms
   * across the hall exactly (z 3.5..11.9). */
  [TREASURY_ID]: {
    id: TREASURY_ID,
    name: "Treasury",
    interior: { minX: -28.2, maxX: -14.4, minZ: -17.9, maxZ: -9.2 },
    walk: { minX: -27.85, maxX: -14.35, minZ: -17.55, maxZ: -9.55 },
    spawn: { x: -15.6, z: -13.5 },
    camClamp: { minX: -27.9, maxX: -14.7, minZ: -17.6, maxZ: -9.6 },
  },
  [ROYAL_COURT_ID]: {
    id: ROYAL_COURT_ID,
    name: "Royal Court Chamber",
    interior: { minX: 14.4, maxX: 28.2, minZ: -17.9, maxZ: -9.2 },
    walk: { minX: 14.35, maxX: 27.85, minZ: -17.55, maxZ: -9.55 },
    spawn: { x: 15.6, z: -13.5 },
    camClamp: { minX: 14.7, maxX: 27.9, minZ: -17.6, maxZ: -9.6 },
  },
  [BRANDING_ATELIER_ID]: {
    id: BRANDING_ATELIER_ID,
    name: "Branding Atelier",
    interior: { minX: 14.4, maxX: 28.2, minZ: 3.5, maxZ: 11.9 },
    walk: { minX: 14.35, maxX: 27.85, minZ: 3.85, maxZ: 11.55 },
    spawn: { x: 15.6, z: 5 },
    camClamp: { minX: 14.7, maxX: 27.9, minZ: 3.8, maxZ: 11.6 },
  },
  /* ── Open World Phase 1: the Courtyard becomes THE KING'S PLAZA ──
   * The room keeps its id (`world:courtyard` — the directory, the
   * creator-room arch and every station already point at it) and
   * becomes the palace's front door: the grounds widen to the
   * palace's full outer width, a promenade runs south-west of the
   * creator wing, and spawn moves to the promenade's head — you
   * arrive facing the palace, with the Kingdom Board monument at
   * the plaza's heart (0, 19.7) and the hall's open doors beyond.
   * One room, one presence: the colonnade stations keep their
   * places along the south wall, and the creator arch still
   * pierces it at x 9.5. The server clamp box mirrors this plan
   * (api-server lib/world-palace.ts). */
  [COURTYARD_ID]: {
    id: COURTYARD_ID,
    name: "The King's Plaza",
    walk: { minX: -27.85, maxX: 27.85, minZ: 12.55, maxZ: 25.7 },
    grounds: [
      { minX: -27.85, maxX: 2.35, minZ: 25.6, maxZ: 33.6 },
      /* The south-east yard (item 34): the enclosed floor east of
       * the Creator Room, between the main grounds and the south
       * wall. Until this batch it was visible-but-unwalkable —
       * item 42's notch wall hid its invisible boundary at
       * z 25.7. Now it is plaza ground in its own right: the way
       * a walker reaches the Ateliers gate in the east wall
       * (z 30.5), and the notch wall is gone with the boundary
       * it hid. The yard's edges are all real: the Creator
       * Room's east wall west, the east wall (and its gate)
       * east, the south run south. */
      { minX: 16.6, maxX: 27.85, minZ: 25.6, maxZ: 33.6 },
      /* The arch spur (item 41): the promenade's eastward arm
       * along the Creator Room's north wall face, from the
       * promenade's edge to the arch — its band runs to the
       * portal's east edge (10.65) so the arch's forecourt is
       * plaza ground in its own right, and stops at the wall
       * face (z 26.0): south of that is the wall, and the room
       * beyond is still entered through the portal alone. The
       * arch's flanking return walls stand in the band as
       * blocked rects (PLAZA_WALL_RUNS). */
      { minX: 2.35, maxX: 10.65, minZ: 25.6, maxZ: 26.0 },
    ],
    /* Solid footprints, derived from the dressing plan above
     * (PLAZA_BLOCKED): the monument's plinth — its board station
     * point stands on the open plaza just south of it at
     * (0, 22.6), in reading distance of the engraved face and
     * inside prompt radius of a walker stopped at the plinth's
     * edge — plus every planter, column pier, brazier, gate and
     * wall run on the plaza (item 39). */
    blocked: PLAZA_BLOCKED,
    camBlocked: PLAZA_TALL_BLOCKED,
    interior: { minX: -28.2, maxX: 28.2, minZ: 12.4, maxZ: 34.0 },
    camClamp: { minX: -28.0, maxX: 28.0, minZ: 12.6, maxZ: 33.9 },
    spawn: { x: 0, z: 31.5 },
  },
  /* ── Stage C item 31: THE STAGE GROUNDS ────────────────────────
   * The first built district: an outdoor stage quarter west of
   * the plaza, through the west wall's gate — since this batch a
   * true passage (the PALACE_DOORS portal below), not a barred
   * promise. One room, one presence, like every district-to-be:
   * the quarter is public look/listen space exactly as the plaza
   * is (no stage authority, no new verbs — the palace's one
   * stage stays in the hall). Its plan lives in stage-grounds.ts;
   * the server clamp box mirrors it (api-server
   * lib/world-palace.ts). */
  [STAGE_GROUNDS_ID]: {
    id: STAGE_GROUNDS_ID,
    name: "Stage Grounds",
    walk: STAGE_GROUNDS_WALK,
    blocked: [...STAGE_BLOCKED],
    camBlocked: [...STAGE_TALL_BLOCKED],
    interior: STAGE_GROUNDS_INTERIOR,
    camClamp: STAGE_GROUNDS_CAM_CLAMP,
    spawn: { ...STAGE_GROUNDS_SPAWN },
  },
  /* ── Stage C item 32: THE LISTENING GARDENS ────────────────────
   * The second built district: a gardens quarter south of the
   * promenade, through a new gap in the south wall on the old
   * marker's line — since this batch a true passage (the
   * PALACE_DOORS portal below), not a signpost's promise. One
   * room, one presence, like every district: the quarter is
   * public look/listen space exactly as the plaza is (no stage
   * authority, no new verbs — sitting and listening are what
   * it's for). Its plan lives in listening-gardens.ts; the
   * server clamp box mirrors it (api-server lib/world-palace.ts). */
  [LISTENING_GARDENS_ID]: {
    id: LISTENING_GARDENS_ID,
    name: "Listening Gardens",
    walk: GARDENS_WALK,
    blocked: [...GARDENS_BLOCKED],
    camBlocked: [...GARDENS_TALL_BLOCKED],
    interior: GARDENS_INTERIOR,
    camClamp: GARDENS_CAM_CLAMP,
    spawn: { ...GARDENS_SPAWN },
  },
  /* ── Stage C item 33: CREATION ROW ─────────────────────────────
   * The third built district: a makers' row east of the plaza,
   * through a new gap in the east wall on the old marker's line
   * — since this batch a true passage (the PALACE_DOORS portal
   * below), not a signpost's promise. One room, one presence,
   * like every district: the quarter is public look/listen space
   * exactly as the plaza is (no stage authority, no new verbs —
   * the stalls and plinths are the craft on show, and the Row
   * Slate is its one door). Its plan lives in creation-row.ts;
   * the server clamp box mirrors it (api-server
   * lib/world-palace.ts). */
  [CREATION_ROW_ID]: {
    id: CREATION_ROW_ID,
    name: "Creation Row",
    walk: ROW_WALK,
    blocked: [...ROW_BLOCKED],
    camBlocked: [...ROW_TALL_BLOCKED],
    interior: ROW_INTERIOR,
    camClamp: ROW_CAM_CLAMP,
    spawn: { ...ROW_SPAWN },
  },
  /* ── Stage C item 34: THE ATELIERS ─────────────────────────────
   * The fourth built district: a fine-work quarter south-east
   * of the plaza, south of Creation Row, through a new gap in
   * the east wall's south run — since this batch a true passage
   * (the PALACE_DOORS portal below), not a signpost's promise.
   * The gate stands at z 30.5, not on the old marker's line
   * (z 22.5): east of that line is Creation Row's built quarter,
   * and the Ateliers' north wall is the Row's own south wall.
   * One room, one presence, like every district: the quarter is
   * public look/listen space exactly as the plaza is (no stage
   * authority, no new verbs — the bays and vitrines are the fine
   * work on show, and the Ateliers Slate is its one door). Its
   * plan lives in ateliers.ts; the server clamp box mirrors it
   * (api-server lib/world-palace.ts). */
  [ATELIERS_ID]: {
    id: ATELIERS_ID,
    name: "The Ateliers",
    walk: ATELIERS_WALK,
    blocked: [...ATELIERS_BLOCKED],
    camBlocked: [...ATELIERS_TALL_BLOCKED],
    interior: ATELIERS_INTERIOR,
    camClamp: ATELIERS_CAM_CLAMP,
    spawn: { ...ATELIERS_SPAWN },
  },
  /* ── Stage C item 35: THE BOARDWALK ────────────────────────────
   * The fifth built district: a waterfront quarter south of the
   * plaza, between the Listening Gardens and the Ateliers,
   * through the south wall's gate — since this batch a true
   * passage (the PALACE_DOORS portal below), its bar off. The
   * quarter threads the Creator Rooms building, which stands
   * in the strip south of the wall: an entry corridor west of
   * the building and a pocket east of it ride as the room's
   * `grounds`, and the main timber deck opens out south of the
   * building down to the water basin at its south edge. One
   * room, one presence, like every district: the quarter is
   * public look/listen space exactly as the plaza is (no stage
   * authority, no new verbs — the bandstand is a viewing
   * platform, and the Boardwalk Slate is its one door). Its
   * plan lives in boardwalk.ts; the server clamp box mirrors
   * it (api-server lib/world-palace.ts). */
  [BOARDWALK_ID]: {
    id: BOARDWALK_ID,
    name: "The Boardwalk",
    walk: BOARDWALK_WALK,
    grounds: [...BOARDWALK_GROUNDS],
    blocked: [...BOARDWALK_BLOCKED],
    camBlocked: [...BOARDWALK_TALL_BLOCKED],
    interior: BOARDWALK_INTERIOR,
    camClamp: BOARDWALK_CAM_CLAMP,
    spawn: { ...BOARDWALK_SPAWN },
  },
};

export interface PalaceDoor {
  /** The room on the other side of the hall wall (the destination
   *  the hall-side name plate announces). */
  roomId: string;
  /** The wall the doorway pierces: "x" = a wall running along Z at
   *  x = plane (the side walls); "z" = a wall running along X at
   *  z = plane (the back wall). */
  axis: "x" | "z";
  plane: number;
  /** The opening's span along the wall. */
  spanMin: number;
  spanMax: number;
  /** The walkable doorway zone — aprons on both faces of the wall. */
  portal: PalaceRect;
  /** Membership on the plane's negative / positive side. */
  negRoom: string;
  posRoom: string;
}

export const PALACE_DOORS: PalaceDoor[] = [
  {
    roomId: MUSIC_HALL_ID,
    axis: "x",
    plane: -14.2,
    spanMin: -3.5,
    spanMax: -0.5,
    portal: { minX: -14.4, maxX: -13.05, minZ: -3.45, maxZ: -0.55 },
    negRoom: MUSIC_HALL_ID,
    posRoom: HALL_ROOM_ID,
  },
  {
    roomId: GAME_ROOMS_ID,
    axis: "x",
    plane: -14.2,
    spanMin: 3.5,
    spanMax: 6.5,
    portal: { minX: -14.4, maxX: -13.05, minZ: 3.55, maxZ: 6.45 },
    negRoom: GAME_ROOMS_ID,
    posRoom: HALL_ROOM_ID,
  },
  {
    roomId: CREATE_WING_ID,
    axis: "x",
    plane: 14.2,
    spanMin: -3.5,
    spanMax: -0.5,
    portal: { minX: 13.05, maxX: 14.4, minZ: -3.45, maxZ: -0.55 },
    negRoom: HALL_ROOM_ID,
    posRoom: CREATE_WING_ID,
  },
  /* The front doors: three metres wide in the hall's front side
   * walls (span −15..−12), clear of the stage (|x| ≤ 11), the
   * columns (x ±12.4, z −8/0/8) and the dark look's side sconces
   * and panel frames (z −9..5). */
  {
    roomId: TREASURY_ID,
    axis: "x",
    plane: -14.2,
    spanMin: -15,
    spanMax: -12,
    portal: { minX: -14.4, maxX: -13.05, minZ: -14.95, maxZ: -12.05 },
    negRoom: TREASURY_ID,
    posRoom: HALL_ROOM_ID,
  },
  {
    roomId: ROYAL_COURT_ID,
    axis: "x",
    plane: 14.2,
    spanMin: -15,
    spanMax: -12,
    portal: { minX: 13.05, maxX: 14.4, minZ: -14.95, maxZ: -12.05 },
    negRoom: HALL_ROOM_ID,
    posRoom: ROYAL_COURT_ID,
  },
  {
    roomId: BRANDING_ATELIER_ID,
    axis: "x",
    plane: 14.2,
    spanMin: 3.5,
    spanMax: 6.5,
    portal: { minX: 13.05, maxX: 14.4, minZ: 3.55, maxZ: 6.45 },
    negRoom: HALL_ROOM_ID,
    posRoom: BRANDING_ATELIER_ID,
  },
  {
    roomId: COURTYARD_ID,
    axis: "z",
    plane: 12.2,
    spanMin: -2.2,
    spanMax: 2.2,
    portal: { minX: -2.15, maxX: 2.15, minZ: 11.05, maxZ: 13.7 },
    negRoom: HALL_ROOM_ID,
    posRoom: COURTYARD_ID,
  },
  /* The Stage Grounds gate (item 31): the west wall's real gap
   * (z 18.4..20.6 at x −28.2), now a true passage. The portal
   * spans the wall band with aprons on both faces; its z span
   * stops inside the gate posts' footprints (posts at z 18.4 /
   * 20.6, blocked in PLAZA_BLOCKED), so the walkable doorway is
   * the honest opening between the posts. Membership flips at
   * the wall plane: west of it is the district, east the plaza. */
  {
    roomId: STAGE_GROUNDS_ID,
    axis: "x",
    plane: -28.2,
    spanMin: 18.4,
    spanMax: 20.6,
    portal: { minX: -28.6, maxX: -27.8, minZ: 18.55, maxZ: 20.45 },
    negRoom: STAGE_GROUNDS_ID,
    posRoom: COURTYARD_ID,
  },
  /* The Listening Gardens gate (item 32): the south wall's new
   * gap (x −27.1..−24.9 at z 34.0), now a true passage. The
   * portal spans the wall band with aprons on both faces; its x
   * span stops inside the gate posts' footprints (posts at
   * x −27.1 / −24.9, blocked in PLAZA_BLOCKED), so the walkable
   * doorway is the honest opening between the posts. Membership
   * flips at the wall plane: south of it is the district, north
   * the plaza. */
  {
    roomId: LISTENING_GARDENS_ID,
    axis: "z",
    plane: 34.0,
    spanMin: -27.1,
    spanMax: -24.9,
    portal: { minX: -26.95, maxX: -25.05, minZ: 33.6, maxZ: 34.4 },
    negRoom: COURTYARD_ID,
    posRoom: LISTENING_GARDENS_ID,
  },
  /* The Creation Row gate (item 33): the east wall's new gap
   * (z 13.4..15.6 at x 28.2), now a true passage. The portal
   * spans the wall band with aprons on both faces; its z span
   * stops inside the gate posts' footprints (posts at z 13.4 /
   * 15.6, blocked in PLAZA_BLOCKED), so the walkable doorway is
   * the honest opening between the posts. Membership flips at
   * the wall plane: east of it is the district, west the plaza. */
  {
    roomId: CREATION_ROW_ID,
    axis: "x",
    plane: 28.2,
    spanMin: 13.4,
    spanMax: 15.6,
    portal: { minX: 27.8, maxX: 28.6, minZ: 13.55, maxZ: 15.45 },
    negRoom: COURTYARD_ID,
    posRoom: CREATION_ROW_ID,
  },
  /* The Ateliers gate (item 34): the east wall's new gap in its
   * south run (z 29.4..31.6 at x 28.2), now a true passage. The
   * portal spans the wall band with aprons on both faces; its z
   * span stops inside the gate posts' footprints (posts at
   * z 29.4 / 31.6, blocked in PLAZA_BLOCKED), so the walkable
   * doorway is the honest opening between the posts. Membership
   * flips at the wall plane: east of it is the district, west
   * the plaza (reached across the south-east yard, walkable
   * plaza ground since this batch). */
  {
    roomId: ATELIERS_ID,
    axis: "x",
    plane: 28.2,
    spanMin: 29.4,
    spanMax: 31.6,
    portal: { minX: 27.8, maxX: 28.6, minZ: 29.55, maxZ: 31.45 },
    negRoom: COURTYARD_ID,
    posRoom: ATELIERS_ID,
  },
  /* The Boardwalk gate (item 35): the south wall's real gap
   * (x −1.1..1.1 at z 34.0), now a true passage — its gold bar
   * is off. The portal spans the wall band with aprons on both
   * faces; its x span stops inside the gate posts' footprints
   * (posts at x −1.1 / 1.1, blocked in PLAZA_BLOCKED), so the
   * walkable doorway is the honest opening between the posts.
   * Membership flips at the wall plane: south of it is the
   * district (its entry corridor, west of the Creator Rooms
   * building), north the plaza. */
  {
    roomId: BOARDWALK_ID,
    axis: "z",
    plane: 34.0,
    spanMin: -1.1,
    spanMax: 1.1,
    portal: { minX: -0.95, maxX: 0.95, minZ: 33.6, maxZ: 34.4 },
    negRoom: COURTYARD_ID,
    posRoom: BOARDWALK_ID,
  },
];

/* ── Creator Rooms (Ring 2, item 3.5) ──────────────────────────────
 * One room TEMPLATE south of the Courtyard, through the arch that
 * stood sealed there: a real room on the floor plan (interior
 * x 2.6..16.4, z 26.4..38.0 — the same numbers the server clamps
 * to, artifacts/api-server/src/lib/world-palace.ts
 * CREATOR_ROOM_BOUNDS/SPAWN) whose IDENTITY is dynamic. The room
 * instance is `creator:<slug>`; which creator that is belongs to
 * the walker, not the floor plan — presence is room-scoped
 * server-side, so two creators' rooms never share a crowd, and
 * this client only ever stands in one at a time. Registering a
 * slug lays the template's walk rect + the arch doorway under
 * that slug's id; registering another replaces it (one template,
 * one current host). The server template bounds are a touch
 * generous at the aprons, like every room's. */
export const CREATOR_ROOM_PREFIX = "creator:";

export function creatorRoomId(slug: string): string {
  return `${CREATOR_ROOM_PREFIX}${slug}`;
}

export function creatorSlugFromRoomId(roomId: string): string | null {
  if (!roomId.startsWith(CREATOR_ROOM_PREFIX)) return null;
  const slug = roomId.slice(CREATOR_ROOM_PREFIX.length);
  return slug.length > 0 ? slug : null;
}

export function isCreatorRoomId(roomId: string): boolean {
  return creatorSlugFromRoomId(roomId) !== null;
}

/** The one template's geometry — every creator's room stands here,
 *  dressed in their name and colors by the scene. */
export const CREATOR_ROOM_TEMPLATE = {
  interior: { minX: 2.6, maxX: 16.4, minZ: 26.4, maxZ: 38.0 },
  walk: { minX: 2.95, maxX: 16.05, minZ: 26.8, maxZ: 37.65 },
  camClamp: { minX: 2.85, maxX: 16.15, minZ: 26.6, maxZ: 37.75 },
  spawn: { x: 9.5, z: 28.6 },
  /** The arch in the Courtyard's south wall (x 9.5, z 26). */
  door: { plane: 26.2, spanMin: 8.45, spanMax: 10.55 },
} as const;

/** The currently registered creator-room layout + door, if any.
 *  Module state on purpose: the movement resolver, the scene and
 *  the page all read the same floor plan, and the plan's dynamic
 *  ring is exactly one room deep. */
let dynamicRoom: PalaceRoomLayout | null = null;
let dynamicDoor: PalaceDoor | null = null;

/** Lay the template under a creator's slug. Returns the layout.
 *  Re-registering (another creator, or the same) replaces the
 *  previous registration wholesale. */
export function registerCreatorRoomLayout(slug: string, displayName?: string): PalaceRoomLayout {
  const id = creatorRoomId(slug);
  const name = displayName?.trim() ? `${displayName.trim()}'s Room` : "Creator Room";
  dynamicRoom = {
    id,
    name,
    walk: { ...CREATOR_ROOM_TEMPLATE.walk },
    interior: { ...CREATOR_ROOM_TEMPLATE.interior },
    camClamp: { ...CREATOR_ROOM_TEMPLATE.camClamp },
    spawn: { ...CREATOR_ROOM_TEMPLATE.spawn },
  };
  dynamicDoor = {
    roomId: id,
    axis: "z",
    plane: CREATOR_ROOM_TEMPLATE.door.plane,
    spanMin: CREATOR_ROOM_TEMPLATE.door.spanMin,
    spanMax: CREATOR_ROOM_TEMPLATE.door.spanMax,
    portal: { minX: 8.4, maxX: 10.6, minZ: 25.55, maxZ: 26.9 },
    /* Membership by the plane rule roomAt applies (along < plane
     * → negRoom): the Courtyard lies NORTH of this wall (smaller
     * z), the creator room SOUTH of it. */
    negRoom: COURTYARD_ID,
    posRoom: id,
  };
  return dynamicRoom;
}

/** The registered creator room's layout, when the id is its. */
export function creatorRoomLayout(roomId: string): PalaceRoomLayout | null {
  return dynamicRoom && dynamicRoom.id === roomId ? dynamicRoom : null;
}

/** Any room's layout: the fixed eight from the plan, or the
 *  registered creator room. */
export function palaceRoomLayout(roomId: string): PalaceRoomLayout | undefined {
  return PALACE_LAYOUT[roomId] ?? creatorRoomLayout(roomId) ?? undefined;
}

function allRooms(): PalaceRoomLayout[] {
  const rooms = Object.values(PALACE_LAYOUT);
  return dynamicRoom ? [...rooms, dynamicRoom] : rooms;
}

function allDoors(): PalaceDoor[] {
  return dynamicDoor ? [...PALACE_DOORS, dynamicDoor] : PALACE_DOORS;
}

export function pointInRect(x: number, z: number, r: PalaceRect): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

/** Standing room: inside some room's walk rect (or its grounds),
 *  or in a doorway — and never inside a solid footprint. */
export function isWalkable(x: number, z: number): boolean {
  for (const room of allRooms()) {
    if (room.blocked?.some((b) => pointInRect(x, z, b))) return false;
    if (pointInRect(x, z, room.walk)) return true;
    if (room.grounds?.some((g) => pointInRect(x, z, g))) return true;
  }
  for (const door of allDoors()) {
    if (pointInRect(x, z, door.portal)) return true;
  }
  return false;
}

/**
 * Which room a position belongs to. Inside a portal, the wall plane
 * decides: which side of the wall you're on is the room you're in.
 * Outside every rect (inside a wall, say), the fallback stands —
 * geometry alone can't claim you there.
 */
export function roomAt(x: number, z: number, fallback: string): string {
  for (const door of allDoors()) {
    if (pointInRect(x, z, door.portal)) {
      const along = door.axis === "x" ? x : z;
      return along < door.plane ? door.negRoom : door.posRoom;
    }
  }
  for (const room of allRooms()) {
    if (room.blocked?.some((b) => pointInRect(x, z, b))) continue;
    if (pointInRect(x, z, room.walk)) return room.id;
    if (room.grounds?.some((g) => pointInRect(x, z, g))) return room.id;
  }
  return fallback;
}

/** Clamp a position into a room's walk rect. */
export function clampToRoom(roomId: string, x: number, z: number): { x: number; z: number } {
  const room = palaceRoomLayout(roomId) ?? PALACE_LAYOUT[HALL_ROOM_ID]!;
  return {
    x: Math.min(room.walk.maxX, Math.max(room.walk.minX, x)),
    z: Math.min(room.walk.maxZ, Math.max(room.walk.minZ, z)),
  };
}

export interface PalaceMoveResult {
  x: number;
  z: number;
  room: string;
  /** The room just entered, when this step crossed a doorway plane
   *  (or left the spawn room) — null for an ordinary step. */
  entered: string | null;
}

/** A segment may only pass through walkable ground — sampled finely
 *  enough that a 0.4 m wall can never be tunneled between samples. */
function segmentWalkable(x0: number, z0: number, x1: number, z1: number): boolean {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(dist / 0.12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}

/**
 * Resolve one movement step against the palace: try the full step,
 * then slide along each axis — the way a body slides along a wall
 * instead of sticking to it. Reports the room the step lands in and
 * whether that is a doorway crossing.
 */
export function resolvePalaceMove(
  from: { x: number; z: number; room: string },
  nextX: number,
  nextZ: number,
): PalaceMoveResult {
  const candidates: Array<{ x: number; z: number }> = [
    { x: nextX, z: nextZ },
    { x: nextX, z: from.z },
    { x: from.x, z: nextZ },
  ];
  for (const c of candidates) {
    if (c.x === from.x && c.z === from.z) continue;
    if (segmentWalkable(from.x, from.z, c.x, c.z)) {
      const room = roomAt(c.x, c.z, from.room);
      return { x: c.x, z: c.z, room, entered: room !== from.room ? room : null };
    }
  }
  return { x: from.x, z: from.z, room: from.room, entered: null };
}

/* ── Third-person camera collision (item 44) ──────────────────────
 * The follow camera's world spot is clamped to the room's
 * camClamp (the walls), but a clamp box knows nothing of props:
 * back toward the monument and the camera used to sink straight
 * into the stele. A camera point is FREE when it stands inside
 * the room's camClamp and clear of every room's CAMERA-TALL
 * footprints (inflated by CAMERA_PROP_MARGIN, so the near plane
 * never kisses a surface). Walls need no entry here: each room's
 * camClamp already keeps its camera on its own side of every
 * wall, and low furniture passes under the lens by design. */

/** How far the camera keeps off a prop's footprint (m). */
export const CAMERA_PROP_MARGIN = 0.3;

export function cameraPointFree(roomId: string, x: number, z: number): boolean {
  const room = palaceRoomLayout(roomId);
  if (!room) return false;
  if (!pointInRect(x, z, room.camClamp)) return false;
  for (const r of allRooms()) {
    for (const b of r.camBlocked ?? r.blocked ?? []) {
      if (
        x >= b.minX - CAMERA_PROP_MARGIN &&
        x <= b.maxX + CAMERA_PROP_MARGIN &&
        z >= b.minZ - CAMERA_PROP_MARGIN &&
        z <= b.maxZ + CAMERA_PROP_MARGIN
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Pull the camera in toward the figure until its spot is free:
 * walk the segment figure → desired in fine steps and keep the
 * last free point before the first obstruction. An unobstructed
 * desired spot comes back untouched; a fully boxed-in figure
 * keeps the camera at its own position rather than inside a prop.
 */
export function pullInCamera(
  roomId: string,
  from: { x: number; z: number },
  desired: { x: number; z: number },
): { x: number; z: number } {
  /* The whole segment is walked, never just the endpoint: a spot
   * BEYOND a prop can be perfectly free while the ray to it
   * passes straight through the prop's body. */
  const dist = Math.hypot(desired.x - from.x, desired.z - from.z);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  let last = { x: from.x, z: from.z };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = from.x + (desired.x - from.x) * t;
    const pz = from.z + (desired.z - from.z) * t;
    if (!cameraPointFree(roomId, px, pz)) break;
    last = { x: px, z: pz };
  }
  return last;
}
