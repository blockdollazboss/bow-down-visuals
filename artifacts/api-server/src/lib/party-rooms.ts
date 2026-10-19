/**
 * party-rooms.ts — Party Games v1: multiplayer party rooms (Trivia +
 * Court Battle duels) riding the shared live gateway.
 *
 * Rooms are EPHEMERAL socket state (like the World's presence): a room
 * exists in this process exactly as long as it is being played in, and
 * only the RESULT of a finished match is persisted (by the route
 * layer, via the onMatchEnd hook — migration 0141). No room rows, no
 * room codes in the database.
 *
 * SERVER-AUTHORITATIVE, always: clients send only intents (an answer
 * choice, a category pick, host flow controls). Scores, speed bonuses,
 * round winners and placements are computed here from server-side
 * timestamps. Any score-like field a client puts in a frame is never
 * read. The correct answer never leaves the server before the reveal.
 *
 * MONEY BOUNDARY: this engine knows nothing about Visual Bucs. It
 * never calls a credits function; wins are recorded as wins, full stop.
 *
 * Protocol (JSON frames; hub room name `party:<CODE>`):
 *   client → server
 *     { type: "start", rounds? }        host only — begin the match
 *     { type: "next" }                  host only — advance from reveal
 *     { type: "end" }                   host only — end the match now
 *     { type: "pick", category }        duel only — the round's picker
 *     { type: "answer", choice }        answer the live question (0–3)
 *   server → client
 *     { type: "welcome", code, you, room }     full snapshot on join
 *     { type: "players", players }             roster/standings update
 *     { type: "host.changed", peerId }
 *     { type: "game.started", total }
 *     { type: "pick.begin", pickerPeerId, categories, endsAt }  duel
 *     { type: "question", index, total, category, prompt, choices, endsAt }
 *     { type: "answer.count", answered, total }
 *     { type: "reveal", answer, results, standings }
 *     { type: "podium", standings, winnerPeerIds, draw }
 *     { type: "room.ended", reason }
 *     { type: "error", code, message } / { type: "room_full", cap } + close
 */
import { RoomHub, WS_OPEN, type WsClientSocket } from "./live-ws";
import {
  PARTY_CATEGORIES,
  PARTY_QUESTIONS,
  type PartyCategory,
  type PartyQuestion,
} from "./party-questions";

export const PARTY_MAX_PLAYERS = 8;
export const PARTY_DUEL_PLAYERS = 2;
export const PARTY_QUESTION_MS = 15_000;
export const PARTY_PICK_MS = 6_000;
export const PARTY_TRIVIA_ROUNDS = [5, 8, 10] as const;
export const PARTY_DUEL_ROUNDS_TO_WIN = 3;
export const PARTY_DUEL_MAX_ROUNDS = 5;
const MAX_FRAME_CHARS = 8192;
const IDLE_ROOM_MS = 10 * 60_000;
const EMPTY_ROOM_MS = 2 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export type PartyGame = "trivia" | "duel";
export type PartyPhase = "lobby" | "pick" | "question" | "reveal" | "podium" | "ended";

export interface PartyIdentity {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
}

