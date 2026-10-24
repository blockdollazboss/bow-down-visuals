/**
 * Creator Rank — stars as EARNED rank (owner ruling, 2026-10-17).
 *
 * Pins, in three layers:
 *  1. The ladder itself (pure): per-source points and caps, the
 *     0/25/100/300/700/1400 thresholds at their exact boundaries, and
 *     the ★5/★6 business gates — points alone can never buy the top.
 *  2. The rails (real handlers over pg-mem): GET /retention/rank reads
 *     only recorded work (unpublished and other people's work excluded);
 *     level-check computes stars server-side and IGNORES a lying
 *     ?currentLevel=6 claim; celebrate refuses a level above the
 *     earned rank and records a real crossing exactly once.
 *  3. The nameplate source: routes/world resolveCreatorStars returns
 *     the same earned computation.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({ db: null as any, userId: "" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = testState.userId; next(); },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

/* The rank rails never move credits; keep the money modules inert so
   importing the router can't reach the network. */
vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => {},
}));
vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => {},
}));

import retentionDelightRouter from "../retention-delight";
import { resolveCreatorStars } from "../world";
import {
  rankFromCounts,
  pointsForSource,
  clearCreatorRankCache,
  EMPTY_RANK_COUNTS,
  type RankCounts,
} from "../../lib/creator-rank";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE profile_tracks (id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false);
CREATE TABLE profile_videos (id uuid PRIMARY KEY, profile_id uuid NOT NULL, is_published boolean NOT NULL DEFAULT false, thumbnail_alt_text text);
CREATE TABLE export_jobs (id uuid PRIMARY KEY, user_id uuid NOT NULL, state text NOT NULL DEFAULT 'queued');
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, status text NOT NULL DEFAULT 'completed');
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL);
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL DEFAULT 'active', stripe_session_id text);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL);
CREATE TABLE live_streams (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE tip_jar_tips (id uuid PRIMARY KEY, page_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending_payment');
CREATE TABLE live_stream_tips (id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, creator_credited_at timestamptz);
CREATE TABLE world_stage_tips (id uuid PRIMARY KEY, from_user_id text NOT NULL, to_user_id text NOT NULL, amount_vb integer NOT NULL, room_id text NOT NULL, idempotency_key text NOT NULL, creator_credited_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE level_celebrations (user_id uuid NOT NULL, level integer NOT NULL, celebrated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, level));
CREATE TABLE retention_prefs (
  user_id uuid PRIMARY KEY,
  shark_drops_enabled boolean NOT NULL DEFAULT true,
  level_celebrations_enabled boolean NOT NULL DEFAULT true,
  leaderboard_visible boolean NOT NULL DEFAULT true
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const OTHER = randomUUID();
const PROFILE = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(retentionDelightRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function freshDb() {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = USER;
  clearCreatorRankCache();
}

beforeEach(() => freshDb());

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json()) as any };
}
async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as any };
}

function counts(partial: Partial<RankCounts>): RankCounts {
  return { ...EMPTY_RANK_COUNTS, ...partial };
}

/* ── 1. The ladder (pure) ─────────────────────────────────────────────── */

