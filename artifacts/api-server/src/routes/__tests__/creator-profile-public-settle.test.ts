/**
 * S27-38 — GET /api/creator-profiles/:slug per-source settle.
 *
 * The public profile used to run its aggregates (top tracks/videos/
 * playlists/counts, profileExtras, playlist resolution) unguarded in
 * the handler's one try/catch, so any auxiliary source failing 500'd
 * the whole profile. Now each settles on its own — the discipline the
 * same handler already applied to the recruiter badge, social proof,
 * resolvePaidPlan and the referral code — and the profile renders even
 * if EVERY auxiliary source fails.
 *
 * Fake-db style mirrors creator-profile-public.test.ts: rows are
 * decided by table + select fields + chain mode (list = orderBy->limit,
 * direct = awaited where-chain, limit = plain limit), and a fail switch
 * per source key makes exactly that source throw.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    fail: new Set<string>(),
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

const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "44444444-4444-4444-8444-444444444444";
const PLAYLIST_ID = "55555555-5555-4555-8555-555555555555";

function profileRow(): Record<string, unknown> {
  return {
    id: PROFILE_ID,
    userId: OWNER_ID,
    slug: "some-creator",
    displayName: "Some Creator",
    vertical: "music",
    streamSchedule: null,
    mediaKit: null,
    bio: "bio",
    avatarUrl: "/images/avatar.png",
    bannerUrl: "/images/banner.jpg",
    themeId: "gold-lux",
    themeConfig: null,
    sections: null,
    featuredMedia: null,
    merchItems: null,
    profileEvents: null,
    series: null,
    socialPosts: null,
    socialLinks: { website: "https://example.com" },
    topCreators: null,
    tipJarEnabled: true,
    pinnedKind: null,
    pinnedItemId: null,
    aiDesign: null,
    isPublic: true,
    isVerified: false,
    isOfficial: false,
    followerCount: 12,
    totalPlays: 0,
    createdAt: new Date("2026-10-12T00:00:00.000Z"),
    updatedAt: new Date("2026-10-12T00:00:00.000Z"),
  };
}

function trackRow(): Record<string, unknown> {
  return {
    id: TRACK_ID,
    profileId: PROFILE_ID,
    title: "Top Track",
    audioUrl: "/audio/top.mp3",
    artworkUrl: null,
    genre: "hip-hop",
    tags: [],
    durationSec: 120,
    downloadPriceCents: 500,
    playCount: 99,
    likeCount: 1,
    repostCount: 0,
    commentCount: 0,
    isPublished: true,
    soundTrackId: null,
    createdAt: new Date("2026-10-12T00:00:00.000Z"),
  };
}

function videoRow(): Record<string, unknown> {
  return {
    id: VIDEO_ID,
    profileId: PROFILE_ID,
    title: "Top Video",
    videoUrl: "/video/top.mp4",
    thumbnailUrl: null,
    description: null,
    genre: "music",
    tags: [],
    durationSec: 60,
    downloadPriceCents: 0,
    viewCount: 77,
    likeCount: 2,
    repostCount: 0,
    commentCount: 0,
    isPublished: true,
    isShort: false,
    season: null,
    episode: null,
    soundTrackId: null,
    createdAt: new Date("2026-10-12T00:00:00.000Z"),
  };
}

function playlistRow(): Record<string, unknown> {
  return {
    id: PLAYLIST_ID,
    ownerProfileId: PROFILE_ID,
    title: "Shelf",
    description: null,
    coverUrl: null,
    isPublic: true,
    kind: "playlist",
    items: [{ kind: "track", id: TRACK_ID }],
    followerCount: 0,
    priceCents: null,
    previewItem: null,
    createdAt: new Date("2026-10-12T00:00:00.000Z"),
  };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    playlistsTable,
    referralCodesTable,
    shopsTable,
  } = actual;

  function rowsFor(table: unknown, fields: unknown, cond: unknown, mode: string): unknown[] {
    const fail = h.state.fail;
    const keys =
      fields && typeof fields === "object" ? Object.keys(fields as Record<string, unknown>) : [];

    if (table === referralCodesTable) return [];
    if (table === shopsTable) {
      if (fail.has("shops")) throw new Error("shops source down");
      return [];
    }
    if (table === creatorProfilesTable) {
      if (mode === "limit") {
        const slug = String(render(cond).params[0] ?? "");
        return slug === "some-creator" ? [profileRow()] : [];
      }
      // profileCards + playlist item-artist lookups.
      return [profileRow()];
    }
    if (table === profileTracksTable) {
      if (keys.includes("trackCount")) {
        if (fail.has("counts")) throw new Error("counts source down");
        return [{ trackCount: 2 }];
      }
      if (keys.includes("price")) {
        if (fail.has("tracks:extras")) throw new Error("extras tracks down");
        return [{ price: 500 }];
      }
      if (mode === "list") {
        if (fail.has("tracks:list")) throw new Error("top tracks down");
        return [trackRow()];
      }
      // Direct awaited reads: playlist item resolution + sound lookups.
      if (fail.has("tracks:items")) throw new Error("playlist track items down");
      return [trackRow()];
    }
    if (table === profileVideosTable) {
      if (keys.includes("videoCount")) {
        if (fail.has("counts")) throw new Error("counts source down");
        return [{ videoCount: 1 }];
      }
      if (keys.includes("price")) {
        if (fail.has("videos:extras")) throw new Error("extras videos down");
        return [{ price: 0 }];
      }
      if (mode === "list") {
        if (fail.has("videos:list")) throw new Error("top videos down");
        return [videoRow()];
      }
      if (fail.has("videos:items")) throw new Error("playlist video items down");
      return [videoRow()];
    }
    if (table === playlistsTable) {
      if (keys.includes("playlistCount")) {
        if (fail.has("counts")) throw new Error("counts source down");
        return [{ playlistCount: 3 }];
      }
      if (mode === "list") {
        if (fail.has("playlists:list")) throw new Error("playlists down");
        return [playlistRow()];
      }
      return [playlistRow()];
    }
    // digitalSales + anything else: no rows.
    return [];
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, fields, cond, "limit"),
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, fields, cond, "list"),
              then: (res: any, rej: any) =>
                Promise.resolve().then(() => rowsFor(table, fields, cond, "list")).then(res, rej),
            }),
            then: (res: any, rej: any) =>
              Promise.resolve().then(() => rowsFor(table, fields, cond, "direct")).then(res, rej),
          };
          return chain;
        },
      }),
    }),
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
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {} };
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

beforeEach(() => {
  h.state.fail = new Set<string>();
});

async function getProfile() {
  const r = await realFetch(`${baseUrl}/creator-profiles/some-creator`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/creator-profiles/:slug — per-source settle (S27-38)", () => {
  it("serves the full payload when every source is healthy", async () => {
    const { status, json } = await getProfile();
    expect(status).toBe(200);
    expect(json.profile.slug).toBe("some-creator");
    expect(json.counts).toEqual({ tracks: 2, videos: 1, playlists: 3 });
    expect(json.top_tracks).toHaveLength(1);
    expect(json.top_tracks[0].title).toBe("Top Track");
    expect(json.top_videos).toHaveLength(1);
    expect(json.profile.monetization_checklist.has_price).toBe(true);
    expect(json.profile.has_downloads).toBe(true);
    expect(json.playlists).toHaveLength(1);
    expect(json.playlists[0].resolved_items).toHaveLength(1);
  });

  it("top-tracks failing empties only top_tracks — the profile still renders", async () => {
    h.state.fail.add("tracks:list");
    const { status, json } = await getProfile();
    expect(status).toBe(200);
    expect(json.profile.slug).toBe("some-creator");
    expect(json.top_tracks).toEqual([]);
    expect(json.top_videos).toHaveLength(1);
    expect(json.counts).toEqual({ tracks: 2, videos: 1, playlists: 3 });
  });

  it("counts failing degrades counts to zeros — the profile still renders", async () => {
    h.state.fail.add("counts");
    const { status, json } = await getProfile();
    expect(status).toBe(200);
    expect(json.profile.slug).toBe("some-creator");
    expect(json.counts).toEqual({ tracks: 0, videos: 0, playlists: 0 });
    expect(json.top_tracks).toHaveLength(1);
  });

  it("profileExtras sources failing degrade the extras flags, not the profile", async () => {
    h.state.fail.add("tracks:extras");
    h.state.fail.add("videos:extras");
    h.state.fail.add("shops");
    const { status, json } = await getProfile();
    expect(status).toBe(200);
    expect(json.profile.slug).toBe("some-creator");
    expect(json.profile.monetization_checklist.has_price).toBe(false);
    expect(json.profile.has_downloads).toBe(false);
    expect(json.profile.shop_handle).toBeNull();
    // Flags derived from the profile row itself still hold.
    expect(json.profile.has_social_links).toBe(true);
    expect(json.profile.monetization_checklist.has_tip_jar).toBe(true);
    expect(json.profile.monetization_checklist.has_audience).toBe(true);
  });

  it("playlist item resolution failing keeps the shelf, with no resolved items", async () => {
    h.state.fail.add("tracks:items");
    const { status, json } = await getProfile();
    expect(status).toBe(200);
    expect(json.profile.slug).toBe("some-creator");
    expect(json.playlists).toHaveLength(1);
    expect(json.playlists[0].title).toBe("Shelf");
    expect(json.playlists[0].resolved_items).toEqual([]);
  });

  it("the profile renders even when EVERY auxiliary source fails", async () => {
    for (const k of [
      "tracks:list", "videos:list", "playlists:list", "counts",
      "tracks:extras", "videos:extras", "shops", "tracks:items", "videos:items",
    ]) h.state.fail.add(k);
    const { status, json } = await getProfile();
    expect(status).toBe(200);
    expect(json.profile.slug).toBe("some-creator");
    expect(json.profile.is_public).toBe(true);
    expect(json.top_tracks).toEqual([]);
    expect(json.top_videos).toEqual([]);
    expect(json.playlists).toEqual([]);
    expect(json.counts).toEqual({ tracks: 0, videos: 0, playlists: 0 });
  });
});
