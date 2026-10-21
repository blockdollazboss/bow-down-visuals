/**
 * Profile-song pin (Stack-4 wave-2 #10) — client boundary.
 *
 * The server's public-profile payload leads top_tracks / top_videos
 * with the creator's ONE pinned item and flags it is_pinned. The
 * fetch boundary (normalizePublicProfile) must carry that flag onto
 * profile.media_items untouched and in order: the Grand Stage Music /
 * Videos blocks render the items in payload order and give the pinned
 * row its gold "Pinned" treatment (MediaRowSection reads isPinned).
 * A payload with no pin must normalize to all-isPinned-false — the
 * profile renders exactly as before.
 */
import { describe, it, expect } from "vitest";
import {
  normalizePublicProfile,
  type CreatorProfile,
  type PublicProfileWire,
} from "./artist-profiles";
import type { StreamTrack, StreamVideo } from "./streaming";

const PROFILE = {
  id: "prof-1",
  user_id: "user-1",
  slug: "pin-owner",
  display_name: "Pin Owner",
  bio: "",
  avatar_url: null,
  banner_url: null,
  vertical: "music",
  theme_id: "royal-gold",
  theme_config: null,
  sections: [
    { id: "s-music", type: "tracks", title: "Music", visible: true },
    { id: "s-videos", type: "videos", title: "Videos", visible: true },
  ],
  featured_media: null,
  social_links: {},
  top_creators: [],
  tip_jar_enabled: true,
  ai_design: null,
  is_public: true,
  follower_count: 3,
  total_plays: 515,
} as unknown as CreatorProfile;

function wireTrack(id: string, isPinned: boolean): StreamTrack {
  return {
    id,
    profile_id: "prof-1",
    title: `Track ${id}`,
    audio_url: `https://cdn.example.com/${id}.mp3`,
    artwork_url: null,
    genre: "Soul",
    tags: [],
    duration_sec: 180,
    download_price_cents: 0,
    play_count: 5,
    like_count: 0,
    repost_count: 0,
    comment_count: 0,
    is_published: true,
    is_pinned: isPinned,
  };
}

function wireVideo(id: string, isPinned: boolean): StreamVideo {
  return {
    id,
    profile_id: "prof-1",
    title: `Video ${id}`,
    video_url: `https://cdn.example.com/${id}.mp4`,
    thumbnail_url: null,
    duration_sec: 240,
    description: "",
    view_count: 10,
    like_count: 0,
    comment_count: 0,
    is_published: true,
    is_pinned: isPinned,
  };
}

describe("normalizePublicProfile — profile-song pin", () => {
  it("carries is_pinned onto media_items, leading order preserved", () => {
    const wire: PublicProfileWire = {
      profile: PROFILE,
      top_tracks: [wireTrack("t-pin", true), wireTrack("t-a", false), wireTrack("t-b", false)],
      top_videos: [wireVideo("v-1", false), wireVideo("v-2", false)],
    };
    const profile = normalizePublicProfile(wire);
    expect(profile.media_items?.tracks.map((t) => t.id)).toEqual(["t-pin", "t-a", "t-b"]);
    expect(profile.media_items?.tracks.map((t) => t.isPinned)).toEqual([true, false, false]);
    expect(profile.media_items?.videos.map((v) => v.isPinned)).toEqual([false, false]);
  });

  it("a payload with no pin normalizes to no pinned items", () => {
    const wire: PublicProfileWire = {
      profile: PROFILE,
      top_tracks: [wireTrack("t-a", false)],
      top_videos: [wireVideo("v-1", false)],
    };
    const profile = normalizePublicProfile(wire);
    expect(profile.media_items?.tracks.every((t) => t.isPinned === false)).toBe(true);
    expect(profile.media_items?.videos.every((v) => v.isPinned === false)).toBe(true);
  });

  it("a video pin flags the video, never a track", () => {
    const wire: PublicProfileWire = {
      profile: PROFILE,
      top_tracks: [wireTrack("t-a", false)],
      top_videos: [wireVideo("v-pin", true), wireVideo("v-1", false)],
    };
    const profile = normalizePublicProfile(wire);
    expect(profile.media_items?.videos.map((v) => [v.id, v.isPinned])).toEqual([
      ["v-pin", true],
      ["v-1", false],
    ]);
    expect(profile.media_items?.tracks.every((t) => t.isPinned === false)).toBe(true);
  });
});
