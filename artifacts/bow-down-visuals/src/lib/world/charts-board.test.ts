/**
 * charts-board — the Charts board's pure shaping (NATIVE-PLAN §3.1).
 *
 * Pins:
 * - the discovery payloads (raw SQL rows: snake_case, optional
 *   halves) normalize into board rows, skipping unusable rows
 *   rather than guessing;
 * - a track's Play id is the jukebox resolver's `track:<uuid>`
 *   catalog form — the seam the Jukebox panel's picks use;
 * - the follow contract is POST …/follow / DELETE …/unfollow
 *   (there is no POST unfollow route on the server);
 * - the board component's source: it rides exactly the plan's
 *   endpoints, plays ONLY through the host's onPlayTrack prop,
 *   and never opens a website page itself.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  followRequest,
  followStateFromResponse,
  followUrl,
  jukeboxTrackId,
  normalizeChartCreators,
  normalizeChartTracks,
  normalizeFollowStates,
} from "./charts-board";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const boardSrc = read("../../components/world/native/boards/ChartsBoard.tsx");
const stationPanelSrc = read("../../components/world/StationPanel.tsx");

const TRACKS_PAYLOAD = {
  window: "week",
  tracks: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      profile_id: "p1",
      title: "Gold Teeth",
      genre: "Hip-Hop",
      artwork_url: "https://x/art.png",
      play_count: 900,
      window_plays: 42,
      duration_sec: 187,
      display_name: "Thy Cheat Code",
    },
    { id: "22222222-2222-2222-2222-222222222222", title: "No Creator Row", play_count: 5 },
    { title: "No id — skipped", play_count: 99 },
    { id: "33333333-3333-3333-3333-333333333333", play_count: 99 },
    "not-a-row",
  ],
};

describe("normalizeChartTracks", () => {
  it("shapes chart rows, window plays winning over the all-time counter", () => {
    const rows = normalizeChartTracks(TRACKS_PAYLOAD);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      title: "Gold Teeth",
      creatorName: "Thy Cheat Code",
      genre: "Hip-Hop",
      artworkUrl: "https://x/art.png",
      plays: 42,
      durationSec: 187,
    });
    expect(rows[1]!.plays).toBe(5); // no window count → the counter
    expect(rows[1]!.creatorName).toBeNull();
  });

  it("an unusable payload is an empty board, never a throw", () => {
    expect(normalizeChartTracks(null)).toEqual([]);
    expect(normalizeChartTracks({})).toEqual([]);
    expect(normalizeChartTracks({ tracks: "nope" })).toEqual([]);
  });
});

describe("normalizeChartCreators", () => {
  it("shapes top creators from the creators key", () => {
    const rows = normalizeChartCreators(
      {
        creators: [
          { id: "c1", display_name: "Ada Gold", vertical: "music", follower_count: 1200, total_plays: 34000 },
          { id: "c2" }, // no name — skipped
        ],
      },
      "creators",
    );
    expect(rows).toEqual([
      { id: "c1", displayName: "Ada Gold", vertical: "music", followerCount: 1200, totalPlays: 34000, newFollowers: null, earnedCents30d: null },
    ]);
  });

  it("rising rows carry their new-follower count; earner rows their 30-day take", () => {
    const rising = normalizeChartCreators(
      { rising: [{ id: "c9", display_name: "Breaker", follower_count: 10, total_plays: 20, new_followers: 77 }] },
      "rising",
    );
    expect(rising[0]!.newFollowers).toBe(77);
    const earners = normalizeChartCreators(
      { earners: [{ id: "c8", display_name: "Earner", follower_count: 10, total_plays: 20, earned_cents_30d: 12345 }] },
      "earners",
    );
    expect(earners[0]!.earnedCents30d).toBe(12345);
  });

  it("reads only its own key — a rising payload is not a creators payload", () => {
    expect(normalizeChartCreators({ rising: [{ id: "c1", display_name: "X" }] }, "creators")).toEqual([]);
  });
});

describe("the Play seam (jukeboxTrackId)", () => {
  it("prefixes a raw discovery track id into the jukebox catalog form", () => {
    expect(jukeboxTrackId("11111111-1111-1111-1111-111111111111")).toBe(
      "track:11111111-1111-1111-1111-111111111111",
    );
  });
  it("is idempotent on an already-prefixed id", () => {
    expect(jukeboxTrackId("track:abc")).toBe("track:abc");
  });
});

describe("the follow contract", () => {
  it("follow is a POST to …/follow; unfollow is a DELETE to …/unfollow", () => {
    expect(followRequest(false)).toEqual({ method: "POST", suffix: "follow" });
    expect(followRequest(true)).toEqual({ method: "DELETE", suffix: "unfollow" });
    expect(followUrl("c1", false)).toBe("/api/creator-profiles/c1/follow");
    expect(followUrl("c1", true)).toBe("/api/creator-profiles/c1/unfollow");
  });

  it("the response's authoritative state is read, never assumed", () => {
    expect(followStateFromResponse({ followed: true, follower_count: 1201 })).toEqual({
      followed: true,
      followerCount: 1201,
    });
    expect(followStateFromResponse({ followed: false })).toEqual({ followed: false, followerCount: null });
    expect(followStateFromResponse({})).toBeNull();
    expect(followStateFromResponse(null)).toBeNull();
  });

  it("the batched follow-state payload keeps only real booleans", () => {
    expect(normalizeFollowStates({ a: true, b: false, c: "yes" })).toEqual({ a: true, b: false });
    expect(normalizeFollowStates(null)).toEqual({});
  });
});

describe("the ChartsBoard surface (source pins)", () => {
  it("rides exactly the plan's discovery endpoints", () => {
    expect(boardSrc).toContain("/api/discovery/charts?window=week&limit=10");
    expect(boardSrc).toContain("/api/discovery/charts/creators?window=week&limit=10");
    expect(boardSrc).toContain("/api/discovery/rising?limit=12");
    expect(boardSrc).toContain("/api/discovery/rising-earners?limit=12");
    expect(boardSrc).toContain("/api/discovery/following?ids=");
  });

  it("plays ONLY through the host's jukebox prop, with the catalog id form", () => {
    expect(boardSrc).toContain("onPlayTrack(jukeboxTrackId(row.id))");
    expect(boardSrc).not.toContain("new Audio");
    expect(boardSrc).not.toContain("<audio");
    // No page pull-up: the board mounts no website page and routes nowhere.
    expect(boardSrc).not.toContain("PanelRouter");
    expect(boardSrc).not.toContain('href="/charts"');
  });

  it("carries the honest states and the board primitives", () => {
    expect(boardSrc).toContain("NativeLoadingState");
    expect(boardSrc).toContain("NativeEmptyState");
    expect(boardSrc).toContain("NativeErrorState");
    expect(boardSrc).toContain("NativeBoard");
    expect(boardSrc).toContain("NativeBoardRow");
  });

  it("the host dispatches the board pattern's charts station to it", () => {
    expect(stationPanelSrc).toContain('resolution.pattern === "board" && station.id === "charts-desk"');
    expect(stationPanelSrc).toContain("onPlayTrack={props.onJukeboxAdd}");
    expect(stationPanelSrc).toContain("jukeboxDenied={props.jukeboxDenied}");
  });
});
