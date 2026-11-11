/**
 * crownfall-net.ts — Crownfall Run ONLINE: the room socket brain +
 * the bridge the game engine plays through.
 *
 * Framework-free (the React lobby is a thin shell, the game consumes
 * the bridge surface) so the whole protocol behaviour is unit-tested
 * in node with fake sockets — the Party Games client pattern
 * (lib/party-client.ts), for the engine in lib/crownfall-rooms.ts.
 *
 * Protocol mirrors the server:
 *   out: start (host), state (~15 Hz King state), foe.roster (first
 *        client per floor), foe.hit, coin.take, door.enter,
 *        player.down
 *   in:  welcome, players, host.changed, run.started, state (relayed),
 *        foe.hp, foe.down, coin.spawn, coin.taken, floor.cleared,
 *        floor.begin, player.down, run.ended, room_full, error
 *
 * The client NEVER sends a score or a tally: damage numbers are
 * intents, the server accumulates them, credits kills and purses,
 * and the score a player finally submits is validated server-side
 * against the run receipt (see routes/arcade.ts). Tallies shown
 * in-game (myPurse / myKills) are read from server `players` frames.
 */

export type CrownfallPhase = "lobby" | "playing" | "cleared" | "ended";
export type CrownfallStatus =
  | "connecting"
  | "inside"
  | "full"
  | "no-room"
  | "auth"
  | "error"
  | "closed";

export interface CrownfallPlayer {
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

export interface CrownfallRoomSummary {
  code: string;
  name: string;
  phase: CrownfallPhase;
  players: CrownfallPlayer[];
  depth: number;
  maxPlayers: number;
}

export interface CrownfallRemoteKing {
  peerId: string;
  displayName: string;
  x: number;
  y: number;
  faceX: number;
  faceY: number;
  hp: number;
  maxhp: number;
  firing: boolean;
  down: boolean;
  away: boolean;
  lastAt: number;
}

export interface CrownfallFloorSnapshot {
  depth: number;
  foes: { id: number; hp: number; maxHp: number; down: boolean }[];
  coinsTaken: string[];
  coinsLive: { coinId: string; x: number; y: number; kind: "crown" | "heart"; onlyPeerId: string | null }[];
}

/** One instruction from the server that the game engine must act on.
 *  The engine drains these every frame (see mpTick in
 *  CrownfallRunGame.tsx) — network truth enters the simulation only
 *  here, never mid-update. */
export type CrownfallMpEvent =
  | { kind: "foeDown"; foeId: number; byPeerId: string; x: number; y: number }
  | { kind: "foeHp"; foeId: number; hp: number }
  | { kind: "coinSpawn"; coinId: string; x: number; y: number; coinKind: "crown" | "heart"; onlyPeerId: string | null }
  | { kind: "coinTaken"; coinId: string; byPeerId: string; purse: number }
  | { kind: "floorCleared"; depth: number }
  | { kind: "floorBegin"; depth: number }
  | { kind: "playerDown"; peerId: string }
  | { kind: "runEnded"; reason: string };

/** The game should (re)build a run: fresh start (depth 1, no
 *  snapshot) or a reconnect resync onto the live floor (snapshot). */
export interface CrownfallStartDirective {
  seed: number;
  depth: number;
  snapshot: CrownfallFloorSnapshot | null;
  resync: boolean;
}

export interface CrownfallSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

interface CrownfallClientDeps {
  /** Session access token for the handshake (null = signed out). */
  getAccessToken: () => Promise<string | null>;
  /** Build the socket URL for this token + room code. */
  socketUrl: (token: string | null, code: string) => string;
  /** Open a socket (WebSocket in the browser; fakes in tests). */
  openSocket: (url: string) => CrownfallSocketLike;
  /** Clock for state-frame throttling + remote-king staleness. */
  now?: () => number;
}

export function defaultCrownfallSocketUrl(
  loc: { protocol: string; host: string },
  token: string | null,
  code: string,
): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams();
  if (token) q.set("token", token);
  q.set("code", code);
  return `${proto}//${loc.host}/api/arcade/crownfall/ws?${q.toString()}`;
}

