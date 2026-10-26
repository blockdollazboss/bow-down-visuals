/**
 * Route tests for Local Scenes (Stack-200 N10, routes/scenes) — the
 * honesty contract, exercised end to end over a fake db that answers
 * db.execute the way Postgres would over the seeds below:
 *
 * - A city with no declared-location creators gets NO scene page (404)
 *   and NO directory entry — even when real shows exist there.
 * - Scene creators are exactly the public profiles that DECLARED the
 *   city (undeclared + private profiles never appear).
 * - Scene shows are real tour_dates rows only: cancelled, past, and
 *   private-owner shows are excluded, tour notes never ship, and
 *   nothing else (Show Finder suggestions have no rows and are never
 *   read) can appear.
 * - The scene chart EQUALS the main chart's counting for the same
 *   tracks: scenes call discovery's own topTracks/topVideos scoped to
 *   the city's creators, so per-track window_plays / play_count match
 *   /api/discovery/charts exactly.
 * - Pre-migration (declared_city missing, 42703): reads degrade —
 *   directory answers an empty list, a city page the honest 404.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const NY_A = "11111111-1111-4111-8111-111111111111";
const NY_B = "12121212-1212-4212-8212-121212121212";
const ATL_A = "13131313-1313-4313-8313-131313131313";
const PRIV_NY = "14141414-1414-4414-8414-141414141414";

const T_NY1 = "22222222-2222-4222-8222-222222222222";
const T_NY2 = "23232323-2323-4232-8232-232323232323";
const T_ATL = "24242424-2424-4242-8242-242424242424";
const V_NY1 = "33333333-3333-4333-8333-333333333333";
const V_ATL = "34343434-3434-4343-8343-343434343434";

const SHOW_NY = "44444444-4444-4444-8444-444444444444";
const SHOW_NY_CANCELLED = "45454545-4545-4545-8545-454545454545";
const SHOW_NY_PAST = "46464646-4646-4646-8646-464646464646";
const SHOW_CHICAGO = "47474747-4747-4747-8747-474747474747";
const SHOW_PRIVATE = "48484848-4848-4848-8848-484848484848";

const dialect = new PgDialect();

/* ─── Seeds ─────────────────────────────────────────────────────────── */

const PROFILES = [
  { id: NY_A, slug: "nova-york", display_name: "Nova York", avatar_url: null, vertical: "music", follower_count: 100, total_plays: 5000, declared_city: "New York, NY", is_public: true, user_id: "u-nya" },
  { id: NY_B, slug: "bk-poet", display_name: "BK Poet", avatar_url: null, vertical: "music", follower_count: 10, total_plays: 300, declared_city: "new york", is_public: true, user_id: "u-nyb" },
  { id: ATL_A, slug: "peach-state", display_name: "Peach State", avatar_url: null, vertical: "music", follower_count: 50, total_plays: 2000, declared_city: "Atlanta, GA", is_public: true, user_id: "u-atl" },
  { id: PRIV_NY, slug: "hidden-ny", display_name: "Hidden NY", avatar_url: null, vertical: "music", follower_count: 1, total_plays: 10, declared_city: "New York", is_public: false, user_id: "u-priv" },
];

const TRACKS = [
  { id: T_NY1, profile: NY_A, title: "Empire", play_count: 900, events: [2, 5, 480] },
  { id: T_NY2, profile: NY_B, title: "Borough", play_count: 40, events: [1, 2, 3, 4] },
  { id: T_ATL, profile: ATL_A, title: "Peachtree", play_count: 700, events: [1, 1, 1, 1, 1] },
];

const VIDEOS = [
  { id: V_NY1, profile: NY_A, title: "Rooftop session", view_count: 500, events: [5, 100] },
  { id: V_ATL, profile: ATL_A, title: "Studio diary", view_count: 60, events: [1, 2, 3] },
];

