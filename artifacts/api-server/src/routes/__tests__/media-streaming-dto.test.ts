/**
 * Route tests for the streaming player payloads (routes/creator-platform):
 *
 *   GET /api/media/track/:id
 *   GET /api/media/video/:id
 *   GET /api/creator-profiles/:slug/media?kind=
 *   GET /api/playlists/:id
 *
 * THE REGRESSION (DTO hunt round 2, finding #1): enrichTrack/enrichVideo
 * spread the raw camelCase Drizzle row and added only profile_slug /
 * buyable / download_price_cents. The client contract (frontend
 * lib/streaming.ts StreamTrack/StreamVideo/StreamPlaylist) is snake_case
 * end to end and its fetchers do NO normalization — so audio_url /
 * video_url arrived undefined and the player pages rendered but could
 * not play anything: resolveMedia(track.audio_url) === "", artwork,
 * play_count, duration_sec, profile_id ("More from artist"), and
 * is_owner/owner_user_id (the Get-Paid finale) were all dead. Playlists
 * were worse: resolvePlaylistItems emitted resolved_items FLAT
 * {kind,id,title,...} while the client types them WRAPPED
 * {kind, item: StreamTrack} — playlist.tsx dereferences r.item.title
 * and crashed with a TypeError on any playlist with items.
 *
 * These tests mount the real router over a fake db (style mirrors
 * creator-profile-public.test.ts) and pin the full snake_case DTO
 * field set + values, the wrapped playlist items, and the absence of
 * camelCase leakage.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "44444444-4444-4444-8444-444444444444";
const PLAYLIST_ID = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
    playlists: [] as Array<Record<string, unknown>>,
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
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    playlistsTable,
  } = actual;

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    if (fields && typeof fields === "object") {
      const keys = Object.keys(fields as Record<string, unknown>);
      if (keys.includes("trackCount")) return [{ trackCount: 0 }];
      if (keys.includes("videoCount")) return [{ videoCount: 0 }];
      if (keys.includes("playlistCount")) return [{ playlistCount: 0 }];
    }
    const params = cond ? render(cond).params : [];
    if (table === creatorProfilesTable) {
      return state.profiles.filter(
        (p) => params.includes(p["id"]) || params.includes(p["slug"]),
      );
    }
    if (table === profileTracksTable) {
      const byId = state.tracks.filter((t) => params.includes(t["id"]));
      if (byId.length) return byId;
      return state.tracks.filter((t) => params.includes(t["profileId"]));
    }
    if (table === profileVideosTable) {
      const byId = state.videos.filter((v) => params.includes(v["id"]));
      if (byId.length) return byId;
      return state.videos.filter((v) => params.includes(v["profileId"]));
    }
    if (table === playlistsTable) {
      const byId = state.playlists.filter((p) => params.includes(p["id"]));
      if (byId.length) return byId;
      return state.playlists.filter((p) => params.includes(p["ownerProfileId"]));
    }
    return [];
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, fields, cond),
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, fields, cond),
              then: (res: any, rej: any) =>
                Promise.resolve(rowsFor(table, fields, cond)).then(res, rej),
            }),
            then: (res: any, rej: any) =>
              Promise.resolve(rowsFor(table, fields, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
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

function profileRow(): Record<string, unknown> {
  return {
    id: PROFILE_ID,
    userId: OWNER_USER_ID,
    slug: "king-creator",
    displayName: "King Creator",
    vertical: "musician",
    streamSchedule: null,
    mediaKit: null,
    bio: "Test creator.",
    avatarUrl: "/images/king-avatar.png",
    bannerUrl: "/images/king-banner.jpg",
    themeId: "gold-lux",
    themeConfig: {},
    sections: [],
    featuredMedia: null,
    socialLinks: {},
    topCreators: null,
    tipJarEnabled: false,
    aiDesign: null,
    isPublic: true,
    isVerified: false,
    isOfficial: false,
    followerCount: 0,
    totalPlays: 0,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

function trackRow(): Record<string, unknown> {
  return {
    id: TRACK_ID,
    profileId: PROFILE_ID,
    title: "King Anthem",
    audioUrl: "audio/king-anthem.mp3",
    artworkUrl: "artwork/king-anthem.jpg",
    genre: "Hip-Hop",
    tags: ["king", "anthem"],
    isrc: null,
    durationSec: 187,
    downloadPriceCents: 499,
    playCount: 1234,
    likeCount: 56,
    repostCount: 7,
    commentCount: 3,
    isPublished: true,
    createdAt: new Date("2026-10-05T12:00:00.000Z"),
  };
}

function videoRow(): Record<string, unknown> {
  return {
    id: VIDEO_ID,
    profileId: PROFILE_ID,
    title: "Throne Room Sessions",
    videoUrl: "video/throne-room.mp4",
    thumbnailUrl: "video/throne-room.jpg",
    description: "Inside the throne room.",
    genre: "Documentary",
    tags: ["throne"],
    durationSec: 642,
    season: 1,
    episode: 3,
    soundTrackId: TRACK_ID,
    downloadPriceCents: 0,
    viewCount: 9876,
    likeCount: 321,
    repostCount: 12,
    commentCount: 9,
    isPublished: true,
    isShort: false,
    duetWith: null,
    stitchWith: null,
    soundId: null,
    soundTitle: null,
    soundUrl: null,
    soundUseCount: 0,
    createdAt: new Date("2026-10-06T12:00:00.000Z"),
  };
}

function playlistRow(): Record<string, unknown> {
  return {
    id: PLAYLIST_ID,
    ownerProfileId: PROFILE_ID,
    title: "Royal Rotation",
    description: "The king's picks.",
    coverUrl: "covers/royal-rotation.jpg",
    isPublic: true,
    kind: "playlist",
    items: [
      { kind: "track", id: TRACK_ID },
      { kind: "video", id: VIDEO_ID },
    ],
    followerCount: 42,
    createdAt: new Date("2026-10-07T12:00:00.000Z"),
  };
}

beforeEach(() => {
  h.state.profiles = [profileRow()];
  h.state.tracks = [trackRow()];
  h.state.videos = [videoRow()];
  h.state.playlists = [playlistRow()];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/media/track/:id — StreamTrack DTO", () => {
  it("serves the full snake_case contract the player reads", async () => {
    const { status, json } = await get(`/media/track/${TRACK_ID}`);

    expect(status).toBe(200);
    const t = json.track;
    // The play button itself: resolveMedia(track.audio_url) must be non-empty.
    expect(t.audio_url).toBe("audio/king-anthem.mp3");
    expect(t.id).toBe(TRACK_ID);
    expect(t.profile_id).toBe(PROFILE_ID);
    expect(t.title).toBe("King Anthem");
    expect(t.artwork_url).toBe("artwork/king-anthem.jpg");
    expect(t.genre).toBe("Hip-Hop");
    expect(t.tags).toEqual(["king", "anthem"]);
    expect(t.duration_sec).toBe(187);
    expect(t.download_price_cents).toBe(499);
    expect(t.buyable).toBe(true);
    expect(t.play_count).toBe(1234);
    expect(t.like_count).toBe(56);
    expect(t.repost_count).toBe(7);
    expect(t.comment_count).toBe(3);
    expect(t.is_published).toBe(true);
    expect(t.profile_slug).toBe("king-creator");
    // Get-Paid finale ownership reads.
    expect(t.owner_user_id).toBe(OWNER_USER_ID);
    expect(t.created_at).toBe("2026-10-05T12:00:00.000Z");
    // No camelCase leakage from the raw row.
    expect(t).not.toHaveProperty("audioUrl");
    expect(t).not.toHaveProperty("profileId");
    expect(t).not.toHaveProperty("playCount");
    // Artist ref rides along, snake_case as before.
    expect(json.artist.slug).toBe("king-creator");
    expect(json.artist.display_name).toBe("King Creator");
  });
});

describe("GET /api/media/video/:id — StreamVideo DTO", () => {
  it("serves the full snake_case contract the watch page reads", async () => {
    const { status, json } = await get(`/media/video/${VIDEO_ID}`);

    expect(status).toBe(200);
    const v = json.video;
    // The player itself: resolveMedia(video.video_url) must be non-empty.
    expect(v.video_url).toBe("video/throne-room.mp4");
    expect(v.id).toBe(VIDEO_ID);
    expect(v.profile_id).toBe(PROFILE_ID);
    expect(v.title).toBe("Throne Room Sessions");
    expect(v.thumbnail_url).toBe("video/throne-room.jpg");
    expect(v.duration_sec).toBe(642);
    expect(v.description).toBe("Inside the throne room.");
    expect(v.view_count).toBe(9876);
    expect(v.like_count).toBe(321);
    expect(v.comment_count).toBe(9);
    expect(v.is_published).toBe(true);
    // Series metadata: row columns are season/episode, client reads *_number.
    expect(v.season_number).toBe(1);
    expect(v.episode_number).toBe(3);
    expect(v.profile_slug).toBe("king-creator");
    expect(v.owner_user_id).toBe(OWNER_USER_ID);
    expect(v.created_at).toBe("2026-10-06T12:00:00.000Z");
    // Linked sound stays the resolved snake_case shape.
    expect(v.sound).toEqual({
      id: TRACK_ID,
      title: "King Anthem",
      audio_url: "audio/king-anthem.mp3",
      artwork_url: "artwork/king-anthem.jpg",
      profile_slug: "king-creator",
    });
    expect(v).not.toHaveProperty("videoUrl");
    expect(v).not.toHaveProperty("viewCount");
  });
});

describe("GET /api/creator-profiles/:slug/media — listing DTOs", () => {
  it("serves track items with the fields 'More from artist' maps", async () => {
    const { status, json } = await get(`/creator-profiles/king-creator/media?kind=track`);

    expect(status).toBe(200);
    expect(json.items).toHaveLength(1);
    const t = json.items[0];
    expect(t.audio_url).toBe("audio/king-anthem.mp3");
    expect(t.artwork_url).toBe("artwork/king-anthem.jpg");
    expect(t.play_count).toBe(1234);
    expect(t.profile_id).toBe(PROFILE_ID);
  });

  it("serves video items with thumbnail / view_count / series fields", async () => {
    const { status, json } = await get(`/creator-profiles/king-creator/media?kind=video`);

    expect(status).toBe(200);
    expect(json.items).toHaveLength(1);
    const v = json.items[0];
    expect(v.video_url).toBe("video/throne-room.mp4");
    expect(v.thumbnail_url).toBe("video/throne-room.jpg");
    expect(v.view_count).toBe(9876);
    expect(v.season_number).toBe(1);
    expect(v.episode_number).toBe(3);
  });
});

describe("GET /api/playlists/:id — StreamPlaylist DTO + wrapped items", () => {
  it("serves the playlist snake_case and resolved_items WRAPPED as {kind, item}", async () => {
    const { status, json } = await get(`/playlists/${PLAYLIST_ID}`);

    expect(status).toBe(200);
    const pl = json.playlist;
    expect(pl.id).toBe(PLAYLIST_ID);
    expect(pl.owner_profile_id).toBe(PROFILE_ID);
    expect(pl.title).toBe("Royal Rotation");
    expect(pl.description).toBe("The king's picks.");
    expect(pl.cover_url).toBe("covers/royal-rotation.jpg");
    expect(pl.is_public).toBe(true);
    expect(pl.kind).toBe("playlist");
    expect(pl.follower_count).toBe(42);
    expect(pl.owner_profile_slug).toBe("king-creator");
    expect(pl).not.toHaveProperty("ownerProfileId");
    expect(pl).not.toHaveProperty("coverUrl");
    expect(pl).not.toHaveProperty("followerCount");

    // The crash fix: playlist.tsx dereferences r.item.title — items are wrapped.
    expect(pl.resolved_items).toHaveLength(2);
    const [first, second] = pl.resolved_items;
    expect(first.kind).toBe("track");
    expect(first.item.title).toBe("King Anthem");
    expect(first.item.audio_url).toBe("audio/king-anthem.mp3");
    expect(first.item.artwork_url).toBe("artwork/king-anthem.jpg");
    expect(first.item.duration_sec).toBe(187);
    expect(first.item.play_count).toBe(1234);
    expect(first.item.download_price_cents).toBe(499);
    expect(second.kind).toBe("video");
    expect(second.item.title).toBe("Throne Room Sessions");
    expect(second.item.video_url).toBe("video/throne-room.mp4");
    expect(second.item.thumbnail_url).toBe("video/throne-room.jpg");
    expect(second.item.view_count).toBe(9876);
    expect(second.item.season_number).toBe(1);
    expect(second.item.episode_number).toBe(3);
  });
});
