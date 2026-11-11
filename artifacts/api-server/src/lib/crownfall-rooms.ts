/**
 * crownfall-rooms.ts — Crownfall Run ONLINE (owner directive, Nov 10
 * 2026: "Crownfall Run should be multiplayer online 30 rooms max"):
 * co-op party rooms riding the shared live gateway, built directly on
 * the Party Games pattern (lib/party-rooms.ts).
 *
 * Rooms are EPHEMERAL socket state (like Party rooms and the World's
 * presence): a room exists in this process exactly as long as it is
 * being played in. No room rows, no migration — the only durable
 * output of a run is the score each player submits afterwards through
 * the existing arcade score route, which validates against a
 * short-lived in-memory RECEIPT this manager issues at run end (see
 * getReceipt). A server restart ends live rooms; receipts live 15
 * minutes, which is all the score route needs.
 *
 * SYNC MODEL — "soft sync" + server referee. The Crownfall floor
 * generator is deterministic (mulberry32(runSeed + depth * 7919)), so
 * every client builds the IDENTICAL floor from the shared seed: foe
 * identity party-wide is (depth, foe index), placed-coin identity is
 * (depth, pickup index). Each client simulates foes locally and
 * streams its King state (~15 Hz); the server relays it stamped with
 * the sender's peerId. The server referees everything that becomes
 * score:
 *   - `foe.roster` — the first client into a floor registers the foe
 *     list (type/elite/maxHp per index), sanity-capped against the
 *     game's own construction maxima (see crownfallMaxFoeHp).
 *   - `foe.hit` — damage accumulates server-side; the hit that crosses
 *     maxHp is credited the kill (`foe.down`). Per-hit damage is
 *     clamped to [1, 200]; down players cannot deal damage.
 *   - Coin drops are rolled HERE (the single-player table: boss/elite
 *     drop exactly 2, a regular foe drops 1 at 30%; a hurt killer may
 *     also earn a personal heart at 12%) and broadcast as `coin.spawn`.
 *     The first `coin.take` claim wins; the winner's PER-PLAYER purse
 *     is credited and `coin.taken` is broadcast.
 *   - The door opens party-wide when the whole roster is down
 *     (`floor.cleared`). When every alive + connected player has sent
 *     `door.enter`, the party descends together (`floor.begin`).
 *     Dead players spectate the floor out and revive at the next
 *     floor start at 50% max HP (client-applied; the fraction is
 *     CROWNFALL_REVIVE_HP_FRACTION, mirrored by the client).
 *   - A party wipe (every connected player down) ends the run:
 *     `run.ended` carries the final tallies and receipts are issued.
 *
 * Score honesty: per-player tallies (kills / purse / depth) are
 * counted HERE from refereed events, never read from client totals,
 * and the multiplayer caps in lib/arcade-rules only widen the solo
 * pacing bound for runs a receipt vouches for.
 *
 * MONEY BOUNDARY: this engine knows nothing about Visual Bucs. No
 * entry fee, no wager, no prize. The coins here are in-game Crownfall
 * coins (score + the in-game upgrade economy), per player.
 *
 * Protocol (JSON frames; hub room name `crownfall:<CODE>`):
 *   client → server
 *     { type: "start" }                                host, lobby only
 *     { type: "state", x, y, faceX, faceY, hp, maxhp, firing, down, away }
 *     { type: "foe.roster", depth, foes: [{ id, type, elite, maxHp }], placed }
 *     { type: "foe.hit", foeId, dmg, x, y }
 *     { type: "coin.take", coinId }
 *     { type: "door.enter" }
 *     { type: "player.down" }
 *   server → client
 *     { type: "welcome", code, you, room, run }        snapshot on join
 *     { type: "players", players }                     roster/tallies
 *     { type: "host.changed", peerId }
 *     { type: "run.started", seed, depth, players }
 *     { type: "state", peerId, ... }                   relayed King state
 *     { type: "foe.hp", foeId, hp }                    throttled
 *     { type: "foe.down", foeId, byPeerId, x, y }
 *     { type: "coin.spawn", coinId, x, y, kind, onlyPeerId }
 *     { type: "coin.taken", coinId, byPeerId, purse }
 *     { type: "floor.cleared", depth }
 *     { type: "floor.begin", depth, seed }
 *     { type: "player.down", peerId }
 *     { type: "run.ended", reason, players }
 *     { type: "error", code, message } / { type: "room_full", cap } + close
 */