describe("the earned-rank ladder", () => {
  it("points per source, with caps that stop farming one source", () => {
    expect(pointsForSource("publishedTracks", 1)).toBe(10);
    expect(pointsForSource("publishedVideos", 1)).toBe(15);
    expect(pointsForSource("exports", 1)).toBe(5);
    expect(pointsForSource("followers", 1)).toBe(1);
    expect(pointsForSource("streamsHosted", 1)).toBe(10);
    expect(pointsForSource("tipsReceived", 1)).toBe(5);
    expect(pointsForSource("sales", 1)).toBe(20);
    expect(pointsForSource("membershipsSold", 1)).toBe(25);
    /* Caps: 100 tracks still only 300 points; 10,000 followers only 200. */
    expect(pointsForSource("publishedTracks", 100)).toBe(300);
    expect(pointsForSource("followers", 10_000)).toBe(200);
    expect(pointsForSource("sales", 0)).toBe(0);
  });

  it("a fresh account is exactly ★1 with a named next step", () => {
    const rank = rankFromCounts(counts({}));
    expect(rank.stars).toBe(1);
    expect(rank.points).toBe(0);
    expect(rank.next).toMatchObject({ stars: 2, pointsAt: 25, pointsNeeded: 25 });
    expect(rank.hints.join(" ")).toMatch(/Publish your first track/);
  });

  it("first real outputs cross ★2 exactly at 25 points", () => {
    expect(rankFromCounts(counts({ publishedTracks: 1, publishedVideos: 1 })).stars).toBe(2);
    expect(rankFromCounts(counts({ publishedTracks: 1, publishedVideos: 1 })).points).toBe(25);
    expect(rankFromCounts(counts({ publishedTracks: 2, exports: 0 })).stars).toBe(1); // 20 pts
    expect(rankFromCounts(counts({ publishedTracks: 2, exports: 1 })).stars).toBe(2); // 25 pts
  });

  it("threshold boundaries: 100 ★3, 300 ★4", () => {
    expect(rankFromCounts(counts({ publishedTracks: 9, exports: 1 })).stars).toBe(2); // 95
    expect(rankFromCounts(counts({ publishedTracks: 10 })).stars).toBe(3); // 100
    expect(rankFromCounts(counts({ publishedTracks: 29, exports: 1 })).stars).toBe(3); // 295
    expect(rankFromCounts(counts({ publishedTracks: 30 })).stars).toBe(4); // 300
  });

  it("★5 needs 700 points AND at least 3 business results", () => {
    /* 700 points of pure catalog, zero business: still ★4. */
    const catalogOnly = counts({ publishedTracks: 30, publishedVideos: 20, exports: 20 });
    expect(rankFromCounts(catalogOnly).points).toBe(700);
    expect(rankFromCounts(catalogOnly).stars).toBe(4);
    expect(rankFromCounts(catalogOnly).next?.gates).toMatchObject([
      { key: "businessResults", have: 0, need: 3, met: false },
    ]);
    /* Same points with the business gate met by 3 sales: ★5. */
    const withBusiness = counts({ publishedTracks: 27, publishedVideos: 20, exports: 16, sales: 3 });
    expect(rankFromCounts(withBusiness).points).toBe(710);
    expect(rankFromCounts(withBusiness).stars).toBe(5);
  });

  it("★6 needs 1,400 points AND 10 business results AND 20 published works", () => {
    const almost = counts({
      publishedTracks: 0, publishedVideos: 19, exports: 30, followers: 200,
      streamsHosted: 10, tipsReceived: 20, sales: 20, membershipsSold: 20,
    });
    /* Points (1,735) and business (40) clear their bars, but only 19
       published works exist — the works gate holds the rank at ★5. */
    expect(rankFromCounts(almost).points).toBeGreaterThanOrEqual(1400);
    expect(rankFromCounts(almost).businessResults).toBeGreaterThanOrEqual(10);
    expect(rankFromCounts(almost).publishedWorks).toBe(19);
    expect(rankFromCounts(almost).stars).toBe(5);
    const full = counts({ ...almost, publishedTracks: 1 });
    expect(rankFromCounts(full).publishedWorks).toBe(20);
    expect(rankFromCounts(full).stars).toBe(6);
    expect(rankFromCounts(full).next).toBeNull();
  });

  it("spending is not a source: no count key reads purchases, packs or plan", () => {
    const keys = Object.keys(EMPTY_RANK_COUNTS).sort();
    expect(keys).toEqual([
      "exports",
      "followers",
      "membershipsSold",
      "publishedTracks",
      "publishedVideos",
      "sales",
      "streamsHosted",
      "tipsReceived",
    ]);
  });
});

/* ── 2. The rails over recorded work ──────────────────────────────────── */

