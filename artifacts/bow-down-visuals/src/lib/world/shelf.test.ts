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
  shelfThreadCount,
  shelfThreadWindowNote,
  queueUpNext,
  takeQueueNext,
  removeFromQueue,
  parseMyMusic,
  playInputFromMyMusic,
  parseShelfPlaylists,
  playInputsFromPlaylist,
  shelfEmbedCode,
  parseDownloadMint,
  downloadMintCopy,
  shelfReceiptLine,
  type ShelfPlayInput,
  type ShelfPurchase,
} from "./shelf";
import type { StreamPlaylist, StreamTrack, StreamVideo } from "@/lib/streaming";

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

describe("the thread's honest header (2.13, stack-20 hardening)", () => {
  it("the server's count wins over the fetched window's length", () => {
    /* A hot thread: the window holds the endpoint-capped 100 rows,
       the server's true count is 137 — the header must say 137. */
    expect(shelfThreadCount(137, 100, 0)).toBe(137);
    expect(shelfThreadCount(4, 4, 0)).toBe(4);
    expect(shelfThreadCount(0, 0, 0)).toBe(0);
  });

  it("during load the server count alone carries; unknown server count falls back to loaded rows", () => {
    expect(shelfThreadCount(12, null, 0)).toBe(12);
    expect(shelfThreadCount(null, null, 0)).toBe(0);
    expect(shelfThreadCount(undefined, 6, 0)).toBe(6);
    expect(shelfThreadCount(Number.NaN, 6, 0)).toBe(6);
  });

  it("this sitting's landed posts add on top — the server counted them the same way", () => {
    expect(shelfThreadCount(10, 10, 1)).toBe(11);
    expect(shelfThreadCount(10, 10, 3)).toBe(13);
    expect(shelfThreadCount(null, 2, 1)).toBe(3);
  });

  it("the window note names the truncation, and only the truncation", () => {
    expect(shelfThreadWindowNote(137, 100)).toContain("newest 100 of 137");
    expect(shelfThreadWindowNote(100, 100)).toBeNull();
    expect(shelfThreadWindowNote(3, 3)).toBeNull();
    expect(shelfThreadWindowNote(0, 0)).toBeNull();
  });
});

const playInput = (over: Partial<ShelfPlayInput> = {}): ShelfPlayInput => ({
  kind: "track",
  id: "trk-1",
  title: "Gold Standard",
  artistName: "Thy Cheat Code",
  artworkUrl: null,
  src: "https://cdn.example.com/gold.mp3",
  pagePath: "/track/trk-1",
  likeCount: 0,
  commentCount: 0,
  ...over,
});

describe("the queue (2.12) — what's next, in order", () => {
  it("queue-next puts the item at the front, and re-queueing moves it there without duplicating", () => {
    const a = playInput({ id: "a" });
    const b = playInput({ id: "b" });
    const c = playInput({ id: "c" });
    expect(queueUpNext([a, b], c).map((q) => q.id)).toEqual(["c", "a", "b"]);
    expect(queueUpNext([a, b], b).map((q) => q.id)).toEqual(["b", "a"]);
    // A video and a track with the same id are different items.
    expect(queueUpNext([a], playInput({ id: "a", kind: "video" }))).toHaveLength(2);
  });

  it("taking the next item shifts the rest up; an empty queue takes nothing", () => {
    const a = playInput({ id: "a" });
    const b = playInput({ id: "b" });
    const { next, rest } = takeQueueNext([a, b]);
    expect(next?.id).toBe("a");
    expect(rest.map((q) => q.id)).toEqual(["b"]);
    expect(takeQueueNext([])).toEqual({ next: null, rest: [] });
  });

  it("removal matches on kind + id", () => {
    const a = playInput({ id: "a" });
    const av = playInput({ id: "a", kind: "video" });
    expect(removeFromQueue([a, av], { kind: "track", id: "a" })).toEqual([av]);
  });
});

