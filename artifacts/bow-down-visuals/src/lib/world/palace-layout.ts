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
 *  The two gate gaps (Stage Grounds west, Boardwalk south) are
 *  real gaps in the runs — each is closed by its gate's gold bar,
 *  and the walk rects end inside them, so nothing leaks. */
export const PLAZA_WALL_RUNS: PlazaWallRun[] = [
  /* West wall x −28.2, split by the Stage Grounds gate gap
   * (z 18.4..20.6). */
  { w: 0.35, d: 6.0, x: -28.2, z: 15.4 },
  { w: 0.35, d: 13.4, x: -28.2, z: 27.3 },
  /* East wall x 28.2: the main run, then the continuation south
   * past the creator wing (item 42 — the run used to stop at
   * z 26 and leave the south-east grounds open to the void). */
  { w: 0.35, d: 13.6, x: 28.2, z: 19.2 },
  { w: 0.35, d: 8.0, x: 28.2, z: 30.0 },
  /* South wall z 34.0 across the promenade, split by the
   * Boardwalk gate gap (x −1.1..1.1). */
  { w: 27.1, d: 0.35, x: -14.65, z: 34.0 },
  { w: 1.25, d: 0.35, x: 1.725, z: 34.0 },
  /* The south-east yard's south run: from the Creator Room's east
   * wall to the east wall, closing the yard the SE floor patch
   * stands in (item 42). West of x 16.6 the Creator Room's own
   * walls close the line — its interior runs on to z 38. */
  { w: 11.6, d: 0.35, x: 22.4, z: 34.0 },
  /* The notch wall (item 42): along the main grounds' south edge
   * east of the Creator Room (whose north wall closes the same
   * line west of x 16.6). Without it a walker on the east lawns
   * met an invisible wall at z 25.7 with open floor beyond. */
  { w: 11.8, d: 0.35, x: 22.3, z: 26.05 },
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
  /** "x": the gate spans X (posts east/west of centre); "z": spans Z. */
  axis: "x" | "z";
  plateRotY: number;
  /** The gold bar's offset from centre (wall gates' bars ride the
   *  wall's plaza face). */
  barDx: number;
  barDz: number;
}

/** The six district gates. Posts stand ±1.1 m from centre (0.32 m
 *  square, gold cap), a gold header over, a gold bar at 0.55 m.
 *  Five stand in or on the perimeter walls — outside the walkable
 *  bounds, closed by their bars; CREATOR HEIGHTS freestands on
 *  the plaza floor, and its footprint below is a real solid. */
export const PLAZA_GATES: PlazaGate[] = [
  { name: "STAGE GROUNDS", x: -28.2, z: 19.5, axis: "z", plateRotY: Math.PI / 2, barDx: 0.22, barDz: 0 },
  { name: "THE BOARDWALK", x: 0, z: 34.0, axis: "x", plateRotY: Math.PI, barDx: 0, barDz: 0 },
  { name: "LISTENING GARDENS", x: -26, z: 33.8, axis: "x", plateRotY: Math.PI, barDx: 0, barDz: 0 },
  { name: "CREATION ROW", x: 28.2, z: 14.5, axis: "z", plateRotY: -Math.PI / 2, barDx: -0.22, barDz: 0 },
  { name: "THE ATELIERS", x: 28.2, z: 22.5, axis: "z", plateRotY: -Math.PI / 2, barDx: -0.22, barDz: 0 },
  { name: "CREATOR HEIGHTS", x: 13.5, z: 24.6, axis: "x", plateRotY: Math.PI, barDx: 0, barDz: 0 },
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

const gateRect = (gate: PlazaGate): PalaceRect =>
  gate.axis === "x" ? rectAround(gate.x, gate.z, 1.26, 0.16) : rectAround(gate.x, gate.z, 0.16, 1.26);

/** The plaza's solid footprints (item 39), derived from the
 *  dressing plan above: the monument's plinth, every wall run,
 *  every column pier, planter, brazier and gate, and the arch's
 *  pillars. A step into any of them resolves like a wall — slide
 *  or stop — never a walk through a visible body. */
export const PLAZA_BLOCKED: PalaceRect[] = [
  /* The Kingdom Board monument's plinth (3.55 m trim square at
   * (0, 19.7)) — banked in overhaul stage 3, kept exact. */
  { minX: -1.85, maxX: 1.85, minZ: 17.85, maxZ: 21.55 },
  ...PLAZA_WALL_RUNS.map(wallRunRect),
  ...PLAZA_COLUMNS.map((c) => rectAround(c.x, c.z, 0.45, 0.45)),
  ...PLAZA_PLANTERS.map((p) => rectAround(p.x, p.z, p.alongZ ? 0.44 : 1.0, p.alongZ ? 1.0 : 0.44)),
  ...PLAZA_BRAZIERS.map((b) => rectAround(b.x, b.z, 0.46, 0.46)),
  ...PLAZA_GATES.map(gateRect),
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
      /* The arch spur (item 41): the promenade's eastward arm
       * along the Creator Room's north wall face, from the
       * promenade's edge to the arch portal (x 8.4..) — a walker
       * can now stroll the promenade and turn east to the arch
       * without crossing open floor. The spur's z band stops at
       * the wall face (26.05); the arch's flanking return walls
       * stand in it as blocked rects (PLAZA_WALL_RUNS). */
      { minX: 2.35, maxX: 8.45, minZ: 25.6, maxZ: 26.05 },
    ],
    /* Solid footprints, derived from the dressing plan above
     * (PLAZA_BLOCKED): the monument's plinth — its board station
     * point stands on the open plaza just south of it at
     * (0, 22.6), in reading distance of the engraved face and
     * inside prompt radius of a walker stopped at the plinth's
     * edge — plus every planter, column pier, brazier, gate and
     * wall run on the plaza (item 39). */
    blocked: PLAZA_BLOCKED,
    interior: { minX: -28.2, maxX: 28.2, minZ: 12.4, maxZ: 34.0 },
    camClamp: { minX: -28.0, maxX: 28.0, minZ: 12.6, maxZ: 33.9 },
    spawn: { x: 0, z: 31.5 },
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
 * the room's camClamp and clear of every room's solid footprints
 * (inflated by CAMERA_PROP_MARGIN, so the near plane never kisses
 * a surface). Walls need no entry here: each room's camClamp
 * already keeps its camera on its own side of every wall. */

/** How far the camera keeps off a prop's footprint (m). */
export const CAMERA_PROP_MARGIN = 0.3;

export function cameraPointFree(roomId: string, x: number, z: number): boolean {
  const room = palaceRoomLayout(roomId);
  if (!room) return false;
  if (!pointInRect(x, z, room.camClamp)) return false;
  for (const r of allRooms()) {
    for (const b of r.blocked ?? []) {
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
  if (cameraPointFree(roomId, desired.x, desired.z)) return { x: desired.x, z: desired.z };
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
