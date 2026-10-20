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
  CHART_WINDOWS,
  chartLikeIdsParam,
  chartLikeKey,
  chartTrackPlayInput,
  chartVideoPlayInput,
  chartsCreatorsPath,
  chartsMediaPath,
  chartWindowNoun,
  followRequest,
  followStateFromResponse,
  followUrl,
  jukeboxTrackId,
  likeStateFromToggle,
  normalizeChartCreators,
  normalizeChartTracks,
  normalizeChartVideos,
  normalizeFollowStates,
  normalizeLikeStates,
} from "./charts-board";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const boardSrc = read("../../components/world/native/boards/ChartsBoard.tsx");
const stationPanelSrc = read("../../components/world/StationPanel.tsx");
const shelfPlayerSrc = read("../../components/world/native/ShelfPlayer.tsx");

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
      likeCount: 0,
      mediaUrl: null,
      profileId: "p1",
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

describe("Ring 2 (2.27) — likes, videos, and the Shelf-player seam", () => {
  it("track rows carry their like count, stream URL and profile id", () => {
    const rows = normalizeChartTracks({
      tracks: [
        {
          id: "t1",
          title: "Chart Topper",
          like_count: 17,
          audio_url: "https://cdn.example.com/t1.mp3",
          profile_id: "prof-9",
          play_count: 5,
        },
      ],
    });
    expect(rows[0]).toMatchObject({ likeCount: 17, mediaUrl: "https://cdn.example.com/t1.mp3", profileId: "prof-9" });
  });

  it("video rows shape from the payload's videos key, view counts as plays", () => {
    const rows = normalizeChartVideos({
      videos: [
        {
          id: "v1",
          title: "The Coronation",
          thumbnail_url: "https://cdn.example.com/v1.jpg",
          video_url: "https://cdn.example.com/v1.mp4",
          view_count: 99,
          like_count: 7,
          duration_sec: 240,
          display_name: "Thy Cheat Code",
        },
        { id: "v2", title: "No URL row", view_count: 1 },
        { title: "no id — skipped" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "v1",
      plays: 99,
      likeCount: 7,
      mediaUrl: "https://cdn.example.com/v1.mp4",
      artworkUrl: "https://cdn.example.com/v1.jpg",
    });
    expect(rows[1]!.mediaUrl).toBeNull();
    expect(normalizeChartVideos(null)).toEqual([]);
    expect(normalizeChartVideos({ tracks: [] })).toEqual([]);
  });

  it("play inputs build for the Shelf player only when the row carries a playable URL", () => {
    const trackRow = normalizeChartTracks({
      tracks: [{ id: "t1", title: "T", audio_url: "https://cdn.example.com/t1.mp3", like_count: 3 }],
    })[0]!;
    expect(chartTrackPlayInput(trackRow)).toMatchObject({
      kind: "track",
      id: "t1",
      src: "https://cdn.example.com/t1.mp3",
      pagePath: "/track/t1",
      likeCount: 3,
    });
    const bareTrack = normalizeChartTracks({ tracks: [{ id: "t2", title: "T2" }] })[0]!;
    expect(chartTrackPlayInput(bareTrack)).toBeNull();

    const videoRow = normalizeChartVideos({
      videos: [{ id: "v1", title: "V", video_url: "https://cdn.example.com/v1.mp4" }],
    })[0]!;
    expect(chartVideoPlayInput(videoRow)).toMatchObject({
      kind: "video",
      id: "v1",
      src: "https://cdn.example.com/v1.mp4",
      pagePath: "/watch/v1",
    });
    const bareVideo = normalizeChartVideos({ videos: [{ id: "v2", title: "V2" }] })[0]!;
    expect(chartVideoPlayInput(bareVideo)).toBeNull();
  });

  it("the board source: Like rides the media rails, videos play on the Shelf player, tracks keep the jukebox Play", () => {
    expect(boardSrc).toContain("toggleLike");
    expect(boardSrc).toContain("normalizeChartVideos");
    expect(boardSrc).toContain("chartVideoPlayInput");
    expect(boardSrc).toContain("shelfPlayer");
    expect(boardSrc).toContain('data-testid="world-charts-like"');
    expect(boardSrc).toContain('data-testid="world-charts-video-play"');
    // Still no media element and no page pull-up in the board itself.
    expect(boardSrc).not.toContain("<audio");
    expect(boardSrc).not.toContain("<video");
  });
});

describe("Ring 2 (2.27) completion — hearts open on the walker's real like state", () => {
  const tracks = normalizeChartTracks({
    tracks: [
      { id: "t1", title: "One", like_count: 17, audio_url: "https://cdn.example.com/t1.mp3" },
      { id: "t2", title: "Two", like_count: 3 },
    ],
  });
  const videos = normalizeChartVideos({
    videos: [{ id: "v1", title: "Vid", like_count: 7, video_url: "https://cdn.example.com/v1.mp4" }],
  });

  it("a heart's key is kind+id — a track and a video never share one", () => {
    expect(chartLikeKey("track", "x1")).toBe("track:x1");
    expect(chartLikeKey("video", "x1")).toBe("video:x1");
    expect(chartLikeKey("track", "x1")).not.toBe(chartLikeKey("video", "x1"));
  });

  it("the batched read asks about every media row on show, once each", () => {
    expect(chartLikeIdsParam(tracks, videos)).toBe("track:t1,track:t2,video:v1");
    expect(chartLikeIdsParam([...tracks, ...tracks], videos)).toBe("track:t1,track:t2,video:v1");
    expect(chartLikeIdsParam([], [])).toBeNull();
  });

  it("the like-state payload keeps only real booleans (the follow read's discipline)", () => {
    expect(normalizeLikeStates({ "track:t1": true, "video:v1": false, "track:t2": "yes" })).toEqual({
      "track:t1": true,
      "video:v1": false,
    });
    expect(normalizeLikeStates(null)).toEqual({});
    expect(normalizeLikeStates("nope")).toEqual({});
  });

  it("the toggle fold takes the server's answer — its count whenever it sends one", () => {
    /* like: the server's count rules, even when it disagrees with ±1 */
    expect(likeStateFromToggle({ liked: false, count: 17 }, { liked: true, count: 19 })).toEqual({
      liked: true,
      count: 19,
    });
    /* unlike: the same, downward */
    expect(likeStateFromToggle({ liked: true, count: 19 }, { liked: false, count: 17 })).toEqual({
      liked: false,
      count: 17,
    });
    /* count absent: step the last known count by the server's verdict */
    expect(likeStateFromToggle({ liked: false, count: 17 }, { liked: true, count: null })).toEqual({
      liked: true,
      count: 18,
    });
    expect(likeStateFromToggle({ liked: true, count: 1 }, { liked: false, count: null })).toEqual({
      liked: false,
      count: 0,
    });
    /* never below zero */
    expect(likeStateFromToggle({ liked: true, count: 0 }, { liked: false, count: null }).count).toBe(0);
  });

  it("the board source: hearts seed from the batched read and fold only from the toggle's answer", () => {
    expect(boardSrc).toContain("/api/discovery/likes?ids=");
    expect(boardSrc).toContain("normalizeLikeStates");
    expect(boardSrc).toContain("chartLikeIdsParam");
    expect(boardSrc).toContain("likeStateFromToggle(current, res)");
    /* the seed never overwrites a settled heart */
    expect(boardSrc).toContain("if (!(key in next))");
    /* the old inline count math is gone — the seam owns the fold */
    expect(boardSrc).not.toContain("res.count !== null ? res.count");
    /* a failed toggle flips nothing: its catch settles no state */
    const toggleAt = boardSrc.indexOf("const toggleRowLike");
    const catchAt = boardSrc.indexOf("} catch {", toggleAt);
    const finallyAt = boardSrc.indexOf("} finally {", toggleAt);
    expect(boardSrc.slice(catchAt, finallyAt)).not.toContain("setLikeStates");
  });

  it("the board source: guests meet the pitch for every gated act, like and watch included", () => {
    expect(boardSrc).toContain("like a row");
    expect(boardSrc).toContain("play or watch rows here");
    /* row actions — Like included — render only inside the member branch */
    const tracksAt = boardSrc.indexOf('tab === "tracks" ? (');
    const guestGateAt = boardSrc.indexOf("isGuest ? undefined", tracksAt);
    const likeAt = boardSrc.indexOf('likeButton("track"', tracksAt);
    expect(guestGateAt).toBeGreaterThan(-1);
    expect(likeAt).toBeGreaterThan(guestGateAt);
  });

  it("the host hands the Charts board the Shelf player itself — the video seam is connected, not just offered", () => {
    const dispatchAt = stationPanelSrc.indexOf('station.id === "charts-desk"');
    expect(dispatchAt).toBeGreaterThan(-1);
    const block = stationPanelSrc.slice(dispatchAt, dispatchAt + 500);
    expect(block).toContain("<ChartsBoard");
    expect(block).toContain("shelfPlayer={shelfPlayer}");
    expect(block).toContain("onPlayTrack={props.onJukeboxAdd}");
  });

  it("the Shelf player the board feeds really plays video in-world (a <video> element for video items)", () => {
    expect(shelfPlayerSrc).toContain('current.kind === "video"');
    expect(shelfPlayerSrc).toContain("<video");
  });
});

describe("the ChartsBoard surface (source pins)", () => {
  it("rides exactly the plan's discovery endpoints", () => {
    /* The windowed reads ride the window seam (charts-board.ts) —
       the URLs it builds are the plan's endpoints, window included. */
    expect(chartsMediaPath("week")).toBe("/api/discovery/charts?window=week&limit=10");
    expect(chartsCreatorsPath("week")).toBe("/api/discovery/charts/creators?window=week&limit=10");
    expect(boardSrc).toContain("chartsMediaPath(window)");
    expect(boardSrc).toContain("chartsCreatorsPath(window)");
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

describe("Ring 4 parity — the window switcher (Today / This week / All time)", () => {
  it("offers exactly the website /charts page's three windows, in order", () => {
    expect(CHART_WINDOWS.map((w) => w.key)).toEqual(["today", "week", "all"]);
    expect(CHART_WINDOWS.map((w) => w.label)).toEqual(["Today", "This week", "All time"]);
  });

  it("every window's read carries its own window param — switching re-queries, never re-slices", () => {
    expect(chartsMediaPath("today")).toBe("/api/discovery/charts?window=today&limit=10");
    expect(chartsMediaPath("week")).toBe("/api/discovery/charts?window=week&limit=10");
    expect(chartsMediaPath("all")).toBe("/api/discovery/charts?window=all&limit=10");
    expect(chartsCreatorsPath("today")).toBe("/api/discovery/charts/creators?window=today&limit=10");
    expect(chartsCreatorsPath("all")).toBe("/api/discovery/charts/creators?window=all&limit=10");
  });

  it("titles and empty states speak the window's noun", () => {
    expect(chartWindowNoun("today")).toBe("today");
    expect(chartWindowNoun("week")).toBe("this week");
    expect(chartWindowNoun("all")).toBe("all time");
  });

  it("the board source: a window state drives the switcher, the fetches, the titles", () => {
    expect(boardSrc).toContain("useState<ChartWindow>");
    expect(boardSrc).toContain("CHART_WINDOWS.map");
    expect(boardSrc).toContain("world-charts-window-${w.key}");
    expect(boardSrc).toContain("setWindow(w.key)");
    /* the load effect re-runs on window change, and media rows
       cache per window — a window's rows are its own server read */
    expect(boardSrc).toContain("[tab, tick, window]");
    expect(boardSrc).toContain("mediaByWindow");
    /* titles come off the window, not a hardcoded "this week" */
    expect(boardSrc).toContain("chartWindowNoun(window)");
    expect(boardSrc).not.toContain("Top tracks — this week");
  });

  it("the board source: the switcher shows only on the windowed tabs", () => {
    /* Rising (7d) and Earners (30d) are fixed spans: their fetch
       paths take no window, and the switcher renders behind the
       windowed-tab gate so it never pretends to move them. */
    expect(boardSrc).toContain('const windowedTab = tab === "tracks" || tab === "videos" || tab === "creators"');
    expect(boardSrc).toContain("{windowedTab && (");
    expect(boardSrc).not.toContain("rising?window");
    expect(boardSrc).not.toContain("rising-earners?window");
    /* the old hardcoded week fetches are gone */
    expect(boardSrc).not.toContain("charts?window=week");
    expect(boardSrc).not.toContain("charts/creators?window=week");
  });
});
