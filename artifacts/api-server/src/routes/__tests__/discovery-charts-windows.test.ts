/**
 * Route tests for the charts time windows (routes/discovery) —
 * the Ring 4 parity contract behind BOTH the website /charts page
 * and the in-world Charts board's window switcher.
 *
 * Pins:
 * - window=today|week|all are REAL server aggregates: the fake db
 *   below answers db.execute by reading the SQL the handler emitted
 *   and aggregating a seeded play_events log (event ages in hours)
 *   over the interval the SQL names — so per-window results differ
 *   exactly the way Postgres would differ them, and a window that
 *   secretly re-sliced the all-time counters would fail here.
 * - window=all rides the counter columns (no play_events in the
 *   SQL, no window_plays on the rows).
 * - days= (the advanced lookback, 1–90) overrides with its own
 *   interval.
 * - a bad window or days is the caller's error: 400, never the 500
 *   "Discovery hiccup" the old .parse() throw produced.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "12121212-1212-4212-8212-121212121212";
const TRACK_A = "22222222-2222-4222-8222-222222222222";
const TRACK_B = "23232323-2323-4232-8232-232323232323";
const TRACK_C = "24242424-2424-4242-8242-242424242424";
const VIDEO_A = "33333333-3333-4333-8333-333333333333";
const VIDEO_B = "34343434-3434-4343-8343-343434343434";

const dialect = new PgDialect();

/* ─── The seeded kingdom ─────────────────────────────────────────────
   Event ages are HOURS before "now". The three charts tell three
   different stories, on purpose:
   - Veteran (TRACK_A): the all-time king (900 plays) but quiet now.
   - Fresh (TRACK_B): small all-time, loud today.
   - Weekly (TRACK_C): silent today, owned the last week. */

const TRACK_SEEDS = [
  { id: TRACK_A, profile: PROFILE_A, title: "Veteran", play_count: 900, events: [2, 5, 480] },
  { id: TRACK_B, profile: PROFILE_B, title: "Fresh", play_count: 40, events: [1, 2, 3, 4, 5, 6, 7, 8, 9, 72, 72, 72] },
  { id: TRACK_C, profile: PROFILE_A, title: "Weekly", play_count: 300, events: Array.from({ length: 20 }, () => 96) },
];

const VIDEO_SEEDS = [
  { id: VIDEO_A, profile: PROFILE_A, title: "Old faithful", view_count: 500, events: [5, 100] },
  { id: VIDEO_B, profile: PROFILE_B, title: "New heat", view_count: 60, events: [1, 2, 3, 4, 5, 6, 7, 50] },
];

const CREATOR_SEEDS = [
  { id: PROFILE_A, display_name: "Steady", total_plays: 5000, follower_count: 100, events: [3, 3, 3, 100, 100, 100, 100, 100, 100, 100], follows: [] as number[] },
  { id: PROFILE_B, display_name: "Surging", total_plays: 100, follower_count: 10, events: [2, 2, 2, 2, 2, 2, 2, 2, 30], follows: [] as number[] },
];

const PROFILE_LITE: Record<string, Record<string, unknown>> = {
  [PROFILE_A]: { slug: "steady", display_name: "Steady", avatar_url: null, vertical: "music", follower_count: 100, total_plays: 5000 },
  [PROFILE_B]: { slug: "surging", display_name: "Surging", avatar_url: null, vertical: "music", follower_count: 10, total_plays: 100 },
};

const inWindow = (ages: number[], days: number) => ages.filter((h) => h <= days * 24).length;

function intervalDays(text: string): number {
  const m = /INTERVAL '(\d+) days?'/.exec(text);
  return m ? Number(m[1]) : 0;
}

function trackRow(seed: (typeof TRACK_SEEDS)[number], windowPlays?: number): Record<string, unknown> {
  return {
    id: seed.id,
    profile_id: seed.profile,
    title: seed.title,
    genre: "rock",
    artwork_url: "t.png",
    audio_url: "t.mp3",
    play_count: seed.play_count,
    like_count: 1,
    duration_sec: 100,
    created_at: "2026-10-01T00:00:00.000Z",
    ...PROFILE_LITE[seed.profile],
    ...(windowPlays !== undefined ? { window_plays: windowPlays } : {}),
  };
}

function videoRow(seed: (typeof VIDEO_SEEDS)[number], windowPlays?: number): Record<string, unknown> {
  return {
    id: seed.id,
    profile_id: seed.profile,
    title: seed.title,
    genre: "rock",
    thumbnail_url: "v.png",
    video_url: "v.mp4",
    view_count: seed.view_count,
    like_count: 2,
    duration_sec: 200,
    created_at: "2026-10-01T00:00:00.000Z",
    ...PROFILE_LITE[seed.profile],
    ...(windowPlays !== undefined ? { window_plays: windowPlays } : {}),
  };
}

