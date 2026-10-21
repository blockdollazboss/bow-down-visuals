/**
 * shelf.ts — the Listening Booth's pure data seam (NATIVE-PLAN §3.2).
 *
 * The Shelf is your purchased library on a palace shelf: rows come
 * from GET /api/store/purchases — the exact payload the /my-music
 * page renders (see pages/my-music.tsx) — and a row becomes a
 * playable in-world item through the media rails the /track/:id
 * and /watch/:id pages use (lib/streaming.ts: fetchTrack /
 * fetchVideo → resolveMedia). Everything here is pure: payload
 * parsing, row derivation, page/share paths, the jukebox intent id,
 * the Now Playing preview maths. The component owns the fetches
 * and the media element; this module owns the decisions, so they
 * are testable without a DOM (house test style).
 *
 * The store playback token, honestly: POST /api/store/token (the
 * task brief said GET; the route and /my-music both POST) mints a
 * DOWNLOAD link — its `url` is /api/store/download/<token>, an HTML
 * delivery page that burns one of the link's 5 uses when opened.
 * It is NOT a playable stream source and is never used as one here;
 * playback rides the media detail endpoints instead. Flagged as a
 * follow-on in the lane report.
 */
import type { MediaComment, MediaKind, StreamPlaylist, StreamTrack, StreamVideo } from "@/lib/streaming";
import { resolveMedia } from "@/lib/streaming";

/* ─── Purchases (GET /api/store/purchases) ────────────────────────── */

/** One row of the buyer's library, exactly as /my-music reads it. */
export interface ShelfPurchase {
  /** The sale id (digital_sales.id) — the token mint's saleId. */
  id: string;
  itemKind: string;
  itemId: string;
  title: string;
  artistName: string;
  artistSlug: string;
  artworkUrl: string | null;
  amount: string;
  purchasedAt: string;
  receiptId: string;
  buyUrl: string;
  artistUrl: string | null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Parse the purchases payload the way /my-music does: a missing
 *  or malformed body is an empty library, never a crash; rows
 *  without a sale id or an item id are dropped (they can neither
 *  play, queue, nor be shared). */
export function parseShelfPurchases(payload: unknown): ShelfPurchase[] {
  const list =
    payload && typeof payload === "object" && Array.isArray((payload as { purchases?: unknown }).purchases)
      ? ((payload as { purchases: unknown[] }).purchases as unknown[])
      : [];
  const out: ShelfPurchase[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r["id"]);
    const itemId = str(r["itemId"]);
    if (!id || !itemId) continue;
    const itemKind = str(r["itemKind"], "track");
    out.push({
      id,
      itemKind,
      itemId,
      title: str(r["title"], "Content"),
      artistName: str(r["artistName"], "Creator"),
      artistSlug: str(r["artistSlug"]),
      artworkUrl: typeof r["artworkUrl"] === "string" ? (r["artworkUrl"] as string) : null,
      amount: str(r["amount"]),
      purchasedAt: str(r["purchasedAt"]),
      receiptId: str(r["receiptId"]),
      buyUrl: str(r["buyUrl"], `/store/buy/${itemKind}/${itemId}`),
      artistUrl: typeof r["artistUrl"] === "string" ? (r["artistUrl"] as string) : null,
    });
  }
  return out;
}

/** The media kind a purchase plays as, or null when the purchase
 *  isn't playable media (courses, packs and other drops stay on
 *  the shelf as share-only rows — honest, not fake-playable). */
export function shelfMediaKind(p: Pick<ShelfPurchase, "itemKind">): MediaKind | null {
  if (p.itemKind === "track") return "track";
  if (p.itemKind === "video") return "video";
  return null;
}

export function shelfIsPlayable(p: Pick<ShelfPurchase, "itemKind">): boolean {
  return shelfMediaKind(p) !== null;
}

/** The deeper website page a purchase's full thread / extras live
 *  on: /track/:id for songs, /watch/:id for videos, the drop page
 *  (buyUrl) for everything else. Used ONLY for the Now Playing
 *  card's secondary quiet transfer link and the Share link — never
 *  auto-opened. */
