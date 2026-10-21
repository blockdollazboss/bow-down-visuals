/**
 * Route tests for GET /api/discovery/feed — For-You v1 (Wave 3 #19).
 *
 * The pins that matter:
 *   - OFF (PATCH /feed/prefs {forYouEnabled:false}) = the legacy wire
 *     byte-for-byte in shape and order: followed creators only,
 *     created_at DESC, no source/why fields, no forYou envelope key.
 *   - COLD START: a member with zero recorded engagement gets the
 *     legacy wire even with personalization ON and no pref row.
 *   - ON + signals: affinity re-orders within the follow backbone
 *     (an older drop from a creator the member likes outranks a newer
 *     drop from one they never touch), a non-followed creator the
 *     member plays surfaces labeled source:"discovery" with an honest
 *     why, discovery stays within its bounded share, the member's own
 *     drops never surface as discovery, and why appears ONLY where a
 *     signal earned it.
 *   - Prefs are owner-scoped: one member's toggle never moves
 *     another member's feed.
 *
 * Real router over pg-mem (the trust/catalog harness): real SQL, so
 * the owner filters and the ANY(ARRAY[...]) feed query are exercised,
 * not simulated.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

import discoveryRouter from "../discovery";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL, avatar_url text, vertical text NOT NULL DEFAULT 'music', follower_count integer NOT NULL DEFAULT 0, total_plays integer NOT NULL DEFAULT 0, is_public boolean NOT NULL DEFAULT true);
CREATE TABLE profile_tracks (id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, genre text, artwork_url text, play_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL);
CREATE TABLE profile_videos (id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, genre text, thumbnail_url text, view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE play_events (id uuid PRIMARY KEY, kind text NOT NULL, media_id uuid NOT NULL, user_id uuid, played_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE likes (user_id uuid NOT NULL, kind text NOT NULL, target_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE saves (user_id uuid NOT NULL, kind text NOT NULL, target_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reactions (user_id uuid NOT NULL, target_kind text NOT NULL, target_id uuid NOT NULL, emoji text NOT NULL DEFAULT 'fire', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reposts (user_id uuid NOT NULL, track_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE feed_preferences (user_id uuid PRIMARY KEY, for_you_enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
`;

const VIEWER = "11111111-1111-4111-8111-111111111111";
const VIEWER2 = "22222222-2222-4222-8222-222222222222"; // discovery-cap test
const COLD = "33333333-3333-4333-8333-333333333333"; // follows, zero signals
const LONE = "44444444-4444-4444-8444-444444444444"; // follows nobody, has signals
const OTHER = "55555555-5555-4555-8555-555555555555";

const PROF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // Aria Followed (rock)
const PROF_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // Boring Followed (jazz)
const PROF_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // Cara Discovery (soul)
const PROF_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // Dan Nobody (pop)
const PROF_OWN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // the VIEWER's own profile

const A_OLD = ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002", "a0000000-0000-4000-8000-000000000003"];
const A1 = "a0000000-0000-4000-8000-000000000011"; // 1h ago
const A2 = "a0000000-0000-4000-8000-000000000012"; // 30h ago — affinity must pull it up
const B1 = "b0000000-0000-4000-8000-000000000001"; // 2h ago
const C0 = "c0000000-0000-4000-8000-000000000001"; // 40d ago — signal target only
const C1 = "c0000000-0000-4000-8000-000000000011"; // 5h ago
const C2 = "c0000000-0000-4000-8000-000000000012"; // 2h ago
const C3 = "c0000000-0000-4000-8000-000000000013"; // 3h ago
const C4 = "c0000000-0000-4000-8000-000000000014"; // 4h ago
const D1 = "d0000000-0000-4000-8000-000000000001"; // 1h ago, never engaged
const OWN_OLD = "e0000000-0000-4000-8000-000000000001"; // 40d ago — signal target only
const OWN1 = "e0000000-0000-4000-8000-000000000011"; // 1h ago — must never surface

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use("/api/discovery", discoveryRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discovery`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(DDL);
  testState.db = db;
});

async function seedBase() {
  const db = testState.db;
  const profiles: Array<[string, string, string, string]> = [
    [PROF_A, VIEWER2, "aria", "Aria Followed"],
    [PROF_B, OTHER, "boring", "Boring Followed"],
    [PROF_C, OTHER, "cara", "Cara Discovery"],
    [PROF_D, OTHER, "dan", "Dan Nobody"],
    [PROF_OWN, VIEWER, "mine", "My Own"],
  ];
  for (const [id, userId, slug, name] of profiles) {
    await db.execute(sql.raw(`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES ('${id}', '${userId}', '${slug}', '${name}')`));
  }
  const tracks: Array<[string, string, string, string, number]> = [
    [A_OLD[0]!, PROF_A, "A Old 1", "rock", 40 * DAY],
    [A_OLD[1]!, PROF_A, "A Old 2", "rock", 40 * DAY],
    [A_OLD[2]!, PROF_A, "A Old 3", "rock", 40 * DAY],
    [A1, PROF_A, "A Fresh", "rock", 1 * HOUR],
    [A2, PROF_A, "A Older", "rock", 30 * HOUR],
    [B1, PROF_B, "B Fresh", "jazz", 2 * HOUR],
    [C0, PROF_C, "C Old", "soul", 40 * DAY],
    [C1, PROF_C, "C Five", "soul", 5 * HOUR],
    [C2, PROF_C, "C Two", "soul", 2 * HOUR],
    [C3, PROF_C, "C Three", "soul", 3 * HOUR],
    [C4, PROF_C, "C Four", "soul", 4 * HOUR],
    [D1, PROF_D, "D Fresh", "pop", 1 * HOUR],
    [OWN_OLD, PROF_OWN, "Own Old", "rock", 40 * DAY],
    [OWN1, PROF_OWN, "Own Fresh", "rock", 1 * HOUR],
  ];
  for (const [id, profileId, title, genre, ageMs] of tracks) {
    await db.execute(sql.raw(`INSERT INTO profile_tracks (id, profile_id, title, genre, created_at) VALUES ('${id}', '${profileId}', '${title}', '${genre}', '${ago(ageMs)}'::timestamptz)`));
  }
  const follows: Array<[string, string]> = [
    [VIEWER, PROF_A], [VIEWER, PROF_B],
    [COLD, PROF_A], [COLD, PROF_B],
    [VIEWER2, PROF_A],
  ];
  for (const [userId, profileId] of follows) {
    await db.execute(sql.raw(`INSERT INTO follows (follower_user_id, profile_id) VALUES ('${userId}', '${profileId}')`));
  }
}

/** VIEWER's engagement: Aria affinity 29 (10 plays · 5 likes · 3 saves
 *  on her old tracks), Cara affinity 4 (4 plays), own-profile plays 5.
 *  Boring and Dan: nothing — that's the point. */