import { RoomHub, WS_OPEN, type WsClientSocket } from "./live-ws";
import { sweepTtlEntries, capMapSize } from "./sweep-map";

/** Owner's cap: at most 30 Crownfall rooms live at once, site-wide. */
export const CROWNFALL_MAX_ROOMS = 30;
export const CROWNFALL_MAX_PLAYERS = 4;
/** A dead player revives at the next floor start with this fraction
 *  of their max HP (the brief's pick: 50%). Applied by the client;
 *  stated here so the protocol has one home. */
export const CROWNFALL_REVIVE_HP_FRACTION = 0.5;

const MAX_FRAME_CHARS = 8192;
const EMPTY_ROOM_MS = 2 * 60_000;
const IDLE_ROOM_MS = 10 * 60_000;
const RECEIPT_TTL_MS = 15 * 60_000;
const RECEIPT_MAX_ENTRIES = 5000;
/* Single-player construction bounds (client genFloor / arcade-rules,
 * v2 construction): at most 24 foes a floor (AMBUSH rooms included),
 * at most 14 placed crowns a floor (JACKPOT VAULT). The referee
 * mirrors the client that actually ships — a roster inside these
 * bounds is honest, beyond them forged. */
const MAX_FOES_PER_FLOOR = 24;
const MAX_PLACED_COINS = 14;
/* A single bolt hit can never honestly exceed this: base damage 10,
 * the Turbo Damage upgrade multiplies 1.3× per pick with no cap on
 * picks, so the clamp is generous — it exists to stop a forged frame
 * one-shotting a boss, not to price real builds. */
const MAX_HIT_DMG = 200;
/* Foe HP sync: at most one `foe.hp` broadcast per foe per window, so
 * boss bars stay honest without flooding the room. */
const FOE_HP_BROADCAST_MS = 150;
/* Drop table — the single-player killEnemy rates, rolled server-side. */
const DROP_COIN_CHANCE = 0.3;
const DROP_HEART_CHANCE = 0.12;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const FOE_TYPES = ["chaser", "shooter", "dasher", "charger", "spambot", "boss"] as const;

export type CrownfallFoeType = (typeof FOE_TYPES)[number];
export type CrownfallPhase = "lobby" | "playing" | "cleared" | "ended";

export interface CrownfallIdentity {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
}

export interface CrownfallKingState {
  x: number;
  y: number;
  faceX: number;
  faceY: number;
  hp: number;
  maxhp: number;
  firing: boolean;
  down: boolean;
  away: boolean;
}

interface CrownfallPlayerDto {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
  isHost: boolean;
  connected: boolean;
  alive: boolean;
  down: boolean;
  purse: number;
  kills: number;
}

export interface CrownfallRoomDto {
  code: string;
  name: string;
  phase: CrownfallPhase;
  hostPeerId: string;
  players: CrownfallPlayerDto[];
  /** Current floor (1 while the room is still a lobby). */
  depth: number;
  maxPlayers: number;
  createdAt: number;
}

/** What a rejoining client needs to rebuild the live floor: which
 *  foes are already down / hurt, which coins are gone, and the drop
 *  coins still lying on the floor. */
export interface CrownfallFloorSnapshot {
  depth: number;
  foes: { id: number; hp: number; maxHp: number; down: boolean }[];
  coinsTaken: string[];
  coinsLive: { coinId: string; x: number; y: number; kind: "crown" | "heart"; onlyPeerId: string | null }[];
}

export interface CrownfallRunSnapshot {
  seed: number;
  depth: number;
  phase: CrownfallPhase;
  floor: CrownfallFloorSnapshot | null;
}

/** The server's own record of a finished run, kept briefly so the
 *  arcade score route can validate a multiplayer submission against
 *  facts (party size, server elapsed time) instead of client claims. */
export interface CrownfallRunReceipt {
  userId: string;
  code: string;
  playerCount: number;
  startedAt: number;
  endedAt: number;
  elapsedMs: number;
  depth: number;
  kills: number;
  coins: number;
}