export function shelfPagePath(p: Pick<ShelfPurchase, "itemKind" | "itemId" | "buyUrl">): string {
  const kind = shelfMediaKind(p as ShelfPurchase);
  if (kind === "track") return `/track/${encodeURIComponent(p.itemId)}`;
  if (kind === "video") return `/watch/${encodeURIComponent(p.itemId)}`;
  return p.buyUrl;
}

/** The jukebox intent's track id, in the catalog's `track:<uuid>`
 *  form the room server re-verifies at add time (the jukebox
 *  catalog's own id shape). Tracks only — the jukebox is audio —
 *  and null for anything else, so a video row never offers it. */
export function shelfJukeboxTrackId(p: Pick<ShelfPurchase, "itemKind" | "itemId">): string | null {
  return p.itemKind === "track" ? `track:${p.itemId}` : null;
}

const KIND_LABELS: Record<string, string> = {
  track: "Song",
  video: "Video",
};

export function shelfKindLabel(itemKind: string): string {
  return KIND_LABELS[itemKind] ?? itemKind;
}

/** A shelf row's detail line: artist · kind · when you got it. */
export function shelfDetailLine(p: ShelfPurchase): string {
  const parts = [p.artistName, shelfKindLabel(p.itemKind)];
  const when = Date.parse(p.purchasedAt);
  if (Number.isFinite(when)) {
    parts.push(new Date(when).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
  }
  if (p.amount) parts.push(p.amount);
  return parts.join(" · ");
}

/* ─── The one in-world player ───────────────────────────────────────
   The Shelf player is THE personal player of the palace
   (NATIVE-PLAN §3.2): the Charts board's Play hands tracks to this
   same player. Its controller lives in the StationPanel host and
   is passed down as ONE prop bundle — the same prop/wiring shape
   the jukebox uses (state + intents on StationPanelProps) — so any
   native surface in the host can play through it. */

/** What the player is asked to play: a resolved, playable item.
 *  `src` is a direct media URL resolved by the caller through the
 *  media rails (resolveMedia) — never a store download-page URL. */
export interface ShelfPlayInput {
  kind: MediaKind;
  id: string;
  title: string;
  artistName: string | null;
  artworkUrl: string | null;
  src: string;
  /** The item's full website page (/track/:id or /watch/:id) — the
   *  Now Playing card's secondary quiet transfer for the full
   *  comment thread and the page's extras. */
  pagePath: string;
  likeCount: number;
  commentCount: number;
  /** The owning creator profile's id (media DTOs carry profile_id) —
   *  the More-from-this-artist rail keys off it. Null when unknown. */
  profileId?: string | null;
  /** The artist's profile slug, when the caller holds it — share and
   *  more-from links prefer it, never guess it. */
  artistSlug?: string | null;
  /** Reposts ride the track rails only (POST /api/tracks/:id/repost);
   *  the card offers Repost for tracks and never for videos. */
  repostCount?: number;
  /** True for the owner's own unpublished track (GET
   *  /api/world/my-music): badged in the Booth and on the card, and
   *  the card hides its website transfer — the public /track page
   *  404s unpublished music by design, so the link would dead-end. */
  unpublished?: boolean;
}

/** Build the play input for a purchased track from its media
 *  detail (GET /api/media/track/:id via lib/streaming). Null when
 *  the detail carries no playable audio — the caller says so
 *  honestly instead of queueing silence. */
export function playInputFromTrack(
  p: ShelfPurchase,
  track: StreamTrack,
  artistName: string | null,
  artistSlug: string | null = null,
): ShelfPlayInput | null {
  const src = resolveMedia(track.audio_url);
  if (!src) return null;
  return {
    kind: "track",
    id: String(track.id),
    title: track.title || p.title,
    artistName: artistName ?? p.artistName,
    artworkUrl: track.artwork_url ?? p.artworkUrl,
    src,
    pagePath: `/track/${encodeURIComponent(String(track.id))}`,
    likeCount: track.like_count ?? 0,
    commentCount: track.comment_count ?? 0,
    profileId: track.profile_id ?? null,
    artistSlug: artistSlug ?? p.artistSlug ?? null,
    repostCount: track.repost_count ?? 0,
  };
}

/** Build the play input for a purchased video from its media
 *  detail (GET /api/media/video/:id via lib/streaming). The Now
 *  Playing card renders a <video> element for kind "video" and an
 *  <audio> element for kind "track" — one card, one transport. */
export function playInputFromVideo(
  p: ShelfPurchase,
  video: StreamVideo,
  artistName: string | null,
  artistSlug: string | null = null,
): ShelfPlayInput | null {
  const src = resolveMedia(video.video_url);
  if (!src) return null;
  return {
    kind: "video",
    id: String(video.id),
    title: video.title || p.title,
    artistName: artistName ?? p.artistName,
    artworkUrl: video.thumbnail_url ?? p.artworkUrl,
    src,
    pagePath: `/watch/${encodeURIComponent(String(video.id))}`,
    likeCount: video.like_count ?? 0,
    commentCount: video.comment_count ?? 0,
    profileId: video.profile_id ?? null,
    artistSlug: artistSlug ?? p.artistSlug ?? null,
  };
}

/** A generic play input for a caller that already holds a resolved
 *  src — the Charts lane's hand-off shape (its rows resolve through
 *  the same media rails). Kept here so every lane builds the input
 *  the same way. */
export function shelfPlayInput(input: ShelfPlayInput): ShelfPlayInput {
  return { ...input, src: input.src.trim() };
}

export function isSameShelfItem(
  a: Pick<ShelfPlayInput, "kind" | "id"> | null,
  b: Pick<ShelfPlayInput, "kind" | "id"> | null,
): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

/* ─── The queue (2.12 — queue what's next) ───────────────────────────
   The player's up-next list, as pure list maths the hook composes:
   queue-next puts an item at the FRONT (it is what's next, not what's
   last); a duplicate of the same kind+id is never queued twice —
   queueing it again just moves it to the front. When the current
   item ends, the card takes the head and the rest shift up. */

export function queueUpNext(queue: readonly ShelfPlayInput[], item: ShelfPlayInput): ShelfPlayInput[] {
  const rest = queue.filter((q) => !isSameShelfItem(q, item));
  return [item, ...rest];
}

export function takeQueueNext(queue: readonly ShelfPlayInput[]): {
  next: ShelfPlayInput | null;
  rest: ShelfPlayInput[];
} {
  if (queue.length === 0) return { next: null, rest: [] };
  return { next: queue[0]!, rest: queue.slice(1) };
}

export function removeFromQueue(
  queue: readonly ShelfPlayInput[],
  item: Pick<ShelfPlayInput, "kind" | "id">,
): ShelfPlayInput[] {
  return queue.filter((q) => !isSameShelfItem(q, item));
}

/* ─── My music (2.14 — GET /api/world/my-music) ──────────────────────
   The endpoint's DTO is camelCase (the world catalogs' shape), but
   the boundary normalizer still reads defensively — both casings —
   because DTO drift is this repo's #1 bug family. Rows without an id
   or a playable audio URL are dropped: a row that cannot play is
   never shown as playable. */

export interface MyMusicTrack {
  id: string;
  title: string;
  artistName: string | null;
  artworkUrl: string | null;
  audioUrl: string;
  genre: string | null;
  durationSec: number;
  isPublished: boolean;
  likeCount: number;
  commentCount: number;
}

export function parseMyMusic(payload: unknown): MyMusicTrack[] {
  const list =
    payload && typeof payload === "object" && Array.isArray((payload as { tracks?: unknown }).tracks)
      ? ((payload as { tracks: unknown[] }).tracks as unknown[])
      : [];
  const out: MyMusicTrack[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r["id"]);
    const audioUrl = str(r["audioUrl"] ?? r["audio_url"]);
    if (!id || !audioUrl) continue;
    const numOr = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    out.push({
      id,
      title: str(r["title"], "Untitled"),
      artistName: typeof r["artistName"] === "string" ? (r["artistName"] as string) : null,
      artworkUrl: typeof r["artworkUrl"] === "string" ? (r["artworkUrl"] as string) : null,
      audioUrl,
      genre: typeof r["genre"] === "string" ? (r["genre"] as string) : null,
      durationSec: numOr(r["durationSec"] ?? r["duration_sec"]),
      isPublished: (r["isPublished"] ?? r["is_published"]) === true,
      likeCount: numOr(r["likeCount"] ?? r["like_count"]),
      commentCount: numOr(r["commentCount"] ?? r["comment_count"]),
    });
  }
  return out;
}

