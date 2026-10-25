/**
 * Linkage Fix 1 (server half) — published work appears on the public
 * profile.
 *
 * Drives the REAL GET /api/creator-profiles/:slug handler (real
 * router, real enrichTrack / enrichVideo DTO mapping) over the house
 * fake-db harness — the style creator-profile-public.test.ts uses for
 * this builder-based router (pg-mem is reserved for raw-SQL surfaces:
 * drizzle builder queries carry rowMode, which pg-mem rejects).
 *
 * The fake serves seeded profile_tracks / profile_videos rows and
 * applies the handler's own semantics — published-only filtering,
 * play/view-count ordering, the top-5 limit, and published counts —
 * so what is asserted here is the endpoint's real output contract:
 * the payload fetchPublicProfile normalizes into the Grand Stage
 * Music / Videos blocks.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const EMPTY_PROFILE_ID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  state: {
    profilesBySlug: new Map<string, Record<string, unknown>>(),
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
    req.userId = OWNER;
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
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
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

/* Storage refresh simulated (the distribution.test.ts contract):
   refs become signed URLs; plain https passes through untouched. */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}
async function deepRefresh(v: unknown): Promise<unknown> {
  if (typeof v === "string") {
    return v.startsWith("r2://") || v.startsWith("supabase://") ? signedFor(v) : v;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => deepRefresh(x)));
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const entries = await Promise.all(
        Object.entries(v as Record<string, unknown>).map(
          async ([k, val]) => [k, await deepRefresh(val)] as const,
        ),
      );
      return Object.fromEntries(entries);
    }
  }
  return v;
}