describe("my music (2.14) — the owned-but-unpublished seam", () => {
  it("parses the world DTO, drops rows that cannot play, and reads snake_case defensively", () => {
    const rows = parseMyMusic({
      tracks: [
        { id: "d1", title: "Draft One", audioUrl: "https://cdn.example.com/d1.mp3", isPublished: false, likeCount: 1 },
        { id: "d2", title: "Snake Row", audio_url: "https://cdn.example.com/d2.mp3", is_published: true },
        { id: "d3", title: "No audio — dropped", isPublished: false },
        { title: "No id — dropped", audioUrl: "https://cdn.example.com/x.mp3" },
        "junk",
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(rows[0]!.isPublished).toBe(false);
    expect(rows[1]!.isPublished).toBe(true);
    expect(parseMyMusic(null)).toEqual([]);
    expect(parseMyMusic({})).toEqual([]);
  });

  it("a draft becomes a play input flagged unpublished; a published one is not", () => {
    const draft = parseMyMusic({
      tracks: [{ id: "d1", title: "Draft", audioUrl: "https://cdn.example.com/d1.mp3", isPublished: false }],
    })[0]!;
    expect(playInputFromMyMusic(draft)).toMatchObject({
      kind: "track",
      id: "d1",
      src: "https://cdn.example.com/d1.mp3",
      unpublished: true,
    });
    const live = parseMyMusic({
      tracks: [{ id: "d9", title: "Live", audioUrl: "https://cdn.example.com/d9.mp3", isPublished: true }],
    })[0]!;
    expect(playInputFromMyMusic(live)?.unpublished).toBe(false);
  });
});

describe("playlists (2.12) — summaries and the resolved-items fold", () => {
  it("summaries read item_count, fall back to items length, and drop id-less rows", () => {
    const rows = parseShelfPlaylists({
      playlists: [
        { id: "pl1", title: "Late Night", cover_url: null, item_count: 4 },
        { id: "pl2", title: "Counted By Items", items: [{ kind: "track", id: "a" }, { kind: "track", id: "b" }] },
        { title: "no id — dropped" },
      ],
    });
    expect(rows).toEqual([
      { id: "pl1", title: "Late Night", coverUrl: null, itemCount: 4 },
      { id: "pl2", title: "Counted By Items", coverUrl: null, itemCount: 2 },
    ]);
    expect(parseShelfPlaylists(null)).toEqual([]);
  });

  it("resolved items fold into play inputs in order, skipping unplayable media", () => {
    const playlist = {
      id: "pl1",
      owner_profile_id: "prof-1",
      title: "Mix",
      description: null,
      cover_url: null,
      is_public: true,
      items: [],
      follower_count: 0,
      resolved_items: [
        { kind: "track", item: track() },
        { kind: "track", item: track({ id: "silent", audio_url: "" }) },
        { kind: "video", item: video() },
      ],
    } as unknown as StreamPlaylist;
    const inputs = playInputsFromPlaylist(playlist);
    expect(inputs.map((i) => `${i.kind}:${i.id}`)).toEqual(["track:trk-1", "video:vid-9"]);
    expect(inputs[0]).toMatchObject({ pagePath: "/track/trk-1", profileId: "prof-1" });
    expect(playInputsFromPlaylist({ ...playlist, resolved_items: undefined })).toEqual([]);
  });
});

describe("embed + download mint + receipts (2.15 / 2.16)", () => {
  it("the embed code matches the website player's iframe shape per kind", () => {
    const trackCode = shelfEmbedCode(playInput(), "https://bowdownvisuals.com");
    expect(trackCode).toContain('src="https://bowdownvisuals.com/embed/track/trk-1"');
    expect(trackCode).toContain('width="420"');
    expect(trackCode).toContain('height="200"');
    const videoCode = shelfEmbedCode(playInput({ kind: "video", id: "vid-9" }), "https://bowdownvisuals.com");
    expect(videoCode).toContain("/embed/video/vid-9");
    expect(videoCode).toContain('width="560"');
    expect(videoCode).toContain('height="360"');
    expect(trackCode).not.toContain("ref=");
  });

  it("a mint payload parses, junk doesn't, and the copy states the burn honestly", () => {
    const mint = parseDownloadMint({ token: "tok", url: "/api/store/download/tok", expiresAt: "2026-11-01T00:00:00.000Z", maxUses: 5 });
    expect(mint).toMatchObject({ url: "/api/store/download/tok", maxUses: 5 });
    expect(parseDownloadMint(null)).toBeNull();
    expect(parseDownloadMint({})).toBeNull();
    const copy = downloadMintCopy(mint!);
    expect(copy).toContain("5 times");
    expect(copy).toContain("one use is spent");
  });

  it("the receipt line carries the receipt id, the amount and the date", () => {
    const line = shelfReceiptLine(purchase());
    expect(line).toContain("Receipt cs_123");
    expect(line).toContain("$5.00");
    expect(line).toContain("2026");
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
    expect(booth).not.toContain('fetch("/api/store/download');
    expect(booth).not.toContain("fetch(`/api/store/download");
    expect(booth).not.toContain('fetch("/api/store/token"');
    expect(booth).not.toContain("fetch(`/api/store/token`");
  });
});

describe("source pins — playlists + queue-next are wired in the booth (2.12)", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("the booth builds on the site's playlist rails — no parallel store", () => {
    const booth = read("../../components/world/native/ListeningBooth.tsx");
    expect(booth).toContain("fetchMyPlaylists");
    expect(booth).toContain("createPlaylist");
    expect(booth).toContain("addItemToPlaylist");
    expect(booth).toContain("fetchPlaylist");
    expect(booth).toContain("playInputsFromPlaylist");
    expect(booth).toContain("parseShelfPlaylists");
  });

  it("every shelf row offers queue-next and add-to-playlist; the picker can create", () => {
    const booth = read("../../components/world/native/ListeningBooth.tsx");
    expect(booth).toContain('data-testid="world-shelf-queue-next"');
    expect(booth).toContain('data-testid="world-my-music-queue-next"');
    expect(booth).toContain('data-testid="world-shelf-add-to-playlist"');
    expect(booth).toContain('data-testid="world-my-music-add-to-playlist"');
    expect(booth).toContain('data-testid="world-shelf-playlist-picker"');
    expect(booth).toContain('data-testid="world-shelf-playlist-create"');
    expect(booth).toContain("shelfPlayer.queueNext");
  });

  it("playing a playlist puts the first item on and the rest in the queue, in order", () => {
    const booth = read("../../components/world/native/ListeningBooth.tsx");
    expect(booth).toContain('data-testid="world-shelf-playlist-play"');
    expect(booth).toContain("shelfPlayer.play(first!)");
    expect(booth).toContain("shelfPlayer.replaceQueue(rest)");
  });

  it("the player advances when an item ends and shows the queue in the card", () => {
    const player = read("../../components/world/native/ShelfPlayer.tsx");
    expect(player).toContain("onEnded: () => player.advance()");
    expect(player).toContain("takeQueueNext");
    expect(player).toContain("queueUpNext");
    expect(player).toContain('data-testid="world-shelf-queue"');
    expect(player).toContain('data-testid="world-shelf-queue-remove"');
  });

  it("the booth is a members-only door, so guests meet the pitch, never the picker", () => {
    const stations = read("./stations.ts");
    const boothDef = stations.slice(stations.indexOf('id: "listening-booth"'));
    expect(boothDef.slice(0, boothDef.indexOf("},"))).toContain("membersOnly: true");
  });
});

describe("source pins — the Now Playing card's thread (2.13, stack-20 hardening)", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const card = read("../../components/world/native/ShelfPlayer.tsx");

  it("reads the FULL thread through the media comment rails, at the full limit", () => {
    expect(card).toContain("fetchComments(current.kind, current.id, SHELF_COMMENT_FULL_LIMIT)");
    expect(card).not.toContain("shelfPreviewComments");
  });

  it("a failed load is a failed state with a retry — it never becomes an empty-looking thread", () => {
    expect(card).toContain("setCommentsFailed(true)");
    expect(card).not.toContain("setComments([])");
    expect(card).toContain("commentsFailed ? (");
    expect(card).toContain('title="The conversation wouldn\'t load"');
    expect(card).toContain("onRetry={retryThread}");
  });

  it("the header count is the server's true total, and a truncated window says so", () => {
    expect(card).toContain("shelfThreadCount(");
    expect(card).toContain("Comments{threadTotal > 0 ? ` · ${threadTotal}` : \"\"}");
    expect(card).toContain("shelfThreadWindowNote(threadTotal, comments.length)");
  });

  it("posting rides the real rails and counts the landed post", () => {
    expect(card).toContain("postComment(current.kind, current.id, body, await authHeaders())");
    expect(card).toContain("setPostedCount((n) => n + 1)");
  });

  it("guests read the thread and meet the pitch at the composer — no fake affordance", () => {
    expect(card).toContain("Sign in to join the conversation — reading is open to everyone here.");
    expect(card).toContain('data-testid="world-shelf-comment-input"');
    /* The composer block only exists inside the member branch. */
    const pitchAt = card.indexOf("Sign in to join the conversation");
    const memberBranchAt = card.lastIndexOf("user ? (", pitchAt);
    expect(memberBranchAt).toBeGreaterThan(-1);
    expect(card.indexOf('data-testid="world-shelf-comment-input"')).toBeGreaterThan(memberBranchAt);
    expect(card.indexOf('data-testid="world-shelf-comment-input"')).toBeLessThan(pitchAt);
  });
});
