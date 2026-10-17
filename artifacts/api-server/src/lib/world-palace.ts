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
  worldIdentityKey,
  type WorldIdentity,
  type WorldRoomOptions,
} from "./world-room";

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

export interface PalaceDirectoryEntry {
  id: string;
  name: string;
  count: number;
  /** Who's inside, by display name — the "your people are there"
   *  signal. Capped so a full room can't bloat every frame. */
  members: string[];
  /** A show holds the hall's stage (only the hall can be live). */
  live: boolean;
}

const DIRECTORY_MEMBER_NAMES = 12;

export class WorldPalace {
  private rooms = new Map<string, WorldRoom>();
  /** The hall — the palace's front door and its one stage. */
  readonly hallRoom: WorldRoom;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private hub: RoomHub,
    deps: ConstructorParameters<typeof WorldRoom>[1] = {},
  ) {
    for (const def of PALACE_ROOM_DEFS) {
      const { roomId, name, ...opts } = def;
      // Only the hall gets the stage resolvers: it is the palace's
      // one stage, and no other room may ever verify a claim. Only
      // the Music Hall gets the jukebox resolver — the same rule,
      // one authority per piece of room programming.
      const roomDeps =
        def.roomId === WORLD_ROOM_ID
          ? deps
          : def.roomId === "world:music-hall"
            ? { resolveJukeboxTrack: deps.resolveJukeboxTrack }
            : {};
      const room = new WorldRoom(hub, roomDeps, { roomId, name, ...opts });
      room.onChange = () => this.broadcastDirectory();
      this.rooms.set(roomId, room);
    }
    this.hallRoom = this.rooms.get(WORLD_ROOM_ID)!;
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

  /** Admission: everyone enters through the hall. A rejoining
   *  identity first replaces its own ghost — wherever in the
   *  palace the corpse is standing — so a reload or a reconnect
   *  never stacks a second presence beside the first, and the
   *  freed slot is back before the hall's cap check runs. */
  enterHall(socket: WsClientSocket, identity: WorldIdentity): boolean {
    const key = worldIdentityKey(identity);
    if (key) {
      for (const room of this.rooms.values()) room.evictIdentity(key, socket);
    }
    return this.hallRoom.attach(socket, identity);
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

  directory(): PalaceDirectoryEntry[] {
    return PALACE_ROOM_DEFS.map((def) => {
      const room = this.rooms.get(def.roomId)!;
      return {
        id: def.roomId,
        name: def.name,
        count: room.size(),
        members: room.memberNames().slice(0, DIRECTORY_MEMBER_NAMES),
        live: room.stageHeld(),
      };
    });
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
      this.transfer(socket, roomId, x, z, rotY);
      return;
    }
    this.roomOf(socket)?.handleFrame(socket, raw, now);
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
      at,
    });
    /* No explicit directory send to the walker: attach's onChange
     * broadcast IS their copy — the welcome went out first, then
     * the room change carries the fresh directory to everyone in
     * the room, the walker included. Exactly one frame. */
  }
}
