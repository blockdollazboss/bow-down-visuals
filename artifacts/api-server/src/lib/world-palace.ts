/**
 * world-palace.ts — The World is a palace, not one room.
 *
 * The registry: one WorldRoom instance per palace room, keyed by room
 * id, all sharing the site's one RoomHub (each room is its own hub
 * channel, so presence, chat, voice and the stage never leak across a
 * doorway). Since Open World Phase 1 the front door is THE KING'S
 * PLAZA — the palace grounds the courtyard always stood on, laid
 * out wide (see WORLD_PLAZA_ROOM_ID): admission lands on the
 * promenade facing the palace, and the King's Hall is one walk
 * through its open south doors. The hall keeps everything it
 * always had — its channel id, its bounds, and the palace's ONE
 * stage + big screen. The other rooms are shells for now:
 * walkable, named, present in the directory — their features
 * (jukebox, game tables, the Create desks) dock in later lanes.
 *
 * Doorways (the plan's Step 1 architecture):
 * - A peer belongs to exactly one room at a time. Walking through a
 *   doorway is a `room.enter` frame; the registry intercepts it (a
 *   room never sees it) and transfers the peer: detach from the old
 *   room (its room sees a normal despawn; the voice mesh ends, since
 *   the mesh is the room's) and attach to the new one carrying the
 *   peer's identity — same peerId, same character, same voice flags.
 * - Presence caps are per room (30 presence / 12 voice each), so the
 *   palace holds far more than the hall alone ever could. A full
 *   destination refuses honestly (`room.unavailable`) and the walker
 *   STAYS in the room they were in — never kicked out of the palace
 *   for knocking on a full door.
 * - Entry coordinates are the walker's own crossing point, clamped
 *   into the destination's bounds server-side.
 *
 * The directory is the palace's front-door signal: every room with
 * its headcount and who's inside, plus a LIVE flag on the hall when
 * a show holds the stage. One `palace.directory` frame follows every
 * welcome and every room change (the room's onChange broadcast —
 * a joiner is already inside when it fires, so entry carries
 * exactly one copy), and it's served over HTTP at
 * GET /world/directory for surfaces that haven't stepped in yet.
 *
 * The announce channel (Ring 3, THE-GAME §5(b)) is the registry's
 * second palace-wide signal: a `palace.announce` frame delivered to
 * every occupied room at once. Rooms emit their moments through
 * their onAnnounce hook (a drop landing, a show starting, a level
 * rising); the events/king schedulers speak through `announce()`
 * directly; and the host speaks in their own words through the
 * `announce.herald` intent, which — like room.enter — the registry
 * intercepts before the room ever sees it: the sender's host flag
 * is verified against the room's own peer record (resolved at the
 * door, never a client claim), the text is capped, and heralds are
 * rate-limited per host so the channel stays a herald, not a horn.
 */
import type { RoomHub, WsClientSocket } from "./live-ws";
import {
  WorldRoom,
  WORLD_PRESENCE_CAP,
  WORLD_ROOM_ID,
  type PalaceAnnouncement,
  type WorldDropClaimer,
  type WorldPresentMember,
  type WorldTutorialNotifier,
  worldIdentityKey,
  type WorldIdentity,
  type WorldRoomOptions,
} from "./world-room";
import type { WorldLockStore } from "./world-locks";

/** The King's Plaza — the palace's front door since Open World
 *  Phase 1. The room's id is the courtyard's own: the directory,
 *  the creator-room arch and the colonnade stations were already
 *  pointed at it when the grounds were laid around it. Admission
 *  (enterPalace) lands here, on the promenade facing the palace;
 *  the hall is one walk through the open doors. */
export const WORLD_PLAZA_ROOM_ID = "world:courtyard";

/** The host's herald: at most this many characters reach the
 *  palace — a herald is a headline, not a speech. */
export const HERALD_MAX_CHARS = 140;

/** One herald per host per this interval. The palace's ear is a
 *  shared resource; the channel's value is that it is rare. */
export const HERALD_MIN_INTERVAL_MS = 10_000;

/** How often the palace sweeps every room for frame-silent peers
 *  (see WorldRoom.sweepStalePeers / WORLD_PEER_STALE_MS). A ghost's
 *  total linger is the stale window plus at most one sweep tick. */
export const WORLD_PRESENCE_SWEEP_MS = 15_000;

export interface PalaceRoomDef extends WorldRoomOptions {
  roomId: string;
  name: string;
}

/**
 * The floor plan's first ring (plan Step 1). Bounds are the server
 * clamp box for each room — the client's walkable geometry
 * (lib/world/palace-layout.ts) is built to the same plan; the clamp
 * is deliberately a little generous at each doorway apron so a
 * crossing in flight never gets yanked back mid-step.
 *
 * The hall's def carries NO bounds/spawn/stage options on purpose:
 * WorldRoom's defaults ARE the hall exactly as it has always been.
 */