const DAY_MS = 86_400_000;
const SHOWS = [
  { id: SHOW_NY, city: "New York, NY", venue: "The Loft", show_date: new Date(Date.now() + 3 * DAY_MS).toISOString(), status: "confirmed", owner: NY_A, notes: "promoter cell 555-0100" },
  { id: SHOW_NY_CANCELLED, city: "New York", venue: "Old Hall", show_date: new Date(Date.now() + 5 * DAY_MS).toISOString(), status: "cancelled", owner: NY_A, notes: null },
  { id: SHOW_NY_PAST, city: "New York", venue: "Basement", show_date: new Date(Date.now() - 10 * DAY_MS).toISOString(), status: "confirmed", owner: NY_B, notes: null },
  { id: SHOW_CHICAGO, city: "Chicago, IL", venue: "Metro", show_date: new Date(Date.now() + 2 * DAY_MS).toISOString(), status: "upcoming", owner: ATL_A, notes: null },
  { id: SHOW_PRIVATE, city: "New York", venue: "Secret Spot", show_date: new Date(Date.now() + 4 * DAY_MS).toISOString(), status: "confirmed", owner: PRIV_NY, notes: null },
];

const profileLite = (id: string) => {
  const p = PROFILES.find((x) => x.id === id)!;
  return { profile_id: p.id, slug: p.slug, display_name: p.display_name, avatar_url: p.avatar_url, vertical: p.vertical, follower_count: p.follower_count, total_plays: p.total_plays };
};

const inWindow = (ages: number[], days: number) => ages.filter((h) => h <= days * 24).length;
function intervalDays(text: string): number {
  const m = /INTERVAL '(\d+) days?'/.exec(text);
  return m ? Number(m[1]) : 0;
}
/* Scoped chart queries carry the profile ids as string params. */
const scopeOf = (params: unknown[]): Set<string> | null =>
  params.some((p) => typeof p === "string") ? new Set(params.filter((p): p is string => typeof p === "string")) : null;

let missingSchema = false;
const seenSql: string[] = [];

