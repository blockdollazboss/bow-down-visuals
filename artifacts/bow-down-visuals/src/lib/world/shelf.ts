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
import type { MediaComment, MediaKind, StreamTrack, StreamVideo } from "@/lib/streaming";
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
}

/** Build the play input for a purchased track from its media
 *  detail (GET /api/media/track/:id via lib/streaming). Null when
 *  the detail carries no playable audio — the caller says so
 *  honestly instead of queueing silence. */
export function playInputFromTrack(
  p: ShelfPurchase,
  track: StreamTrack,
  artistName: string | null,
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

/* ─── Comments preview (the card's short readable list) ──────────── */

/** How many comments the Now Playing card reads in-world; the rest
 *  of the thread is the card transfer's job (follow-on log). */
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