export const PALACE_ROOM_DEFS: PalaceRoomDef[] = [
  { roomId: WORLD_ROOM_ID, name: "The King's Hall" },
  {
    roomId: "world:music-hall",
    name: "Music Hall",
    bounds: { minX: -27.8, maxX: -13.0, minZ: -8.4, maxZ: 2.9 },
    spawn: { x: -16.5, z: -2 },
    /* The Music Hall's one piece of room programming: the jukebox
     * (queue + shared playback). No other room runs one. */
    jukeboxEnabled: true,
  },
  {
    roomId: "world:game-rooms",
    name: "Game Rooms",
    bounds: { minX: -27.8, maxX: -13.0, minZ: 3.6, maxZ: 11.4 },
    spawn: { x: -16.5, z: 5 },
  },
  {
    roomId: "world:create-wing",
    name: "Create Wing",
    bounds: { minX: 13.0, maxX: 27.8, minZ: -8.4, maxZ: 2.9 },
    spawn: { x: 16.5, z: -2 },
  },
  {
    /* Open World Phase 1: the courtyard is now THE KING'S PLAZA —
     * the palace's front door. The clamp box covers the widened
     * grounds (the client's floor plan is the same shape: main
     * ground x ±27.85, z 12.55..25.7, promenade to z 33.6); the
     * spawn is the promenade's head, facing the palace. */
    roomId: WORLD_PLAZA_ROOM_ID,
    name: "The King's Plaza",
    bounds: { minX: -27.9, maxX: 27.9, minZ: 11.1, maxZ: 33.8 },
    spawn: { x: 0, z: 31.5 },
  },
  /* The second ring (palace follow-on): the front rooms flank the
   * stage end of the hall; the Branding Atelier mirrors the Game
   * Rooms across the hall. Bounds + spawn mirror the client floor
   * plan (lib/world/palace-layout.ts) to the same plan. */
  {
    roomId: "world:treasury",
    name: "Treasury",
    bounds: { minX: -27.8, maxX: -13.0, minZ: -17.5, maxZ: -9.6 },
    spawn: { x: -16.5, z: -13.5 },
  },
  {
    roomId: "world:royal-court",
    name: "Royal Court Chamber",
    bounds: { minX: 13.0, maxX: 27.8, minZ: -17.5, maxZ: -9.6 },
    spawn: { x: 16.5, z: -13.5 },
  },
  {
    roomId: "world:branding-atelier",
    name: "Branding Atelier",
    bounds: { minX: 13.0, maxX: 27.8, minZ: 3.6, maxZ: 11.4 },
    spawn: { x: 16.5, z: 5 },
  },
  {
    /* Stage C item 31: THE STAGE GROUNDS — the first built
     * district, an outdoor stage quarter west of the plaza
     * through the west wall's gate (a true passage since this
     * batch). Bounds + spawn mirror the client floor plan
     * (lib/world/stage-grounds.ts via palace-layout.ts), a touch
     * generous at the gate apron like every room's. The district
     * is public look/listen space like the plaza: NO stage and
     * NO jukebox here — the palace's one stage stays in the hall
     * and its one jukebox in the Music Hall. */
    roomId: "world:stage-grounds",
    name: "Stage Grounds",
    bounds: { minX: -54.4, maxX: -27.8, minZ: 9.6, maxZ: 36.4 },
    spawn: { x: -30.2, z: 19.5 },
  },
];

/** One booked event on a room's slate (World Events, migration
 *  0145): the live one first, then what's next — "tonight at the
 *  palace", carried additively on the directory entry so the board
 *  and the entry screen can read the palace's schedule without a
 *  second channel. Written by the events scheduler (lib/world-
 *  events) via setDirectoryEvents; absent when nothing is booked. */
export interface PalaceDirectoryEvent {
  id: string;
  kind: string;
  title: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
}

export interface PalaceDirectoryEntry {
  id: string;
  name: string;
  count: number;
  /** Who's inside, by display name — the "your people are there"
   *  signal. Capped so a full room can't bloat every frame. */
  members: string[];
  /** A show holds the hall's stage (only the hall can be live). */
  live: boolean;
  /** The room's door is locked (Lane F): the people inside stay,
   *  nobody new joins — the only bypass is an admin account. The
   *  directory says so plainly so the lock is never a surprise
   *  discovered by walking into it. */
  locked: boolean;
  /** This room's booked slate (live + upcoming), when any. */
  events?: PalaceDirectoryEvent[];
  /** Creator rooms only: the room owner's profile slug — the
   *  directory row IS a creator's place, and surfaces that render
   *  it (the entry strip, the Kingdom Board) link it to the room's
   *  data by this slug. Absent on the eight palace rooms. */
  slug?: string;
}