async function seedViewerSignals() {
  const db = testState.db;
  for (let i = 0; i < 10; i++) {
    await db.execute(sql.raw(`INSERT INTO play_events (id, kind, media_id, user_id) VALUES ('${randomUUID()}', 'track', '${A_OLD[i % 3]}', '${VIEWER}')`));
  }
  for (const t of [A_OLD[0]!, A_OLD[1]!, A_OLD[2]!, A1, A2]) {
    await db.execute(sql.raw(`INSERT INTO likes (user_id, kind, target_id) VALUES ('${VIEWER}', 'track', '${t}')`));
  }
  for (const t of A_OLD) {
    await db.execute(sql.raw(`INSERT INTO saves (user_id, kind, target_id) VALUES ('${VIEWER}', 'track', '${t}')`));
  }
  for (let i = 0; i < 4; i++) {
    await db.execute(sql.raw(`INSERT INTO play_events (id, kind, media_id, user_id) VALUES ('${randomUUID()}', 'track', '${C0}', '${VIEWER}')`));
  }
  for (let i = 0; i < 5; i++) {
    await db.execute(sql.raw(`INSERT INTO play_events (id, kind, media_id, user_id) VALUES ('${randomUUID()}', 'track', '${OWN_OLD}', '${VIEWER}')`));
  }
}

async function seedPlaysOnCara(userId: string, n: number) {
  const db = testState.db;
  for (let i = 0; i < n; i++) {
    await db.execute(sql.raw(`INSERT INTO play_events (id, kind, media_id, user_id) VALUES ('${randomUUID()}', 'track', '${C0}', '${userId}')`));
  }
}