function creatorRow(seed: (typeof CREATOR_SEEDS)[number], windowPlays?: number, newFollowers?: number): Record<string, unknown> {
  return {
    id: seed.id,
    profile_id: seed.id,
    ...PROFILE_LITE[seed.id],
    follower_count: seed.follower_count,
    total_plays: seed.total_plays,
    has_sales: false,
    month_earnings_cents: 0,
    bio: "",
    ...(windowPlays !== undefined ? { window_plays: windowPlays } : {}),
    ...(newFollowers !== undefined ? { new_followers: newFollowers } : {}),
  };
}

/* Answer a flattened SQL string the way Postgres would over the
   seeds: windowed queries aggregate events inside the SQL's own
   interval (an inner join — zero plays in window, no row); all-time
   queries order by the counter columns and carry no window_plays. */
const seenSql: string[] = [];

function rowsForQuery(text: string): Record<string, unknown>[] {
  const days = intervalDays(text);
  if (text.includes("track_plays AS")) {
    // Windowed creators: plays across both media kinds + new follows.
    return CREATOR_SEEDS.map((c) => ({
      seed: c,
      plays: inWindow(c.events, days),
      follows: inWindow(c.follows, days),
    }))
      .filter((r) => r.plays + r.follows > 0)
      .sort((a, b) => b.plays + b.follows * 50 - (a.plays + a.follows * 50))
      .map((r) => creatorRow(r.seed, r.plays, r.follows));
  }
  if (text.includes("FROM play_events") && text.includes("profile_tracks")) {
    return TRACK_SEEDS.map((t) => ({ seed: t, n: inWindow(t.events, days) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((r) => trackRow(r.seed, r.n));
  }
  if (text.includes("FROM play_events") && text.includes("profile_videos")) {
    return VIDEO_SEEDS.map((v) => ({ seed: v, n: inWindow(v.events, days) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((r) => videoRow(r.seed, r.n));
  }
  if (text.includes("FROM profile_tracks")) {
    return [...TRACK_SEEDS].sort((a, b) => b.play_count - a.play_count).map((t) => trackRow(t));
  }
  if (text.includes("FROM profile_videos")) {
    return [...VIDEO_SEEDS].sort((a, b) => b.view_count - a.view_count).map((v) => videoRow(v));
  }
  if (text.includes("FROM creator_profiles")) {
    return [...CREATOR_SEEDS]
      .sort((a, b) => b.total_plays + b.follower_count * 50 - (a.total_plays + a.follower_count * 50))
      .map((c) => creatorRow(c));
  }
  return [];
}

/* ─── Mocks (the discovery-dto.test.ts pattern) ───────────────────── */

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [],
    then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
  };
  const fakeDb: any = {
    select: () => ({ from: () => chain }),
    execute: async (q: unknown) => {
      const { sql: text } = dialect.sqlToQuery(q as never);
      seenSql.push(text);
      return { rows: rowsForQuery(text), rowCount: 0, command: "SELECT", fields: [], oid: 0 };
    },
  };
  return { ...actual, db: fakeDb };
});

import router from "../discovery";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/discovery", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discovery`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seenSql.length = 0;
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

/* ─── Per-window results actually differ ───────────────────────────── */

describe("charts windows — each window is its own server aggregate", () => {
  it("tracks: today crowns the fresh track, week the weekly one, all-time the veteran", async () => {
    const today = await get("/charts/tracks?window=today");
    expect(today.status).toBe(200);
    expect(today.json.window).toBe("today");
    expect(ids(today.json.tracks)).toEqual([TRACK_B, TRACK_A]);
    expect(today.json.tracks.map((t: any) => t.window_plays)).toEqual([9, 2]);
    // Weekly charted nothing today — an inner join on today's plays.
    expect(ids(today.json.tracks)).not.toContain(TRACK_C);

    const week = await get("/charts/tracks?window=week");
    expect(week.json.window).toBe("week");
    expect(ids(week.json.tracks)).toEqual([TRACK_C, TRACK_B, TRACK_A]);
    expect(week.json.tracks.map((t: any) => t.window_plays)).toEqual([20, 12, 2]);

    const all = await get("/charts/tracks?window=all");
    expect(all.json.window).toBe("all");
    expect(ids(all.json.tracks)).toEqual([TRACK_A, TRACK_C, TRACK_B]);
    expect(all.json.tracks.map((t: any) => t.play_count)).toEqual([900, 300, 40]);
    // The all-time read carries counters only — no window count to fake with.
    expect(all.json.tracks[0]).not.toHaveProperty("window_plays");
  });

  it("tracks: the SQL proves the mechanism — windowed aggregates play_events, all-time doesn't", async () => {
    await get("/charts/tracks?window=today");
    const windowed = seenSql.find((s) => s.includes("profile_tracks"))!;
    expect(windowed).toContain("play_events");
    expect(windowed).toContain("INTERVAL '1 day'");

    seenSql.length = 0;
    await get("/charts/tracks?window=all");
    const allTime = seenSql.find((s) => s.includes("profile_tracks"))!;
    expect(allTime).not.toContain("play_events");
    expect(allTime).toContain("ORDER BY t.play_count DESC");
  });

  it("videos: today flips the all-time order", async () => {
    const today = await get("/charts/videos?window=today");
    expect(ids(today.json.videos)).toEqual([VIDEO_B, VIDEO_A]);
    expect(today.json.videos.map((v: any) => v.window_plays)).toEqual([7, 1]);

    const all = await get("/charts/videos?window=all");
    expect(ids(all.json.videos)).toEqual([VIDEO_A, VIDEO_B]);
    expect(all.json.videos[0]).not.toHaveProperty("window_plays");
  });

  it("creators: today's board differs from the all-time board", async () => {
    const today = await get("/charts/creators?window=today");
    expect(ids(today.json.creators)).toEqual([PROFILE_B, PROFILE_A]);
    expect(today.json.creators.map((c: any) => c.window_plays)).toEqual([8, 3]);

    const week = await get("/charts/creators?window=week");
    expect(ids(week.json.creators)).toEqual([PROFILE_A, PROFILE_B]);
    expect(week.json.creators.map((c: any) => c.window_plays)).toEqual([10, 9]);

    const all = await get("/charts/creators?window=all");
    expect(ids(all.json.creators)).toEqual([PROFILE_A, PROFILE_B]);
    expect(all.json.creators[0]).not.toHaveProperty("window_plays");
  });

  it("the combined /charts read windows every family at once", async () => {
    const { status, json } = await get("/charts?window=today");
    expect(status).toBe(200);
    expect(json.window).toBe("today");
    expect(ids(json.tracks)).toEqual([TRACK_B, TRACK_A]);
    expect(ids(json.videos)).toEqual([VIDEO_B, VIDEO_A]);
    expect(ids(json.creators)).toEqual([PROFILE_B, PROFILE_A]);
  });

  it("no window param defaults to all-time", async () => {
    const { status, json } = await get("/charts/tracks");
    expect(status).toBe(200);
    expect(json.window).toBe("all");
    expect(ids(json.tracks)).toEqual([TRACK_A, TRACK_C, TRACK_B]);
  });

  it("days= (advanced lookback) aggregates over its own interval", async () => {
    const { status, json } = await get("/charts/tracks?days=30");
    expect(status).toBe(200);
    expect(ids(json.tracks)).toEqual([TRACK_C, TRACK_B, TRACK_A]);
    // Veteran's 20-day-old play joins at 30 days — it was invisible at week.
    expect(json.tracks.map((t: any) => t.window_plays)).toEqual([20, 12, 3]);
    const sql = seenSql.find((s) => s.includes("profile_tracks"))!;
    expect(sql).toContain("INTERVAL '30 days'");
  });

  it("days= overrides even an explicit window=all (the schema's contract)", async () => {
    // topTracks/topVideos used to take the all-time branch on
    // window=all alone and silently drop days — creators never did.
    const tracks = await get("/charts/tracks?window=all&days=30");
    expect(ids(tracks.json.tracks)).toEqual([TRACK_C, TRACK_B, TRACK_A]);
    expect(tracks.json.tracks.map((t: any) => t.window_plays)).toEqual([20, 12, 3]);

    const videos = await get("/charts/videos?window=all&days=30");
    expect(ids(videos.json.videos)).toEqual([VIDEO_B, VIDEO_A]);
    expect(videos.json.videos.map((v: any) => v.window_plays)).toEqual([8, 2]);
  });
});

/* ─── Bad params are 400, never 500 ────────────────────────────────── */

describe("charts windows — invalid params answer 400", () => {
  it.each([
    "/charts?window=month",
    "/charts/tracks?window=year",
    "/charts/videos?window=",
    "/charts/creators?window=ALL",
    "/charts/tracks?days=0",
    "/charts/tracks?days=91",
    "/charts/tracks?days=abc",
    "/charts?days=-3",
  ])("GET %s → 400 with the reason", async (path) => {
    const { status, json } = await get(path);
    expect(status).toBe(400);
    expect(json.error).toContain("window");
  });

  it("the shared query contract 400s on the sibling routes too", async () => {
    for (const path of ["/rising?window=nope", "/rising-earners?days=0", "/brands?window=decade"]) {
      const { status } = await get(path);
      expect(status).toBe(400);
    }
  });

  it("valid edge params still pass: days=1 and days=90", async () => {
    expect((await get("/charts/tracks?days=1")).status).toBe(200);
    expect((await get("/charts/tracks?days=90")).status).toBe(200);
    expect((await get("/charts/tracks?window=today&days=14")).status).toBe(200);
  });
});