/** One room in a presence snapshot (WorldPalace.presenceSnapshot):
 *  `count` is DISTINCT present people (see the snapshot's note),
 *  `members` their display names, capped like the directory's. */
export interface PalacePresenceRoom {
  id: string;
  name: string;
  count: number;
  members: string[];
}

/** The palace-wide presence snapshot: per-room distinct counts
 *  plus the palace total (itself deduplicated across rooms). */
export interface PalacePresenceSnapshot {
  total: number;
  rooms: PalacePresenceRoom[];
}

/* ── Creator Rooms (Ring 2, item 3.5) ───────────────────────────────
 * One room template, instantiated per creator: room id
 * `creator:<slug>` for any creator with a PUBLIC Grand Stage
 * profile. The instance is a plain WorldRoom on the template's
 * bounds/spawn (the client's floor plan carries the same numbers —
 * artifacts/bow-down-visuals/src/lib/world/palace-layout.ts,
 * CREATOR_ROOM_TEMPLATE) with NO stage and NO jukebox: those are
 * hall-locked / Music-Hall-locked authorities and a creator room
 * never pretends to either. Voice is per-room like everywhere —
 * a creator room is a room.
 *
 * Instances are created on demand, two ways:
 *  - `noteCreatorRoom` (sync): the world-shaped HTTP reads
 *    (GET /api/world/creator-rooms/:slug) call it once the profile
 *    record has proven public, so a walker who read the room's data
 *    can always transfer in.
 *  - the injected `resolveCreatorRoom` (async): a `room.enter` for
 *    a `creator:<slug>` nobody has materialized yet resolves the
 *    slug against the profile record first, then transfers — a
 *    private or unknown slug resolves null and the walker simply
 *    stays where they stand (the transfer never happens). */
export const CREATOR_ROOM_PREFIX = "creator:";
export const CREATOR_ROOM_BOUNDS = { minX: 2.4, maxX: 16.6, minZ: 26.2, maxZ: 38.2 };
export const CREATOR_ROOM_SPAWN = { x: 9.5, z: 28.6 };

export function creatorRoomIdForSlug(slug: string): string {
  return `${CREATOR_ROOM_PREFIX}${slug}`;
}

export function creatorSlugFromRoomId(roomId: string): string | null {
  if (!roomId.startsWith(CREATOR_ROOM_PREFIX)) return null;
  const slug = roomId.slice(CREATOR_ROOM_PREFIX.length);
  return slug.length > 0 ? slug : null;
}

/** The room's display name: the creator's place, named for them. */
export function creatorRoomName(displayName: string): string {
  const name = displayName.trim() || "Creator";
  return `${name}'s Room`;
}

export interface CreatorRoomResolution {
  displayName: string;
}

const DIRECTORY_MEMBER_NAMES = 12;

/** One present member, and the room they're standing in — the
 *  operator's name resolution result (WorldPalace.findPresentMember). */
export interface PalacePresentMatch {
  room: WorldRoom;
  member: WorldPresentMember;
}

export class WorldPalace {
  private rooms = new Map<string, WorldRoom>();
  /** Creator room instances by slug (the dynamic ring — see the
   *  Creator Rooms note above). The same instances live in
   *  `rooms` under their `creator:<slug>` ids; this index is how
   *  the directory names them. */
  private creatorRooms = new Map<string, { room: WorldRoom; displayName: string }>();
  /** Slugs with a creator-room resolution already in flight — a
   *  burst of room.enter frames for one unmaterialized room
   *  resolves the profile once, not once per frame. */
  private creatorResolutions = new Set<string>();
  /** The hall — the palace's one stage. */
  readonly hallRoom: WorldRoom;
  /** The King's Plaza — the palace's front door (Open World
   *  Phase 1): admission lands here, facing the palace. */
  readonly plazaRoom: WorldRoom;
  private sweeper: NodeJS.Timeout | null = null;

  /** The drop-claim rail, kept from the constructor deps: creator
   *  rooms are built later, on demand, and a drop spectacle can
   *  land in any room — the creator rooms carry the claimer like
   *  every other room, and nothing else. */
  private dropClaimer: WorldDropClaimer | undefined;

  /** The tutorial notifier, kept the same way: creator rooms are
   *  built later and carry it too (the verbs themselves are
   *  room-gated — a creator room can only ever witness applause
   *  with no stage, i.e. none; the rail stays uniform). */
  private tutorialNotifier: WorldTutorialNotifier | undefined;

