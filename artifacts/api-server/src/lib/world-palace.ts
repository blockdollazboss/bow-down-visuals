/**
 * world-palace.ts — The World is a palace, not one room.
 *
 * The registry: one WorldRoom instance per palace room, keyed by room
 * id, all sharing the site's one RoomHub (each room is its own hub
 * channel, so presence, chat, voice and the stage never leak across a
 * doorway). The King's Hall is the front door and keeps everything it
 * always had — its channel id, its bounds, its spawn arc, and the
 * palace's ONE stage + big screen. The other rooms are shells for
 * now: walkable, named, present in the directory — their features
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
 */
import type { RoomHub, WsClientSocket } from "./live-ws";
import {
  WorldRoom,
  WORLD_PRESENCE_CAP,
  WORLD_ROOM_ID,
  type WorldDropClaimer,
  type WorldIdentity,
  type WorldRoomOptions,
} from "./world-room";

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
    roomId: "world:courtyard",
    name: "Courtyard",
    bounds: { minX: -13.5, maxX: 13.5, minZ: 11.1, maxZ: 25.6 },
    spawn: { x: 0, z: 14.5 },
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
  /** This room's booked slate (live + upcoming), when any. */
  events?: PalaceDirectoryEvent[];
  /** Creator rooms only: the room owner's profile slug — the
   *  directory row IS a creator's place, and surfaces that render
   *  it (the entry strip, the Kingdom Board) link it to the room's
   *  data by this slug. Absent on the eight palace rooms. */
  slug?: string;
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
  /** The hall — the palace's front door and its one stage. */
  readonly hallRoom: WorldRoom;

  /** The drop-claim rail, kept from the constructor deps: creator
   *  rooms are built later, on demand, and a drop spectacle can
   *  land in any room — the creator rooms carry the claimer like
   *  every other room, and nothing else. */
  private dropClaimer: WorldDropClaimer | undefined;

  constructor(
    private hub: RoomHub,
    deps: ConstructorParameters<typeof WorldRoom>[1] = {},
    private palaceDeps: {
      /** Resolve a creator slug to a room host, or null when the
       *  slug has no PUBLIC Grand Stage profile (unknown and
       *  private are the same answer — the room does not exist). */
      resolveCreatorRoom?: (slug: string) => Promise<CreatorRoomResolution | null>;
    } = {},
  ) {
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
          ? deps
          : def.roomId === "world:music-hall"
            ? {
                resolveJukeboxTrack: deps.resolveJukeboxTrack,
                claimWorldDrop: deps.claimWorldDrop,
                resolveStars: deps.resolveStars,
                findRecentQuestClaim: deps.findRecentQuestClaim,
              }
            : {
                claimWorldDrop: deps.claimWorldDrop,
                resolveStars: deps.resolveStars,
                findRecentQuestClaim: deps.findRecentQuestClaim,
              };
      const room = new WorldRoom(hub, roomDeps, { roomId, name, ...opts });
      room.onChange = () => this.broadcastDirectory();
      this.rooms.set(roomId, room);
    }
    this.hallRoom = this.rooms.get(WORLD_ROOM_ID)!;
    this.dropClaimer = deps.claimWorldDrop;
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
      { claimWorldDrop: this.dropClaimer },
      {
        roomId,
        name: creatorRoomName(displayName),
        bounds: { ...CREATOR_ROOM_BOUNDS },
        spawn: { ...CREATOR_ROOM_SPAWN },
      },
    );
    room.onChange = () => this.broadcastDirectory();
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

  /** Admission: everyone enters through the hall. */
  enterHall(socket: WsClientSocket, identity: WorldIdentity): boolean {
    return this.hallRoom.attach(socket, identity);
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
        slug,
      });
    }
    return entries;
  }

  private broadcastDirectory(): void {
    const payload = { type: "palace.directory", rooms: this.directory() };
    for (const room of this.rooms.values()) {
      if (room.size() > 0) this.hub.broadcast(room.roomId, payload);
    }
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
      }
    } catch {
      /* not JSON — the room's own parser will ignore it too */
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
