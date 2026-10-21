/**
 * Route tests for the public profile media listing in routes/creator-platform:
 *   GET /api/creator-profiles/:slug/media?kind=track|video&limit=
 *
 * THE REGRESSION: the handler resolved its :slug param through a slug-only
 * lookup (eq(slug)), but its real streaming callers pass the profile UUID —
 * lib/streaming.ts fetchMoreFromArtist(profileId) is called with
 * res.track.profile_id (pages/stream/track.tsx) and res.video.profile_id
 * (pages/stream/watch.tsx). A UUID can never equal a slug, so every call
 * 404'd, fetchMoreFromArtist swallowed it into [], and the player pages'
 * "More from {artist}" / "Up next" sections never rendered.
 *
 * The handler must resolve through getProfileBySlugOrId (the same helper
 * the wall-comment and follow/unfollow handlers use): UUID-shaped input
 * resolves by id, anything else by slug — while preserving the handler's
 * 404 semantics (unknown or non-public profile) and response shape.
 *
 * These tests mount the real router over a fake db (style mirrors
 * creator-follow-unfollow.test.ts: real table objects via importOriginal,
 * WHERE params read back through PgDialect rendering) whose profile
 * lookup answers id lookups ONLY by UUID and slug lookups ONLY by slug,
 * the way Postgres behaves — a UUID reaching a slug lookup finds nothing.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_OWNER = "22222222-2222-4222-8222-222222222222";
const PROFILE_SLUG = "catalog-owner";
const OTHER_PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const TRACK_1 = "55555555-5555-4555-8555-555555555555";
const TRACK_2 = "66666666-6666-4666-8666-666666666666";
const TRACK_DRAFT = "77777777-7777-4777-8777-777777777777";
const TRACK_OTHER = "88888888-8888-4888-8888-888888888888";
const VIDEO_1 = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
}));

vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, profileTracksTable, profileVideosTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      // Slug lookup: select() with eq(slug) — answer by slug only.
      if (sql.includes('"slug"')) {
        const row = [...state.profilesById.values()].find(
          (p) => String(p["slug"]) === String(params[0] ?? ""),
        );
        return row ? [row] : [];
      }
      // getProfileById: select() with eq(id) — a slug finds nothing here,
      // exactly as a slug can never equal a UUID primary key.
      const row = state.profilesById.get(String(params[0] ?? ""));
      return row ? [row] : [];
    }
    if (table === profileTracksTable) {
      // and(eq(profileId, profile.id), eq(isPublished, true))
      return state.tracks.filter(
        (t) =>
          String(t["profileId"]) === String(params[0] ?? "") &&
          t["isPublished"] === true,
      );
    }
    if (table === profileVideosTable) {
      return state.videos.filter(
        (v) =>
          String(v["profileId"]) === String(params[0] ?? "") &&
          v["isPublished"] === true,
      );
    }
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    let limitN: number | null = null;
    const self: any = {
      limit: (n: number) => {
        limitN = n;
        return self;
      },
      offset: (_n: number) => self,
      orderBy: (..._args: unknown[]) => self,
      then: (res: any, rej: any) =>
        Promise.resolve(
          limitN === null ? rowsFor(table, cond) : rowsFor(table, cond).slice(0, limitN),
        ).then(res, rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
    execute: async () => [],
  };

  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function trackRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: TRACK_1,
    profileId: PROFILE_ID,
    title: "Midnight Gold",
    audioUrl: "/audio/midnight-gold.mp3",
    artworkUrl: "/images/midnight-gold.png",
    genre: "hip-hop",
    tags: [],
    durationSec: 187,
    downloadPriceCents: 0,
    playCount: 42,
    likeCount: 3,
    repostCount: 1,
    commentCount: 2,
    isPublished: true,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  const s = h.state;
  s.profilesById = new Map();
  s.tracks = [];
  s.videos = [];

  s.profilesById.set(PROFILE_ID, {
    id: PROFILE_ID,
    userId: PROFILE_OWNER,
    slug: PROFILE_SLUG,
    displayName: "Catalog Owner",
    isPublic: true,
  });

  s.tracks = [
    trackRow({}),
    trackRow({
      id: TRACK_2,
      title: "Second Tide",
      createdAt: new Date("2026-10-02T12:00:00.000Z"),
    }),
    trackRow({ id: TRACK_DRAFT, title: "Unreleased Draft", isPublished: false }),
    trackRow({ id: TRACK_OTHER, title: "Someone Else's Song", profileId: OTHER_PROFILE_ID }),
  ];

  s.videos = [
    {
      id: VIDEO_1,
      profileId: PROFILE_ID,
      title: "Golden Hour Session",
      videoUrl: "/videos/golden-hour.mp4",
      thumbnailUrl: "/images/golden-hour.png",
      description: "Live from the studio.",
      genre: "hip-hop",
      tags: [],
      durationSec: 240,
      downloadPriceCents: 0,
      viewCount: 99,
      likeCount: 5,
      repostCount: 0,
      commentCount: 1,
      isPublished: true,
      isShort: false,
      season: null,
      episode: null,
      soundTrackId: null,
      createdAt: new Date("2026-10-03T12:00:00.000Z"),
    },
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/creator-profiles/:id/media — the streaming caller's shape (UUID)", () => {
  it("lists the artist's published tracks BY UUID — fetchMoreFromArtist's call", async () => {
    const { status, json } = await get(
      `/creator-profiles/${PROFILE_ID}/media?kind=track&limit=9`,
    );

    expect(status).toBe(200);
    expect(json.items).toHaveLength(2);
    const titles = json.items.map((t: any) => t.title).sort();
    expect(titles).toEqual(["Midnight Gold", "Second Tide"]);
    const first = json.items.find((t: any) => t.id === TRACK_1);
    // The DTO the player pages consume (lib/streaming.ts).
    expect(first.profile_id).toBe(PROFILE_ID);
    expect(first.profile_slug).toBe(PROFILE_SLUG);
    expect(first.audio_url).toBe("/audio/midnight-gold.mp3");
    expect(first.play_count).toBe(42);
  });

  it("lists the artist's published videos BY UUID (watch page 'Up next')", async () => {
    const { status, json } = await get(
      `/creator-profiles/${PROFILE_ID}/media?kind=video&limit=11`,
    );

    expect(status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe(VIDEO_1);
    expect(json.items[0].title).toBe("Golden Hour Session");
    expect(json.items[0].profile_id).toBe(PROFILE_ID);
    expect(json.items[0].profile_slug).toBe(PROFILE_SLUG);
  });

  it("404s an unknown UUID, same as an unknown slug", async () => {
    const { status, json } = await get(
      "/creator-profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/media?kind=track",
    );
    expect(status).toBe(404);
    expect(json.error).toBe("No creator at that address.");
  });

  it("404s a non-public profile BY UUID, same as by slug", async () => {
    h.state.profilesById.get(PROFILE_ID)!["isPublic"] = false;
    const { status } = await get(`/creator-profiles/${PROFILE_ID}/media?kind=track`);
    expect(status).toBe(404);
  });
});

describe("GET /api/creator-profiles/:slug/media — by-slug regression", () => {
  it("lists the artist's published tracks BY SLUG, unchanged", async () => {
    const { status, json } = await get(
      `/creator-profiles/${PROFILE_SLUG}/media?kind=track&limit=9`,
    );

    expect(status).toBe(200);
    expect(json.items).toHaveLength(2);
    const titles = json.items.map((t: any) => t.title).sort();
    expect(titles).toEqual(["Midnight Gold", "Second Tide"]);
    const first = json.items.find((t: any) => t.id === TRACK_1);
    expect(first.profile_id).toBe(PROFILE_ID);
    expect(first.profile_slug).toBe(PROFILE_SLUG);
  });

  it("404s an unknown slug", async () => {
    const { status, json } = await get("/creator-profiles/no-such-creator/media");
    expect(status).toBe(404);
    expect(json.error).toBe("No creator at that address.");
  });
});