  /** The World's lock store (Lane F, migration 0179), when the
   *  route layer wired one: every room in this palace consults it
   *  at its door, and the Cloud Operator's Tier-4 lock commands
   *  write through it. Null in a palace built without one (unit
   *  surfaces, embeds) — no locks exist there. */
  readonly lockStore: WorldLockStore | null;

  constructor(
    private hub: RoomHub,
    deps: ConstructorParameters<typeof WorldRoom>[1] = {},
    private palaceDeps: {
      /** Resolve a creator slug to a room host, or null when the
       *  slug has no PUBLIC Grand Stage profile (unknown and
       *  private are the same answer — the room does not exist). */
      resolveCreatorRoom?: (slug: string) => Promise<CreatorRoomResolution | null>;
      /** The lock store (Lane F): threaded into every room as its
       *  door checker, creator rooms included. */
      lockStore?: WorldLockStore;
    } = {},
  ) {
    this.lockStore = palaceDeps.lockStore ?? null;
    const locks = this.lockStore ?? undefined;
    for (const def of PALACE_ROOM_DEFS) {
      const { roomId, name, ...opts } = def;
      // Only the hall gets the stage resolvers: it is the palace's
      // one stage, and no other room may ever verify a claim. Only
      // the Music Hall gets the jukebox resolver — the same rule,
      // one authority per piece of room programming. The drop-claim
      // rail is the exception: a drop spectacle can land in ANY
      // room, so every room carries the (injected, route-owned)
      // claimer; the room itself decides who may claim. The
      // witnessed-moment rails (THE-GAME §5(a)) are palace-wide for
      // the same reason: a quest completes in the room where it
      // happened, so every room carries the stars resolver + the
      // quest-claim finder and verifies moments for its own floor.
      const roomDeps =
        def.roomId === WORLD_ROOM_ID
          ? { ...deps, locks }
          : def.roomId === "world:music-hall"
            ? {
                resolveJukeboxTrack: deps.resolveJukeboxTrack,
                claimWorldDrop: deps.claimWorldDrop,
                /* The Music Hall holds the palace's second stage —
                 * its performers take seat tips like the hall's. */
                tipStagePerformer: deps.tipStagePerformer,
                noteTutorialAction: deps.noteTutorialAction,
                resolveStars: deps.resolveStars,
                findRecentQuestClaim: deps.findRecentQuestClaim,
                locks,
              }
            : {
                claimWorldDrop: deps.claimWorldDrop,
                noteTutorialAction: deps.noteTutorialAction,
                resolveStars: deps.resolveStars,
                findRecentQuestClaim: deps.findRecentQuestClaim,
                locks,
              };
      const room = new WorldRoom(hub, roomDeps, { roomId, name, ...opts });
      room.onChange = () => this.broadcastDirectory();
      room.onAnnounce = (announce) => this.announce(announce);
      this.rooms.set(roomId, room);
    }
    this.hallRoom = this.rooms.get(WORLD_ROOM_ID)!;
    this.plazaRoom = this.rooms.get(WORLD_PLAZA_ROOM_ID)!;
    /* The jukebox authority fix (stack-100 item 47): the palace's
     * one jukebox stands in the Music Hall, but a song is published
     * at the Song Desk in the Create Wing — every other room hands
     * its jukebox.add frames to the Music Hall room, which runs
     * them through the same authority as a local add. */
    const jukeboxRoom = this.rooms.get("world:music-hall");
    if (jukeboxRoom) {
      for (const room of this.rooms.values()) {
        if (room !== jukeboxRoom) {
          room.onJukeboxForward = (add, now) => jukeboxRoom.acceptForwardedJukeboxAdd(add, now);
        }
      }
    }
    this.dropClaimer = deps.claimWorldDrop;
    this.tutorialNotifier = deps.noteTutorialAction;
  }

  /**
   * Materialize (or fetch) the creator room for a slug whose
   * public profile the caller has already verified. Idempotent —
   * the first display name wins until the room exists; a room is
   * never renamed out from under the people standing in it.
   */
  noteCreatorRoom(slug: string, displayName: string): WorldRoom {
    const existing = this.creatorRooms.get(slug);
    if (existing) return existing.room;
    const roomId = creatorRoomIdForSlug(slug);
    const room = new WorldRoom(
      this.hub,
      {
        claimWorldDrop: this.dropClaimer,
        noteTutorialAction: this.tutorialNotifier,
        locks: this.lockStore ?? undefined,
      },
      {
        roomId,
        name: creatorRoomName(displayName),
        bounds: { ...CREATOR_ROOM_BOUNDS },
        spawn: { ...CREATOR_ROOM_SPAWN },
      },
    );
    room.onChange = () => this.broadcastDirectory();
    room.onAnnounce = (announce) => this.announce(announce);
    /* Creator rooms forward their jukebox asks too (item 47) —
     * the Portrait Card's Play seam fires jukebox.add from the
     * host's room, and the palace jukebox is the only box there is. */
    const jukeboxRoom = this.rooms.get("world:music-hall");
    if (jukeboxRoom) {
      room.onJukeboxForward = (add, now) => jukeboxRoom.acceptForwardedJukeboxAdd(add, now);
    }
    this.rooms.set(roomId, room);
    this.creatorRooms.set(slug, { room, displayName });
    return room;
  }