function rowsForQuery(text: string, params: unknown[]): Record<string, unknown>[] {
  if (missingSchema && text.includes("declared_city")) {
    const err = new Error('column "declared_city" does not exist') as Error & { code?: string };
    err.code = "42703";
    throw err;
  }
  /* Directory: declared cities grouped raw. */
  if (text.includes("GROUP BY declared_city")) {
    const counts = new Map<string, number>();
    for (const p of PROFILES) {
      if (!p.is_public || !p.declared_city || p.declared_city.trim() === "") continue;
      counts.set(p.declared_city, (counts.get(p.declared_city) ?? 0) + 1);
    }
    return [...counts.entries()].map(([declared_city, creator_count]) => ({ declared_city, creator_count }));
  }
  /* Directory: show counts grouped by raw city (SQL filters applied). */
  if (text.includes("FROM tour_dates") && text.includes("GROUP BY td.city")) {
    const counts = new Map<string, number>();
    for (const s of liveShows()) counts.set(s.city, (counts.get(s.city) ?? 0) + 1);
    return [...counts.entries()].map(([city, show_count]) => ({ city, show_count }));
  }
  /* Scene page: raw show rows (SQL filters applied by liveShows). */
  if (text.includes("FROM tour_dates")) {
    return liveShows().map((s) => ({
      id: s.id, city: s.city, venue: s.venue, show_date: s.show_date, status: s.status,
      ...profileLite(s.owner),
    }));
  }
  /* Scene page: declared creators (SQL: public + declared, plays desc). */
  if (text.includes("FROM creator_profiles") && text.includes("declared_city")) {
    return PROFILES
      .filter((p) => p.is_public && p.declared_city && p.declared_city.trim() !== "")
      .sort((a, b) => b.total_plays - a.total_plays)
      .map((p) => ({ ...profileLite(p.id), declared_city: p.declared_city }));
  }
  /* Charts (discovery topTracks/topVideos), scope-aware. */
  const scope = scopeOf(params);
  const days = intervalDays(text);
  if (text.includes("FROM play_events") && text.includes("profile_tracks")) {
    return TRACKS
      .filter((t) => !scope || scope.has(t.profile))
      .map((t) => ({ seed: t, n: inWindow(t.events, days) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((r) => trackRow(r.seed, r.n));
  }
  if (text.includes("FROM play_events") && text.includes("profile_videos")) {
    return VIDEOS
      .filter((v) => !scope || scope.has(v.profile))
      .map((v) => ({ seed: v, n: inWindow(v.events, days) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((r) => videoRow(r.seed, r.n));
  }
  if (text.includes("FROM profile_tracks")) {
    return TRACKS
      .filter((t) => !scope || scope.has(t.profile))
      .sort((a, b) => b.play_count - a.play_count)
      .map((t) => trackRow(t));
  }
  if (text.includes("FROM profile_videos")) {
    return VIDEOS
      .filter((v) => !scope || scope.has(v.profile))
      .sort((a, b) => b.view_count - a.view_count)
      .map((v) => videoRow(v));
  }
  return [];
}

/* The SQL's own show filters, the way Postgres would apply them:
   public owner profile, upcoming/confirmed, not past the 1-day grace. */
function liveShows() {
  return SHOWS.filter((s) => {
    const owner = PROFILES.find((p) => p.id === s.owner)!;
    return owner.is_public
      && (s.status === "upcoming" || s.status === "confirmed")
      && Date.parse(s.show_date) >= Date.now() - DAY_MS;
  }).sort((a, b) => Date.parse(a.show_date) - Date.parse(b.show_date));
}

function trackRow(seed: (typeof TRACKS)[number], windowPlays?: number): Record<string, unknown> {
  return {
    id: seed.id, profile_id: seed.profile, title: seed.title, genre: "rock",
    artwork_url: "t.png", audio_url: "t.mp3", play_count: seed.play_count,
    like_count: 1, repost_count: 0, duration_sec: 100, created_at: "2026-10-01T00:00:00.000Z",
    ...profileLite(seed.profile),
    ...(windowPlays !== undefined ? { window_plays: windowPlays } : {}),
  };
}
function videoRow(seed: (typeof VIDEOS)[number], windowPlays?: number): Record<string, unknown> {
  return {
    id: seed.id, profile_id: seed.profile, title: seed.title, genre: "rock",
    thumbnail_url: "v.png", video_url: "v.mp4", view_count: seed.view_count,
    like_count: 2, duration_sec: 200, created_at: "2026-10-01T00:00:00.000Z",
    ...profileLite(seed.profile),
    ...(windowPlays !== undefined ? { window_plays: windowPlays } : {}),
  };
}

/* ─── Mocks (the discovery-charts-windows pattern) ─────────────────── */

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
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
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      seenSql.push(text);
      return { rows: rowsForQuery(text, params as unknown[]), rowCount: 0, command: "SELECT", fields: [], oid: 0 };
    },
  };
  return { ...actual, db: fakeDb };
});

import scenesRouter from "../scenes";
import discoveryRouter from "../discovery";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/discovery", discoveryRouter);
  app.use("/api/discovery", scenesRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discovery`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seenSql.length = 0;
  missingSchema = false;
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

/* ─── Directory ─────────────────────────────────────────────────────── */

describe("scene directory — only real declared cities", () => {
  it("lists New York first and Atlanta, with real counts; Chicago (shows, no creators) is absent", async () => {
    const { status, json } = await get("/scenes");
    expect(status).toBe(200);
    expect(json.cities.map((c: any) => c.slug)).toEqual(["new-york", "atlanta"]);
    expect(json.cities[0]).toMatchObject({ name: "New York", creator_count: 2, show_count: 1 });
    expect(json.cities[1]).toMatchObject({ name: "Atlanta", creator_count: 1, show_count: 0 });
  });
});

/* ─── City page ─────────────────────────────────────────────────────── */

describe("scene page — New York", () => {
  it("creators are exactly the public profiles that declared New York", async () => {
    const { status, json } = await get("/scenes/new-york");
    expect(status).toBe(200);
    expect(json.city).toMatchObject({ slug: "new-york", name: "New York" });
    expect(json.creators.map((c: any) => c.profile_id)).toEqual([NY_A, NY_B]);
    expect(json.counts.creators).toBe(2);
  });

  it("shows are real tour_dates rows only — cancelled, past and private-owner shows never appear; notes never ship", async () => {
    const { json } = await get("/scenes/new-york");
    expect(json.shows.map((s: any) => s.id)).toEqual([SHOW_NY]);
    expect(json.shows[0]).toMatchObject({ venue: "The Loft", slug: "nova-york" });
    expect(json.shows[0]).not.toHaveProperty("notes");
    expect(json.counts.shows).toBe(1);
    /* The only show source the route ever reads is tour_dates. */
    expect(seenSql.some((s) => s.includes("FROM tour_dates"))).toBe(true);
  });

  it("a bad window is the caller's 400, never a 500", async () => {
    const { status } = await get("/scenes/new-york?window=month");
    expect(status).toBe(400);
  });
});

describe("no fake scenes", () => {
  it("Chicago has a real show but no declared creators → 404, no page", async () => {
    const { status, json } = await get("/scenes/chicago");
    expect(status).toBe(404);
    expect(json.scene).toBeNull();
  });

  it("a city nobody declared → 404", async () => {
    const { status } = await get("/scenes/nowhere-city");
    expect(status).toBe(404);
  });
});

/* ─── Scene chart parity with the main charts ───────────────────────── */

describe("scene chart — the main charts' counting, scoped", () => {
  it("week window: per-track window_plays equal /charts/tracks exactly; Atlanta's track is absent", async () => {
    const scene = await get("/scenes/new-york?window=week");
    const main = await get("/charts/tracks?window=week");
    const mainById = new Map(main.json.tracks.map((t: any) => [t.id, t.window_plays]));
    expect(scene.json.chart.tracks.map((t: any) => t.id)).toEqual([T_NY2, T_NY1]);
    for (const t of scene.json.chart.tracks) {
      expect(t.window_plays).toBe(mainById.get(t.id));
    }
    expect(mainById.get(T_NY1)).toBe(2);
    expect(scene.json.chart.tracks.map((t: any) => t.id)).not.toContain(T_ATL);
  });

  it("all-time: play_count equals the main chart's counters; no window_plays is invented", async () => {
    const scene = await get("/scenes/new-york?window=all");
    const main = await get("/charts/tracks?window=all");
    const mainById = new Map(main.json.tracks.map((t: any) => [t.id, t.play_count]));
    expect(scene.json.chart.tracks.map((t: any) => t.id)).toEqual([T_NY1, T_NY2]);
    for (const t of scene.json.chart.tracks) {
      expect(t.play_count).toBe(mainById.get(t.id));
      expect(t).not.toHaveProperty("window_plays");
    }
    expect(scene.json.chart.videos.map((v: any) => v.id)).toEqual([V_NY1]);
  });

  it("the scoped chart SQL carries the profile scope — the same play_events aggregate, restricted", async () => {
    await get("/scenes/new-york?window=week");
    const chartSql = seenSql.find((s) => s.includes("FROM play_events") && s.includes("profile_tracks"))!;
    expect(chartSql).toContain("COUNT(*)");
    expect(chartSql).toContain("profile_id IN");
  });
});

/* ─── Pre-migration degradation ─────────────────────────────────────── */

describe("pre-migration (declared_city not landed yet)", () => {
  it("directory degrades to an honest empty list; city page to the no-scene 404", async () => {
    missingSchema = true;
    const dir = await get("/scenes");
    expect(dir.status).toBe(200);
    expect(dir.json.cities).toEqual([]);
    const page = await get("/scenes/new-york");
    expect(page.status).toBe(404);
    expect(page.json.scene).toBeNull();
  });
});
