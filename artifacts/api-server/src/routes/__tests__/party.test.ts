/**
 * Party Games v1 (#7 owner's games pick) — HTTP routes, question-bank
 * integrity, and scoring-helper tests.
 *
 *  - POST /api/party/rooms creates a lobby owned by the caller (game
 *    validated, context carried); discovery lists open lobbies only;
 *    GET /rooms/:code 404s honestly for unknown codes.
 *  - recordMatchResults writes exactly one row per player; the
 *    leaderboard aggregates wins/points and honors the retention
 *    leaderboard opt-out; /me aggregates per game.
 *  - The question bank is real: ≥30 questions, ≥10 per category,
 *    4 distinct choices, valid answers — and NO other-company names
 *    anywhere in it.
 *  - Scoring helpers are server-side math: speed bonus bounded, ties
 *    share placements.
 *
 * No credits module is imported by the party routes at all — party
 * games carry no Visual Bucs in v1, so there is nothing to fake here.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  fake: null as any,
  userId: "",
  names: new Map<string, string>(),
}));
h.userId = ME;

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({
          data: ids
            .filter((id) => h.names.has(id))
            .map((id) => ({ id, display_name: h.names.get(id) })),
        }),
      }),
    }),
  }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    partyMatchResults: actual.partyMatchResultsTable,
    retentionPrefs: actual.retentionPrefsTable,
    creatorProfiles: actual.creatorProfilesTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import partyRouter, { partyRooms, recordMatchResults } from "../party";
import { PARTY_QUESTIONS, validateQuestionBank, questionsForCategory } from "../../lib/party-questions";
import { pointsForAnswer, placementsFor, sortStandings, PartyRooms } from "../../lib/party-rooms";
import { RoomHub } from "../../lib/live-ws";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(partyRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.fake.clear();
  h.userId = ME;
  h.names = new Map([[OTHER, "Gold Fin Gary"]]);
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

/* ─── Room creation + discovery ─────────────────────────────────────── */