  /** The creator room instance for a slug, when one is
   *  materialized — the HTTP reads report its occupant count. */
  creatorRoom(slug: string): WorldRoom | undefined {
    return this.creatorRooms.get(slug)?.room;
  }

  room(roomId: string): WorldRoom | undefined {
    return this.rooms.get(roomId);
  }

  /** The room a socket currently stands in, if any. */
  roomOf(socket: WsClientSocket): WorldRoom | null {
    for (const room of this.rooms.values()) {
      if (room.peerFor(socket)) return room;
    }
    return null;
  }

  /** Admission: everyone enters through the front door — since
   *  Open World Phase 1 that is the King's Plaza, arriving on the
   *  promenade facing the palace (the hall is a walk through its
   *  open doors). A rejoining identity first replaces its own
   *  ghost — wherever in the palace the corpse is standing — so a
   *  reload or a reconnect never stacks a second presence beside
   *  the first, and the freed slot is back before the plaza's cap
   *  check runs. Person locks keep binding the room they name: a
   *  plaza lock refuses admission itself; a lock on any other
   *  room binds at that room's door, exactly as it always did. */
  enterPalace(socket: WsClientSocket, identity: WorldIdentity): boolean {
    const key = worldIdentityKey(identity);
    if (key) {
      for (const room of this.rooms.values()) room.evictIdentity(key, socket);
    }
    return this.plazaRoom.attach(socket, identity);
  }

  /** The admission verb's original name, kept for the many test
   *  harnesses written against it — the front door moved to the
   *  plaza in Open World Phase 1; new code calls enterPalace. */
  enterHall(socket: WsClientSocket, identity: WorldIdentity): boolean {
    return this.enterPalace(socket, identity);
  }