vi.mock("../../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    refreshSupabaseStorageUrl: async (v: unknown) =>
      typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
        ? signedFor(v)
        : v,
    refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    playlistsTable,
    referralCodesTable,
    creatorSubscriptionsTable,
    creatorHostingTable,
    shopsTable,
  } = actual;

  const publishedTracks = (profileId: unknown) =>
    state.tracks
      .filter((t) => t["profileId"] === profileId && t["isPublished"] === true)
      .sort((a, b) => Number(b["playCount"]) - Number(a["playCount"]));
  const publishedVideos = (profileId: unknown) =>
    state.videos
      .filter((v) => v["profileId"] === profileId && v["isPublished"] === true)
      .sort((a, b) => Number(b["viewCount"]) - Number(a["viewCount"]));

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    const params = cond !== undefined ? render(cond).params : [];
    if (table === referralCodesTable) return [];
    if (table === creatorProfilesTable) {
      /* by slug (public GET) or by id (playlist item resolution) */
      const key = String(params[0] ?? "");
      const bySlug = state.profilesBySlug.get(key);
      if (bySlug) return [bySlug];
      const byId = [...state.profilesBySlug.values()].find((p) => p["id"] === key);
      return byId ? [byId] : [];
    }
    if (fields && typeof fields === "object") {
      const keys = Object.keys(fields as Record<string, unknown>);
      if (keys.includes("trackCount")) {
        return [{ trackCount: publishedTracks(params[0]).length }];
      }
      if (keys.includes("videoCount")) {
        return [{ videoCount: publishedVideos(params[0]).length }];
      }
      if (keys.includes("playlistCount")) return [{ playlistCount: 0 }];
    }
    if (table === profileTracksTable) return publishedTracks(params[0]);
    if (table === profileVideosTable) return publishedVideos(params[0]);
    /* playlists / shops / subscriptions / hosting: nothing seeded. */
    void playlistsTable;
    void creatorSubscriptionsTable;
    void creatorHostingTable;
    void shopsTable;
    return [];
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => rowsFor(table, fields, cond);
          const chain: any = {
            limit: async (n: number) => rows().slice(0, n),
            orderBy: (..._args: unknown[]) => ({
              limit: async (n: number) => rows().slice(0, n),
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    /* resolvePaidPlan's profiles probe — no paid plan in this fixture. */
    execute: async () => ({ rows: [] }),
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
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function profileRow(id: string, slug: string, displayName: string): Record<string, unknown> {
  return {
    id,
    userId: OWNER,
    slug,
    displayName,
    vertical: "music",
    streamSchedule: null,
    mediaKit: null,
    bio: "",
    avatarUrl: null,
    bannerUrl: null,
    themeId: "royal-gold",
    themeConfig: {},
    sections: [],
    layoutBlocks: [],
    pinnedKind: null,
    pinnedItemId: null,
    collectionVisibility: "public",
    featuredMedia: null,
    socialLinks: {},
    topCreators: [],
    tipJarEnabled: true,
    aiDesign: null,
    isPublic: true,
    isVerified: false,
    isOfficial: false,
    followerCount: 12,
    totalPlays: 340,
    stripeConnectAccountId: null,
    stripeConnectOnboarded: false,
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

function trackRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "track-x",
    profileId: PROFILE_ID,
    title: "Untitled",
    audioUrl: "https://cdn.example.com/audio/x.mp3",
    artworkUrl: null,
    genre: null,
    tags: [],
    isrc: null,
    durationSec: 0,
    downloadPriceCents: 0,
    pwywEnabled: false,
    pwywMinCents: 0,
    playCount: 0,
    likeCount: 0,
    repostCount: 0,
    commentCount: 0,
    isPublished: true,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function videoRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "video-x",
    profileId: PROFILE_ID,
    title: "Untitled",
    videoUrl: "https://cdn.example.com/video/x.mp4",
    thumbnailUrl: null,
    description: "",
    genre: null,
    tags: [],
    durationSec: 0,
    season: null,
    episode: null,
    soundTrackId: null,
    downloadPriceCents: 0,
    pwywEnabled: false,
    pwywMinCents: 0,
    viewCount: 0,
    likeCount: 0,
    repostCount: 0,
    commentCount: 0,
    isPublished: true,
    isShort: false,
    duetWith: null,
    stitchWith: null,
    soundId: null,
    soundTitle: null,
    soundUrl: null,
    soundUseCount: 0,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  h.state.profilesBySlug = new Map([
    ["queen-bee", profileRow(PROFILE_ID, "queen-bee", "Queen Bee")],
    ["quiet-one", profileRow(EMPTY_PROFILE_ID, "quiet-one", "Quiet One")],
  ]);
  h.state.tracks = [
    trackRow({
      id: "track-1",
      title: "Golden Hour",
      audioUrl: "https://cdn.example.com/audio/golden-hour.mp3",
      artworkUrl: "https://cdn.example.com/art/golden-hour.jpg",
      genre: "Soul",
      tags: ["warm"],
      durationSec: 204,
      playCount: 128,
      likeCount: 9,
    }),
    trackRow({
      id: "track-2",
      title: "Second Drop",
      audioUrl: "https://cdn.example.com/audio/second.mp3",
      durationSec: 60,
      playCount: 40,
    }),
    /* The most-played row of all — but unpublished. It must never
       reach the public payload. */
    trackRow({
      id: "track-secret",
      title: "Secret Draft",
      audioUrl: "https://cdn.example.com/audio/secret.mp3",
      playCount: 9999,
      isPublished: false,
    }),
  ];
  h.state.videos = [
    videoRow({
      id: "video-1",
      title: "Golden Hour (Visual)",
      videoUrl: "https://cdn.example.com/video/golden-hour.mp4",
      thumbnailUrl: "https://cdn.example.com/video/golden-hour.jpg",
      durationSec: 95,
      viewCount: 432,
    }),
    videoRow({
      id: "video-secret",
      title: "Unlisted Cut",
      videoUrl: "https://cdn.example.com/video/cut.mp4",
      viewCount: 7777,
      isPublished: false,
    }),
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/creator-profiles/:slug — the public catalog payload", () => {
  it("returns the creator's published tracks and videos as enriched top_tracks / top_videos", async () => {
    const { status, json } = await get("/creator-profiles/queen-bee");
    expect(status).toBe(200);

    /* Tracks: published only, most-played first, full client DTO. */
    expect(json.top_tracks).toHaveLength(2);
    expect(json.top_tracks.map((t: any) => t.title)).toEqual(["Golden Hour", "Second Drop"]);
    const [first] = json.top_tracks;
    expect(first.audio_url).toBe("https://cdn.example.com/audio/golden-hour.mp3");
    expect(first.artwork_url).toBe("https://cdn.example.com/art/golden-hour.jpg");
    expect(first.duration_sec).toBe(204);
    expect(first.play_count).toBe(128);
    expect(first.tags).toEqual(["warm"]);
    expect(first.profile_slug).toBe("queen-bee");
    expect(first.owner_user_id).toBe(OWNER);

    /* Videos: published only, full client DTO. */
    expect(json.top_videos).toHaveLength(1);
    expect(json.top_videos[0].title).toBe("Golden Hour (Visual)");
    expect(json.top_videos[0].video_url).toBe("https://cdn.example.com/video/golden-hour.mp4");
    expect(json.top_videos[0].thumbnail_url).toBe("https://cdn.example.com/video/golden-hour.jpg");
    expect(json.top_videos[0].view_count).toBe(432);

    /* Counts agree with the payload — header and blocks never tell
       two different stories. */
    expect(json.counts).toEqual({ tracks: 2, videos: 1, playlists: 0 });
    expect(json.profile.slug).toBe("queen-bee");
  });

  it("a creator with nothing published gets honest empty arrays", async () => {
    const { status, json } = await get("/creator-profiles/quiet-one");
    expect(status).toBe(200);
    expect(json.top_tracks).toEqual([]);
    expect(json.top_videos).toEqual([]);
    expect(json.counts).toEqual({ tracks: 0, videos: 0, playlists: 0 });
  });
});
