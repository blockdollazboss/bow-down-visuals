/**
 * shelf — the Listening Booth's pure seam (NATIVE-PLAN §3.2).
 *
 * Pins: the purchases payload parses exactly as /my-music reads it
 * (malformed rows dropped, never a crash); only track/video
 * purchases are playable and only tracks can ride the jukebox
 * (in the catalog's `track:<uuid>` form); page/share paths fold
 * /track/:id and /watch/:id in; play inputs resolve their src
 * through the media rails and refuse src-less media; the transport
 * maths clamps; the comment preview is a short list with an honest
 * hidden count. Plus source pins: the booth dispatches from the
 * StationPanel host on pattern "shelf", and the store download
 * token is never used as a playback source anywhere in the booth.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseShelfPurchases,
  shelfMediaKind,
  shelfIsPlayable,
  shelfPagePath,
  shelfJukeboxTrackId,
  shelfDetailLine,
  playInputFromTrack,
  playInputFromVideo,
  isSameShelfItem,
  formatShelfClock,
  clampShelfSeek,
  shelfProgress,
  shelfPreviewComments,
  SHELF_COMMENT_PREVIEW_COUNT,
  type ShelfPurchase,
} from "./shelf";
import type { StreamTrack, StreamVideo } from "@/lib/streaming";

const purchase = (over: Partial<ShelfPurchase> = {}): ShelfPurchase => ({
  id: "sale-1",
  itemKind: "track",
  itemId: "trk-1",
  title: "Gold Standard",
  artistName: "Thy Cheat Code",
  artistSlug: "thy-cheat-code",
  artworkUrl: null,
  amount: "$5.00",
  purchasedAt: "2026-10-01T12:00:00.000Z",
  receiptId: "cs_123",
  buyUrl: "/store/buy/track/trk-1",
  artistUrl: "/artist/thy-cheat-code",
  ...over,
});

describe("parseShelfPurchases — the /my-music payload, parsed honestly", () => {
  it("reads well-formed rows whole", () => {
    const rows = parseShelfPurchases({ purchases: [purchase(), purchase({ id: "sale-2", itemId: "vid-9", itemKind: "video" })] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "sale-1", itemId: "trk-1", title: "Gold Standard" });
    expect(rows[1]?.itemKind).toBe("video");
  });

  it("a missing or malformed body is an empty library, never a crash", () => {
    expect(parseShelfPurchases(null)).toEqual([]);
    expect(parseShelfPurchases({})).toEqual([]);
    expect(parseShelfPurchases({ purchases: "nope" })).toEqual([]);
    expect(parseShelfPurchases("junk")).toEqual([]);
  });

  it("rows without a sale id or item id are dropped; defaults fill the rest", () => {
    const rows = parseShelfPurchases({
      purchases: [
        { itemId: "x" },
        { id: "s" },
        null,
        "junk",
        { id: "s2", itemId: "t2" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "s2", itemId: "t2", title: "Content", artistName: "Creator", itemKind: "track" });
    expect(rows[0]?.buyUrl).toBe("/store/buy/track/t2");
  });
});

describe("playability + the jukebox intent", () => {
  it("only track and video purchases are playable media", () => {
    expect(shelfMediaKind(purchase())).toBe("track");
    expect(shelfMediaKind(purchase({ itemKind: "video" }))).toBe("video");
    expect(shelfMediaKind(purchase({ itemKind: "course" }))).toBeNull();
    expect(shelfIsPlayable(purchase({ itemKind: "sample-pack" }))).toBe(false);
    expect(shelfIsPlayable(purchase({ itemKind: "video" }))).toBe(true);
  });

  it("the jukebox id is the catalog's track:<uuid> form, tracks only", () => {
    expect(shelfJukeboxTrackId(purchase())).toBe("track:trk-1");
    expect(shelfJukeboxTrackId(purchase({ itemKind: "video" }))).toBeNull();
    expect(shelfJukeboxTrackId(purchase({ itemKind: "course" }))).toBeNull();
  });
});

describe("page + share paths — the deeper pages fold in", () => {
  it("tracks fold to /track/:id, videos to /watch/:id, the rest to the drop page", () => {
    expect(shelfPagePath(purchase())).toBe("/track/trk-1");
    expect(shelfPagePath(purchase({ itemKind: "video", itemId: "vid-9" }))).toBe("/watch/vid-9");
    expect(shelfPagePath(purchase({ itemKind: "course", itemId: "c1", buyUrl: "/store/buy/course/c1" }))).toBe("/store/buy/course/c1");
  });

  it("the detail line carries artist, kind, date and amount", () => {
    const line = shelfDetailLine(purchase());
    expect(line).toContain("Thy Cheat Code");
    expect(line).toContain("Song");
    expect(line).toContain("$5.00");
  });
});

const track = (over: Partial<StreamTrack> = {}): StreamTrack => ({
  id: "trk-1",
  profile_id: "prof-1",
  title: "Gold Standard",
  audio_url: "https://cdn.example.com/gold.mp3",
  artwork_url: "https://cdn.example.com/gold.jpg",
  genre: null,
  tags: null,
  duration_sec: 187,
  download_price_cents: null,
  play_count: 10,
  like_count: 4,
  repost_count: 0,
  comment_count: 2,
  is_published: true,
  ...over,
});

const video = (over: Partial<StreamVideo> = {}): StreamVideo => ({
  id: "vid-9",
  profile_id: "prof-1",
  title: "The Coronation (Video)",
  video_url: "https://cdn.example.com/coronation.mp4",
  thumbnail_url: "https://cdn.example.com/coronation.jpg",
  duration_sec: 240,
  description: null,
  view_count: 99,
  like_count: 7,
  comment_count: 5,
  is_published: true,
  ...over,
});

describe("play inputs — resolved through the media rails", () => {
  it("a track becomes a track input with its page, likes and comments", () => {
    const input = playInputFromTrack(purchase(), track(), "Thy Cheat Code");
    expect(input).toMatchObject({
      kind: "track",
      id: "trk-1",
      src: "https://cdn.example.com/gold.mp3",
      pagePath: "/track/trk-1",
      likeCount: 4,
      commentCount: 2,
    });
  });

  it("a video becomes a video input aimed at /watch/:id", () => {
    const input = playInputFromVideo(purchase({ itemKind: "video", itemId: "vid-9" }), video(), null);
    expect(input).toMatchObject({ kind: "video", id: "vid-9", pagePath: "/watch/vid-9", likeCount: 7 });
    expect(input?.artistName).toBe("Thy Cheat Code");
  });

  it("media with no playable source refuses — null, never silent queueing", () => {
    expect(playInputFromTrack(purchase(), track({ audio_url: "" }), null)).toBeNull();
    expect(playInputFromVideo(purchase({ itemKind: "video" }), video({ video_url: "" }), null)).toBeNull();
  });

  it("isSameShelfItem matches on kind + id", () => {
    const a = playInputFromTrack(purchase(), track(), null)!;
    expect(isSameShelfItem(a, { kind: "track", id: "trk-1" })).toBe(true);
    expect(isSameShelfItem(a, { kind: "video", id: "trk-1" })).toBe(false);
    expect(isSameShelfItem(null, a)).toBe(false);
  });
});

describe("transport maths", () => {
  it("formats clocks and clamps seeks + progress", () => {
    expect(formatShelfClock(187)).toBe("3:07");
    expect(formatShelfClock(null)).toBe("0:00");
    expect(clampShelfSeek(50, 40)).toBe(40);
    expect(clampShelfSeek(-3, 40)).toBe(0);
    expect(clampShelfSeek(12, 0)).toBe(12);
    expect(shelfProgress(30, 60)).toBe(0.5);
    expect(shelfProgress(30, 0)).toBe(0);
    expect(shelfProgress(90, 60)).toBe(1);
  });
});

describe("comment preview", () => {
  it("shows the first few and counts the rest honestly", () => {
    const comments = Array.from({ length: 7 }, (_, i) => ({
      id: String(i), user_id: null, display_name: "Fan", avatar_url: null, body: `c${i}`, created_at: "",
    }));
    const { preview, hiddenCount } = shelfPreviewComments(comments);
    expect(preview).toHaveLength(SHELF_COMMENT_PREVIEW_COUNT);
    expect(hiddenCount).toBe(4);
    expect(shelfPreviewComments(comments.slice(0, 2)).hiddenCount).toBe(0);
  });
});

describe("source pins — the booth is wired, the token is not a stream", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("StationPanel dispatches pattern 'shelf' to the ListeningBooth", () => {
    const host = read("../../components/world/StationPanel.tsx");
    expect(host).toContain("ListeningBooth");
    expect(host).toContain('resolution.pattern === "shelf"');
    expect(host).toContain("NowPlayingCard");
  });

  it("the booth rides the purchases + media rails and never the download token as a source", () => {
    const booth = read("../../components/world/native/ListeningBooth.tsx");
    expect(booth).toContain("/api/store/purchases");
    expect(booth).toContain("fetchTrack");
    expect(booth).toContain("fetchVideo");
    expect(booth).not.toContain("/api/store/download");
    expect(booth).not.toContain("store/token");
  });
});