/** Room codes are 6 chars from the server's unambiguous alphabet —
 *  the join box validates the shape before spending a socket. */
export function isCrownfallRoomCode(v: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(v.trim().toUpperCase());
}

export function normalizeCrownfallCode(v: string): string {
  return v.trim().toUpperCase();
}

/** King state frames ride at ~15 Hz — the lobby of a co-op run does
 *  not need (and the gateway should not carry) one packet per frame. */
const STATE_SEND_MS = 66;
/** A remote King not heard from in this long is dropped from the
 *  room view (their seat may live on; their ghost should not). */
const REMOTE_STALE_MS = 4_000;

export class CrownfallClient {
  status: CrownfallStatus = "connecting";
  code = "";
  roomName = "";
  roomPhase: CrownfallPhase = "lobby";
  self: CrownfallPlayer | null = null;
  players: CrownfallPlayer[] = [];
  lastError: string | null = null;
  endedReason: string | null = null;

  /** Fired on every state change — the lobby re-renders off this. */
  onUpdate: (() => void) | null = null;

  /* ── Bridge surface (the game engine reads/writes these) ──────── */
  seed = 0;
  /** True while the server says a run is live for this seat. The
   *  game's startRun refuses to fire without it in multiplayer, so a
   *  death-screen "run it back" can never start a phantom solo run
   *  inside a party room. */
  started = false;
  remoteKings = new Map<string, CrownfallRemoteKing>();

  private socket: CrownfallSocketLike | null = null;
  private readonly now: () => number;
  private events: CrownfallMpEvent[] = [];
  private startDirective: CrownfallStartDirective | null = null;
  private rosterSentForDepth = 0;
  private doorSentForDepth = 0;
  private lastStateSentAt = 0;