/** A my-music row as a play input: the audio URL already rides the
 *  row (the endpoint refreshed it), resolved through the same
 *  resolveMedia the other rails use. Unpublished rows are flagged so
 *  the card can badge them and skip the dead-end website transfer. */
export function playInputFromMyMusic(row: MyMusicTrack): ShelfPlayInput | null {
  const src = resolveMedia(row.audioUrl);
  if (!src) return null;
  return {
    kind: "track",
    id: row.id,
    title: row.title,
    artistName: row.artistName,
    artworkUrl: row.artworkUrl,
    src,
    pagePath: `/track/${encodeURIComponent(row.id)}`,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    unpublished: !row.isPublished,
  };
}

/** The share path for one of your own songs (track extras, 2.15):
 *  its public /track/:id page — the page the website's share
 *  surface points at — for a PUBLISHED song only. An unpublished
 *  song has no public page (the media detail 404s it by design),
 *  so it earns no share path: a link that dead-ends is not an
 *  extra, it's a trap. The Booth folds this path into the full
 *  share link through lib/streaming's shareUrl with the walker's
 *  referral code — the exact link the /track/:id share menu and
 *  the owner's Get Paid finale build. Lyrics and stems are
 *  deliberately NOT extras here: the site stores no lyrics on a
 *  profile track (lyrics live on library songs and distribution
 *  releases, neither keyed to a track) and no stems per track
 *  (stems are a paid splitter job's output, benched at the Audio
 *  Desk) — no honest rail exists to ride, so no button pretends. */
