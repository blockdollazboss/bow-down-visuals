/**
 * Route tests for the Daily Drop catalogue + archives
 * (STACK-20 R2 item #18, routes/retention-drops).
 *
 * THE GAP THESE PIN: the drop catalogue is a code-level slate of 30
 * curated template defs (DAILY_DROPS) rotating one per UTC day, but
 * the only route ever built surfaced TODAY's drop — a member who
 * missed a day could never go back for that template, and there was
 * no per-member archive state at all. Now:
 *   GET  /retention/daily-drop/catalog   — the whole slate, each def
 *     with its real tool href, isToday, and the caller's archived flag
 *   POST /retention/daily-drop/archive   — archive one key (validated
 *     against the live catalogue, idempotent, caller-scoped)
 *   POST /retention/daily-drop/unarchive — reverse it (idempotent)
 * Fake-db style mirrors arcade.test.ts (reach fake db, real tables).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  fake: null as any,
  dropEnabled: true,
}));

vi.mock("../../middlewares/require-auth", () => ({
  /* Header-driven stand-in for the real middleware's contract:
     a member token yields req.userId; no token is a 401. */
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (typeof user !== "string" || !user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
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
  getSupabaseAdmin: () => {
    throw new Error("catalogue routes must not use the raw admin client");
  },
}));

vi.mock("../../lib/retention", () => ({
  getRetentionPrefs: async () => ({
    creation_streaks_enabled: true,
    quests_enabled: true,
    daily_drop_enabled: h.dropEnabled,
    away_digest_enabled: true,
    login_streaks_enabled: true,
    share_to_earn_enabled: true,
    contests_enabled: true,
    fomo_feed_enabled: true,
  }),
  getStreakStatus: async () => ({}),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb(
    {
      dailyDropArchives: actual.dailyDropArchivesTable,
      userActivity: actual.userActivityTable,
    },
    { dailyDropArchives: [["userId", "dropKey"]] },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import retentionDropsRouter, { DAILY_DROPS, dropIndexForDate, utcDate } from "../retention-drops";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", retentionDropsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.fake.clear();
  h.dropEnabled = true;
});

async function get(path: string, user?: string) {
  const res = await fetch(`${base}${path}`, {
    headers: user ? { "x-test-user": user } : {},
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
async function post(path: string, body: unknown, user?: string) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const SOME_KEY = DAILY_DROPS[3]!.key;
const OTHER_KEY = DAILY_DROPS[7]!.key;

describe("GET /retention/daily-drop/catalog", () => {
  it("guests get a 401 and nothing is read", async () => {
    const r = await get("/retention/daily-drop/catalog");
    expect(r.status).toBe(401);
  });

  it("the whole slate: every def with its real href, exactly one today, none archived", async () => {
    const r = await get("/retention/daily-drop/catalog", ME);
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(true);
    expect(r.body.total).toBe(DAILY_DROPS.length);
    expect(r.body.date).toBe(utcDate());
    expect(r.body.drops).toHaveLength(DAILY_DROPS.length);
    const todays = r.body.drops.filter((d: any) => d.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0].key).toBe(DAILY_DROPS[dropIndexForDate(utcDate())]!.key);
    for (const [i, d] of r.body.drops.entries()) {
      expect(d.key).toBe(DAILY_DROPS[i]!.key);
      expect(d.kind).toBe(DAILY_DROPS[i]!.kind);
      expect(d.href).toBe(DAILY_DROPS[i]!.href);
      expect(d.href).toContain("template=");
      expect(d.archived).toBe(false);
    }
  });

  it("agrees with the daily-drop route about which drop is today's", async () => {
    const today = await get("/retention/daily-drop", ME);
    const catalog = await get("/retention/daily-drop/catalog", ME);
    expect(today.body.drop.key).toBe(catalog.body.drops.find((d: any) => d.isToday).key);
  });

  it("daily_drop_enabled off: the catalogue closes like the daily drop does", async () => {
    h.dropEnabled = false;
    const r = await get("/retention/daily-drop/catalog", ME);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ enabled: false });
  });
});

describe("POST /retention/daily-drop/archive + unarchive", () => {
  it("archive lands in the caller's catalogue only, and is idempotent", async () => {
    const r = await post("/retention/daily-drop/archive", { key: SOME_KEY }, ME);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, key: SOME_KEY, archived: true });
    expect(h.fake.store("dailyDropArchives").rows).toHaveLength(1);
    expect(h.fake.store("dailyDropArchives").rows[0]).toMatchObject({ userId: ME, dropKey: SOME_KEY });

    const again = await post("/retention/daily-drop/archive", { key: SOME_KEY }, ME);
    expect(again.status).toBe(200);
    expect(h.fake.store("dailyDropArchives").rows).toHaveLength(1);

    const mine = await get("/retention/daily-drop/catalog", ME);
    expect(mine.body.drops.find((d: any) => d.key === SOME_KEY).archived).toBe(true);
    expect(mine.body.drops.filter((d: any) => d.archived)).toHaveLength(1);

    const theirs = await get("/retention/daily-drop/catalog", OTHER);
    expect(theirs.body.drops.find((d: any) => d.key === SOME_KEY).archived).toBe(false);
  });

  it("unarchive reverses it, and unarchiving a live drop is a no-op 200", async () => {
    await post("/retention/daily-drop/archive", { key: SOME_KEY }, ME);
    const r = await post("/retention/daily-drop/unarchive", { key: SOME_KEY }, ME);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, key: SOME_KEY, archived: false });
    expect(h.fake.store("dailyDropArchives").rows).toHaveLength(0);

    const noop = await post("/retention/daily-drop/unarchive", { key: OTHER_KEY }, ME);
    expect(noop.status).toBe(200);
    expect(h.fake.store("dailyDropArchives").rows).toHaveLength(0);
  });

  it("one member's unarchive never clears another member's archive of the same key", async () => {
    await post("/retention/daily-drop/archive", { key: SOME_KEY }, ME);
    await post("/retention/daily-drop/archive", { key: SOME_KEY }, OTHER);
    await post("/retention/daily-drop/unarchive", { key: SOME_KEY }, OTHER);
    const mine = await get("/retention/daily-drop/catalog", ME);
    expect(mine.body.drops.find((d: any) => d.key === SOME_KEY).archived).toBe(true);
    expect(h.fake.store("dailyDropArchives").rows).toHaveLength(1);
  });

  it("unknown or malformed keys are a 400 and record nothing", async () => {
    for (const body of [{ key: "not-a-real-drop" }, { key: 42 }, {}, { key: "" }]) {
      const r = await post("/retention/daily-drop/archive", body, ME);
      expect(r.status).toBe(400);
      const u = await post("/retention/daily-drop/unarchive", body, ME);
      expect(u.status).toBe(400);
    }
    expect(h.fake.store("dailyDropArchives").rows).toHaveLength(0);
  });

  it("guests cannot archive", async () => {
    const r = await post("/retention/daily-drop/archive", { key: SOME_KEY });
    expect(r.status).toBe(401);
    expect(h.fake.store("dailyDropArchives").rows).toHaveLength(0);
  });
});
