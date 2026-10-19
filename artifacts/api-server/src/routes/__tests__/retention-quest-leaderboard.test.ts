/**
 * retention-quest-leaderboard.test.ts — route tests for the Quest
 * Marks standings (World Ring 2, item 2.22):
 *
 *   GET /api/retention/quests/leaderboard
 *
 * Real handler (the retention router) over the house fake db.
 * Pinned contract: members only (a guest gets 401 and no board);
 * the standings are sums of the marks the Daily Quest Trio's
 * CLAIMED rows recorded — unclaimed progress banks nothing and
 * never stands; a member who opted out of leaderboards is absent
 * from the rows while their own tally still reports to them;
 * display names resolve from profiles with the "Creator" fallback.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const BEA = "22222222-2222-4222-8222-222222222222";
const HID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  fake: null as any,
  userId: "11111111-1111-4111-8111-111111111111" as string, // ME
  names: new Map<string, string>(),
}));

/* The members-only door, enforced the way the real middleware
   enforces it: no signed-in member, no handler — a 401. */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!h.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
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
  addCreditsAtomic: vi.fn(async () => ({ oldCredits: 0, newCredits: 0, created: false })),
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
    dailyQuestProgress: actual.dailyQuestProgressTable,
    retentionPrefs: actual.retentionPrefsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import retentionRouter from "../retention";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(retentionRouter);
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
  h.names = new Map([[BEA, "Bea"]]);
});

function claimRow(userId: string, marks: number, claimedAt: Date | null) {
  return {
    userId,
    questKey: "daily-song-spark",
    dayDate: "2026-10-14",
    progress: 1,
    target: 1,
    completed: true,
    rewardVb: claimedAt ? 10 : null,
    marks: claimedAt ? marks : 0,
    claimedAt,
  };
}

async function getBoard() {
  const res = await fetch(`${base}/retention/quests/leaderboard`);
  return { status: res.status, body: (await res.json()) as any };
}

describe("GET /retention/quests/leaderboard", () => {
  it("sums claimed rows into standings; unclaimed progress stands nowhere", async () => {
    h.fake.seed("dailyQuestProgress", [
      claimRow(ME, 5, new Date("2026-10-14T20:00:00Z")),
      claimRow(ME, 5, new Date("2026-10-15T20:00:00Z")),
      claimRow(BEA, 15, new Date("2026-10-14T21:00:00Z")),
      // Progress without a claim: the row's marks were never banked.
      claimRow(BEA, 0, null),
      { ...claimRow(HID, 0, null), completed: false, progress: 0 },
    ]);
    const { status, body } = await getBoard();
    expect(status).toBe(200);
    expect(body.rows).toEqual([
      { rank: 1, userId: BEA, name: "Bea", marks: 15, claims: 1, isYou: false },
      { rank: 2, userId: ME, name: "Creator", marks: 10, claims: 2, isYou: true },
    ]);
    expect(body.viewer).toEqual({ marks: 10, claims: 2, rank: 2, listed: true });
  });

  it("an opted-out member is absent from the rows; their own tally still reports", async () => {
    h.userId = HID;
    h.fake.seed("dailyQuestProgress", [
      claimRow(HID, 25, new Date("2026-10-14T20:00:00Z")),
      claimRow(BEA, 15, new Date("2026-10-14T21:00:00Z")),
    ]);
    h.fake.seed("retentionPrefs", [{ userId: HID, leaderboardVisible: false }]);
    const { status, body } = await getBoard();
    expect(status).toBe(200);
    expect(body.rows.map((r: any) => r.userId)).toEqual([BEA]);
    expect(body.viewer).toEqual({ marks: 25, claims: 1, rank: null, listed: false });
  });

  it("guests get no board at all", async () => {
    h.userId = "";
    h.fake.seed("dailyQuestProgress", [claimRow(ME, 5, new Date("2026-10-14T20:00:00Z"))]);
    const { status, body } = await getBoard();
    expect(status).toBe(401);
    expect(body.rows).toBeUndefined();
  });

  it("an untouched kingdom answers an empty board, not an error", async () => {
    const { status, body } = await getBoard();
    expect(status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.viewer).toEqual({ marks: 0, claims: 0, rank: null, listed: false });
  });
});