export interface PartyPlayerDto {
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

export interface PartyRoomDto {
  code: string;
  game: PartyGame;
  phase: PartyPhase;
  hostPeerId: string;
  streamId: string | null;
  profileSlug: string | null;
  players: PartyPlayerDto[];
  /** Live question, public view (never carries the answer). */
  question: {
    index: number;
    total: number;
    category: PartyCategory;
    prompt: string;
    choices: string[];
    endsAt: number;
  } | null;
  pickerPeerId: string | null;
  createdAt: number;
}

export interface PartyMatchPlayerResult {
  userId: string;
  displayName: string;
  placement: number;
  score: number;
  roundsWon: number;
  won: boolean;
}

export interface PartyMatchResult {
  code: string;
  game: PartyGame;
  playerCount: number;
  players: PartyMatchPlayerResult[];
}

export interface PartyRoomsDeps {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  rng?: () => number;
  onMatchEnd?: (result: PartyMatchResult) => void;
  questionMs?: number;
  pickMs?: number;
}

interface Player extends PartyIdentity {
  peerId: string;
  socket: WsClientSocket | null;
  connected: boolean;
  joinedSeq: number;
  score: number;
  correct: number;
  roundsWon: number;
  totalAnswerMs: number;
}

interface Room {
  code: string;
  game: PartyGame;
  phase: PartyPhase;
  hostUserId: string;
  streamId: string | null;
  profileSlug: string | null;
  createdAt: number;
  players: Player[];
  seq: number;
  /* Match state */
  pool: PartyQuestion[];
  /** Ids of every question actually asked this match — recorded at
   *  the end as each player's "recently seen" set (see recentByUser). */
  usedIds: Set<string>;
  totalRounds: number;
  roundIndex: number; // 0-based; -1 before start
  current: PartyQuestion | null;
  questionStartedAt: number;
  questionEndsAt: number;
  answers: Map<string, { choice: number; elapsedMs: number }>;
  pickerPeerId: string | null;
  lastPickerPeerId: string | null;
  timer: unknown;
  recorded: boolean;
  emptySince: number | null;
  lastActivityAt: number;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Speed-scored points for a correct answer: 500 for the answer itself
 *  plus up to 500 more for speed (full bonus at instant, zero at the
 *  buzzer). Wrong answers score 0. */
export function pointsForAnswer(elapsedMs: number, questionMs: number): number {
  const frac = Math.min(1, Math.max(0, 1 - elapsedMs / questionMs));
  return 500 + Math.round(500 * frac);
}

/** Standings order: score desc, then correct answers desc, then total
 *  answer time asc (faster players win ties). Duel re-sorts by rounds
 *  won first — placements there are about rounds, not raw points. */
export function sortStandings(players: Player[], game: PartyGame): Player[] {
  return [...players].sort((a, b) => {
    if (game === "duel" && a.roundsWon !== b.roundsWon) return b.roundsWon - a.roundsWon;
    if (a.score !== b.score) return b.score - a.score;
    if (a.correct !== b.correct) return b.correct - a.correct;
    return a.totalAnswerMs - b.totalAnswerMs;
  });
}

/** Placement for each player in standings order: players tied on every
 *  sort key share a placement (standard competition ranking). */
export function placementsFor(standings: Player[], game: PartyGame): Map<string, number> {
  const out = new Map<string, number>();
  standings.forEach((p, i) => {
    const prev = standings[i - 1];
    if (
      prev &&
      prev.score === p.score &&
      prev.correct === p.correct &&
      prev.totalAnswerMs === p.totalAnswerMs &&
      prev.roundsWon === p.roundsWon
    ) {
      out.set(p.peerId, out.get(prev.peerId)!);
    } else {
      out.set(p.peerId, i + 1);
    }
  });
  void game;
  return out;
}

export class PartyRooms {
  private rooms = new Map<string, Room>();
  private socketRoom = new Map<WsClientSocket, Room>();
  /** Each player's most recent match's question ids (in-memory,
   *  process-lifetime — matching the rooms themselves). Selection
   *  avoids re-dealing what a seated player JUST saw, so back-to-back
   *  matches at the same table don't repeat themselves. */
  private recentByUser = new Map<string, Set<string>>();
  private peerCounter = 0;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly rng: () => number;
  private readonly questionMs: number;
  private readonly pickMs: number;

  constructor(
    private hub: RoomHub,
    private deps: PartyRoomsDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return t;
      });
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.rng = deps.rng ?? (() => Math.random());
    this.questionMs = deps.questionMs ?? PARTY_QUESTION_MS;
    this.pickMs = deps.pickMs ?? PARTY_PICK_MS;
  }

  /* ── Room creation / discovery (HTTP layer calls these) ────────────── */

  createRoom(
    host: PartyIdentity,
    opts: { game: PartyGame; streamId?: string | null; profileSlug?: string | null },
  ): PartyRoomDto {
    let code = this.newCode();
    while (this.rooms.has(code)) code = this.newCode();
    const room: Room = {
      code,
      game: opts.game,
      phase: "lobby",
      hostUserId: host.userId,
      streamId: opts.streamId ?? null,
      profileSlug: opts.profileSlug ?? host.profileSlug ?? null,
      createdAt: this.now(),
      players: [],
      seq: 0,
      pool: [],
      usedIds: new Set(),
      totalRounds: 0,
      roundIndex: -1,
      current: null,
      questionStartedAt: 0,
      questionEndsAt: 0,
      answers: new Map(),
      pickerPeerId: null,
      lastPickerPeerId: null,
      timer: null,
      recorded: false,
      emptySince: null,
      lastActivityAt: this.now(),
    };
    this.rooms.set(code, room);
    return this.dto(room);
  }

