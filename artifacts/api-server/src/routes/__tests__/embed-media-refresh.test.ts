/**
 * Route tests for embed media URL refresh (routes/embed).
 *
 * THE DEFECT: embed.ts's local mediaUrl() passed through only
 * http/blob/data and otherwise prepended "/" — so a stored storage
 * ref such as `r2://generated-clips/clips/x.mp4` became the
 * unplayable path "/r2://generated-clips/clips/x.mp4", and the
 * thumbnail / artwork / avatar / cover fields were passed through
 * RAW, leaking refs verbatim. The standalone embed pages render
 * these fields directly as <audio src> / <video src> / <img src>,
 * so every embed whose media lived in storage was broken.
 *
 * The objectStorage mock below SIMULATES the real helper's contract
 * (a ref string becomes a fresh signed https URL; everything else
 * passes through unchanged) rather than mocking it as identity —
 * an identity mock could never catch a missing refresh call.
 *
 * Fake-db style mirrors creator-follow-unfollow.test.ts /
 * saves-mine-refresh.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const PLAYLIST_ID = "55555555-5555-4555-8555-555555555555";
const PROFILE_SLUG = "some-creator";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
    playlists: [] as Array<Record<string, unknown>>,
  },
}));

/* Simulated refresh: refs (r2:// / supabase://) become signed https
   URLs; everything else passes through — mirroring
   refreshSupabaseStorageUrl / refreshSupabaseStorageUrlsDeep. */
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

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
      ? signedFor(v)
      : v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
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

  function rowsFor(table: unknown): unknown[] {
    if (table === creatorProfilesTable) return state.profiles;
    if (table === profileTracksTable) return state.tracks;
    if (table === profileVideosTable) return state.videos;
    if (table === playlistsTable) return state.playlists;
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    // QueryResult shape (see embed-refcode test); no code in this file's
    // fixtures, so ref_code is null and the media assertions stand alone.
    execute: async () => ({ command: "SELECT", rowCount: 0, oid: 0, fields: [], rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import { embedApiRouter } from "../embed";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", embedApiRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.profiles = [
    {
      id: PROFILE_ID,
      userId: OWNER_ID,
      slug: PROFILE_SLUG,
      displayName: "Some Creator",
      isPublic: true,
      avatarUrl: "r2://artist-references/avatars/me.png",
      bio: "hello\nworld",
    },
  ];
  h.state.tracks = [
    {
      id: TRACK_ID,
      profileId: PROFILE_ID,
      title: "Stored Song",
      isPublished: true,
      artworkUrl: "r2://generated-clips/artwork/cover.jpg",
      audioUrl: "r2://generated-clips/clips/song.mp3",
      playCount: 10,
    },
  ];
  h.state.videos = [
    {
      id: VIDEO_ID,
      profileId: PROFILE_ID,
      title: "Stored Video",
      isPublished: true,
      thumbnailUrl: "supabase://generated-clips/thumbs/poster.jpg",
      videoUrl: "r2://generated-clips/clips/x.mp4",
      viewCount: 10,
    },
  ];
  h.state.playlists = [
    {
      id: PLAYLIST_ID,
      ownerProfileId: PROFILE_ID,
      title: "Stored Playlist",
      isPublic: true,
      coverUrl: "r2://generated-clips/covers/pl.jpg",
      items: [
        { kind: "track", id: TRACK_ID },
        { kind: "video", id: VIDEO_ID },
      ],
    },
  ];
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("embed payloads — storage refs are refreshed to playable URLs", () => {
  it("track: audio_url and artwork_url stored as r2:// refs return refreshed playable URLs, not /r2://…", async () => {
    const { status, json } = await get(`/embed/track/${TRACK_ID}`);

    expect(status).toBe(200);
    expect(json.audio_url).toBe(
      "https://signed.example.com/generated-clips/clips/song.mp3?sig=test",
    );
    expect(json.audio_url).not.toContain("r2://");
    expect(json.artwork_url).toBe(
      "https://signed.example.com/generated-clips/artwork/cover.jpg?sig=test",
    );
    expect(json.artwork_url).not.toContain("r2://");
  });

  it("video: video_url stored as an r2:// ref and thumbnail_url as a supabase:// ref return refreshed playable URLs", async () => {
    const { status, json } = await get(`/embed/video/${VIDEO_ID}`);

    expect(status).toBe(200);
    expect(json.video_url).toBe(
      "https://signed.example.com/generated-clips/clips/x.mp4?sig=test",
    );
    expect(json.video_url).not.toBe("/r2://generated-clips/clips/x.mp4");
    expect(json.video_url).not.toContain("r2://");
    expect(json.thumbnail_url).toBe(
      "https://signed.example.com/generated-clips/thumbs/poster.jpg?sig=test",
    );
    expect(json.thumbnail_url).not.toContain("supabase://");
  });

  it("playlist: cover_url and item thumbs stored as refs return refreshed playable URLs", async () => {
    const { status, json } = await get(`/embed/playlist/${PLAYLIST_ID}`);

    expect(status).toBe(200);
    expect(json.cover_url).toBe(
      "https://signed.example.com/generated-clips/covers/pl.jpg?sig=test",
    );
    const trackItem = json.items.find((i: any) => i.kind === "track");
    expect(trackItem.thumb).toBe(
      "https://signed.example.com/generated-clips/artwork/cover.jpg?sig=test",
    );
    const videoItem = json.items.find((i: any) => i.kind === "video");
    expect(videoItem.thumb).toBe(
      "https://signed.example.com/generated-clips/thumbs/poster.jpg?sig=test",
    );
  });

  it("profile: avatar_url and featured media_url/thumb stored as refs return refreshed playable URLs", async () => {
    const { status, json } = await get(`/embed/profile/${PROFILE_SLUG}`);

    expect(status).toBe(200);
    expect(json.avatar_url).toBe(
      "https://signed.example.com/artist-references/avatars/me.png?sig=test",
    );
    expect(json.featured).not.toBeNull();
    expect(json.featured.media_url).toBe(
      "https://signed.example.com/generated-clips/clips/song.mp3?sig=test",
    );
    expect(json.featured.media_url).not.toContain("r2://");
    expect(json.featured.thumb).toBe(
      "https://signed.example.com/generated-clips/artwork/cover.jpg?sig=test",
    );
  });

  it("already-playable values stay byte-identical and relative paths keep the leading-slash normalization", async () => {
    h.state.tracks = [
      {
        id: TRACK_ID,
        profileId: PROFILE_ID,
        title: "CDN Song",
        isPublished: true,
        artworkUrl: "https://cdn.example.com/cover.jpg",
        audioUrl: "https://cdn.example.com/song.mp3",
        playCount: 10,
      },
    ];
    const cdn = await get(`/embed/track/${TRACK_ID}`);
    expect(cdn.status).toBe(200);
    expect(cdn.json.audio_url).toBe("https://cdn.example.com/song.mp3");
    expect(cdn.json.artwork_url).toBe("https://cdn.example.com/cover.jpg");

    h.state.tracks = [
      {
        id: TRACK_ID,
        profileId: PROFILE_ID,
        title: "Relative Song",
        isPublished: true,
        artworkUrl: null,
        audioUrl: "uploads/song.mp3",
        playCount: 10,
      },
    ];
    const rel = await get(`/embed/track/${TRACK_ID}`);
    expect(rel.status).toBe(200);
    expect(rel.json.audio_url).toBe("/uploads/song.mp3");
    expect(rel.json.artwork_url).toBeNull();
  });
});
