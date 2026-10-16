/**
 * party-client.ts — Party Games: the room socket brain.
 * Framework-free (the React page is a thin shell) so the whole
 * protocol behaviour is unit-tested in node with fake sockets.
 *
 * Protocol mirrors lib/party-rooms.ts on the server:
 *   out: start / next / end (host), pick (duel), answer
 *   in:  welcome, players, host.changed, game.started, pick.begin,
 *        question, answer.count, reveal, podium, room.ended,
 *        room_full, error
 *
 * The client NEVER sends a score: it sends an answer choice and the
 * server — which alone knows the correct answer and its own clock —
 * does all scoring. The question frame the server sends carries no
 * answer; the correct index only arrives with the reveal.
 */

export type PartyGame = "trivia" | "duel";
export type PartyCategory = "music" | "creator" | "general";
export type PartyPhase = "lobby" | "pick" | "question" | "reveal" | "podium" | "ended";
export type PartyStatus =
  | "connecting"
  | "inside"
  | "full"
  | "no-room"
  | "auth"
  | "error"
  | "closed";

export interface PartyPlayer {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
  isHost: boolean;
  connected: boolean;
  score: number;
  correct: number;
  roundsWon: number;
}

export interface PartyQuestionView {
  index: number;
  total: number;
  category: PartyCategory;
  prompt: string;
  choices: string[];
  endsAt: number;
}

export interface PartyAnswerResult {
  peerId: string;
  choice: number | null;
  correct: boolean;
  points: number;
  elapsedMs: number | null;
}

export interface PartyReveal {
  answer: number;
  results: PartyAnswerResult[];
  roundWinnerPeerId: string | null;
  standings: PartyPlayer[];
}

export interface PartyPodium {
  standings: PartyPlayer[];
  winnerPeerIds: string[];
  draw: boolean;
}

export interface PartySocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface PartyClientDeps {
  /** Session access token for the handshake (null = signed out). */
  getAccessToken: () => Promise<string | null>;
  /** Build the socket URL for this token + room code. */
  socketUrl: (token: string | null, code: string) => string;
  /** Open a socket (WebSocket in the browser; fakes in tests). */
  openSocket: (url: string) => PartySocketLike;
}

export function defaultPartySocketUrl(
  loc: { protocol: string; host: string },
  token: string | null,
  code: string,
): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams();
  if (token) q.set("token", token);
  q.set("code", code);
  return `${proto}//${loc.host}/api/party/ws?${q.toString()}`;
}

/** The overlay a status maps to — null means "you're in the room".
 *  Refusals are honest dead-ends with their own cards. */
export function partyOverlay(
  status: PartyStatus,
): "connecting" | "room-full" | "no-room" | "auth" | "error" | null {
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
    default:
      return null;
  }
}

/** Room codes are 6 chars from the server's unambiguous alphabet —
 *  the join box validates the shape before spending a socket. */
export function isPartyRoomCode(v: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(v.trim().toUpperCase());
}

export function normalizePartyCode(v: string): string {
  return v.trim().toUpperCase();
}

export class PartyClient {
  status: PartyStatus = "connecting";
  code = "";
  game: PartyGame = "trivia";
  phase: PartyPhase = "lobby";
  self: PartyPlayer | null = null;
  players: PartyPlayer[] = [];
  question: PartyQuestionView | null = null;
  reveal: PartyReveal | null = null;
  podium: PartyPodium | null = null;
  pickerPeerId: string | null = null;
  pickEndsAt = 0;
  answeredCount = 0;
  /** The choice I locked in for the live question (null = not yet). */
  myChoice: number | null = null;
  lastError: string | null = null;
  endedReason: string | null = null;
  streamId: string | null = null;
  profileSlug: string | null = null;

  /** Fired on every state change — the page re-renders off this. */
  onUpdate: (() => void) | null = null;

  private socket: PartySocketLike | null = null;

  constructor(private deps: PartyClientDeps) {}

  get isHost(): boolean {
    return this.self?.isHost ?? false;
  }

  get connectedCount(): number {
    return this.players.filter((p) => p.connected).length;
  }