describe("party rooms HTTP", () => {
  it("creates a trivia room owned by the caller, with a join path", async () => {
    const { status, body } = await post("/party/rooms", { game: "trivia" });
    expect(status).toBe(201);
    expect(body.room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(body.room.game).toBe("trivia");
    expect(body.room.phase).toBe("lobby");
    expect(body.joinPath).toBe(`/party?room=${body.room.code}`);
    expect(partyRooms.getRoom(body.room.code)?.code).toBe(body.room.code);
  });

  it("creates a duel room carrying stream/profile context", async () => {
    const { status, body } = await post("/party/rooms", {
      game: "duel",
      streamId: "stream-42",
      profileSlug: "golden-voice",
    });
    expect(status).toBe(201);
    expect(body.room.game).toBe("duel");
    expect(body.room.streamId).toBe("stream-42");
    expect(body.room.profileSlug).toBe("golden-voice");
  });

  it("rejects an unknown game", async () => {
    const { status } = await post("/party/rooms", { game: "poker" });
    expect(status).toBe(400);
  });

  it("discovery lists the open lobby; unknown codes 404 honestly", async () => {
    const created = await post("/party/rooms", { game: "trivia" });
    const code = created.body.room.code as string;
    const list = await get("/party/rooms");
    expect(list.status).toBe(200);
    expect(list.body.rooms.some((r: any) => r.code === code)).toBe(true);

    const one = await get(`/party/rooms/${code.toLowerCase()}`);
    expect(one.status).toBe(200);
    expect(one.body.room.code).toBe(code);

    const missing = await get("/party/rooms/ZZZZZZ");
    expect(missing.status).toBe(404);
  });
});

/* ─── Result recording + records ────────────────────────────────────── */

describe("party records", () => {
  const result = {
    code: "ABC234",
    game: "trivia" as const,
    playerCount: 3,
    players: [
      { userId: ME, displayName: "Me", placement: 1, score: 4200, roundsWon: 0, won: true },
      { userId: OTHER, displayName: "Gary", placement: 2, score: 3100, roundsWon: 0, won: false },
      { userId: THIRD, displayName: "Third", placement: 3, score: 900, roundsWon: 0, won: false },
    ],
  };

  it("recordMatchResults writes exactly one row per player", async () => {
    await recordMatchResults(result);
    const rows = h.fake.store("partyMatchResults").rows;
    expect(rows).toHaveLength(3);
    expect(rows.find((r: any) => r.userId === ME)?.won).toBe(true);
    expect(rows.find((r: any) => r.userId === ME)?.roomCode).toBe("ABC234");
  });

  it("leaderboard aggregates wins/points, resolves names, honors opt-out", async () => {
    await recordMatchResults(result);
    await recordMatchResults({
      ...result,
      code: "DEF345",
      players: [
        { userId: OTHER, displayName: "Gary", placement: 1, score: 5000, roundsWon: 0, won: true },
        { userId: ME, displayName: "Me", placement: 2, score: 2000, roundsWon: 0, won: false },
      ],
    });
    const { body } = await get("/party/leaderboard");
    // ME and OTHER both hold 1 win; OTHER leads on points (8100 vs 6200).
    expect(body.rows[0].userId).toBe(OTHER);
    expect(body.rows[0].name).toBe("Gold Fin Gary");
    expect(body.rows[0].wins).toBe(1);
    expect(body.rows[0].points).toBe(8100);
    expect(body.viewerRank).toBe(2);

    // Opt-out hides OTHER from everyone — except OTHER themselves.
    h.fake.seed("retentionPrefs", [{ userId: OTHER, leaderboardVisible: false }]);
    const hidden = await get("/party/leaderboard");
    expect(hidden.body.rows.some((r: any) => r.userId === OTHER)).toBe(false);
    h.userId = OTHER;
    const selfView = await get("/party/leaderboard");
    expect(selfView.body.rows.some((r: any) => r.userId === OTHER)).toBe(true);
  });

  it("/me aggregates per game with an honest empty state", async () => {
    const empty = await get("/party/me");
    expect(empty.body.totalMatches).toBe(0);
    expect(empty.body.games).toHaveLength(2);

    await recordMatchResults(result);
    const { body } = await get("/party/me");
    expect(body.totalMatches).toBe(1);
    const trivia = body.games.find((g: any) => g.game === "trivia");
    expect(trivia).toMatchObject({ matches: 1, wins: 1, points: 4200, bestScore: 4200 });
    const duel = body.games.find((g: any) => g.game === "duel");
    expect(duel).toMatchObject({ matches: 0, wins: 0 });
  });
});

/* ─── Question bank integrity ───────────────────────────────────────── */

describe("party question bank", () => {
  it("is well-formed: counts, categories, choices, answers", () => {
    expect(validateQuestionBank()).toEqual([]);
    expect(PARTY_QUESTIONS.length).toBeGreaterThanOrEqual(150);
    for (const cat of ["music", "creator", "general"] as const) {
      expect(questionsForCategory(cat).length).toBeGreaterThanOrEqual(50);
    }
  });

  it("carries no other-company names anywhere", () => {
    const banned = [
      "suno", "capcut", "spotify", "youtube", "tiktok", "twitch", "instagram",
      "facebook", "distrokid", "elevenlabs", "runway", "openai", "discord",
      "apple", "google", "amazon", "netflix", "xbox", "playstation", "nintendo",
    ];
    const haystack = JSON.stringify(PARTY_QUESTIONS).toLowerCase();
    for (const word of banned) {
      expect(haystack).not.toContain(word);
    }
  });
});

/* ─── Recent-match no-repeat selection ────────────────────────────────
   The bank grew to 153, and the room engine additionally refuses to
   re-deal what a seated player saw in their most recent match: a
   second match at the same table must ask entirely fresh questions. */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FakeSocket {
  readyState: number;
  frames: Record<string, unknown>[];
  send: (data: string) => void;
  close: () => void;
}

function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    readyState: 1,
    frames: [],
    send(data: string) {
      s.frames.push(JSON.parse(data) as Record<string, unknown>);
    },
    close() {},
  };
  return s;
}

function makeRooms(seed: number) {
  const timers: { fn: () => void; cleared: boolean }[] = [];
  const rooms = new PartyRooms(new RoomHub(), {
    rng: mulberry32(seed),
    questionMs: 1_000,
    pickMs: 300,
    schedule: (fn) => {
      const t = { fn, cleared: false };
      timers.push(t);
      return t;
    },
    cancel: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
  });
  return { rooms, timers };
}

const idFor = (userId: string) => ({
  userId,
  displayName: userId === ME ? "Host" : "Guest",
  avatarUrl: null,
  profileSlug: null,
});

function questionsAsked(sock: FakeSocket): string[] {
  return sock.frames
    .filter((f) => f["type"] === "question")
    .map((f) => {
      const q = PARTY_QUESTIONS.find((x) => x.prompt === f["prompt"]);
      return q ? q.id : `unknown:${String(f["prompt"])}`;
    });
}

function lastFrame(sock: FakeSocket, type: string): Record<string, unknown> | undefined {
  return [...sock.frames].reverse().find((f) => f["type"] === type);
}