describe("GET /retention/rank", () => {
  it("counts only the caller's recorded, published work", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${USER})`);
    await db.execute(sql`INSERT INTO profile_tracks (id, profile_id, is_published) VALUES (${randomUUID()}, ${PROFILE}, true)`);
    await db.execute(sql`INSERT INTO profile_tracks (id, profile_id, is_published) VALUES (${randomUUID()}, ${PROFILE}, false)`);
    await db.execute(sql`INSERT INTO profile_videos (id, profile_id, is_published) VALUES (${randomUUID()}, ${PROFILE}, true)`);
    await db.execute(sql`INSERT INTO export_jobs (id, user_id, state) VALUES (${randomUUID()}, ${USER}, 'done')`);
    await db.execute(sql`INSERT INTO export_jobs (id, user_id, state) VALUES (${randomUUID()}, ${USER}, 'failed')`);
    await db.execute(sql`INSERT INTO follows (follower_user_id, profile_id) VALUES (${OTHER}, ${PROFILE})`);
    /* Someone else's published track must not leak in. */
    const otherProfile = randomUUID();
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${otherProfile}, ${OTHER})`);
    await db.execute(sql`INSERT INTO profile_tracks (id, profile_id, is_published) VALUES (${randomUUID()}, ${otherProfile}, true)`);

    const { status, json } = await get("/retention/rank");
    expect(status).toBe(200);
    expect(json.rank.counts).toMatchObject({
      publishedTracks: 1,
      publishedVideos: 1,
      exports: 1,
      followers: 1,
    });
    /* 10 + 15 + 5 + 1 = 31 points → ★2. */
    expect(json.rank.points).toBe(31);
    expect(json.rank.stars).toBe(2);
    expect(json.rank.next).toMatchObject({ stars: 3, pointsAt: 100, pointsNeeded: 69 });
  });

  it("business sources: paid members and completed sales only", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${USER})`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, status, stripe_session_id) VALUES (${randomUUID()}, ${USER}, 'active', 'cs_1')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, status, stripe_session_id) VALUES (${randomUUID()}, ${USER}, 'active', NULL)`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, status, stripe_session_id) VALUES (${randomUUID()}, ${USER}, 'canceled', 'cs_2')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, status) VALUES (${randomUUID()}, ${PROFILE}, 'completed')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, status) VALUES (${randomUUID()}, ${PROFILE}, 'refunded')`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type) VALUES (${randomUUID()}, ${USER}, 'sale')`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type) VALUES (${randomUUID()}, ${USER}, 'view')`);
    await db.execute(sql`INSERT INTO tip_jar_tips (id, page_user_id, status) VALUES (${randomUUID()}, ${USER}, 'paid')`);
    await db.execute(sql`INSERT INTO tip_jar_tips (id, page_user_id, status) VALUES (${randomUUID()}, ${USER}, 'pending_payment')`);
    await db.execute(sql`INSERT INTO live_stream_tips (id, creator_user_id, creator_credited_at) VALUES (${randomUUID()}, ${USER}, now())`);
    await db.execute(sql`INSERT INTO live_stream_tips (id, creator_user_id, creator_credited_at) VALUES (${randomUUID()}, ${USER}, NULL)`);
    await db.execute(sql`INSERT INTO live_streams (id, user_id) VALUES (${randomUUID()}, ${USER})`);

    const { json } = await get("/retention/rank");
    expect(json.rank.counts).toMatchObject({
      membershipsSold: 1,
      sales: 2,
      tipsReceived: 2,
      streamsHosted: 1,
    });
    expect(json.rank.businessResults).toBe(3);
  });

  it("world stage tips feed the SAME tipsReceived source — credited ones only", async () => {
    const db = testState.db;
    /* 3 stage tips whose credit landed on the caller. */
    for (let i = 0; i < 3; i++) {
      await db.execute(sql`INSERT INTO world_stage_tips (id, from_user_id, to_user_id, amount_vb, room_id, idempotency_key, creator_credited_at) VALUES (${randomUUID()}, ${OTHER}, ${USER}, 500, 'throne-hall', ${`k-stage-${i}`}, now())`);
    }
    /* An in-flight stage tip (row stands, credit not yet landed) is not a received tip. */
    await db.execute(sql`INSERT INTO world_stage_tips (id, from_user_id, to_user_id, amount_vb, room_id, idempotency_key, creator_credited_at) VALUES (${randomUUID()}, ${OTHER}, ${USER}, 500, 'throne-hall', 'k-stage-inflight', NULL)`);
    /* Stage tips that landed on someone else never count. */
    for (let i = 0; i < 2; i++) {
      await db.execute(sql`INSERT INTO world_stage_tips (id, from_user_id, to_user_id, amount_vb, room_id, idempotency_key, creator_credited_at) VALUES (${randomUUID()}, ${USER}, ${OTHER}, 500, 'throne-hall', ${`k-stage-other-${i}`}, now())`);
    }
    /* The two older sources still count in the same union. */
    await db.execute(sql`INSERT INTO tip_jar_tips (id, page_user_id, status) VALUES (${randomUUID()}, ${USER}, 'paid')`);
    await db.execute(sql`INSERT INTO live_stream_tips (id, creator_user_id, creator_credited_at) VALUES (${randomUUID()}, ${USER}, now())`);

    const { status, json } = await get("/retention/rank");
    expect(status).toBe(200);
    /* 3 stage + 1 jar + 1 stream = 5 landed tip events, 5 pts each. */
    expect(json.rank.counts.tipsReceived).toBe(5);
    expect(json.rank.breakdown.tipsReceived).toBe(25);
    /* Those 25 points are the creator's whole record: exactly the ★2 line. */
    expect(json.rank.points).toBe(25);
    expect(json.rank.stars).toBe(2);
  });

  it("the 100-point tips cap is shared across all three tip sources", async () => {
    const db = testState.db;
    /* 15 credited stage tips + 10 credited stream tips = 25 landed
       events = 125 raw points — the one source cap stops it at 100.
       Stage tips get no second helping of their own. */
    for (let i = 0; i < 15; i++) {
      await db.execute(sql`INSERT INTO world_stage_tips (id, from_user_id, to_user_id, amount_vb, room_id, idempotency_key, creator_credited_at) VALUES (${randomUUID()}, ${OTHER}, ${USER}, 100, 'music-hall', ${`k-cap-stage-${i}`}, now())`);
    }
    for (let i = 0; i < 10; i++) {
      await db.execute(sql`INSERT INTO live_stream_tips (id, creator_user_id, creator_credited_at) VALUES (${randomUUID()}, ${USER}, now())`);
    }
    const { json } = await get("/retention/rank");
    expect(json.rank.counts.tipsReceived).toBe(25);
    expect(json.rank.breakdown.tipsReceived).toBe(100);
  });
});

describe("level-check + celebrate on earned rank", () => {
  async function seedStar2() {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${USER})`);
    await db.execute(sql`INSERT INTO profile_tracks (id, profile_id, is_published) VALUES (${randomUUID()}, ${PROFILE}, true)`);
    await db.execute(sql`INSERT INTO profile_videos (id, profile_id, is_published) VALUES (${randomUUID()}, ${PROFILE}, true)`);
    clearCreatorRankCache();
  }

  it("level-check ignores a lying ?currentLevel=6 claim and reports earned stars", async () => {
    await seedStar2();
    const { status, json } = await get("/retention/level-check?currentLevel=6");
    expect(status).toBe(200);
    expect(json.stars).toBe(2);
    expect(json.uncelebrated).toEqual([2]);
  });

  it("a fresh creator has nothing to celebrate and stands at ★1", async () => {
    const { json } = await get("/retention/level-check?currentLevel=6");
    expect(json.stars).toBe(1);
    expect(json.uncelebrated).toEqual([]);
  });

  it("celebrate refuses a level above the earned rank", async () => {
    await seedStar2();
    const { status, json } = await post("/retention/level-check/celebrate", { level: 6 });
    expect(status).toBe(400);
    expect(json.error).toMatch(/has not been earned/);
    const check = await get("/retention/level-check");
    expect(check.json.uncelebrated).toEqual([2]); // nothing was recorded
  });

  it("celebrating a real crossing records it exactly once", async () => {
    await seedStar2();
    const first = await post("/retention/level-check/celebrate", { level: 2 });
    expect(first.status).toBe(200);
    const second = await post("/retention/level-check/celebrate", { level: 2 });
    expect(second.status).toBe(200); // idempotent, not an error
    const check = await get("/retention/level-check");
    expect(check.json.uncelebrated).toEqual([]);
  });

  it("old dial-era celebration rows never inflate the earned rank", async () => {
    const db = testState.db;
    /* Under the dial, a user could record a level-6 celebration at will. */
    await db.execute(sql`INSERT INTO level_celebrations (user_id, level) VALUES (${USER}, 6)`);
    const { json } = await get("/retention/level-check");
    expect(json.stars).toBe(1);
    expect(json.uncelebrated).toEqual([]);
  });
});

/* ── 3. The nameplate source ──────────────────────────────────────────── */

describe("resolveCreatorStars (the World nameplate's read)", () => {
  it("returns the earned computation, not past celebrations", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${USER})`);
    await db.execute(sql`INSERT INTO profile_tracks (id, profile_id, is_published) VALUES (${randomUUID()}, ${PROFILE}, true)`);
    await db.execute(sql`INSERT INTO profile_videos (id, profile_id, is_published) VALUES (${randomUUID()}, ${PROFILE}, true)`);
    await db.execute(sql`INSERT INTO level_celebrations (user_id, level) VALUES (${USER}, 6)`);
    clearCreatorRankCache();
    await expect(resolveCreatorStars(USER)).resolves.toBe(2);
  });
});
