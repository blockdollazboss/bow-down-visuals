/**
 * Linkage Fix 1 — published work appears on the public profile.
 *
 * The API's public-profile endpoint returns the creator's published
 * catalog as top_tracks / top_videos, but fetchPublicProfile used to
 * unwrap only `.profile` and discard them, while the Grand Stage
 * Music / Videos blocks read profile.media_items — a field no payload
 * ever set — so both blocks rendered nothing for every creator.
 *
 * These tests drive the REAL client path: fetchPublicProfile against
 * the endpoint's exact wire payload (snake_case DTOs, copied from the
 * server's enrichTrack / enrichVideo output), and the normalizer that
 * maps them onto profile.media_items — the exact field
 * ProfileSectionByType reads (tracks/videos blocks render iff
 * media_items.tracks/videos are non-empty; empty in public mode is
 * the honest empty state, preview mode shows the empty hint).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchPublicProfile,
  normalizePublicProfile,
  type CreatorProfile,
} from "./artist-profiles";

/* ── The endpoint's wire payload (GET /api/creator-profiles/:slug) ── */

const PROFILE = {
  id: "prof-1",
  user_id: "user-1",
  slug: "queen-bee",
  display_name: "Queen Bee",
  bio: "",
  avatar_url: null,
  banner_url: null,
  vertical: "music",
  theme_id: "royal-gold",
  theme_config: null,
  sections: [{ id: "s-music", type: "tracks", title: "Music", visible: true }],
  featured_media: null,
  social_links: {},
  top_creators: [],
  tip_jar_enabled: true,
  ai_design: null,
  is_public: true,
  follower_count: 12,
  total_plays: 340,
} as unknown as CreatorProfile;

/** enrichTrack output, verbatim field set (creator-platform.ts). */
const WIRE_TRACK = {
  id: "track-1",
  profile_id: "prof-1",
  title: "Golden Hour",
  audio_url: "https://cdn.example.com/audio/golden-hour.mp3",
  artwork_url: "https://cdn.example.com/art/golden-hour.jpg",
  genre: "Soul",
  tags: ["warm"],
  duration_sec: 204,
  download_price_cents: null,
  play_count: 128,
  like_count: 9,
  repost_count: 2,
  comment_count: 1,
  is_published: true,
  created_at: "2026-10-01T00:00:00.000Z",
  profile_slug: "queen-bee",
  buyable: false,
  is_owner: false,
  owner_user_id: "user-1",
};

/** enrichVideo output, verbatim field set (creator-platform.ts). */
const WIRE_VIDEO = {
  id: "video-1",
  profile_id: "prof-1",
  title: "Golden Hour (Visual)",
  video_url: "https://cdn.example.com/video/golden-hour.mp4",
  thumbnail_url: "https://cdn.example.com/video/golden-hour.jpg",
  description: "The visual.",
  genre: "Soul",
  tags: [],
  duration_sec: 95,
  view_count: 432,
  like_count: 20,
  repost_count: 3,
  comment_count: 4,
  is_published: true,
  is_short: false,
  season_number: null,
  episode_number: null,
  series_title: null,
  sound_track_id: null,
  sound: null,
  created_at: "2026-10-02T00:00:00.000Z",
  profile_slug: "queen-bee",
  is_owner: false,
  owner_user_id: "user-1",
};

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPublicProfile — published catalog reaches the profile", () => {
  it("maps top_tracks / top_videos onto media_items in block shape", async () => {
    const fetchMock = stubFetch({
      profile: PROFILE,
      counts: { followers: 12, tracks: 1, videos: 1, posts: 0 },
      top_tracks: [WIRE_TRACK],
      top_videos: [WIRE_VIDEO],
      playlists: [],
    });

    const profile = await fetchPublicProfile("queen-bee");

    expect(fetchMock).toHaveBeenCalledWith("/api/creator-profiles/queen-bee");
    /* The Music block's rows: playable url, art, duration, plays, and
       a deep link to the track's own page. */
    expect(profile.media_items?.tracks).toEqual([
      {
        id: "track-1",
        title: "Golden Hour",
        thumbnailUrl: "https://cdn.example.com/art/golden-hour.jpg",
        url: "https://cdn.example.com/audio/golden-hour.mp3",
        duration: "3:24",
        plays: 128,
        href: "/track/track-1",
      },
    ]);
    /* The Videos block's rows, same contract. */
    expect(profile.media_items?.videos).toEqual([
      {
        id: "video-1",
        title: "Golden Hour (Visual)",
        thumbnailUrl: "https://cdn.example.com/video/golden-hour.jpg",
        url: "https://cdn.example.com/video/golden-hour.mp4",
        duration: "1:35",
        plays: 432,
        href: "/watch/video-1",
      },
    ]);
    /* The rest of the profile passes through untouched. */
    expect(profile.slug).toBe("queen-bee");
    expect(profile.display_name).toBe("Queen Bee");
  });

  it("a creator with no published work gets empty media_items — the honest empty state", async () => {
    stubFetch({
      profile: PROFILE,
      counts: { followers: 12, tracks: 0, videos: 0, posts: 0 },
      top_tracks: [],
      top_videos: [],
      playlists: [],
    });

    const profile = await fetchPublicProfile("queen-bee");

    /* Empty arrays are what make the blocks render nothing in public
       mode (and the fill-me hint in preview) — no fake rows, no
       placeholder content dressed up as a catalog. */
    expect(profile.media_items).toEqual({ tracks: [], videos: [] });
  });
});

describe("normalizePublicProfile — boundary tolerance", () => {
  it("missing top_tracks / top_videos (older payload) normalizes to empty, never undefined rows", () => {
    const profile = normalizePublicProfile({ profile: PROFILE });
    expect(profile.media_items).toEqual({ tracks: [], videos: [] });
  });

  it("rows without art or duration still map with a playable url and link", () => {
    const profile = normalizePublicProfile({
      profile: PROFILE,
      top_tracks: [{ ...WIRE_TRACK, artwork_url: null, duration_sec: null }],
      top_videos: [],
    });
    const [row] = profile.media_items!.tracks;
    expect(row.thumbnailUrl).toBeUndefined();
    expect(row.duration).toBeUndefined();
    expect(row.url).toBe(WIRE_TRACK.audio_url);
    expect(row.href).toBe("/track/track-1");
    expect(row.plays).toBe(128);
  });
});
