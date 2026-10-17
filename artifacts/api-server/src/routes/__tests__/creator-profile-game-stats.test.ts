/**
 * Stack-30 C7 — bespoke route tests for GET /creator-profiles/:slug/game-stats (DE-15).
 *
 * The endpoint shipped covered only by the /arcade/me + /party/me
 * suites (it reuses their aggregation helpers verbatim). These tests
 * drive the REAL profile-website router + the REAL helpers over the
 * house fake-db harness and pin the surface's own contract:
 *   - arcade aggregates: best + plays per game, unplayed games null/0,
 *     other users' scores never counted;
 *   - party aggregates: matches/wins/points/bestScore per game +
 *     totalMatches;
 *   - the leaderboard opt-out (retention_prefs.leaderboard_visible =
 *     false) hides the whole record — stats are not even aggregated
 *     into the response;
 *   - unknown slug and private profile both 404;
 *   - aggregates ONLY: the DTO carries scores and wins (status),
 *     never economy fields — stored row extras (duration, placement,
 *     rounds, player counts) don't leak, and no credit/currency key
 *     appears anywhere in the payload.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    prefs: [] as Array<Record<string, unknown>>,
    arcadeScores: [] as Array<Record<string, unknown>>,
    partyResults: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return (dialect.sqlToQuery(cond as never).params as unknown[]) ?? [];
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const {
    creatorProfilesTable,
    retentionPrefsTable,
    arcadeScoresTable,
    partyMatchResultsTable,
  } = actual;
  const state = h.state;

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    const params = cond !== undefined ? renderParams(cond) : [];
    if (table === creatorProfilesTable) {
      return state.profiles.filter((p) => p["slug"] === params[0]);
    }
    if (table === retentionPrefsTable) {
      const rows = state.prefs.filter((p) => p["userId"] === params[0]);
      /* The handler selects { visible: leaderboardVisible } — project
         the alias the way drizzle would. */
      if (fields && typeof fields === "object" && "visible" in (fields as object)) {
        return rows.map((r) => ({ visible: r["leaderboardVisible"] }));
      }
      return rows;
    }
    if (table === arcadeScoresTable) {
      return state.arcadeScores.filter((r) => r["userId"] === params[0]);
    }
    if (table === partyMatchResultsTable) {
      return state.partyResults.filter((r) => r["userId"] === params[0]);
    }
    return [];
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async (n: number) => rowsFor(table, fields, cond).slice(0, n),
          then: (res: any, rej: any) =>
            Promise.resolve(rowsFor(table, fields, cond)).then(res, rej),
        }),
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

import profileWebsiteRouter from "../profile-website";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api", profileWebsiteRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedProfile(overrides: Record<string, unknown> = {}) {
  h.state.profiles.push({
    id: "profile-1",
    userId: OWNER,
    slug: "thy-cheat-code",
    displayName: "Thy Cheat Code",
    isPublic: true,
    ...overrides,
  });
}

function seedRecord() {
  h.state.arcadeScores.push(
    { id: "a1", userId: OWNER, game: "runner", score: 120, durationMs: 40_000 },
    { id: "a2", userId: OWNER, game: "runner", score: 450, durationMs: 55_000 },
    { id: "a3", userId: OWNER, game: "runner", score: 300, durationMs: 48_000 },
    { id: "a4", userId: OWNER, game: "skeet", score: 80, durationMs: 30_000 },
    /* Another user's scores — never counted. */
    { id: "a5", userId: OTHER, game: "runner", score: 9_999, durationMs: 99_000 },
    { id: "a6", userId: OTHER, game: "skeet", score: 9_999, durationMs: 99_000 },
  );
  h.state.partyResults.push(
    { id: "p1", userId: OWNER, roomCode: "ROOM1", game: "trivia", placement: 1, score: 900, roundsWon: 0, won: true, playerCount: 4 },
    { id: "p2", userId: OWNER, roomCode: "ROOM2", game: "trivia", placement: 3, score: 700, roundsWon: 0, won: false, playerCount: 6 },
    { id: "p3", userId: OWNER, roomCode: "ROOM3", game: "duel", placement: 1, score: 5, roundsWon: 3, won: true, playerCount: 2 },
    { id: "p4", userId: OTHER, roomCode: "ROOM4", game: "trivia", placement: 1, score: 9_999, roundsWon: 0, won: true, playerCount: 4 },
  );
}

