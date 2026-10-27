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
  BRAND_OUTREACH_AUDIENCE_SIZES,
  BRAND_OUTREACH_COST_VB,
  BRAND_OUTREACH_DEAL_TYPES,
  BRAND_OUTREACH_PLATFORMS,
  CHART_VERTICALS,
  CHART_WINDOWS,
  brandOutreachErrorMessage,
  buildBrandOutreachPayload,
  buildUgcBriefPayload,
  chartLikeIdsParam,
  chartLikeKey,
  chartRepostIdsParam,
  chartTrackPlayInput,
  chartVideoPlayInput,
  chartVerticalLabel,
  chartWindowNoun,
  chartsBrandsPath,
  chartsCreatorsPath,
  chartsEarnersPath,
  chartsMediaPath,
  chartsRisingPath,
  followRequest,
  followStateFromResponse,
  followUrl,
  jukeboxTrackId,
  likeStateFromToggle,
  normalizeBrandOutreachResult,
  normalizeChartCreators,
  normalizeChartTracks,
  normalizeChartVideos,
  normalizeFollowStates,
  normalizeLikeStates,
  normalizeRepostStates,
  normalizeUgcBriefResult,
  repostStateFromToggle,
  ugcBriefErrorMessage,
} from "./charts-board";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const boardSrc = read("../../components/world/native/boards/ChartsBoard.tsx");
const outreachPanelSrc = read("../../components/world/native/boards/BrandOutreachPanel.tsx");
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
      repostCount: 0,
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
      { id: "c1", displayName: "Ada Gold", vertical: "music", followerCount: 1200, totalPlays: 34000, newFollowers: null, earnedCents30d: null, topGenre: null, trackCount: null, videoCount: null },
    ]);
  });

  it("brand rows carry the /brands DTO's scouting fields — top genre and published-work counts", () => {
    const rows = normalizeChartCreators(
      {
        creators: [
          { id: "b1", display_name: "Brand Bait", vertical: "music", follower_count: 9000, total_plays: 50000, top_genre: "Hip-Hop", track_count: 14, video_count: 3 },
          { id: "b2", display_name: "No Genre Yet", vertical: "video", follower_count: 10, total_plays: 20, top_genre: null, track_count: 0, video_count: 0 },
        ],
      },
      "creators",
    );
    expect(rows[0]).toMatchObject({ topGenre: "Hip-Hop", trackCount: 14, videoCount: 3 });
    // A real zero is a count, not an absence; a null genre stays null.
    expect(rows[1]).toMatchObject({ topGenre: null, trackCount: 0, videoCount: 0 });
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
    expect(boardSrc).toContain("like or repost a row");
    expect(boardSrc).toContain("play or watch rows here");
    /* Member acts — Like included — render only inside the member
       branch (2.15 widened exactly one read action, embed, to
       guests: it renders BEFORE the branch, never inside it). */
    const tracksAt = boardSrc.indexOf('tab === "tracks" ? (');
    const memberBranchAt = boardSrc.indexOf("{!isGuest && (", tracksAt);
    const likeAt = boardSrc.indexOf('likeButton("track"', tracksAt);
    const embedAt = boardSrc.indexOf('embedButton("track", row)', tracksAt);
    expect(memberBranchAt).toBeGreaterThan(-1);
    expect(likeAt).toBeGreaterThan(memberBranchAt);
    expect(embedAt).toBeGreaterThan(-1);
    expect(embedAt).toBeLessThan(memberBranchAt);
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
    expect(boardSrc).toContain("chartsMediaPath(window, vertical)");
    expect(boardSrc).toContain("chartsCreatorsPath(window, vertical)");
    /* The fixed-span reads ride their builders too — the exact
       strings are pinned at the seam (P3 describe below). */
    expect(boardSrc).toContain("chartsRisingPath(vertical)");
    expect(boardSrc).toContain("chartsEarnersPath(vertical)");
    expect(boardSrc).toContain("chartsBrandsPath(vertical)");
    expect(boardSrc).toContain("/api/discovery/following?ids=");
  });

  it("the For Brands tab scouts in-world; outreach now happens in-world too (P3)", () => {
    expect(boardSrc).toContain('{ key: "brands", label: "For Brands" }');
    /* The old doors are gone — the board mounts the outreach panel
       for members once the scout rows loaded. */
    expect(boardSrc).not.toContain("world-charts-brands-door");
    expect(boardSrc).not.toContain("Scouting only here");
    expect(boardSrc).toContain("<BrandOutreachPanel isLight={isLight} />");
    expect(boardSrc).toContain('tab === "brands" && !isGuest');
    /* The panel rides the site's own two rails and no other write. */
    expect(outreachPanelSrc).toContain('fetch("/api/brand-deals/outreach"');
    expect(outreachPanelSrc).toContain('fetch("/api/ugc-briefs"');
    expect(outreachPanelSrc).toContain("buildBrandOutreachPayload");
    expect(outreachPanelSrc).toContain("buildUgcBriefPayload");
    /* The price is stated on the button before the tap — the
       registry pin, never a surprise charge. */
    expect(outreachPanelSrc).toContain("BRAND_OUTREACH_COST_VB");
    expect(outreachPanelSrc).toContain("Draft my pitch");
    /* The honesty law rides along: the same plain no-money
       statement the briefs board carries, imported from the one
       seam — and exactly one quiet website footer, never more. */
    expect(outreachPanelSrc).toContain("UGC_PAYMENT_NOTE");
    expect(outreachPanelSrc).toContain('from "@/lib/ugc-ads"');
    expect(outreachPanelSrc).toContain('data-testid="world-charts-brands-website"');
    expect(outreachPanelSrc).toContain('href="/brand-deals"');
    expect(outreachPanelSrc).not.toContain('href="/promote"');
    /* Nothing auto-opens: the panel holds no navigation effect. */
    expect(outreachPanelSrc).not.toContain("window.open");
    expect(outreachPanelSrc).not.toContain("setLocation");
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
    expect(boardSrc).toContain("[tab, tick, window, vertical]");
    expect(boardSrc).toContain("mediaByKey");
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

describe("Ring 2 (2.15) — the listening-extras tail: repost, embed, queue", () => {
  const tracks = normalizeChartTracks({
    tracks: [
      { id: "t1", title: "One", like_count: 17, repost_count: 5, audio_url: "https://cdn.example.com/t1.mp3" },
      { id: "t2", title: "Two", like_count: 3, repost_count: 0 },
    ],
  });

  it("chart rows carry the repost counter off the DTO", () => {
    expect(tracks[0]!.repostCount).toBe(5);
    expect(tracks[1]!.repostCount).toBe(0);
    /* a payload without the column reads as 0, never undefined */
    expect(normalizeChartTracks({ tracks: [{ id: "t9", title: "Nine" }] })[0]!.repostCount).toBe(0);
    /* the Shelf hand-off carries it too — the card's Repost opens on it */
    expect(chartTrackPlayInput(tracks[0]!)!.repostCount).toBe(5);
  });

  it("the batched repost read asks about track rows only, once each", () => {
    expect(chartRepostIdsParam(tracks)).toBe("track:t1,track:t2");
    expect(chartRepostIdsParam([...tracks, ...tracks])).toBe("track:t1,track:t2");
    expect(chartRepostIdsParam([])).toBeNull();
  });

  it("the repost-state payload keeps only real booleans (the like read's discipline)", () => {
    expect(normalizeRepostStates({ "track:t1": true, "track:t2": "yes" })).toEqual({ "track:t1": true });
    expect(normalizeRepostStates(null)).toEqual({});
    expect(normalizeRepostStates("nope")).toEqual({});
  });

  it("the repost fold takes the server's answer — its count whenever it sends one", () => {
    expect(repostStateFromToggle({ reposted: false, count: 5 }, { reposted: true, count: 8 })).toEqual({
      reposted: true,
      count: 8,
    });
    expect(repostStateFromToggle({ reposted: true, count: 8 }, { reposted: false, count: 5 })).toEqual({
      reposted: false,
      count: 5,
    });
    expect(repostStateFromToggle({ reposted: false, count: 5 }, { reposted: true, count: null })).toEqual({
      reposted: true,
      count: 6,
    });
    /* never below zero */
    expect(repostStateFromToggle({ reposted: true, count: 0 }, { reposted: false, count: null }).count).toBe(0);
  });

  it("the board source: reposts seed from the batched read, keyed like the hearts", () => {
    expect(boardSrc).toContain("/api/discovery/reposts?ids=");
    expect(boardSrc).toContain("normalizeRepostStates");
    expect(boardSrc).toContain("chartRepostIdsParam");
    expect(boardSrc).toContain("repostStateFromToggle(current, res)");
    /* state is keyed by chartLikeKey — the seed's keys and the
       button's keys must be the same string or the seed is invisible */
    expect(boardSrc).toContain('chartLikeKey("track", row.id)');
    expect(boardSrc).not.toContain("repostStates[row.id]");
    /* the toggle rides the shared rail, not a board-local fetch */
    expect(boardSrc).toContain("toggleRepost(row.id, current.reposted");
    /* a failed toggle flips nothing: its catch settles no state */
    const toggleAt = boardSrc.indexOf("const toggleRowRepost");
    const catchAt = boardSrc.indexOf("} catch {", toggleAt);
    const finallyAt = boardSrc.indexOf("} finally {", toggleAt);
    expect(boardSrc.slice(catchAt, finallyAt)).not.toContain("setRepostStates");
  });

  it("the board source: repost is a track-row member act — video rows never carry it", () => {
    const tracksAt = boardSrc.indexOf('tab === "tracks" ? (');
    const memberBranchAt = boardSrc.indexOf("{!isGuest && (", tracksAt);
    const repostAt = boardSrc.indexOf("repostButton(row)", tracksAt);
    expect(repostAt).toBeGreaterThan(memberBranchAt);
    const videosAt = boardSrc.indexOf('tab === "videos" ? (');
    expect(boardSrc.indexOf("repostButton(row)", videosAt)).toBe(-1);
  });

  it("the board source: embed rides the website player's own served snippet, for both kinds", () => {
    expect(boardSrc).toContain("shelfEmbedCode");
    expect(boardSrc).toContain('embedButton("track", row)');
    expect(boardSrc).toContain('embedButton("video", row)');
    expect(boardSrc).toContain('data-testid="world-charts-embed"');
    expect(boardSrc).toContain('data-testid="world-charts-repost"');
  });

  it("the Shelf source: the queue can be emptied in one tap, through the controller's own clear", () => {
    expect(shelfPlayerSrc).toContain('data-testid="world-shelf-queue-clear"');
    expect(shelfPlayerSrc).toContain("player.clearQueue");
  });
});

describe("P3 — the vertical switcher seam", () => {
  it("offers the no-filter state first, then the canonical verticals under their labels", () => {
    expect(CHART_VERTICALS.map((v) => v.key)).toEqual([
      "all",
      "music",
      "video",
      "gaming",
      "podcast",
      "film",
      "tv",
      "influencer",
      "education",
      "other",
    ]);
    expect(CHART_VERTICALS[0]!.label).toBe("All verticals");
    expect(CHART_VERTICALS[1]!.label).toBe("Music");
    expect(chartVerticalLabel("all")).toBe("All verticals");
    expect(chartVerticalLabel("gaming")).toBe("Gaming");
  });

  it("the unfiltered paths stay byte-identical — 'all' rides no param", () => {
    expect(chartsMediaPath("week")).toBe("/api/discovery/charts?window=week&limit=10");
    expect(chartsMediaPath("week", "all")).toBe("/api/discovery/charts?window=week&limit=10");
    expect(chartsCreatorsPath("week", "all")).toBe(
      "/api/discovery/charts/creators?window=week&limit=10",
    );
    expect(chartsRisingPath()).toBe("/api/discovery/rising?limit=12");
    expect(chartsEarnersPath()).toBe("/api/discovery/rising-earners?limit=12");
    expect(chartsBrandsPath()).toBe("/api/discovery/brands?limit=12");
  });

  it("a chosen vertical rides every board read — switching re-queries the server's filtered read", () => {
    expect(chartsMediaPath("today", "music")).toBe(
      "/api/discovery/charts?window=today&limit=10&vertical=music",
    );
    expect(chartsCreatorsPath("all", "podcast")).toBe(
      "/api/discovery/charts/creators?window=all&limit=10&vertical=podcast",
    );
    expect(chartsRisingPath("gaming")).toBe("/api/discovery/rising?limit=12&vertical=gaming");
    expect(chartsEarnersPath("film")).toBe("/api/discovery/rising-earners?limit=12&vertical=film");
    expect(chartsBrandsPath("influencer")).toBe("/api/discovery/brands?limit=12&vertical=influencer");
  });
});

describe("P3 — the brand outreach seam (the site's own rail, in-world)", () => {
  const goodInput = {
    brand: "Goldline Headphones",
    dealTypeKey: "sponsored-post",
    creatorName: "Thy Cheat Code",
    niche: "Hip-hop production",
    audienceSize: "10k-50k",
    platforms: ["TikTok", "Instagram"],
    contentStyle: "Studio sessions",
  };

  it("the price is the credit registry's pin for the rail — 100 VB", () => {
    expect(BRAND_OUTREACH_COST_VB).toBe(100);
  });

  it("the vocabularies mirror the route's own (audience enum, deal labels, platform presets)", () => {
    expect(BRAND_OUTREACH_AUDIENCE_SIZES.map((a) => a.key)).toEqual([
      "under-1k",
      "1k-10k",
      "10k-50k",
      "50k-250k",
      "250k-plus",
    ]);
    expect(BRAND_OUTREACH_AUDIENCE_SIZES[2]!.label).toBe("10K – 50K followers");
    expect(BRAND_OUTREACH_DEAL_TYPES.map((d) => d.label)).toEqual([
      "Sponsored Post",
      "Affiliate",
      "Ambassadorship",
      "Product Gifting",
      "Usage Licensing",
    ]);
    expect([...BRAND_OUTREACH_PLATFORMS]).toEqual(["TikTok", "Instagram", "YouTube", "Twitch", "X"]);
  });

  it("shapes the exact body the page sends — the deal type rides as its label", () => {
    expect(buildBrandOutreachPayload(goodInput)).toEqual({
      brand: "Goldline Headphones",
      dealType: "Sponsored Post",
      creatorName: "Thy Cheat Code",
      niche: "Hip-hop production",
      audienceSize: "10k-50k",
      platforms: ["TikTok", "Instagram"],
      contentStyle: "Studio sessions",
    });
    /* No deal type chosen → the field rides empty, as the page sends. */
    expect(buildBrandOutreachPayload({ ...goodInput, dealTypeKey: "" })?.["dealType"]).toBe("");
    /* Platforms dedupe and trim; blanks drop out. */
    expect(
      buildBrandOutreachPayload({ ...goodInput, platforms: [" TikTok ", "TikTok", "", "X"] })?.[
        "platforms"
      ],
    ).toEqual(["TikTok", "X"]);
  });

  it("refuses an un-sendable form instead of paying for a 400", () => {
    expect(buildBrandOutreachPayload({ ...goodInput, brand: "  " })).toBeNull();
    expect(buildBrandOutreachPayload({ ...goodInput, creatorName: "" })).toBeNull();
    expect(buildBrandOutreachPayload({ ...goodInput, niche: "" })).toBeNull();
    expect(buildBrandOutreachPayload({ ...goodInput, audienceSize: "millions" })).toBeNull();
    expect(buildBrandOutreachPayload({ ...goodInput, platforms: [] })).toBeNull();
    expect(buildBrandOutreachPayload({ ...goodInput, platforms: [" ", ""] })).toBeNull();
  });

  it("reads a draft answer; a payload without a draft reads as none", () => {
    expect(
      normalizeBrandOutreachResult({
        outreach: { subject: "Partnership: Goldline", message: "Hi team…" },
        tips: ["Lead with your numbers", 42, ""],
        creditsUsed: 100,
        creditsRemaining: 2300,
      }),
    ).toEqual({
      subject: "Partnership: Goldline",
      message: "Hi team…",
      tips: ["Lead with your numbers"],
      creditsUsed: 100,
      creditsRemaining: 2300,
    });
    expect(normalizeBrandOutreachResult({ outreach: { subject: "", message: "x" } })).toBeNull();
    expect(normalizeBrandOutreachResult({ error: "out_of_credits" })).toBeNull();
    expect(normalizeBrandOutreachResult(null)).toBeNull();
  });

  it("error words: the rail's own message first, honest fallbacks after", () => {
    expect(
      brandOutreachErrorMessage(
        { error: "out_of_credits", message: "Not enough credits. Top up to draft a pitch." },
        402,
      ),
    ).toBe("Not enough credits. Top up to draft a pitch.");
    expect(
      brandOutreachErrorMessage({ error: "generation_failed", message: "The draft fizzled." }, 502),
    ).toBe("The draft fizzled.");
    expect(brandOutreachErrorMessage(null, 402)).toContain("out of Visual Bucs");
    expect(brandOutreachErrorMessage(null, 500)).toContain("try again");
  });
});

describe("P3 — the UGC brief seam (the Promote board's own rail)", () => {
  const goodBrief = {
    productName: "Goldline Headphones",
    productUrl: "https://goldline.example.com",
    details: "Show the unboxing, then a beat made wearing them.",
    style: "unboxing",
    deadline: "2026-11-15",
  };

  it("shapes the brief the route accepts — optionals ride only when given", () => {
    expect(buildUgcBriefPayload(goodBrief)).toEqual({
      productName: "Goldline Headphones",
      details: "Show the unboxing, then a beat made wearing them.",
      style: "unboxing",
      productUrl: "https://goldline.example.com",
      deadline: "2026-11-15",
    });
    expect(buildUgcBriefPayload({ ...goodBrief, productUrl: "", deadline: "" })).toEqual({
      productName: "Goldline Headphones",
      details: "Show the unboxing, then a beat made wearing them.",
      style: "unboxing",
    });
  });

  it("refuses what the route would refuse", () => {
    expect(buildUgcBriefPayload({ ...goodBrief, productName: " " })).toBeNull();
    /* The route demands at least ten characters of "what you want". */
    expect(buildUgcBriefPayload({ ...goodBrief, details: "short" })).toBeNull();
    expect(buildUgcBriefPayload({ ...goodBrief, style: "documentary" })).toBeNull();
    expect(buildUgcBriefPayload({ ...goodBrief, productUrl: "goldline.example.com" })).toBeNull();
  });

  it("reads a posted brief; errors speak the rail's words first", () => {
    expect(
      normalizeUgcBriefResult({ brief: { id: "b1", productName: "Goldline", status: "open" } }),
    ).toEqual({ id: "b1", productName: "Goldline", status: "open" });
    expect(normalizeUgcBriefResult({ brief: { productName: "No id" } })).toBeNull();
    expect(normalizeUgcBriefResult({ error: "details is required" })).toBeNull();
    expect(ugcBriefErrorMessage({ error: "details is required" }, 400)).toBe("details is required");
    expect(ugcBriefErrorMessage(null, 500)).toContain("couldn't post");
  });
});

describe("P3 — the board source: the vertical switcher stands on every tab", () => {
  it("a vertical state drives the switcher, the fetches, the caches, the titles", () => {
    expect(boardSrc).toContain("useState<ChartVertical>");
    expect(boardSrc).toContain("CHART_VERTICALS.map");
    expect(boardSrc).toContain("world-charts-vertical-${v.key}");
    expect(boardSrc).toContain("setVertical(v.key)");
    /* every read carries the vertical, and the load effect
       re-runs when it moves — switching re-queries */
    expect(boardSrc).toContain("[tab, tick, window, vertical]");
    /* a chosen vertical names itself in the board title */
    expect(boardSrc).toContain("chartVerticalLabel(vertical)");
    /* unlike the window switcher it is NOT gated to windowed tabs:
       the fixed-span reads filter by vertical too */
    const switcherAt = boardSrc.indexOf('aria-label="Chart vertical"');
    const windowGateAt = boardSrc.indexOf("{windowedTab && (");
    expect(switcherAt).toBeGreaterThan(-1);
    expect(windowGateAt).toBeGreaterThan(-1);
    expect(switcherAt).toBeGreaterThan(windowGateAt);
    expect(boardSrc.slice(windowGateAt, switcherAt)).not.toContain("Chart vertical");
  });

  it("the outreach panel is a native form in both themes — fields, chips, honest states", () => {
    for (const testid of [
      "world-charts-brand-outreach",
      "world-charts-outreach-form",
      "world-outreach-brand",
      "world-outreach-deal-type",
      "world-outreach-creator-name",
      "world-outreach-niche",
      "world-outreach-audience",
      "world-outreach-style",
      "world-outreach-submit",
      "world-charts-brief-form",
      "world-brief-product",
      "world-brief-details",
      "world-brief-style",
      "world-brief-url",
      "world-brief-deadline",
      "world-brief-submit",
    ]) {
      expect(outreachPanelSrc).toContain(`data-testid="${testid}"`);
    }
    expect(outreachPanelSrc).toContain("world-outreach-platform-${p}");
    /* both themes ride the isLight split on the field styling */
    expect(outreachPanelSrc).toContain("isLight");
    expect(outreachPanelSrc).toContain("border-[#C9A84C]/40 bg-white/60");
    expect(outreachPanelSrc).toContain("border-white/10 bg-white/5");
    /* the draft answer renders in-world with a copy, the brief
       confirms in-world — neither doors out */
    expect(outreachPanelSrc).toContain('data-testid="world-outreach-result"');
    expect(outreachPanelSrc).toContain('data-testid="world-outreach-copy"');
    expect(outreachPanelSrc).toContain('data-testid="world-brief-posted"');
  });
});