  getRoom(code: string): PartyRoomDto | null {
    const room = this.rooms.get(normalizeCode(code));
    return room ? this.dto(room) : null;
  }

  /** Open lobbies for discovery, newest first. In-game rooms are not
   *  listed — you join those by code/link, not by browsing. */
  listOpenRooms(limit = 20): PartyRoomDto[] {
    return [...this.rooms.values()]
      .filter((r) => r.phase === "lobby")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => this.dto(r));
  }

  /** Open lobbies homed to ONE creator profile (program 2.25): the
   *  profile/stream home read — the same lobby truth as
   *  listOpenRooms, scoped to the tables a place holds. A room's
   *  home is its stored profileSlug, fixed at creation (the explicit
   *  home the host picked, else the host's own profile). Newest
   *  first; lobby phase only, exactly like discovery. */
  listOpenRoomsForProfile(profileSlug: string, limit = 20): PartyRoomDto[] {
    return [...this.rooms.values()]
      .filter((r) => r.phase === "lobby" && r.profileSlug === profileSlug)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => this.dto(r));
  }

  roomCount(): number {
    return this.rooms.size;
  }

  /* ── Socket lifecycle ──────────────────────────────────────────────── */

  /** Admit a socket into a room by code. Reconnects (same user, seat
   *  kept) reattach to the existing seat — score and place survive a
   *  dropped connection. Returns false after an honest refusal frame. */
  attach(socket: WsClientSocket, code: string, identity: PartyIdentity): boolean {
    const room = this.rooms.get(normalizeCode(code));
    if (!room || room.phase === "ended") {
      this.refuse(socket, { type: "error", code: "no_room", message: "That room isn't open. Check the code and try again." }, 4404);
      return false;
    }

    let player = room.players.find((p) => p.userId === identity.userId);
    if (!player) {
      const cap = room.game === "duel" ? PARTY_DUEL_PLAYERS : PARTY_MAX_PLAYERS;
      if (room.players.length >= cap) {
        this.refuse(socket, { type: "room_full", cap }, 4429);
        return false;
      }
      if (room.phase !== "lobby") {
        this.refuse(socket, { type: "error", code: "already_started", message: "That match already started — rooms seat players from the lobby." }, 4409);
        return false;
      }
      this.peerCounter++;
      player = {
        ...identity,
        peerId: `p${this.peerCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        socket: null,
        connected: false,
        joinedSeq: room.seq++,
        score: 0,
        correct: 0,
        roundsWon: 0,
        totalAnswerMs: 0,
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

    this.send(player, { type: "welcome", code: room.code, you: this.playerDto(room, player), room: this.dto(room) });
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
      // The seat (and its score) stays for a reconnect — but the crown
      // passes: a disconnected host can't run the room, so the
      // earliest-seated connected player takes over, announced.
      if (room.hostUserId === player.userId) this.migrateHost(room);
      this.broadcastPlayers(room);
      // A question no longer waits on a player who has left.
      if (room.phase === "question") this.maybeFinishQuestion(room);
    }
    if (!room.players.some((p) => p.connected)) {
      room.emptySince = this.now();
    }
  }

  /** Drop rooms nobody is connected to anymore (empty lobbies and
   *  stale mid-game rooms). Called by a slow interval in production;
   *  directly in tests. */
  sweep(now = this.now()): void {
    for (const room of [...this.rooms.values()]) {
      if (room.players.some((p) => p.connected)) continue;
      const emptyFor = room.emptySince ? now - room.emptySince : now - room.lastActivityAt;
      const limit = room.phase === "lobby" || room.phase === "podium" ? EMPTY_ROOM_MS : IDLE_ROOM_MS;
      if (emptyFor >= limit) this.destroyRoom(room);
    }
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
        const minPlayers = room.game === "duel" ? PARTY_DUEL_PLAYERS : 2;
        if (room.players.length < minPlayers) {
          this.send(player, {
            type: "error",
            code: "not_enough_players",
            message:
              room.game === "duel"
                ? "A Court Battle needs exactly two players seated."
                : "Trivia needs at least two players seated.",
          });
          return;
        }
        this.startMatch(room, frame["rounds"], now);
        return;
      }
      case "next": {
        if (!this.requireHost(room, player)) return;
        if (room.phase !== "reveal") return;
        this.advance(room, now);
        return;
      }
      case "end": {
        if (!this.requireHost(room, player)) return;
        if (room.phase === "lobby" || room.phase === "podium" || room.phase === "ended") return;
        this.finishMatch(room, /* completed */ room.roundIndex >= 1 || this.roundRevealed(room));
        return;
      }
      case "pick": {
        if (room.game !== "duel" || room.phase !== "pick") return;
        if (room.pickerPeerId !== player.peerId) return;
        const category = frame["category"];
        if (!isCategory(category)) return;
        this.beginQuestion(room, category, now);
        return;
      }
      case "answer": {
        if (room.phase !== "question" || !room.current) return;
        const choice = frame["choice"];
        if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice > 3) return;
        if (room.answers.has(player.peerId)) return; // one answer, locked in
        // NOTE: only `choice` is read. Any score/points/timing field a
        // client adds to this frame is ignored — scoring is computed
        // here, from the server's own clock.
        room.answers.set(player.peerId, { choice, elapsedMs: Math.max(0, now - room.questionStartedAt) });
        this.hub.broadcast(roomName(room), {
          type: "answer.count",
          answered: room.answers.size,
          total: room.players.filter((p) => p.connected).length,
        });
        this.maybeFinishQuestion(room);
        return;
      }
      default:
        return;
    }
  }

  /* ── Match flow ────────────────────────────────────────────────────── */

  /** Question ids the seated players saw in their most recent match —
   *  the union selection should deal around when it can. */
  private recentAvoidSet(room: Room): Set<string> {
    const avoid = new Set<string>();
    for (const p of room.players) {
      for (const id of this.recentByUser.get(p.userId) ?? []) avoid.add(id);
    }
    return avoid;
  }

  private startMatch(room: Room, roundsRaw: unknown, now: number): void {
    room.usedIds = new Set();
    if (room.game === "duel") {
      room.totalRounds = PARTY_DUEL_MAX_ROUNDS;
      room.pool = shuffle(PARTY_QUESTIONS, this.rng);
    } else {
      const rounds =
        typeof roundsRaw === "number" && (PARTY_TRIVIA_ROUNDS as readonly number[]).includes(roundsRaw)
          ? roundsRaw
          : 8;
      room.totalRounds = rounds;
      // Deal from questions nobody at this table saw in their last
      // match; only reach back into the seen pile if the fresh pile
      // runs short (a tiny test bank, never the grown real one).
      const avoid = this.recentAvoidSet(room);
      const fresh = shuffle(PARTY_QUESTIONS.filter((q) => !avoid.has(q.id)), this.rng);
      if (fresh.length < rounds) {
        const seen = shuffle(PARTY_QUESTIONS.filter((q) => avoid.has(q.id)), this.rng);
        fresh.push(...seen.slice(0, rounds - fresh.length));
      }
      room.pool = fresh.slice(0, rounds);
    }
    room.roundIndex = -1;
    for (const p of room.players) {
      p.score = 0;
      p.correct = 0;
      p.roundsWon = 0;
      p.totalAnswerMs = 0;
    }
    room.recorded = false;
    this.hub.broadcast(roomName(room), { type: "game.started", total: room.totalRounds });
    this.advance(room, now);
  }

  /** Move to the next step: duel pick phase or the next question, or
   *  the podium when the match is decided. */
  private advance(room: Room, now: number): void {
    room.roundIndex++;
    if (room.game === "duel") {
      const leader = sortStandings(room.players, "duel")[0];
      if ((leader && leader.roundsWon >= PARTY_DUEL_ROUNDS_TO_WIN) || room.roundIndex >= PARTY_DUEL_MAX_ROUNDS) {
        this.finishMatch(room, true);
        return;
      }
      this.beginPick(room, now);
      return;
    }
    if (room.roundIndex >= room.totalRounds) {
      this.finishMatch(room, true);
      return;
    }
    const q = room.pool[room.roundIndex];
    if (!q) {
      this.finishMatch(room, true);
      return;
    }
    this.beginQuestion(room, q.category, now, q);
  }

  private beginPick(room: Room, now: number): void {
    room.phase = "pick";
    // Picks alternate. First pick goes to the challenger (the seated
    // player who isn't the host), then back and forth.
    const seated = [...room.players].sort((a, b) => a.joinedSeq - b.joinedSeq);
    const challenger = seated.find((p) => p.userId !== room.hostUserId) ?? seated[0];
    const other = seated.find((p) => p.peerId !== challenger?.peerId);
    const picker =
      room.lastPickerPeerId === null
        ? challenger
        : room.lastPickerPeerId === challenger?.peerId
          ? other
          : challenger;
    room.pickerPeerId = picker?.peerId ?? null;
    room.lastPickerPeerId = room.pickerPeerId;
    const endsAt = now + this.pickMs;
    this.hub.broadcast(roomName(room), {
      type: "pick.begin",
      pickerPeerId: room.pickerPeerId,
      categories: PARTY_CATEGORIES,
      endsAt,
    });
    this.setTimer(room, () => {
      if (room.phase !== "pick") return;
      const cats = PARTY_CATEGORIES;
      const category = cats[Math.floor(this.rng() * cats.length)]!;
      this.beginQuestion(room, category, this.now());
    }, this.pickMs);
  }

  private beginQuestion(room: Room, category: PartyCategory, now: number, preset?: PartyQuestion): void {
    this.clearTimer(room);
    let q = preset;
    if (!q) {
      const used = room.usedIds;
      const inCategory = PARTY_QUESTIONS.filter((x) => x.category === category && !used.has(x.id));
      // Prefer questions the duelists didn't just see last match.
      const avoid = this.recentAvoidSet(room);
      const fresh = inCategory.filter((x) => !avoid.has(x.id));
      const candidates = fresh.length > 0 ? fresh : inCategory;
      q =
        candidates[Math.floor(this.rng() * candidates.length)] ??
        PARTY_QUESTIONS.find((x) => !used.has(x.id));
      if (!q) {
        this.finishMatch(room, true);
        return;
      }
      room.pool[room.roundIndex] = q;
    }
    room.usedIds.add(q.id);
    room.current = q;
    room.answers = new Map();
    room.phase = "question";
    room.questionStartedAt = now;
    room.questionEndsAt = now + this.questionMs;
    room.pickerPeerId = null;
    this.hub.broadcast(roomName(room), {
      type: "question",
      index: room.roundIndex + 1,
      total: room.totalRounds,
      category: q.category,
      prompt: q.prompt,
      choices: q.choices,
      endsAt: room.questionEndsAt,
    });
    this.setTimer(room, () => this.reveal(room), this.questionMs);
  }

  private maybeFinishQuestion(room: Room): void {
    if (room.phase !== "question") return;
    const connected = room.players.filter((p) => p.connected);
    if (connected.length === 0) return;
    if (connected.every((p) => room.answers.has(p.peerId))) {
      this.reveal(room);
    }
  }

  private reveal(room: Room): void {
    if (room.phase !== "question" || !room.current) return;
    this.clearTimer(room);
    room.phase = "reveal";
    const q = room.current;
    const results = room.players.map((p) => {
      const a = room.answers.get(p.peerId);
      const correct = !!a && a.choice === q.answer;
      const points = correct ? pointsForAnswer(a!.elapsedMs, this.questionMs) : 0;
      if (a) {
        p.totalAnswerMs += a.elapsedMs;
        if (correct) {
          p.score += points;
          p.correct++;
        }
      }
      return { peerId: p.peerId, choice: a?.choice ?? null, correct, points, elapsedMs: a?.elapsedMs ?? null };
    });

    let roundWinnerPeerId: string | null = null;
    if (room.game === "duel") {
      const correctResults = results.filter((r) => r.correct);
      if (correctResults.length > 0) {
        correctResults.sort((a, b) => (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity));
        const best = correctResults[0]!;
        // Two correct answers at the same millisecond = a drawn round.
        if (correctResults.length === 1 || correctResults[1]!.elapsedMs !== best.elapsedMs) {
          roundWinnerPeerId = best.peerId;
          const winner = room.players.find((p) => p.peerId === best.peerId);
          if (winner) winner.roundsWon++;
        }
      }
    }

    this.hub.broadcast(roomName(room), {
      type: "reveal",
      answer: q.answer,
      results,
      roundWinnerPeerId,
      standings: this.standings(room),
    });
  }

  private roundRevealed(room: Room): boolean {
    return room.phase === "reveal" || room.phase === "podium";
  }

  private finishMatch(room: Room, completed: boolean): void {
    this.clearTimer(room);
    // Whatever was actually asked becomes each player's "recently
    // seen" — win, lose, or host-ended early, they saw those questions.
    if (room.usedIds.size > 0) {
      for (const p of room.players) {
        this.recentByUser.set(p.userId, new Set(room.usedIds));
      }
    }
    room.phase = "podium";
    const standings = sortStandings(room.players, room.game);
    const placements = placementsFor(standings, room.game);
    const topPlacement = placements.get(standings[0]?.peerId ?? "") ?? 1;
    const winners = standings.filter((p) => placements.get(p.peerId) === topPlacement);
    // A duel is won outright or drawn; a tied trivia podium shares the win.
    const draw = room.game === "duel" && winners.length > 1;
    this.hub.broadcast(roomName(room), {
      type: "podium",
      standings: this.standings(room),
      winnerPeerIds: draw ? [] : winners.map((p) => p.peerId),
      draw,
    });
    if (completed && !room.recorded && this.deps.onMatchEnd) {
      room.recorded = true;
      this.deps.onMatchEnd({
        code: room.code,
        game: room.game,
        playerCount: room.players.length,
        players: standings.map((p) => ({
          userId: p.userId,
          displayName: p.displayName,
          placement: placements.get(p.peerId) ?? 0,
          score: p.score,
          roundsWon: p.roundsWon,
          won: !draw && placements.get(p.peerId) === topPlacement,
        })),
      });
    }
  }

  /* ── Helpers ───────────────────────────────────────────────────────── */

  private migrateHost(room: Room): void {
    const next = [...room.players]
      .filter((p) => p.connected)
      .sort((a, b) => a.joinedSeq - b.joinedSeq)[0];
    if (!next) return;
    room.hostUserId = next.userId;
    this.hub.broadcast(roomName(room), { type: "host.changed", peerId: next.peerId });
  }

  private requireHost(room: Room, player: Player): boolean {
    if (room.hostUserId === player.userId) return true;
    this.send(player, { type: "error", code: "not_host", message: "Only the host runs this room." });
    return false;
  }

  private setTimer(room: Room, fn: () => void, ms: number): void {
    this.clearTimer(room);
    room.timer = this.schedule(fn, ms);
  }

  private clearTimer(room: Room): void {
    if (room.timer !== null && room.timer !== undefined) {
      this.cancel(room.timer);
      room.timer = null;
    }
  }

  private destroyRoom(room: Room): void {
    this.clearTimer(room);
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

  private standings(room: Room): PartyPlayerDto[] {
    return sortStandings(room.players, room.game).map((p) => this.playerDto(room, p));
  }

  private playerDto(room: Room, p: Player): PartyPlayerDto {
    return {
      peerId: p.peerId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      profileSlug: p.profileSlug,
      isHost: room.hostUserId === p.userId,
      connected: p.connected,
      score: p.score,
      correct: p.correct,
      roundsWon: p.roundsWon,
    };
  }

  private dto(room: Room): PartyRoomDto {
    return {
      code: room.code,
      game: room.game,
      phase: room.phase,
      hostPeerId: room.players.find((p) => p.userId === room.hostUserId)?.peerId ?? "",
      streamId: room.streamId,
      profileSlug: room.profileSlug,
      players: room.players.map((p) => this.playerDto(room, p)),
      question:
        room.phase === "question" && room.current
          ? {
              index: room.roundIndex + 1,
              total: room.totalRounds,
              category: room.current.category,
              prompt: room.current.prompt,
              choices: [...room.current.choices],
              endsAt: room.questionEndsAt,
            }
          : null,
      pickerPeerId: room.phase === "pick" ? room.pickerPeerId : null,
      createdAt: room.createdAt,
    };
  }

  private broadcastPlayers(room: Room): void {
    this.hub.broadcast(roomName(room), { type: "players", players: room.players.map((p) => this.playerDto(room, p)) });
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

function isCategory(v: unknown): v is PartyCategory {
  return typeof v === "string" && (PARTY_CATEGORIES as readonly string[]).includes(v);
}

function roomName(room: Room): string {
  return `party:${room.code}`;
}