/** Thrown by createRoom when the site-wide room cap is reached; the
 *  route layer turns it into an honest 429. */
export class CrownfallRoomCapError extends Error {
  constructor() {
    super("All Crownfall rooms are busy right now.");
    this.name = "CrownfallRoomCapError";
  }
}

interface CrownfallRoomsDeps {
  now?: () => number;
  rng?: () => number;
}

interface Player extends CrownfallIdentity {
  peerId: string;
  socket: WsClientSocket | null;
  connected: boolean;
  joinedSeq: number;
  alive: boolean;
  down: boolean;
  purse: number;
  kills: number;
  enteredDoor: boolean;
  lastState: CrownfallKingState | null;
}

interface FoeState {
  id: number;
  type: CrownfallFoeType;
  elite: boolean;
  maxHp: number;
  hp: number;
  down: boolean;
  lastHpSentAt: number;
}

interface CoinState {
  coinId: string;
  kind: "crown" | "heart";
  x: number;
  y: number;
  /** Hearts are personal: only this peer may see/claim the coin. */
  onlyPeerId: string | null;
  takenBy: string | null;
  placed: boolean;
}

interface FloorState {
  depth: number;
  rosterBy: string | null;
  foes: Map<number, FoeState>;
  coins: Map<string, CoinState>;
  coinSeq: number;
}

interface Room {
  code: string;
  name: string;
  phase: CrownfallPhase;
  hostUserId: string;
  createdAt: number;
  players: Player[];
  seq: number;
  seed: number;
  depth: number;
  floor: FloorState | null;
  runStartedAt: number;
  recorded: boolean;
  emptySince: number | null;
  lastActivityAt: number;
}

/** The most HP a foe of this kind can honestly have on this floor —
 *  the client's own construction (genFloor): regular foes scale
 *  1 + (d−1)·0.22 off their base (chaser 26, charger 30, dasher and
 *  spambot 22, shooter 20), elites multiply ×1.9, the boss is
 *  330 × (1 + (⌊d/5⌋−1)·0.6). A roster claiming more is forged.
 *  15% + a small flat slack absorbs float rounding. */
export function crownfallMaxFoeHp(depth: number, type: CrownfallFoeType, elite: boolean): number {
  const d = Math.max(1, Math.floor(depth) || 1);
  const hpScale = 1 + (d - 1) * 0.22;
  let base: number;
  if (type === "boss") base = 330 * (1 + (Math.floor(d / 5) - 1) * 0.6);
  else if (type === "chaser") base = 26 * hpScale;
  else if (type === "charger") base = 30 * hpScale;
  else if (type === "dasher" || type === "spambot") base = 22 * hpScale;
  else base = 20 * hpScale;
  if (elite && type !== "boss") base *= 1.9;
  return Math.ceil(base * 1.15) + 2;
}

