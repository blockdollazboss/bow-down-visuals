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
    grounds: [{ minX: -27.85, maxX: 2.35, minZ: 25.6, maxZ: 33.6 }],
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
 *  or in a doorway. */
export function isWalkable(x: number, z: number): boolean {
  for (const room of allRooms()) {
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
