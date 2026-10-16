/**
 * Arcade v1 (Stack: owner's games pick #6) — route + validation tests.
 *
 *  - validateArcadeScore / maxPlausibleScore: the anti-printer caps are
 *    derived from the games' construction constants; a perfect legit
 *    run passes, cap+1 is rejected, malformed submissions are rejected.
 *  - POST /api/arcade/scores stores plausible runs only, tracks
 *    personal bests and rank; impossible scores store NOTHING.
 *  - GET /api/arcade/leaderboard ranks best-per-user, resolves display
 *    names, and honors the retention leaderboard opt-out.
 *  - GET /api/arcade/me returns per-game bests (null/0 when unplayed).
 *  - No credits code is imported by the route at all: rewards ride the
 *    Shark Drop rail, so there is nothing here that can mint VB.
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
    arcadeScores: actual.arcadeScoresTable,
    retentionPrefs: actual.retentionPrefsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import arcadeRouter from "../arcade";
import {
  maxPlausibleScore,
  validateArcadeScore,
} from "../../lib/arcade-rules";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(arcadeRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
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

/* ─── Plausibility caps ──────────────────────────────────────────────── */

describe("arcade score validation", () => {
  it("caps are derived from construction: gallery 45s perfect round = 91 targets × 150", () => {
    expect(maxPlausibleScore("gallery", 45_000)).toBe(91 * 150);
  });

  it("runner cap grows with time and stays finite", () => {
    const cap60 = maxPlausibleScore("runner", 60_000);
    // 60s at max speed: ceil(60*900/40)=1350 distance pts + 55 coins × 25
    expect(cap60).toBe(1350 + (Math.floor(60 / 1.1) + 1) * 25);
    expect(maxPlausibleScore("runner", 30_000)).toBeLessThan(cap60);
  });

  it("accepts a perfect legit run at exactly the cap, rejects cap + 1", () => {
    const cap = maxPlausibleScore("runner", 60_000);
    expect(validateArcadeScore({ game: "runner", score: cap, durationMs: 60_000 }).ok).toBe(true);
    expect(validateArcadeScore({ game: "runner", score: cap + 1, durationMs: 60_000 }).ok).toBe(false);
  });

  it("accepts an ordinary mid run", () => {
    expect(validateArcadeScore({ game: "runner", score: 640, durationMs: 48_000 }).ok).toBe(true);
    expect(validateArcadeScore({ game: "gallery", score: 4_200, durationMs: 45_000 }).ok).toBe(true);
  });

  it("rejects the billion-points printer instantly", () => {
    const v = validateArcadeScore({ game: "runner", score: 1_000_000_000, durationMs: 60_000 });
    expect(v.ok).toBe(false);
  });

  it("rejects too-short, over-long, and over-round durations", () => {
    expect(validateArcadeScore({ game: "runner", score: 10, durationMs: 500 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "runner", score: 10, durationMs: 21 * 60_000 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "gallery", score: 100, durationMs: 52_000 }).ok).toBe(false);
  });

  it("rejects malformed shapes", () => {
    expect(validateArcadeScore({ game: "pong", score: 1, durationMs: 5_000 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "runner", score: -5, durationMs: 5_000 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "runner", score: 10.5, durationMs: 5_000 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "runner", score: "100", durationMs: 5_000 }).ok).toBe(false);
  });
});

/* ─── Score submission ───────────────────────────────────────────────── */

