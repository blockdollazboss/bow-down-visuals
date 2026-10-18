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
 * hidden count; your own songs' one honest extra — a published song
 * carries a share path, an unpublished one none. Plus source pins: the booth dispatches from the
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
  queueUpNext,
  takeQueueNext,
  removeFromQueue,
  parseMyMusic,
  playInputFromMyMusic,
  myMusicSharePath,
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

describe("track extras on your own songs (2.15) — the share path gate", () => {
  it("a published own song shares at its public track page", () => {
    expect(myMusicSharePath({ id: "d9", isPublished: true })).toBe("/track/d9");
  });

  it("an unpublished own song has NO share path — its public page doesn't exist yet", () => {
    expect(myMusicSharePath({ id: "d1", isPublished: false })).toBeNull();
  });

  it("the id is URL-encoded into the path, like every other page path here", () => {
    expect(myMusicSharePath({ id: "a b/c", isPublished: true })).toBe("/track/a%20b%2Fc");
  });

  it("a parsed my-music row feeds the gate unchanged: live rows share, drafts don't", () => {
    const rows = parseMyMusic({
      tracks: [
        { id: "d1", title: "Draft", audioUrl: "https://cdn.example.com/d1.mp3", isPublished: false },
        { id: "d9", title: "Live", audioUrl: "https://cdn.example.com/d9.mp3", isPublished: true },
      ],
    });
    expect(rows.map((r) => myMusicSharePath(r))).toEqual([null, "/track/d9"]);
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

describe("source pins — track extras on Your Songs (2.15)", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("the booth offers Share on a your-songs row, behind the seam's published gate", () => {
    const booth = read("../../components/world/native/ListeningBooth.tsx");
    expect(booth).toContain('data-testid="world-my-music-share"');
    expect(booth).toContain("const sharePath = myMusicSharePath(row);");
    expect(booth).toContain("{sharePath && (");
  });

  it("the share link rides the website's share surface — referral-coded, like the track page", () => {
    const booth = read("../../components/world/native/ListeningBooth.tsx");
    expect(booth).toContain("getMyReferralCode(getAccessToken)");
    expect(booth).toContain("shareUrl(path, code)");
    expect(booth).toContain("copyText(shareUrl(path, code))");
  });

  it("no lyrics or stems affordance is faked onto the row — those rails don't exist per track", () => {
    const booth = read("../../components/world/native/ListeningBooth.tsx");
    expect(booth).not.toContain("world-my-music-lyrics");
    expect(booth).not.toContain("world-my-music-stems");
    expect(booth).not.toContain("/api/stems");
  });
});
