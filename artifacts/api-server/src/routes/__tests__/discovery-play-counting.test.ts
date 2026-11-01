/**
 * Route tests for POST /api/discovery/play + the fixed-span boards
 * (routes/discovery) — the charts' input integrity at the discovery
 * door, and honest parameter handling (stack1100 X3).
 *
 * THE DISEASE: this door counted EVERY post — at its own 120/min
 * limiter, one address could mint 7,200 chart plays an hour. It also
 * inserted the play_events row for ANY uuid: plays of nonexistent or
 * unpublished media sat in the table as phantom rows, ready to chart
 * the moment the media published inside the window. The owner's plays
 * of their own upload counted toward their own chart position. And
 * nothing on this router ever stamped the caller's identity, so
 * play_events.user_id was always NULL here.
 *
 * THE PINS: a burst from one source counts ONCE (lib/play-counting's
 * gap) across all three chart inputs at once — play_events row,
 * counter column, profile total_plays — and the This Week chart
 * itself reads the capped number; distinct signed-in listeners each
 * count; the owner's self-play never counts; unpublished and
 * nonexistent media record NOTHING. Every one of these assertions
 * fails against the pre-fix handler, which counted every post and
 * inserted unconditionally.
 *
 * Also pinned: the fixed-span boards (/rising = 7 days,
 * /rising-earners = 30 days, /brands = no window) refuse a valid
 * ?days= out loud (400 with the board's real span) instead of the
 * old silent ignore, and do NOT refuse a bare request. (The bare
 * boards' 200 itself is not asserted here: their payloads carry
 * R1's correlated EXISTS (has_sales), whose outer-alias reference
 * pg-mem cannot resolve — probed and isolated; real Postgres
 * serves these boards live. The rejection happens before any SQL,
 * so the 400 pins are full-fidelity.)
 *
 * Real router over pg-mem: real SQL, so the windowed chart
 * aggregate is exercised, not simulated. (pg-mem's GROUP BY
 * nulls non-grouped columns in the returned rows, so the chart
 * assertion pins the aggregate count, not the row shape — the
 * fake-db charts suite pins shapes.) Caller identity rides an
 * x-test-user header that the mocked resolveOptionalSession stamps —
 * the same stamp the door's optionalAuth leaves when a real session
 * rides along (it never gates; guests stay guests).
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
vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const u = req.headers["x-test-user"];
    if (u) req.userId = String(u);
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
import { __resetPlayCounterForTests } from "../../lib/play-counting";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL, avatar_url text, vertical text NOT NULL DEFAULT 'music', bio text, follower_count integer NOT NULL DEFAULT 0, total_plays integer NOT NULL DEFAULT 0, is_public boolean NOT NULL DEFAULT true);
CREATE TABLE profile_tracks (id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, genre text, artwork_url text, audio_url text, play_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0, repost_count integer NOT NULL DEFAULT 0, duration_sec integer, is_published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE profile_videos (id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, genre text, thumbnail_url text, video_url text, view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0, duration_sec integer, is_published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE play_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, media_id uuid NOT NULL, user_id uuid, source text, played_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE digital_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
`;

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const FAN_A = "00000000-0000-4000-8000-0000000000bb";
const FAN_B = "00000000-0000-4000-8000-0000000000cc";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_TRACK_ID = "23232323-2323-4232-8232-232323232323";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";

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
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  mem.public.none(DDL);
  testState.db = db;
  __resetPlayCounterForTests();
});

async function seedBase() {
  const db = testState.db;
  await db.execute(sql.raw(`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES ('${PROFILE_ID}', '${OWNER}', 'aria', 'Aria')`));
  await db.execute(sql.raw(`INSERT INTO profile_tracks (id, profile_id, title, genre, audio_url) VALUES ('${TRACK_ID}', '${PROFILE_ID}', 'Hit', 'rock', 'https://x/hit.mp3')`));
  await db.execute(sql.raw(`INSERT INTO profile_tracks (id, profile_id, title, genre, is_published) VALUES ('${DRAFT_TRACK_ID}', '${PROFILE_ID}', 'Draft', 'rock', false)`));
  await db.execute(sql.raw(`INSERT INTO profile_videos (id, profile_id, title, genre, video_url) VALUES ('${VIDEO_ID}', '${PROFILE_ID}', 'Clip', 'rock', 'https://x/clip.mp4')`));
}

async function post(path: string, user: string | null, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
const play = (user: string | null, kind: string, mediaId: string) => post("/play", user, { kind, mediaId });

async function counts() {
  const db = testState.db;
  const events = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM play_events`))).rows[0] as { n: number };
  const track = (await db.execute(sql.raw(`SELECT play_count FROM profile_tracks WHERE id = '${TRACK_ID}'`))).rows[0] as { play_count: number };
  const video = (await db.execute(sql.raw(`SELECT view_count FROM profile_videos WHERE id = '${VIDEO_ID}'`))).rows[0] as { view_count: number };
  const profile = (await db.execute(sql.raw(`SELECT total_plays FROM creator_profiles WHERE id = '${PROFILE_ID}'`))).rows[0] as { total_plays: number };
  return { events: events.n, trackPlays: track.play_count, videoViews: video.view_count, totalPlays: profile.total_plays };
}

describe("POST /play — one source cannot mint a chart", () => {
  it("a guest burst of 15 counts once across every chart input, and the week chart reads 1", async () => {
    await seedBase();
    const results: any[] = [];
    for (let i = 0; i < 15; i++) results.push((await play(null, "track", TRACK_ID)).json);
    expect(results[0]).toEqual({ ok: true, counted: true });
    for (const r of results.slice(1)) expect(r).toEqual({ ok: true, counted: false });
    expect(await counts()).toEqual({ events: 1, trackPlays: 1, videoViews: 0, totalPlays: 1 });

    const chart = await get("/charts/tracks?window=week");
    expect(chart.status).toBe(200);
    /* The manipulation pin is the aggregate itself: 1, not 15.
       (Row identity under GROUP BY is a pg-mem artifact — it
       nulls non-grouped columns; the fake-db charts suite pins
       the real row shapes.) */
    expect(chart.json.tracks).toHaveLength(1);
    expect((chart.json.tracks as any[])[0].window_plays).toBe(1);
  });

  it("distinct signed-in listeners each count — identity is stamped, not shared-IP paced", async () => {
    await seedBase();
    expect((await play(FAN_A, "track", TRACK_ID)).json).toEqual({ ok: true, counted: true });
    expect((await play(FAN_B, "track", TRACK_ID)).json).toEqual({ ok: true, counted: true });
    expect(await counts()).toEqual({ events: 2, trackPlays: 2, videoViews: 0, totalPlays: 2 });
    const rows = (await testState.db.execute(sql.raw(`SELECT user_id FROM play_events ORDER BY user_id`))).rows as Array<{ user_id: string }>;
    expect(rows.map((r) => r.user_id)).toEqual([FAN_A, FAN_B].sort());
  });

  it("a second source still counts after the first source's burst", async () => {
    await seedBase();
    for (let i = 0; i < 5; i++) await play(null, "track", TRACK_ID);
    expect((await play(FAN_A, "track", TRACK_ID)).json).toEqual({ ok: true, counted: true });
    expect(await counts()).toEqual({ events: 2, trackPlays: 2, videoViews: 0, totalPlays: 2 });
  });

  it("the owner's self-play never counts", async () => {
    await seedBase();
    for (let i = 0; i < 3; i++) {
      expect((await play(OWNER, "track", TRACK_ID)).json).toEqual({ ok: true, counted: false });
    }
    expect(await counts()).toEqual({ events: 0, trackPlays: 0, videoViews: 0, totalPlays: 0 });
  });

  it("unpublished media records nothing — no pre-inflated debut", async () => {
    await seedBase();
    expect((await play(FAN_A, "track", DRAFT_TRACK_ID)).json).toEqual({ ok: true, counted: false });
    expect(await counts()).toEqual({ events: 0, trackPlays: 0, videoViews: 0, totalPlays: 0 });
  });

  it("nonexistent media records nothing — no phantom row waiting to chart", async () => {
    await seedBase();
    expect((await play(FAN_A, "track", MISSING_ID)).json).toEqual({ ok: true, counted: false });
    expect(await counts()).toEqual({ events: 0, trackPlays: 0, videoViews: 0, totalPlays: 0 });
  });

  it("the video twin paces identically: a burst of 5 counts once", async () => {
    await seedBase();
    const results: any[] = [];
    for (let i = 0; i < 5; i++) results.push((await play(null, "video", VIDEO_ID)).json);
    expect(results[0]).toEqual({ ok: true, counted: true });
    for (const r of results.slice(1)) expect(r).toEqual({ ok: true, counted: false });
    expect(await counts()).toEqual({ events: 1, trackPlays: 0, videoViews: 1, totalPlays: 1 });
  });
});

describe("fixed-span boards refuse ?days= out loud", () => {
  it("/rising?days=30 answers 400 naming its real 7-day span; a bare request is not refused", async () => {
    await seedBase();
    const bad = await get("/rising?days=30");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("last 7 days");
    const bare = await get("/rising");
    expect(bare.json?.error ?? "").not.toContain("days doesn't apply");
  });

  it("/rising-earners?days=7 answers 400 naming its real 30-day span; a bare request is not refused", async () => {
    await seedBase();
    const bad = await get("/rising-earners?days=7");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("last 30 days");
    const bare = await get("/rising-earners");
    expect(bare.json?.error ?? "").not.toContain("days doesn't apply");
  });

  it("/brands?days=7 answers 400 naming that it has no window; a bare request is not refused", async () => {
    await seedBase();
    const bad = await get("/brands?days=7");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain("no time window");
    const bare = await get("/brands");
    expect(bare.json?.error ?? "").not.toContain("days doesn't apply");
  });
});