  constructor(private deps: CrownfallClientDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  get isHost(): boolean {
    return this.self?.isHost ?? false;
  }

  get selfPeerId(): string {
    return this.self?.peerId ?? "";
  }

  /** Server-tallied purse/kills for THIS player (from `players`
   *  frames) — the game's HUD and score read these, never local
   *  counters. */
  get myPurse(): number {
    return this.self?.purse ?? 0;
  }

  get myKills(): number {
    return this.self?.kills ?? 0;
  }

  get selfDown(): boolean {
    return this.self?.down ?? false;
  }

  /* ── Connection ─────────────────────────────────────────────────── */

  async connect(code: string): Promise<void> {
    this.code = normalizeCrownfallCode(code);
    this.setStatus("connecting");
    let token: string | null = null;
    try {
      token = await this.deps.getAccessToken();
    } catch {
      token = null;
    }
    const socket = this.deps.openSocket(this.deps.socketUrl(token, this.code));
    this.socket = socket;
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = (ev) => {
      if (this.status === "full" || this.status === "no-room" || this.status === "auth") return;
      if (this.status === "inside" || this.status === "connecting") {
        this.setStatus(ev.code === 1000 || ev.code === 1005 ? "closed" : "error");
      }
    };
    socket.onerror = () => {
      if (this.status === "connecting") this.setStatus("error");
    };
  }

  disconnect(): void {
    this.setStatus("closed");
    try {
      this.socket?.close();
    } catch {
      /* already gone */
    }
    this.socket = null;
    this.self = null;
    this.players = [];
    this.started = false;
    this.remoteKings.clear();
    this.events = [];
    this.startDirective = null;
  }

  /* ── Lobby intents ──────────────────────────────────────────────── */

  /** Host only — the server enforces it too; this guard just keeps
   *  the wire clean. */
  start(): void {
    if (!this.isHost) return;
    this.send({ type: "start" });
  }

  /* ── Game bridge: outbound ──────────────────────────────────────── */

  /** Register this floor's foe roster — once per depth; the server
   *  takes the first registration and ignores the rest. */
  sendRoster(depth: number, foes: { id: number; type: string; elite: boolean; maxHp: number }[], placed: number): void {
    if (!this.started || this.rosterSentForDepth === depth) return;
    this.rosterSentForDepth = depth;
    this.send({ type: "foe.roster", depth, foes, placed });
  }

  needsRoster(depth: number): boolean {
    return this.started && this.rosterSentForDepth !== depth;
  }

  reportHit(foeId: number, dmg: number, x: number, y: number): void {
    this.send({ type: "foe.hit", foeId, dmg: Math.round(dmg), x: Math.round(x), y: Math.round(y) });
  }

  claimCoin(coinId: string): void {
    this.send({ type: "coin.take", coinId });
  }

  /** The local King reached the open door — once per depth; the
   *  party descends when every alive player has done the same. */
  notifyDoor(depth: number): void {
    if (this.doorSentForDepth === depth) return;
    this.doorSentForDepth = depth;
    this.send({ type: "door.enter" });
  }

  notifyLocalDown(): void {
    this.send({ type: "player.down" });
  }

  /** ~15 Hz King-state stream; the caller (game tick) invokes this
   *  every frame and the throttle decides. */
  maybeSendState(state: {
    x: number; y: number; faceX: number; faceY: number;
    hp: number; maxhp: number; firing: boolean; down: boolean; away: boolean;
  }): void {
    const t = this.now();
    if (t - this.lastStateSentAt < STATE_SEND_MS) return;
    this.lastStateSentAt = t;
    this.send({ type: "state", ...state });
  }

  /* ── Game bridge: inbound ───────────────────────────────────────── */

  takeStartDirective(): CrownfallStartDirective | null {
    const d = this.startDirective;
    this.startDirective = null;
    return d;
  }

  drainEvents(): CrownfallMpEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Drop remote Kings whose state stream has gone quiet. */
  pruneRemoteKings(): void {
    const t = this.now();
    for (const [peerId, king] of this.remoteKings) {
      if (t - king.lastAt > REMOTE_STALE_MS) this.remoteKings.delete(peerId);
    }
  }

  /* ── Frame handling ─────────────────────────────────────────────── */

  private handleFrame(data: unknown): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = typeof data === "string" ? JSON.parse(data) : null;
      if (!parsed || typeof parsed !== "object") return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    switch (frame["type"]) {
      case "room_full": {
        this.setStatus("full");
        return;
      }
      case "error": {
        const code = String(frame["code"] ?? "");
        this.lastError = String(frame["message"] ?? "Something went wrong");
        if (code === "auth_required") this.setStatus("auth");
        else if (code === "no_room" || code === "already_started") this.setStatus("no-room");
        this.touch();
        return;
      }
      case "welcome": {
        const you = frame["you"] as CrownfallPlayer;
        const room = frame["room"] as {
          name: string;
          phase: CrownfallPhase;
          players: CrownfallPlayer[];
        };
        this.self = you;
        this.roomName = room.name;
        this.roomPhase = room.phase;
        this.players = room.players ?? [];
        const run = frame["run"] as {
          seed: number;
          depth: number;
          floor: CrownfallFloorSnapshot | null;
        } | null;
        if (run) {
          // A reconnect (or a very late mount) onto a live run: the
          // game rebuilds the current floor from the seed + snapshot.
          this.seed = run.seed;
          this.started = true;
          this.rosterSentForDepth = 0;
          this.doorSentForDepth = 0;
          this.startDirective = { seed: run.seed, depth: run.depth, snapshot: run.floor, resync: true };
        }
        this.setStatus("inside");
        this.touch();
        return;
      }
      case "players": {
        const list = (frame["players"] as CrownfallPlayer[]) ?? [];
        this.players = list;
        const me = list.find((p) => p.peerId === this.self?.peerId);
        if (me) this.self = me;
        this.touch();
        return;
      }
      case "host.changed": {
        const peerId = String(frame["peerId"] ?? "");
        this.players = this.players.map((p) => ({ ...p, isHost: p.peerId === peerId }));
        const me = this.players.find((p) => p.peerId === this.self?.peerId);
        if (me) this.self = me;
        this.touch();
        return;
      }
      case "run.started": {
        this.seed = Number(frame["seed"] ?? 0);
        this.started = true;
        this.roomPhase = "playing";
        this.endedReason = null;
        this.rosterSentForDepth = 0;
        this.doorSentForDepth = 0;
        this.events = [];
        this.remoteKings.clear();
        this.startDirective = { seed: this.seed, depth: 1, snapshot: null, resync: false };
        this.touch();
        return;
      }
      case "state": {
        const peerId = String(frame["peerId"] ?? "");
        if (!peerId || peerId === this.selfPeerId) return;
        const player = this.players.find((p) => p.peerId === peerId);
        this.remoteKings.set(peerId, {
          peerId,
          displayName: player?.displayName ?? "Creator",
          x: Number(frame["x"] ?? 0),
          y: Number(frame["y"] ?? 0),
          faceX: Number(frame["faceX"] ?? 0),
          faceY: Number(frame["faceY"] ?? 1),
          hp: Number(frame["hp"] ?? 0),
          maxhp: Number(frame["maxhp"] ?? 1),
          firing: frame["firing"] === true,
          down: frame["down"] === true,
          away: frame["away"] === true,
          lastAt: this.now(),
        });
        return;
      }
      case "foe.hp": {
        this.events.push({ kind: "foeHp", foeId: Number(frame["foeId"] ?? -1), hp: Number(frame["hp"] ?? 0) });
        return;
      }
      case "foe.down": {
        this.events.push({
          kind: "foeDown",
          foeId: Number(frame["foeId"] ?? -1),
          byPeerId: String(frame["byPeerId"] ?? ""),
          x: Number(frame["x"] ?? 0),
          y: Number(frame["y"] ?? 0),
        });
        return;
      }
      case "coin.spawn": {
        this.events.push({
          kind: "coinSpawn",
          coinId: String(frame["coinId"] ?? ""),
          x: Number(frame["x"] ?? 0),
          y: Number(frame["y"] ?? 0),
          coinKind: frame["kind"] === "heart" ? "heart" : "crown",
          onlyPeerId: (frame["onlyPeerId"] as string | null) ?? null,
        });
        return;
      }
      case "coin.taken": {
        this.events.push({
          kind: "coinTaken",
          coinId: String(frame["coinId"] ?? ""),
          byPeerId: String(frame["byPeerId"] ?? ""),
          purse: Number(frame["purse"] ?? 0),
        });
        return;
      }
      case "floor.cleared": {
        this.roomPhase = "cleared";
        this.events.push({ kind: "floorCleared", depth: Number(frame["depth"] ?? 0) });
        this.touch();
        return;
      }
      case "floor.begin": {
        this.roomPhase = "playing";
        this.rosterSentForDepth = 0;
        this.doorSentForDepth = 0;
        this.events.push({ kind: "floorBegin", depth: Number(frame["depth"] ?? 0) });
        this.touch();
        return;
      }
      case "player.down": {
        this.events.push({ kind: "playerDown", peerId: String(frame["peerId"] ?? "") });
        return;
      }
      case "run.ended": {
        this.started = false;
        this.roomPhase = "lobby";
        this.endedReason = String(frame["reason"] ?? "wipe");
        this.events.push({ kind: "runEnded", reason: this.endedReason });
        this.touch();
        return;
      }
      default:
        return;
    }
  }

  /* ── Plumbing ───────────────────────────────────────────────────── */

  private send(frame: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(frame));
    } catch {
      /* reaped on close */
    }
  }

  private setStatus(status: CrownfallStatus): void {
    this.status = status;
    this.touch();
  }

  private touch(): void {
    this.onUpdate?.();
  }
}

/** The overlay a status maps to — null means "you're in the room".
 *  Refusals are honest dead-ends with their own cards (Party pattern). */
export function crownfallOverlay(
  status: CrownfallStatus,
): "connecting" | "room-full" | "no-room" | "auth" | "error" | "closed" | null {
  switch (status) {
    case "connecting":
      return "connecting";
    case "full":
      return "room-full";
    case "no-room":
      return "no-room";
    case "auth":
      return "auth";
    case "error":
      return "error";
    case "closed":
      return "closed";
    default:
      return null;
  }
}