export function myMusicSharePath(row: Pick<MyMusicTrack, "id" | "isPublished">): string | null {
  if (!row.isPublished || !row.id) return null;
  return `/track/${encodeURIComponent(row.id)}`;
}

/* ─── Playlists (2.12 — the site's playlist rails, in-world) ────────
   The rails EXIST on the server (routes/creator-platform.ts):
     GET  /api/playlists/mine        → { playlists: [StreamPlaylist] }
     POST /api/playlists             → create (auth, own profile)
     POST /api/playlists/:id/items   → add item (auth, owner only)
     GET  /api/playlists/:id         → playlist + resolved_items
   lib/streaming.ts already speaks them (fetchMyPlaylists /
   createPlaylist / addItemToPlaylist / fetchPlaylist); this module
   owns only the world-side shaping: the summary normalizer and the
   resolved-items → play-inputs fold. */

export interface ShelfPlaylistSummary {
  id: string;
  title: string;
  coverUrl: string | null;
  itemCount: number;
}

/** Normalize the /playlists/mine payload (snake_case StreamPlaylist
 *  rows ride inside { playlists }) into shelf summaries. The count
 *  prefers an explicit item_count and falls back to items.length. */
export function parseShelfPlaylists(payload: unknown): ShelfPlaylistSummary[] {
  const list =
    payload && typeof payload === "object" && Array.isArray((payload as { playlists?: unknown }).playlists)
      ? ((payload as { playlists: unknown[] }).playlists as unknown[])
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];
  const out: ShelfPlaylistSummary[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r["id"]);
    if (!id) continue;
    const items = Array.isArray(r["items"]) ? (r["items"] as unknown[]) : [];
    const counted = r["item_count"] ?? r["itemCount"];
    out.push({
      id,
      title: str(r["title"], "Untitled playlist"),
      coverUrl: typeof (r["cover_url"] ?? r["coverUrl"]) === "string" ? ((r["cover_url"] ?? r["coverUrl"]) as string) : null,
      itemCount: typeof counted === "number" && Number.isFinite(counted) ? counted : items.length,
    });
  }
  return out;
}