function freshFloor(depth: number): FloorState {
  return { depth, rosterBy: null, foes: new Map(), coins: new Map(), coinSeq: 0 };
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class CrownfallRooms {
  private rooms = new Map<string, Room>();
  private socketRoom = new Map<WsClientSocket, Room>();
  private receipts = new Map<string, CrownfallRunReceipt>();
  private peerCounter = 0;
  private readonly now: () => number;
  private readonly rng: () => number;

  constructor(
    private hub: RoomHub,
    deps: CrownfallRoomsDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.rng = deps.rng ?? (() => Math.random());
  }

  /* ── Room creation / discovery (HTTP layer calls these) ──────────── */

  createRoom(host: CrownfallIdentity, opts: { name?: string | null } = {}): CrownfallRoomDto {
    if (this.rooms.size >= CROWNFALL_MAX_ROOMS) throw new CrownfallRoomCapError();
    let code = this.newCode();
    while (this.rooms.has(code)) code = this.newCode();
    const fallback = `${host.displayName}'s Run`;
    const name = sanitizeRoomName(opts.name) ?? fallback;
    const room: Room = {
      code,
      name,
      phase: "lobby",
      hostUserId: host.userId,
      createdAt: this.now(),
      players: [],
      seq: 0,
      seed: 0,
      depth: 1,
      floor: null,
      runStartedAt: 0,
      recorded: false,
      emptySince: null,
      lastActivityAt: this.now(),
    };
    this.rooms.set(code, room);
    return this.dto(room);
  }

  getRoom(code: string): CrownfallRoomDto | null {
    const room = this.rooms.get(normalizeCode(code));
    return room ? this.dto(room) : null;
  }

  /** Open lobbies for the Arcade lobby list, newest first. Rooms
   *  already running are not listed — you join a run from the lobby,
   *  never mid-descent (a seated player's reconnect is the only way
   *  back into a live run). */
  listOpenRooms(limit = 30): CrownfallRoomDto[] {
    return [...this.rooms.values()]
      .filter((r) => r.phase === "lobby")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => this.dto(r));
  }

  roomCount(): number {
    return this.rooms.size;
  }

  /** The receipt for one player's finished run, if this server
   *  refereed it and it is still fresh. The score route trusts ONLY
   *  this — never a client-sent party size. */
  getReceipt(userId: string, code: string, now = this.now()): CrownfallRunReceipt | null {
    const receipt = this.receipts.get(receiptKey(userId, code));
    if (!receipt) return null;
    if (now - receipt.endedAt > RECEIPT_TTL_MS) return null;
    return receipt;
  }

  /* ── Socket lifecycle ──────────────────────────────────────────────── */

  /** Admit a socket into a room by code. A seated player reconnecting
   *  mid-run reattaches to their seat (purse, kills and down-state
   *  survive a dropped connection) and gets a floor snapshot. A NEW
   *  player is seated from the lobby only. Returns false after an
   *  honest refusal frame. */
  attach(socket: WsClientSocket, code: string, identity: CrownfallIdentity): boolean {
    const room = this.rooms.get(normalizeCode(code));
    if (!room || room.phase === "ended") {
      this.refuse(socket, { type: "error", code: "no_room", message: "That room isn't open. Check the code and try again." }, 4404);
      return false;
    }

    let player = room.players.find((p) => p.userId === identity.userId);
    if (!player) {
      if (room.players.length >= CROWNFALL_MAX_PLAYERS) {
        this.refuse(socket, { type: "room_full", cap: CROWNFALL_MAX_PLAYERS }, 4429);
        return false;
      }
      if (room.phase !== "lobby") {
        this.refuse(socket, { type: "error", code: "already_started", message: "That run already started — rooms seat players from the lobby." }, 4409);
        return false;
      }
      this.peerCounter++;
      player = {
        ...identity,
        peerId: `p${this.peerCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        socket: null,
        connected: false,
        joinedSeq: room.seq++,
        alive: false,
        down: false,
        purse: 0,
        kills: 0,
        enteredDoor: false,
        lastState: null,
      };
      room.players.push(player);
    }

    // A second live socket for the same seat replaces the first.
    if (player.socket && player.socket !== socket) {
      try {
        player.socket.close(4409, "seat taken over");
      } catch {
        /* already gone */
      }
      this.socketRoom.delete(player.socket);
      this.hub.leave(roomName(room), player.socket);
    }
    player.socket = socket;
    player.connected = true;
    player.displayName = identity.displayName;
    player.avatarUrl = identity.avatarUrl;
    room.emptySince = null;
    room.lastActivityAt = this.now();
    this.socketRoom.set(socket, room);
    this.hub.join(roomName(room), socket);

    this.send(player, {
      type: "welcome",
      code: room.code,
      you: this.playerDto(room, player),
      room: this.dto(room),
      run: room.phase === "playing" || room.phase === "cleared" ? this.runSnapshot(room) : null,
    });
    this.broadcastPlayers(room);
    return true;
  }

  detach(socket: WsClientSocket): void {
    const room = this.socketRoom.get(socket);
    if (!room) return;
    this.socketRoom.delete(socket);
    this.hub.leave(roomName(room), socket);
    const player = room.players.find((p) => p.socket === socket);
    if (player) {
      player.socket = null;
      player.connected = false;
      if (room.phase === "lobby") {
        /* Lobby seats carry no run state worth keeping — a closed tab
           frees its chair at once instead of squatting one of four
           slots until the sweep. (Mid-run seats ARE kept: purse,
           kills and the run itself ride on them.) */
        room.players = room.players.filter((p) => p !== player);
        if (room.hostUserId === player.userId) this.migrateHost(room);
      } else {
        if (room.hostUserId === player.userId) this.migrateHost(room);
        // A player who vanishes mid-door-wait no longer blocks it.
        if (room.phase === "cleared") this.maybeAdvanceFloor(room);
        this.maybeWipe(room);
      }
      this.broadcastPlayers(room);
    }
    if (!room.players.some((p) => p.connected)) {
      room.emptySince = this.now();
    }
  }

  /** Drop rooms nobody is connected to anymore. Called by a slow
   *  interval in production; directly in tests. */
  sweep(now = this.now()): void {
    for (const room of [...this.rooms.values()]) {
      if (room.players.some((p) => p.connected)) continue;
      const emptyFor = room.emptySince ? now - room.emptySince : now - room.lastActivityAt;
      const limit = room.phase === "lobby" ? EMPTY_ROOM_MS : IDLE_ROOM_MS;
      if (emptyFor >= limit) this.destroyRoom(room);
    }
    sweepTtlEntries(this.receipts, RECEIPT_TTL_MS, (r) => r.endedAt, now);
    capMapSize(this.receipts, RECEIPT_MAX_ENTRIES, (r) => r.endedAt);
  }

  /* ── Frames ────────────────────────────────────────────────────────── */

  handleFrame(socket: WsClientSocket, raw: string, now = this.now()): void {
    const room = this.socketRoom.get(socket);
    if (!room || raw.length > MAX_FRAME_CHARS) return;
    const player = room.players.find((p) => p.socket === socket);
    if (!player) return;
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    room.lastActivityAt = now;

    switch (frame["type"]) {
      case "start": {
        if (!this.requireHost(room, player)) return;
        if (room.phase !== "lobby") return;
        if (room.players.length < 1) return;
        this.startRun(room, now);
        return;
      }
      case "state": {
        if (room.phase !== "playing" && room.phase !== "cleared") return;
        const state = readKingState(frame);
        if (!state) return;
        player.lastState = state;
        if (state.down && !player.down) this.markDown(room, player);
        // Relay to the rest of the room, stamped with the SENDER's
        // seat — a peerId inside the frame is never trusted.
        for (const other of room.players) {
          if (other === player) continue;
          this.send(other, { type: "state", peerId: player.peerId, ...state });
        }
        return;
      }
      case "foe.roster": {
        if (room.phase !== "playing" || !room.floor || room.floor.rosterBy) return;
        if (frame["depth"] !== room.depth) return;
        this.registerRoster(room, player, frame);
        return;
      }
      case "foe.hit": {
        if (room.phase !== "playing" || !room.floor) return;
        if (player.down || !player.alive) return; // the fallen deal no damage
        const foeId = frame["foeId"];
        const dmgRaw = frame["dmg"];
        if (!Number.isInteger(foeId) || !finite(dmgRaw)) return;
        const foe = room.floor.foes.get(foeId as number);
        if (!foe || foe.down) return;
        const dmg = clamp(Math.round(dmgRaw), 1, MAX_HIT_DMG);
        foe.hp -= dmg;
        const x = finite(frame["x"]) ? clamp(frame["x"] as number, 0, 1080) : 0;
        const y = finite(frame["y"]) ? clamp(frame["y"] as number, 0, 1080) : 0;
        if (foe.hp <= 0) {
          foe.hp = 0;
          foe.down = true;
          player.kills++;
          this.broadcast(room, { type: "foe.down", foeId: foe.id, byPeerId: player.peerId, x, y });
          this.rollDrops(room, player, foe, x, y);
          this.broadcastPlayers(room);
          this.maybeClearFloor(room);
        } else if (now - foe.lastHpSentAt >= FOE_HP_BROADCAST_MS) {
          foe.lastHpSentAt = now;
          this.broadcast(room, { type: "foe.hp", foeId: foe.id, hp: foe.hp });
        }
        return;
      }
      case "coin.take": {
        if (room.phase !== "playing" && room.phase !== "cleared") return;
        if (!room.floor || player.down || !player.alive) return;
        const coinId = frame["coinId"];
        if (typeof coinId !== "string") return;
        const coin = room.floor.coins.get(coinId);
        if (!coin || coin.takenBy) return; // first claim wins; later claims are silent no-ops
        if (coin.onlyPeerId && coin.onlyPeerId !== player.peerId) return;
        coin.takenBy = player.peerId;
        if (coin.kind === "crown") player.purse++;
        this.broadcast(room, { type: "coin.taken", coinId, byPeerId: player.peerId, purse: player.purse });
        this.broadcastPlayers(room);
        return;
      }
      case "door.enter": {
        if (room.phase !== "cleared") return;
        if (player.down || !player.alive) return; // the fallen are carried by the revive, not the door
        player.enteredDoor = true;
        this.maybeAdvanceFloor(room);
        return;
      }
      case "player.down": {
        if (room.phase !== "playing" && room.phase !== "cleared") return;
        if (player.down) return;
        this.markDown(room, player);
        return;
      }
      default:
        return;
    }
  }

  /* ── Run flow ──────────────────────────────────────────────────────── */

  private startRun(room: Room, now: number): void {
    room.seed = 1 + Math.floor(this.rng() * 999_999_999);
    room.depth = 1;
    room.floor = freshFloor(1);
    room.runStartedAt = now;
    room.recorded = false;
    room.phase = "playing";
    for (const p of room.players) {
      p.alive = true;
      p.down = false;
      p.purse = 0;
      p.kills = 0;
      p.enteredDoor = false;
      p.lastState = null;
    }
    this.broadcast(room, {
      type: "run.started",
      seed: room.seed,
      depth: 1,
      players: room.players.map((p) => this.playerDto(room, p)),
    });
  }

  private registerRoster(room: Room, player: Player, frame: Record<string, unknown>): void {
    const floor = room.floor!;
    const foesRaw = frame["foes"];
    if (!Array.isArray(foesRaw) || foesRaw.length < 1 || foesRaw.length > MAX_FOES_PER_FLOOR) return;
    const foes = new Map<number, FoeState>();
    for (const raw of foesRaw) {
      if (!raw || typeof raw !== "object") return;
      const f = raw as Record<string, unknown>;
      const id = f["id"];
      const type = f["type"];
      const elite = f["elite"] === true;
      const maxHp = f["maxHp"];
      if (!Number.isInteger(id) || (id as number) < 0 || foes.has(id as number)) return;
      if (typeof type !== "string" || !(FOE_TYPES as readonly string[]).includes(type)) return;
      if (!finite(maxHp) || maxHp <= 0 || maxHp > crownfallMaxFoeHp(room.depth, type as CrownfallFoeType, elite)) return;
      foes.set(id as number, {
        id: id as number,
        type: type as CrownfallFoeType,
        elite,
        maxHp,
        hp: maxHp,
        down: false,
        lastHpSentAt: 0,
      });
    }
    const placedRaw = frame["placed"];
    const placed = Number.isInteger(placedRaw) ? clamp(placedRaw as number, 0, MAX_PLACED_COINS) : 0;
    floor.foes = foes;
    floor.rosterBy = player.peerId;
    for (let i = 0; i < placed; i++) {
      const coinId = `f${room.depth}:p${i}`;
      floor.coins.set(coinId, { coinId, kind: "crown", x: 0, y: 0, onlyPeerId: null, takenBy: null, placed: true });
    }
  }

  /** The single-player drop table, rolled once, server-side, at the
   *  moment of the kill: boss/elite → exactly 2 coins; a regular foe →
   *  1 coin at 30%. A hurt killer also earns a personal heart at 12%
   *  (hurt = their last state frame says hp < maxhp, as in SP). */
  private rollDrops(room: Room, killer: Player, foe: FoeState, x: number, y: number): void {
    const floor = room.floor!;
    const spawn = (kind: "crown" | "heart", cx: number, cy: number, onlyPeerId: string | null) => {
      const coinId = `f${room.depth}:d${floor.coinSeq++}`;
      floor.coins.set(coinId, { coinId, kind, x: cx, y: cy, onlyPeerId, takenBy: null, placed: false });
      const payload = { type: "coin.spawn", coinId, x: cx, y: cy, kind, onlyPeerId };
      if (onlyPeerId) {
        const owner = room.players.find((p) => p.peerId === onlyPeerId);
        if (owner) this.send(owner, payload);
      } else {
        this.broadcast(room, payload);
      }
    };
    if (foe.type === "boss" || foe.elite) {
      spawn("crown", x, y, null);
      spawn("crown", x + 18, y + 8, null);
    } else if (this.rng() < DROP_COIN_CHANCE) {
      spawn("crown", x, y, null);
    }
    const hurt = killer.lastState ? killer.lastState.hp < killer.lastState.maxhp : false;
    if (hurt && this.rng() < DROP_HEART_CHANCE) {
      spawn("heart", x + 14, y - 10, killer.peerId);
    }
  }

  private maybeClearFloor(room: Room): void {
    const floor = room.floor;
    if (!floor || floor.foes.size === 0) return;
    for (const foe of floor.foes.values()) if (!foe.down) return;
    room.phase = "cleared";
    for (const p of room.players) p.enteredDoor = false;
    this.broadcast(room, { type: "floor.cleared", depth: room.depth });
    // Everyone alive may already be standing in the doorway.
    this.maybeAdvanceFloor(room);
  }

  /** The party descends together: every alive + connected player has
   *  walked through the door. Down players don't block — they revive
   *  on the new floor; disconnected players don't block either (their
   *  seat's King is simply not on this screen anymore). */
  private maybeAdvanceFloor(room: Room): void {
    if (room.phase !== "cleared") return;
    const blockers = room.players.filter((p) => p.connected && p.alive && !p.down && !p.enteredDoor);
    if (blockers.length > 0) return;
    if (!room.players.some((p) => p.connected && p.alive && !p.down)) return;
    room.depth++;
    room.floor = freshFloor(room.depth);
    room.phase = "playing";
    for (const p of room.players) {
      p.enteredDoor = false;
      if (p.down) {
        p.down = false;
        p.alive = true; // revived at 50% max HP, applied client-side
      }
    }
    this.broadcast(room, { type: "floor.begin", depth: room.depth, seed: room.seed });
    this.broadcastPlayers(room);
  }

  private markDown(room: Room, player: Player): void {
    player.down = true;
    player.alive = false;
    this.broadcast(room, { type: "player.down", peerId: player.peerId });
    this.broadcastPlayers(room);
    if (room.phase === "cleared") this.maybeAdvanceFloor(room);
    this.maybeWipe(room);
  }

  /** The run ends when nobody watching can still fight: every
   *  connected player is down. (A room where EVERYONE disconnected is
   *  left for the sweep — a network blip shouldn't end a run nobody
   *  is watching end.) */
  private maybeWipe(room: Room): void {
    if (room.phase !== "playing" && room.phase !== "cleared") return;
    const connected = room.players.filter((p) => p.connected);
    if (connected.length === 0) return;
    if (connected.some((p) => !p.down)) return;
    this.endRun(room, "wipe");
  }

  private endRun(room: Room, reason: string): void {
    this.issueReceipts(room);
    this.broadcast(room, {
      type: "run.ended",
      reason,
      players: room.players.map((p) => this.playerDto(room, p)),
    });
    // The table stays open: the room returns to a lobby for the next
    // run, tallies reset at the next start.
    room.phase = "lobby";
    room.floor = null;
    room.depth = 1;
    for (const p of room.players) {
      p.alive = false;
      p.down = false;
      p.enteredDoor = false;
    }
    this.broadcastPlayers(room);
  }

  private issueReceipts(room: Room): void {
    if (room.recorded || room.runStartedAt === 0) return;
    room.recorded = true;
    const endedAt = this.now();
    for (const p of room.players) {
      this.receipts.set(receiptKey(p.userId, room.code), {
        userId: p.userId,
        code: room.code,
        playerCount: room.players.length,
        startedAt: room.runStartedAt,
        endedAt,
        elapsedMs: Math.max(0, endedAt - room.runStartedAt),
        depth: room.depth,
        kills: p.kills,
        coins: p.purse,
      });
    }
  }

  /* ── Helpers (Party-pattern) ───────────────────────────────────────── */

  private migrateHost(room: Room): void {
    const next = room.players
      .filter((p) => p.connected)
      .sort((a, b) => a.joinedSeq - b.joinedSeq)[0];
    if (next) {
      room.hostUserId = next.userId;
      this.broadcast(room, { type: "host.changed", peerId: next.peerId });
    }
  }

  private requireHost(room: Room, player: Player): boolean {
    if (room.hostUserId === player.userId) return true;
    this.send(player, { type: "error", code: "not_host", message: "Only the host runs this room." });
    return false;
  }

  private destroyRoom(room: Room): void {
    // A run abandoned mid-descent still earns its receipts — the
    // players did the work; only the room is gone.
    if (room.phase === "playing" || room.phase === "cleared") this.issueReceipts(room);
    for (const p of room.players) {
      if (p.socket) {
        this.socketRoom.delete(p.socket);
        this.hub.leave(roomName(room), p.socket);
      }
    }
    this.rooms.delete(room.code);
  }

  private newCode(): string {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(this.rng() * CODE_ALPHABET.length)];
    }
    return code;
  }

  private runSnapshot(room: Room): CrownfallRunSnapshot {
    const floor = room.floor;
    return {
      seed: room.seed,
      depth: room.depth,
      phase: room.phase,
      floor: floor
        ? {
            depth: floor.depth,
            foes: [...floor.foes.values()].map((f) => ({ id: f.id, hp: f.hp, maxHp: f.maxHp, down: f.down })),
            coinsTaken: [...floor.coins.values()].filter((c) => c.takenBy).map((c) => c.coinId),
            coinsLive: [...floor.coins.values()]
              .filter((c) => !c.takenBy && !c.placed)
              .map((c) => ({ coinId: c.coinId, x: c.x, y: c.y, kind: c.kind, onlyPeerId: c.onlyPeerId })),
          }
        : null,
    };
  }

  private playerDto(room: Room, p: Player): CrownfallPlayerDto {
    return {
      peerId: p.peerId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      profileSlug: p.profileSlug,
      isHost: room.hostUserId === p.userId,
      connected: p.connected,
      alive: p.alive,
      down: p.down,
      purse: p.purse,
      kills: p.kills,
    };
  }

  private dto(room: Room): CrownfallRoomDto {
    return {
      code: room.code,
      name: room.name,
      phase: room.phase,
      hostPeerId: room.players.find((p) => p.userId === room.hostUserId)?.peerId ?? "",
      players: room.players.map((p) => this.playerDto(room, p)),
      depth: room.depth,
      maxPlayers: CROWNFALL_MAX_PLAYERS,
      createdAt: room.createdAt,
    };
  }

  private broadcastPlayers(room: Room): void {
    this.broadcast(room, { type: "players", players: room.players.map((p) => this.playerDto(room, p)) });
  }

  private broadcast(room: Room, payload: unknown): void {
    this.hub.broadcast(roomName(room), payload);
  }

  private send(player: Player, payload: unknown): void {
    if (!player.socket || player.socket.readyState !== WS_OPEN) return;
    try {
      player.socket.send(JSON.stringify(payload));
    } catch {
      /* reaped on close */
    }
  }

  private refuse(socket: WsClientSocket, payload: unknown, closeCode: number): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      /* closing anyway */
    }
    try {
      socket.close(closeCode, typeof payload === "object" && payload && "code" in payload ? String((payload as { code: unknown }).code) : "refused");
    } catch {
      /* already gone */
    }
  }
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Room names are player-facing copy: trim, collapse whitespace, cap
 *  the length, and fall back to the default when nothing usable is
 *  left. */
export function sanitizeRoomName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  return clean.length > 0 ? clean : null;
}

function receiptKey(userId: string, code: string): string {
  return `${userId}:${normalizeCode(code)}`;
}

function readKingState(frame: Record<string, unknown>): CrownfallKingState | null {
  const { x, y, faceX, faceY, hp, maxhp } = frame;
  if (!finite(x) || !finite(y) || !finite(faceX) || !finite(faceY) || !finite(hp) || !finite(maxhp)) return null;
  return {
    x: clamp(x, -100, 820),
    y: clamp(y, -100, 820),
    faceX: clamp(faceX, -1, 1),
    faceY: clamp(faceY, -1, 1),
    hp: clamp(hp, 0, 100_000),
    maxhp: clamp(maxhp, 1, 100_000),
    firing: frame["firing"] === true,
    down: frame["down"] === true,
    away: frame["away"] === true,
  };
}

function roomName(room: Room): string {
  return `crownfall:${room.code}`;
}