  /** Start the presence sweeper (production wiring does this at
   *  registration; tests drive sweepStalePeers directly against
   *  their injected clocks instead). Unref'd — it must never be
   *  the thing keeping a process alive. */
  startPresenceSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweepStalePeers(), WORLD_PRESENCE_SWEEP_MS);
    this.sweeper.unref?.();
  }

  /** Stop the sweeper (tests / shutdown). */
  dispose(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** One sweep of every room: reap each room's frame-silent
   *  peers. Returns the palace-wide reap count. */
  sweepStalePeers(now = Date.now()): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.sweepStalePeers(now);
    return n;
  }

  /** Disconnect/error: despawn from whichever room holds the socket. */
  detach(socket: WsClientSocket): void {
    for (const room of this.rooms.values()) room.detach(socket);
  }

  /** Everyone in the palace, all rooms together. */
  totalPopulation(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.size();
    return n;
  }

  /** The events slate per room, owned by the events scheduler
   *  (lib/world-events): roomId → live + upcoming booked events.
   *  Directory-only data — the rooms themselves never read it. */
  private directoryEvents = new Map<string, PalaceDirectoryEvent[]>();

  /** Replace the directory slate and rebroadcast the directory so
   *  everyone inside sees the fresh "tonight at the palace". */
  setDirectoryEvents(byRoom: Map<string, PalaceDirectoryEvent[]>): void {
    this.directoryEvents = byRoom;
    this.broadcastDirectory();
  }

  directory(): PalaceDirectoryEntry[] {
    const entries: PalaceDirectoryEntry[] = PALACE_ROOM_DEFS.map((def) => {
      const room = this.rooms.get(def.roomId)!;
      const events = this.directoryEvents.get(def.roomId);
      return {
        id: def.roomId,
        name: def.name,
        count: room.size(),
        members: room.memberNames().slice(0, DIRECTORY_MEMBER_NAMES),
        live: room.stageHeld(),
        locked: this.lockStore?.isDoorLocked(def.roomId) ?? false,
        ...(events && events.length > 0 ? { events } : {}),
      };
    });
    /* Creator rooms join the directory when someone is home —
     * an empty instance is a place that exists (its data answers
     * at GET /api/world/creator-rooms), not a crowd signal, and
     * the strip would drown in every public creator's name. The
     * moment a walker stands in one, it lists like any room. */
    for (const [slug, entry] of this.creatorRooms) {
      if (entry.room.size() === 0) continue;
      entries.push({
        id: entry.room.roomId,
        name: entry.room.roomName,
        count: entry.room.size(),
        members: entry.room.memberNames().slice(0, DIRECTORY_MEMBER_NAMES),
        live: false,
        locked: this.lockStore?.isDoorLocked(entry.room.roomId) ?? false,
        slug,
      });
    }
    return entries;
  }

  /** A truthful headcount snapshot for read-only callers (the
   *  Cloud Operator's "who's in the palace" tool): the same room
   *  set the directory lists — the eight palace rooms always,
   *  creator rooms only while someone is home — but counted the
   *  honest way: only peers the staleness sweep would NOT reap
   *  (WorldRoom.presentPeers), deduplicated by presence key, so a
   *  ghost awaiting burial and a member's second socket never
   *  inflate the count. A connection with no identity key (a raw
   *  probe) counts once, as itself — it is a live connection in
   *  the room, just not a provable person. */
  presenceSnapshot(now = Date.now()): PalacePresenceSnapshot {
    const rooms: PalacePresenceRoom[] = [];
    const seenGlobally = new Set<string>();
    let anonymousGlobal = 0;
    const tally = (roomId: string, name: string, room: WorldRoom) => {
      const present = room.presentPeers(now);
      if (present.length === 0 && !PALACE_ROOM_DEFS.some((d) => d.roomId === roomId)) return;
      const seen = new Set<string>();
      const members: string[] = [];
      let anonymous = 0;
      for (const p of present) {
        if (p.identityKey) {
          if (seen.has(p.identityKey)) continue;
          seen.add(p.identityKey);
          if (!seenGlobally.has(p.identityKey)) {
            seenGlobally.add(p.identityKey);
          }
        } else {
          anonymous += 1;
          anonymousGlobal += 1;
        }
        if (members.length < DIRECTORY_MEMBER_NAMES) members.push(p.displayName);
      }
      rooms.push({ id: roomId, name, count: seen.size + anonymous, members });
    };
    for (const def of PALACE_ROOM_DEFS) {
      tally(def.roomId, def.name, this.rooms.get(def.roomId)!);
    }
    for (const [, entry] of this.creatorRooms) {
      tally(entry.room.roomId, entry.room.roomName, entry.room);
    }
    return { total: seenGlobally.size + anonymousGlobal, rooms };
  }

  private broadcastDirectory(): void {
    const payload = { type: "palace.directory", rooms: this.directory() };
    for (const room of this.rooms.values()) {
      if (room.size() > 0) this.hub.broadcast(room.roomId, payload);
    }
  }

  /** Republish the directory now (Lane F): a door lock changes what
   *  the directory SAYS without changing who's inside, so no room
   *  onChange fires for it — the lock commands call this so the
   *  Locked mark reaches everyone inside the moment it lands. */
  refreshDirectory(): void {
    this.broadcastDirectory();
  }

  /* ── Resolving people (the operator's eyes) ───────────────────── */

  /** Every present member of the palace whose display name matches
   *  (case-insensitive, exact) — or, when no name matches, whose
   *  profile slug does. A person stands in exactly one room, so
   *  more than one match means more than one PERSON carries the
   *  name: the caller (the operator's Tier-4 commands) refuses and
   *  asks, never guesses. Ghosts past the staleness window are not
   *  present (WorldRoom.presentMembers applies the rule). */
  findPresentMember(name: string): PalacePresentMatch[] {
    const needle = name.trim().toLowerCase();
    if (!needle) return [];
    const byName: PalacePresentMatch[] = [];
    for (const room of this.rooms.values()) {
      for (const member of room.presentMembers()) {
        if (member.displayName.trim().toLowerCase() === needle) {
          byName.push({ room, member });
        }
      }
    }
    if (byName.length > 0) return byName;
    const bySlug: PalacePresentMatch[] = [];
    for (const room of this.rooms.values()) {
      for (const member of room.presentMembers()) {
        if (member.profileSlug && member.profileSlug.toLowerCase() === needle) {
          bySlug.push({ room, member });
        }
      }
    }
    return bySlug;
  }

  /* ── The announce channel ─────────────────────────────────────── */

  /** The last herald time per host peerId (rate limit state). */
  private heraldLastAt = new Map<string, number>();

  /**
   * Speak to the whole palace at once: one `palace.announce` frame
   * delivered to every occupied room's channel. Rooms reach this
   * through their onAnnounce hook; the house schedulers (events,
   * the King's daily moment) call it directly. The announcement is
   * stamped here (`at`, server clock) so every room hears the same
   * moment with the same time on it.
   */
  announce(announcement: PalaceAnnouncement): void {
    const payload = {
      type: "palace.announce",
      announce: { ...announcement, at: Date.now() },
    };
    for (const room of this.rooms.values()) {
      if (room.size() > 0) this.hub.broadcast(room.roomId, payload);
    }
  }

  private sendFrame(socket: WsClientSocket, payload: unknown): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      /* the close handler reaps it */
    }
  }

  /**
   * The host's herald intent (`announce.herald`): the one palace
   * announcement whose text is a person's own words — so it is
   * verified like every host power. The sender must BE the host
   * (their room's peer record carries the door-resolved admin flag;
   * a guest is never an admin), the text must be a non-empty
   * headline within the cap, and the host's last herald must be at
   * least HERALD_MIN_INTERVAL_MS ago. Any failure answers the
   * sender alone with `announce.denied` — the palace never speaks,
   * and nobody else hears that it refused.
   */
  private handleHerald(socket: WsClientSocket, rawText: unknown, now: number): void {
    const room = this.roomOf(socket);
    const me = room?.peerFor(socket) ?? null;
    if (!room || !me || !me.admin) {
      this.sendFrame(socket, { type: "announce.denied" });
      return;
    }
    const text = typeof rawText === "string" ? rawText.trim().slice(0, HERALD_MAX_CHARS) : "";
    if (!text) {
      this.sendFrame(socket, { type: "announce.denied" });
      return;
    }
    const last = this.heraldLastAt.get(me.peerId) ?? 0;
    if (now - last < HERALD_MIN_INTERVAL_MS) {
      this.sendFrame(socket, { type: "announce.denied" });
      return;
    }
    this.heraldLastAt.set(me.peerId, now);
    /* The rate map is keyed by session peerIds; prune dead marks
     * opportunistically so a long-lived process doesn't accrue
     * one entry per host session forever. */
    if (this.heraldLastAt.size > 64) {
      for (const [peerId, at] of this.heraldLastAt) {
        if (now - at > HERALD_MIN_INTERVAL_MS) this.heraldLastAt.delete(peerId);
      }
    }
    this.announce({
      kind: "herald",
      text,
      name: me.displayName,
      roomId: room.roomId,
      roomName: room.roomName,
    });
  }

  /**
   * The herald on an admin's spoken/typed command (Lane F, Tier 4):
   * the admin is at the chat, not standing in the palace, so there
   * is no peer record to verify — the authority was the executor's
   * ADMIN_EMAILS gate on their session, checked before this is
   * ever called. Everything else is the socket herald's own
   * discipline: the same character cap, and the same rate limit,
   * keyed by the command's limit key (the admin's account id) so
   * the channel stays a herald, not a horn — whoever speaks it.
   * The speaker named is Thy Cheat Code: he is the one speaking,
   * on the King's command.
   */
  heraldAsAdmin(input: {
    text: string;
    limitKey: string;
    now?: number;
  }): { ok: true } | { ok: false; reason: "empty" | "rate_limited"; retryAfterMs?: number } {
    const now = input.now ?? Date.now();
    const text = typeof input.text === "string" ? input.text.trim().slice(0, HERALD_MAX_CHARS) : "";
    if (!text) return { ok: false, reason: "empty" };
    const last = this.heraldLastAt.get(input.limitKey) ?? 0;
    if (now - last < HERALD_MIN_INTERVAL_MS) {
      return { ok: false, reason: "rate_limited", retryAfterMs: HERALD_MIN_INTERVAL_MS - (now - last) };
    }
    this.heraldLastAt.set(input.limitKey, now);
    this.announce({
      kind: "herald",
      text,
      name: "Thy Cheat Code",
      roomId: this.hallRoom.roomId,
      roomName: this.hallRoom.roomName,
    });
    return { ok: true };
  }

  /**
   * Route one frame. `room.enter` is the registry's own; everything
   * else belongs to the room the socket stands in. A room.enter for
   * the room you're already in (or an unknown room) is a no-op.
   */
  handleFrame(socket: WsClientSocket, raw: string, now = Date.now()): void {
    let type: string | null = null;
    let roomId: unknown = null;
    let x: unknown = null;
    let z: unknown = null;
    let rotY: unknown = null;
    let heraldText: unknown = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const frame = parsed as Record<string, unknown>;
        type = typeof frame["type"] === "string" ? frame["type"] : null;
        if (type === "room.enter") {
          roomId = frame["roomId"];
          x = frame["x"];
          z = frame["z"];
          rotY = frame["rotY"];
        }
        if (type === "announce.herald") {
          heraldText = frame["text"];
        }
      }
    } catch {
      /* not JSON — the room's own parser will ignore it too */
    }
    if (type === "announce.herald") {
      /* The registry's own frame, like room.enter: the palace
       * verifies and speaks; the room never sees it. Any other
       * frame for a socket standing nowhere falls through to the
       * room lookup below and dies quietly, as before. */
      this.handleHerald(socket, heraldText, now);
      return;
    }
    if (type === "room.enter") {
      /* A creator room nobody has materialized yet: resolve the
       * slug against the profile record first (async), then run
       * the ordinary transfer. Unknown/private resolves null and
       * nothing moves — the walker keeps their place, and no frame
       * ever confirms whether the slug exists at all. */
      const slug = typeof roomId === "string" ? creatorSlugFromRoomId(roomId) : null;
      if (slug && !this.creatorRooms.has(slug) && this.palaceDeps.resolveCreatorRoom) {
        this.resolveThenTransfer(socket, slug, x, z, rotY);
        return;
      }
      this.transfer(socket, roomId, x, z, rotY);
      return;
    }
    this.roomOf(socket)?.handleFrame(socket, raw, now);
  }

  private resolveThenTransfer(
    socket: WsClientSocket,
    slug: string,
    xRaw: unknown,
    zRaw: unknown,
    rotYRaw: unknown,
  ): void {
    if (this.creatorResolutions.has(slug)) return;
    this.creatorResolutions.add(slug);
    const resolve = this.palaceDeps.resolveCreatorRoom!;
    void resolve(slug)
      .then((resolution) => {
        this.creatorResolutions.delete(slug);
        if (!resolution) return;
        this.noteCreatorRoom(slug, resolution.displayName);
        /* The walker may have left (or walked elsewhere) while
         * the profile read ran — transfer() re-finds their room
         * and no-ops when they're gone, so this stays honest. */
        this.transfer(socket, creatorRoomIdForSlug(slug), xRaw, zRaw, rotYRaw);
      })
      .catch(() => {
        this.creatorResolutions.delete(slug);
      });
  }

  private transfer(socket: WsClientSocket, roomIdRaw: unknown, xRaw: unknown, zRaw: unknown, rotYRaw: unknown): void {
    const from = this.roomOf(socket);
    if (!from) return;
    if (typeof roomIdRaw !== "string") return;
    const target = this.rooms.get(roomIdRaw);
    if (!target || target === from) return;
    const state = from.peekTransferState(socket);
    if (!state) return;
    if (target.size() >= WORLD_PRESENCE_CAP) {
      /* Honest refusal, and the walker stays where they stand —
       * a full room never costs anyone their place in the palace. */
      try {
        socket.send(
          JSON.stringify({
            type: "room.unavailable",
            roomId: target.roomId,
            name: target.roomName,
            cap: WORLD_PRESENCE_CAP,
          }),
        );
      } catch {
        /* the close handler reaps it */
      }
      return;
    }
    /* The locks stand at this door too (Lane F) — checked HERE,
     * before the detach, for the same reason the cap is: a refused
     * walker keeps their place in the palace. They hear the lock's
     * own frame (room.locked, no close — they are still inside,
     * just not through THIS door), and the room's attach gate
     * remains the enforcement of last resort at the hall door. */
    const block = target.admissionBlock(state.identity);
    if (block) {
      try {
        socket.send(
          JSON.stringify({
            type: "room.locked",
            kind: block.kind,
            roomId: target.roomId,
            name: target.roomName,
            ...(block.kind === "person"
              ? { until: new Date(block.until).toISOString() }
              : {}),
          }),
        );
      } catch {
        /* the close handler reaps it */
      }
      return;
    }
    /* Detach first (the old room despawns the peer and ends their
     * voice session there), then attach carrying the identity. With
     * no crossing point supplied, `at` stays undefined and attach
     * falls back to the destination's own spawn. */
    const hasPoint =
      typeof xRaw === "number" && Number.isFinite(xRaw) && typeof zRaw === "number" && Number.isFinite(zRaw);
    const at = hasPoint
      ? {
          x: xRaw as number,
          z: zRaw as number,
          rotY: typeof rotYRaw === "number" && Number.isFinite(rotYRaw) ? rotYRaw : undefined,
        }
      : undefined;
    from.detach(socket);
    target.attach(socket, state.identity, {
      peerId: state.peerId,
      character: state.character,
      voiceOff: state.voiceOff,
      voiceDeaf: state.voiceDeaf,
      announcedStars: state.announcedStars,
      at,
    });
    /* No explicit directory send to the walker: attach's onChange
     * broadcast IS their copy — the welcome went out first, then
     * the room change carries the fresh directory to everyone in
     * the room, the walker included. Exactly one frame. */
  }
}