beforeEach(() => {
  h.state.profiles = [];
  h.state.prefs = [];
  h.state.arcadeScores = [];
  h.state.partyResults = [];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /creator-profiles/:slug/game-stats", () => {
  it("aggregates the owner's arcade bests/plays and party record — and only the owner's", async () => {
    seedProfile();
    seedRecord();
    const { status, json } = await get("/creator-profiles/thy-cheat-code/game-stats");
    expect(status).toBe(200);
    expect(json.profile).toEqual({ slug: "thy-cheat-code", displayName: "Thy Cheat Code" });
    expect(json.visible).toBe(true);

    expect(json.arcade).toEqual([
      { game: "runner", best: 450, plays: 3 },
      { game: "skeet", best: 80, plays: 1 },
    ]);

    expect(json.party.totalMatches).toBe(3);
    expect(json.party.games).toEqual([
      { game: "trivia", matches: 2, wins: 1, points: 1600, bestScore: 900 },
      { game: "duel", matches: 1, wins: 1, points: 5, bestScore: 5 },
    ]);
  });

  it("a creator with no games gets the full roster at null/0, not an error", async () => {
    seedProfile();
    const { status, json } = await get("/creator-profiles/thy-cheat-code/game-stats");
    expect(status).toBe(200);
    expect(json.arcade).toEqual([
      { game: "runner", best: null, plays: 0 },
      { game: "skeet", best: null, plays: 0 },
    ]);
    expect(json.party).toEqual({
      games: [
        { game: "trivia", matches: 0, wins: 0, points: 0, bestScore: 0 },
        { game: "duel", matches: 0, wins: 0, points: 0, bestScore: 0 },
      ],
      totalMatches: 0,
    });
  });

  it("the leaderboard opt-out hides the whole record — seeded stats never reach the response", async () => {
    seedProfile();
    seedRecord();
    h.state.prefs.push({ userId: OWNER, leaderboardVisible: false });
    const { status, json } = await get("/creator-profiles/thy-cheat-code/game-stats");
    expect(status).toBe(200);
    expect(json.visible).toBe(false);
    expect(json.arcade).toEqual([]);
    expect(json.party).toEqual({ games: [], totalMatches: 0 });
  });

  it("no prefs row at all means visible (the opt-out is opt-out)", async () => {
    seedProfile();
    seedRecord();
    const { json } = await get("/creator-profiles/thy-cheat-code/game-stats");
    expect(json.visible).toBe(true);
    expect(json.arcade[0]).toEqual({ game: "runner", best: 450, plays: 3 });
  });

  it("404s for an unknown slug and for a private profile", async () => {
    seedProfile();
    const missing = await get("/creator-profiles/no-such-creator/game-stats");
    expect(missing.status).toBe(404);

    h.state.profiles = [];
    seedProfile({ isPublic: false });
    const priv = await get("/creator-profiles/thy-cheat-code/game-stats");
    expect(priv.status).toBe(404);
  });

  it("carries aggregates only — stored row extras never leak and no economy key appears anywhere", async () => {
    seedProfile();
    seedRecord();
    const { status, json } = await get("/creator-profiles/thy-cheat-code/game-stats");
    expect(status).toBe(200);

    expect(Object.keys(json).sort()).toEqual(["arcade", "party", "profile", "visible"]);
    for (const entry of json.arcade) {
      expect(Object.keys(entry).sort()).toEqual(["best", "game", "plays"]);
    }
    for (const entry of json.party.games) {
      expect(Object.keys(entry).sort()).toEqual(["bestScore", "game", "matches", "points", "wins"]);
    }
    /* Row columns like durationMs / placement / roundsWon /
       playerCount / roomCode are record-keeping, not profile copy —
       and nothing in the payload may read as money: no credits,
       cents, prizes, payouts, or balances, at any depth. */
    const raw = JSON.stringify(json);
    expect(raw).not.toMatch(/duration|placement|roundsWon|playerCount|roomCode/i);
    expect(raw).not.toMatch(/credit|cent|prize|payout|balance|visual.?bucs|currency|usd/i);
  });
});