/** Fold a fetched playlist's resolved items into play inputs, in
 *  playlist order — the first plays now, the rest become the queue.
 *  Items whose media carries no playable source are skipped, never
 *  queued as silence. */
export function playInputsFromPlaylist(playlist: StreamPlaylist): ShelfPlayInput[] {
  const out: ShelfPlayInput[] = [];
  for (const entry of playlist.resolved_items ?? []) {
    if (entry.kind === "track") {
      const t = entry.item;
      const src = resolveMedia(t.audio_url);
      if (!src) continue;
      out.push({
        kind: "track",
        id: String(t.id),
        title: t.title,
        artistName: null,
        artworkUrl: t.artwork_url ?? null,
        src,
        pagePath: `/track/${encodeURIComponent(String(t.id))}`,
        likeCount: t.like_count ?? 0,
        commentCount: t.comment_count ?? 0,
        profileId: t.profile_id ?? null,
        repostCount: t.repost_count ?? 0,
      });
    } else {
      const v = entry.item;
      const src = resolveMedia(v.video_url);
      if (!src) continue;
      out.push({
        kind: "video",
        id: String(v.id),
        title: v.title,
        artistName: null,
        artworkUrl: v.thumbnail_url ?? null,
        src,
        pagePath: `/watch/${encodeURIComponent(String(v.id))}`,
        likeCount: v.like_count ?? 0,
        commentCount: v.comment_count ?? 0,
        profileId: v.profile_id ?? null,
      });
    }
  }
  return out;
}

/* ─── Embed code (2.15 — the card's copy-the-player action) ──────────
   The same iframe the website's EmbedButton builds (components/
   player/EmbedButton.tsx): /embed/<kind>/<id>, track 420×200, video
   560×360. The card holds no artist slug, so no ?ref= code rides it —
   an honest plain embed, never an invented referral code. */