describe("POST /api/arcade/scores", () => {
  it("stores a plausible run and reports personal best + rank", async () => {
    const r = await post("/arcade/scores", { game: "runner", score: 500, durationMs: 40_000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true, game: "runner", score: 500, personalBest: 500, isPersonalBest: true, rank: 1, plays: 1,
    });
    expect(h.fake.store("arcadeScores").rows).toHaveLength(1);
  });

  it("keeps the personal best across a weaker second run", async () => {
    await post("/arcade/scores", { game: "runner", score: 500, durationMs: 40_000 });
    const r = await post("/arcade/scores", { game: "runner", score: 300, durationMs: 30_000 });
    expect(r.body.personalBest).toBe(500);
    expect(r.body.isPersonalBest).toBe(false);
    expect(r.body.plays).toBe(2);
  });

  it("rejects an impossible score and stores NOTHING", async () => {
    const r = await post("/arcade/scores", { game: "gallery", score: 999_999, durationMs: 45_000 });
    expect(r.status).toBe(400);
    expect(h.fake.store("arcadeScores").rows).toHaveLength(0);
  });

  it("ranks the viewer against other players' bests", async () => {
    h.fake.seed("arcadeScores", [
      { id: "s1", userId: OTHER, game: "runner", score: 900, durationMs: 60_000 },
      { id: "s2", userId: OTHER, game: "runner", score: 700, durationMs: 55_000 },
    ]);
    const r = await post("/arcade/scores", { game: "runner", score: 500, durationMs: 40_000 });
    expect(r.body.rank).toBe(2);
  });
});

/* ─── Leaderboard ────────────────────────────────────────────────────── */

describe("GET /api/arcade/leaderboard", () => {
  it("ranks best-per-user with display names and a Creator fallback", async () => {
    h.fake.seed("arcadeScores", [
      { id: "s1", userId: OTHER, game: "gallery", score: 3_000, durationMs: 45_000 },
      { id: "s2", userId: OTHER, game: "gallery", score: 1_000, durationMs: 45_000 },
      { id: "s3", userId: ME, game: "gallery", score: 2_000, durationMs: 45_000 },
      { id: "s4", userId: THIRD, game: "gallery", score: 500, durationMs: 45_000 },
    ]);
    const r = await get("/arcade/leaderboard?game=gallery");
    expect(r.status).toBe(200);
    expect(r.body.rows.map((x: any) => [x.rank, x.name, x.best, x.plays])).toEqual([
      [1, "Gold Fin Gary", 3_000, 2],
      [2, "Creator", 2_000, 1],
      [3, "Creator", 500, 1],
    ]);
    expect(r.body.rows[1].isYou).toBe(true);
    expect(r.body.viewerRank).toBe(2);
    expect(r.body.viewerBest).toBe(2_000);
  });

  it("excludes players who opted out of leaderboards", async () => {
    h.fake.seed("arcadeScores", [
      { id: "s1", userId: OTHER, game: "runner", score: 900, durationMs: 60_000 },
      { id: "s2", userId: ME, game: "runner", score: 100, durationMs: 20_000 },
    ]);
    h.fake.seed("retentionPrefs", [{ userId: OTHER, leaderboardVisible: false }]);
    const r = await get("/arcade/leaderboard?game=runner");
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].userId).toBe(ME);
    expect(r.body.viewerRank).toBe(1);
  });

  it("returns an honest empty board and 400s an unknown game", async () => {
    const empty = await get("/arcade/leaderboard?game=runner");
    expect(empty.body.rows).toEqual([]);
    expect(empty.body.viewerRank).toBeNull();
    const bad = await get("/arcade/leaderboard?game=pong");
    expect(bad.status).toBe(400);
  });
});

/* ─── Personal stats ─────────────────────────────────────────────────── */

describe("GET /api/arcade/me", () => {
  it("reports bests and play counts per game, null/0 when unplayed", async () => {
    h.fake.seed("arcadeScores", [
      { id: "s1", userId: ME, game: "runner", score: 450, durationMs: 35_000 },
      { id: "s2", userId: ME, game: "runner", score: 800, durationMs: 50_000 },
      { id: "s3", userId: OTHER, game: "gallery", score: 9_999, durationMs: 45_000 },
    ]);
    const r = await get("/arcade/me");
    expect(r.body.games).toEqual([
      { game: "runner", best: 800, plays: 2 },
      { game: "gallery", best: null, plays: 0 },
    ]);
  });
});