  async connect(code: string): Promise<void> {
    this.code = normalizePartyCode(code);
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
    this.question = null;
    this.reveal = null;
    this.podium = null;
  }

  /* ── Intents (the ONLY things a client may ask for) ──────────────── */

  start(rounds?: number): void {
    if (!this.isHost) return;
    this.send(rounds ? { type: "start", rounds } : { type: "start" });
  }

  next(): void {
    if (!this.isHost) return;
    this.send({ type: "next" });
  }

  end(): void {
    if (!this.isHost) return;
    this.send({ type: "end" });
  }

  pick(category: PartyCategory): void {
    if (this.phase !== "pick" || this.self?.peerId !== this.pickerPeerId) return;
    this.send({ type: "pick", category });
  }

  answer(choice: number): void {
    if (this.phase !== "question" || this.myChoice !== null) return;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) return;
    this.myChoice = choice;
    this.touch();
    // Only the choice crosses the wire — never a score, never a time.
    this.send({ type: "answer", choice });
  }

  /* ── Frame handling ──────────────────────────────────────────────── */

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
        const you = frame["you"] as PartyPlayer;
        const room = frame["room"] as {
          game: PartyGame;
          phase: PartyPhase;
          players: PartyPlayer[];
          streamId: string | null;
          profileSlug: string | null;
          question: PartyQuestionView | null;
          pickerPeerId: string | null;
        };
        this.self = you;
        this.game = room.game;
        this.phase = room.phase;
        this.players = room.players ?? [];
        this.streamId = room.streamId ?? null;
        this.profileSlug = room.profileSlug ?? null;
        this.question = room.question ?? null;
        this.pickerPeerId = room.pickerPeerId ?? null;
        this.setStatus("inside");
        this.touch();
        return;
      }
      case "players": {
        const list = (frame["players"] as PartyPlayer[]) ?? [];
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
      case "game.started": {
        this.reveal = null;
        this.podium = null;
        this.touch();
        return;
      }
      case "pick.begin": {
        this.phase = "pick";
        this.pickerPeerId = String(frame["pickerPeerId"] ?? "");
        this.pickEndsAt = Number(frame["endsAt"] ?? 0);
        this.question = null;
        this.reveal = null;
        this.touch();
        return;
      }
      case "question": {
        this.phase = "question";
        this.question = {
          index: Number(frame["index"] ?? 0),
          total: Number(frame["total"] ?? 0),
          category: frame["category"] as PartyCategory,
          prompt: String(frame["prompt"] ?? ""),
          choices: (frame["choices"] as string[]) ?? [],
          endsAt: Number(frame["endsAt"] ?? 0),
        };
        this.reveal = null;
        this.myChoice = null;
        this.answeredCount = 0;
        this.touch();
        return;
      }
      case "answer.count": {
        this.answeredCount = Number(frame["answered"] ?? 0);
        this.touch();
        return;
      }
      case "reveal": {
        this.phase = "reveal";
        this.reveal = {
          answer: Number(frame["answer"] ?? -1),
          results: (frame["results"] as PartyAnswerResult[]) ?? [],
          roundWinnerPeerId: (frame["roundWinnerPeerId"] as string | null) ?? null,
          standings: (frame["standings"] as PartyPlayer[]) ?? [],
        };
        this.players = this.reveal.standings;
        const me = this.players.find((p) => p.peerId === this.self?.peerId);
        if (me) this.self = me;
        this.touch();
        return;
      }
      case "podium": {
        this.phase = "podium";
        this.podium = {
          standings: (frame["standings"] as PartyPlayer[]) ?? [],
          winnerPeerIds: (frame["winnerPeerIds"] as string[]) ?? [],
          draw: Boolean(frame["draw"]),
        };
        this.players = this.podium.standings;
        this.touch();
        return;
      }
      case "room.ended": {
        this.phase = "ended";
        this.endedReason = String(frame["reason"] ?? "ended");
        this.touch();
        return;
      }
      default:
        return;
    }
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      /* a dying socket surfaces via onclose */
    }
  }

  private setStatus(status: PartyStatus): void {
    this.status = status;
    this.touch();
  }

  private touch(): void {
    this.onUpdate?.();
  }
}