export function shelfEmbedCode(
  input: Pick<ShelfPlayInput, "kind" | "id" | "title">,
  origin: string,
): string {
  const w = input.kind === "video" ? 560 : 420;
  const h = input.kind === "video" ? 360 : 200;
  const src = `${origin}/embed/${input.kind}/${encodeURIComponent(input.id)}`;
  const label = `${input.title} — Bow Down Visuals`.replace(/"/g, "&quot;");
  return `<iframe src="${src}" width="${w}" height="${h}" frameborder="0" allow="autoplay; encrypted-media; fullscreen" loading="lazy" title="${label}"></iframe>`;
}

/* ─── Download links + receipts (2.16 — the token's honest use) ─────
   POST /api/store/token is a DELIVERY mint, not a stream: it returns
   { token, url, expiresAt, maxUses } where url is the download page.
   Opening that page burns one of the link's uses — the Booth says so
   in plain words before the member taps, and the copy below is the
   one place that wording lives so it can't drift soft. */

export interface ShelfDownloadMint {
  url: string;
  expiresAt: string | null;
  maxUses: number | null;
}

export function parseDownloadMint(payload: unknown): ShelfDownloadMint | null {
  if (!payload || typeof payload !== "object") return null;
  const r = payload as Record<string, unknown>;
  const url = str(r["url"]);
  if (!url) return null;
  return {
    url,
    expiresAt: typeof r["expiresAt"] === "string" ? (r["expiresAt"] as string) : null,
    maxUses: typeof r["maxUses"] === "number" && Number.isFinite(r["maxUses"]) ? (r["maxUses"] as number) : null,
  };
}

/** The honest burn-a-use wording for a minted link. */
export function downloadMintCopy(mint: ShelfDownloadMint): string {
  const uses = mint.maxUses !== null ? ` It works ${mint.maxUses} times` : " It works a limited number of times";
  const expiry = mint.expiresAt
    ? ` and expires ${new Date(mint.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  return `This is a download link for the file you bought.${uses}${expiry} — every time the link is opened, one use is spent, so send it only where you mean it to land.`;
}

/** A purchase's receipt line: receipt id + what was paid + when.
 *  The purchases payload already carries all three (receiptId is the
 *  checkout session id, falling back to the sale id server-side). */
export function shelfReceiptLine(p: ShelfPurchase): string {
  const parts: string[] = [];
  if (p.receiptId) parts.push(`Receipt ${p.receiptId}`);
  if (p.amount) parts.push(p.amount);
  const when = Date.parse(p.purchasedAt);
  if (Number.isFinite(when)) {
    parts.push(new Date(when).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
  }
  return parts.join(" · ");
}

/* ─── Transport maths (the Now Playing card's simple transport) ──── */

export function formatShelfClock(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Clamp a requested seek into the media's real span. */
export function clampShelfSeek(targetSec: number, durationSec: number): number {
  if (!Number.isFinite(targetSec)) return 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return Math.max(0, targetSec);
  return Math.min(Math.max(0, targetSec), durationSec);
}

/** Progress 0..1 for the seek bar; 0 until the duration is known. */
export function shelfProgress(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(positionSec) || !Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(1, Math.max(0, positionSec / durationSec));
}

/* ─── Comments (the card's thread) ───────────────────────────────────
   Ring 1 showed a 3-comment preview and sent the reader to the
   website for the rest. Ring 2 (2.13) reads the FULL thread in-world:
   the card fetches with SHELF_COMMENT_FULL_LIMIT (the media comments
   endpoint accepts ?limit= up to 100) and posts/replies through the
   same rails (lib/streaming postComment). The preview maths stays
   for any surface that still wants a short list. */

/** The full-thread fetch size for the Now Playing card. */
export const SHELF_COMMENT_FULL_LIMIT = 100;

/** How many comments a short preview list shows. */
export const SHELF_COMMENT_PREVIEW_COUNT = 3;

export function shelfPreviewComments<T extends MediaComment>(comments: readonly T[]): {
  preview: T[];
  hiddenCount: number;
} {
  return {
    preview: comments.slice(0, SHELF_COMMENT_PREVIEW_COUNT),
    hiddenCount: Math.max(0, comments.length - SHELF_COMMENT_PREVIEW_COUNT),
  };
}

/* ─── The thread's honest header (2.13, hardened for stack-20) ─────
   The count beside "Comments" is the SERVER's count for the media —
   the comment_count every play input carries from the media rail,
   which the server bumps on every landed post — never the length of
   the fetched window: the thread fetch caps at
   SHELF_COMMENT_FULL_LIMIT, so a hot thread would otherwise read
   "100" forever. Posts the walker lands in this sitting add on top
   (the server counted them in exactly the same way). When the
   server count is unknown, the loaded rows are the honest fallback;
   during load (loadedCount null) the server count alone carries. */

/** The true thread total to show next to "Comments". */
export function shelfThreadCount(
  serverTotal: number | null | undefined,
  loadedCount: number | null,
  postedCount: number,
): number {
  const base =
    typeof serverTotal === "number" && Number.isFinite(serverTotal) && serverTotal >= 0
      ? Math.floor(serverTotal)
      : Math.max(0, loadedCount ?? 0);
  const posted = Number.isFinite(postedCount) ? Math.max(0, Math.floor(postedCount)) : 0;
  return base + posted;
}

/** When the fetched window is shorter than the true thread, the card
 *  says so instead of letting the window pose as the whole
 *  conversation. Null when the window holds everything. */
export function shelfThreadWindowNote(total: number, loadedCount: number): string | null {
  if (!Number.isFinite(total) || !Number.isFinite(loadedCount)) return null;
  if (total <= loadedCount) return null;
  return `Showing the newest ${loadedCount} of ${total} comments — the whole conversation lives on the full page.`;
}