async function call(method: string, path: string, user: string | null, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
const getFeed = (user: string, q = "") => call("GET", `/feed${q}`, user);
const idsOf = (json: any) => (json.items as any[]).map((i) => i.id);

const LEGACY_ITEM_KEYS = [
  "avatar_url", "created_at", "display_name", "follower_count", "genre", "id",
  "kind", "like_count", "profile_id", "slug", "thumb", "title", "total_plays",
  "vertical", "window_plays",
];

describe("GET /feed — For-You v1", () => {
  it("ON + signals: affinity re-orders the backbone, discovery surfaces labeled, why only where earned", async () => {
    await seedBase();
    await seedViewerSignals();
    const { status, json } = await getFeed(VIEWER);
    expect(status).toBe(200);
    expect(json.forYou).toBe(true);
    expect(json.following).toBe(2);
    /* A2 (30h old, beloved creator) climbs over B1 (2h old, untouched
       creator); Cara's drops follow, freshest first. */
    expect(idsOf(json)).toEqual([A1, A2, B1, C2, C3, C4, C1]);
    const byId = new Map((json.items as any[]).map((i) => [i.id, i]));
    expect(byId.get(A1).source).toBe("following");
    expect(byId.get(A1).why).toBeUndefined(); // first by recency anyway — nothing to explain
    expect(byId.get(B1).why).toBeUndefined(); // never engaged, sat in its recency place
    expect(byId.get(A2).source).toBe("following");
    expect(byId.get(A2).why).toEqual({
      kind: "affinity-creator",
      label: "Because you like Aria Followed's drops",
    });
    for (const cid of [C1, C2, C3, C4]) {
      expect(byId.get(cid).source).toBe("discovery");
      expect(byId.get(cid).why).toEqual({
        kind: "affinity-creator",
        label: "Because you play Cara Discovery",
      });
    }
    /* Never engaged → never surfaced. Own drops → never discovery. */
    expect(byId.has(D1)).toBe(false);
    expect(byId.has(OWN1)).toBe(false);
  });

  it("OFF: the legacy wire, byte-identical in shape and order", async () => {
    await seedBase();
    await seedViewerSignals();
    const patch = await call("PATCH", "/feed/prefs", VIEWER, { forYouEnabled: false });
    expect(patch.status).toBe(200);
    expect(patch.json).toEqual({ forYouEnabled: false });
    const { status, json } = await getFeed(VIEWER);
    expect(status).toBe(200);
    expect(json).not.toHaveProperty("forYou");
    expect(json.following).toBe(2);
    expect(idsOf(json)).toEqual([A1, B1, A2]); // pure recency, followed only
    for (const item of json.items as any[]) {
      expect(Object.keys(item).sort()).toEqual(LEGACY_ITEM_KEYS);
    }
  });

  it("COLD START: zero signals = the legacy wire even with For-You on and no pref row", async () => {
    await seedBase();
    const { status, json } = await getFeed(COLD);
    expect(status).toBe(200);
    expect(json).not.toHaveProperty("forYou");
    expect(json.following).toBe(2);
    expect(idsOf(json)).toEqual([A1, B1, A2]);
    for (const item of json.items as any[]) {
      expect(Object.keys(item).sort()).toEqual(LEGACY_ITEM_KEYS);
    }
  });

  it("discovery stays within its bounded share of the returned list", async () => {
    await seedBase();
    await seedPlaysOnCara(VIEWER2, 4); // Cara affinity 4, Aria affinity 0
    const { status, json } = await getFeed(VIEWER2, "?limit=4");
    expect(status).toBe(200);
    expect(json.forYou).toBe(true);
    const items = json.items as any[];
    /* Without the cap this would be A1, A2 + all four Cara drops = 6
       candidates → limit 4 with 3 discovery. Cap floor(4 × 0.25) = 1. */
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.source === "discovery")).toHaveLength(1);
    expect(idsOf(json)).toEqual([A1, A2, C2]);
  });

  it("a member who follows nobody but engages still gets a labeled discovery wire", async () => {
    await seedBase();
    await seedPlaysOnCara(LONE, 4);
    const { status, json } = await getFeed(LONE);
    expect(status).toBe(200);
    expect(json.following).toBe(0);
    expect(json.forYou).toBe(true);
    expect(idsOf(json)).toEqual([C2, C3, C4, C1]);
    for (const item of json.items as any[]) {
      expect(item.source).toBe("discovery");
      expect(item.why).toEqual({ kind: "affinity-creator", label: "Because you play Cara Discovery" });
    }
  });

  it("no follows and no signals: the legacy empty answer, unchanged", async () => {
    await seedBase();
    const { status, json } = await getFeed(OTHER);
    expect(status).toBe(200);
    expect(json).toEqual({ items: [], following: 0 });
  });
});

describe("/feed/prefs — the explicit on/off", () => {
  it("defaults ON with no row, flips and persists on PATCH", async () => {
    await seedBase();
    expect((await call("GET", "/feed/prefs", VIEWER)).json).toEqual({ forYouEnabled: true });
    expect((await call("PATCH", "/feed/prefs", VIEWER, { forYouEnabled: false })).json).toEqual({ forYouEnabled: false });
    expect((await call("GET", "/feed/prefs", VIEWER)).json).toEqual({ forYouEnabled: false });
    expect((await call("PATCH", "/feed/prefs", VIEWER, { forYouEnabled: true })).json).toEqual({ forYouEnabled: true });
    expect((await call("GET", "/feed/prefs", VIEWER)).json).toEqual({ forYouEnabled: true });
  });

  it("is owner-scoped: one member's toggle never touches another's", async () => {
    await seedBase();
    await call("PATCH", "/feed/prefs", OTHER, { forYouEnabled: false });
    expect((await call("GET", "/feed/prefs", OTHER)).json).toEqual({ forYouEnabled: false });
    expect((await call("GET", "/feed/prefs", VIEWER)).json).toEqual({ forYouEnabled: true });
  });

  it("rejects a non-boolean body with a 400, and the unauthenticated with 401", async () => {
    await seedBase();
    const bad = await call("PATCH", "/feed/prefs", VIEWER, { forYouEnabled: "yes" });
    expect(bad.status).toBe(400);
    expect((await call("GET", "/feed/prefs", null)).status).toBe(401);
    expect((await call("PATCH", "/feed/prefs", null, { forYouEnabled: false })).status).toBe(401);
    expect((await call("GET", "/feed", null)).status).toBe(401);
  });
});