/** Play a full 5-question trivia match between ME (host) and OTHER. */
function playTriviaMatch(rooms: PartyRooms): string[] {
  const room = rooms.createRoom(idFor(ME), { game: "trivia" });
  const a = fakeSocket();
  const b = fakeSocket();
  rooms.attach(a as never, room.code, idFor(ME));
  rooms.attach(b as never, room.code, idFor(OTHER));
  let now = 1_000_000;
  rooms.handleFrame(a as never, JSON.stringify({ type: "start", rounds: 5 }), now);
  for (let i = 0; i < 5; i++) {
    now += 100;
    rooms.handleFrame(a as never, JSON.stringify({ type: "answer", choice: 0 }), now);
    rooms.handleFrame(b as never, JSON.stringify({ type: "answer", choice: 1 }), now);
    now += 100;
    rooms.handleFrame(a as never, JSON.stringify({ type: "next" }), now);
  }
  expect(lastFrame(a, "podium")).toBeDefined();
  return questionsAsked(a);
}

describe("party no-repeat selection", () => {
  it("a second trivia match at the same table asks none of the first match's questions", () => {
    const { rooms } = makeRooms(7);
    const first = playTriviaMatch(rooms);
    expect(first).toHaveLength(5);
    const second = playTriviaMatch(rooms);
    expect(second).toHaveLength(5);
    expect(second.filter((id) => first.includes(id))).toEqual([]);
  });

  it("duel questions avoid the previous match's questions too", () => {
    const { rooms } = makeRooms(11);
    const playDuel = (): string[] => {
      const room = rooms.createRoom(idFor(ME), { game: "duel" });
      const a = fakeSocket();
      const b = fakeSocket();
      rooms.attach(a as never, room.code, idFor(ME));
      rooms.attach(b as never, room.code, idFor(OTHER));
      const peerOf = (sock: FakeSocket) =>
        (lastFrame(sock, "welcome")?.["you"] as { peerId: string }).peerId;
      const aPeer = peerOf(a);
      let now = 5_000_000;
      rooms.handleFrame(a as never, JSON.stringify({ type: "start" }), now);
      for (let round = 0; round < 5; round++) {
        const pick = lastFrame(a, "pick.begin");
        if (!pick) break;
        const pickerSock = pick["pickerPeerId"] === aPeer ? a : b;
        now += 50;
        rooms.handleFrame(pickerSock as never, JSON.stringify({ type: "pick", category: "music" }), now);
        const qFrame = lastFrame(a, "question");
        const q = PARTY_QUESTIONS.find((x) => x.prompt === qFrame?.["prompt"]);
        if (!q) break;
        // Host answers correctly at once; the guest answers wrong — 3
        // rounds end the duel, the loop's 5 is only a safety bound.
        now += 10;
        rooms.handleFrame(a as never, JSON.stringify({ type: "answer", choice: q.answer }), now);
        rooms.handleFrame(b as never, JSON.stringify({ type: "answer", choice: (q.answer + 1) % 4 }), now);
        now += 50;
        if (lastFrame(a, "podium")) break;
        rooms.handleFrame(a as never, JSON.stringify({ type: "next" }), now);
      }
      expect(lastFrame(a, "podium")).toBeDefined();
      return questionsAsked(a);
    };
    const first = playDuel();
    expect(first.length).toBeGreaterThanOrEqual(3);
    const second = playDuel();
    expect(second.filter((id) => first.includes(id))).toEqual([]);
  });
});

/* ─── Scoring helpers ───────────────────────────────────────────────── */

describe("party scoring helpers", () => {
  it("speed bonus is bounded: instant = 1000, buzzer = 500, never more", () => {
    expect(pointsForAnswer(0, 15_000)).toBe(1000);
    expect(pointsForAnswer(15_000, 15_000)).toBe(500);
    expect(pointsForAnswer(7_500, 15_000)).toBe(750);
    expect(pointsForAnswer(999_999, 15_000)).toBe(500);
  });

  it("standings sort by score, then correct, then speed; ties share placement", () => {
    const mk = (peerId: string, score: number, correct: number, totalAnswerMs: number) =>
      ({ peerId, score, correct, totalAnswerMs, roundsWon: 0 }) as any;
    const players = [mk("slow", 900, 1, 9000), mk("fast", 900, 1, 2000), mk("top", 1200, 2, 8000), mk("tie", 900, 1, 2000)];
    const standings = sortStandings(players, "trivia");
    expect(standings.map((p: any) => p.peerId)).toEqual(["top", "fast", "tie", "slow"]);
    const placements = placementsFor(standings, "trivia");
    expect(placements.get("top")).toBe(1);
    expect(placements.get("fast")).toBe(2);
    expect(placements.get("tie")).toBe(2);
    expect(placements.get("slow")).toBe(4);
  });
});
