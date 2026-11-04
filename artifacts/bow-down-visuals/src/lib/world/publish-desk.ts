/**
 * publish-desk — the standalone Publish desk's pure logic seam
 * (stack1600 world parity wave #4, desk #99, census item B14).
 *
 * THE FEATURE (website): the Publish page (pages/publish.tsx) —
 * the member's own-surface for EXISTING media: upload a finished
 * track or video, save it as a draft or put it live on the
 * creator profile, edit its details, take it down, delete it.
 * Until this desk the World's only contact with the whole
 * /api/publish family was one creation-flow call (the Create
 * desks posting a just-generated song); no World surface listed,
 * edited, deleted, or uploaded publish media. This desk is the
 * /publish page's face inside the palace, stacked at the My
 * Studio board — distinct from the SchedulerDesk (social posts)
 * and from creation-flow posting (making the thing in the first
 * place).
 *
 * THE RAILS (api-server routes/publish.ts, all requireAuth):
 *   POST   /api/publish/upload            multipart "file" →
 *                                         { url, ref }. Audio +
 *                                         video ≤ 80 MB; images
 *                                         (artwork) ≤ 10 MB.
 *   GET    /api/publish/tracks           → { tracks: [row] } —
 *                                         my tracks across all
 *                                         my profiles.
 *   POST   /api/publish/track            → 201 { track }.
 *   PUT    /api/publish/track/:id        → { track }.
 *   DELETE /api/publish/track/:id        → { deleted: id }.
 *   GET    /api/publish/videos           → { videos: [row] }.
 *   POST   /api/publish/video            → 201 { video }.
 *   PUT    /api/publish/video/:id        → { video }.
 *   DELETE /api/publish/video/:id        → { deleted: id }.
 *   GET    /api/creator-profiles         → my profiles (the
 *                                         create rails demand an
 *                                         owned profile_id).
 *
 * MONEY HONESTY: uploading and publishing your own content is
 * FREE — the route's own header says so, and there is NO
 * credit-cost registry row for any /api/publish/* path (the
 * priced neighbours are different rails: /api/album-publish and
 * /api/social/<network>/publish — never quoted here). The desk
 * charges nothing, confirms no spend, and never calls the priced
 * neighbours free or vice versa. The one dollar figure in the
 * flow is the member's OWN download price on a track — their
 * price for their buyers, not a site charge.
 *
 * PAGE DISCIPLINE, MIRRORED: the lists settle per source (the
 * page's S27-44 rule — one rejected shelf never discards the
 * other); a save stores the upload's permanent ref, never the
 * 24h signed URL (and the rail mirrors again server-side
 * regardless); video alt text on an edit is sent verbatim —
 * "" clears, an absent field keeps — because the rail's CASE
 * distinguishes the two; the composer validates in the rail's
 * own terms before anything is sent.
 *
 * DRIFT DISCIPLINE: a listed row with no id or no media URL is
 * dropped, never dressed up; a save whose response carries no
 * usable row reads as failure, not success; a failed shelf is
 * an error with a retry — never an empty shelf.
 */
import { PUBLISH_VERTICALS, type PublishVertical } from "../publish-protocol";

export { PUBLISH_VERTICALS };
export type { PublishVertical };

/* ── Rail paths ─────────────────────────────────────────────────── */

export const PUBLISH_PROFILES_PATH = "/api/creator-profiles";
export const PUBLISH_TRACKS_PATH = "/api/publish/tracks";
export const PUBLISH_VIDEOS_PATH = "/api/publish/videos";
export const PUBLISH_TRACK_PATH = "/api/publish/track";
export const PUBLISH_VIDEO_PATH = "/api/publish/video";
export const PUBLISH_UPLOAD_PATH = "/api/publish/upload";

export function publishTrackPath(id: string): string {
  return `${PUBLISH_TRACK_PATH}/${encodeURIComponent(id)}`;
}

export function publishVideoPath(id: string): string {
  return `${PUBLISH_VIDEO_PATH}/${encodeURIComponent(id)}`;
}

/* ── Rail bounds (routes/publish.ts — pinned in tests) ──────────── */

export const PUBLISH_UPLOAD_MAX_BYTES = 80 * 1024 * 1024;
export const PUBLISH_ARTWORK_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLISH_TITLE_MAX = 160;
export const PUBLISH_GENRE_MAX = 60;
export const PUBLISH_ISRC_MAX = 32;
export const PUBLISH_DESCRIPTION_MAX = 2000;
export const PUBLISH_MAX_TAGS = 12;

/** The /publish page's genre picker list (pages/publish.tsx). */
export const PUBLISH_GENRES = [
  "Hip-Hop", "R&B", "Pop", "Afrobeats", "Trap", "Drill", "EDM", "House",
  "Rock", "Country", "Jazz", "Gospel", "Lo-Fi", "Ambient", "Latin", "K-Pop", "Other",
] as const;

/* ── Verticals & kinds ──────────────────────────────────────────── */

/** Rail nouns: a "track" row is audio content, a "video" row is
 *  video content. The desk speaks in these nouns so its words
 *  always match the rail it rides. */
export type PublishKind = "track" | "video";

export const PUBLISH_VERTICAL_LABELS: Record<PublishVertical, string> = {
  music: "Music",
  video: "Video",
  gaming: "Gaming",
  podcast: "Podcast",
  film: "Film",
  tv: "TV",
  influencer: "Influencer",
  education: "Education",
  other: "Other",
};

/** The page's own split: these verticals default to audio, the
 *  rest to video (pages/publish.tsx AUDIO_VERTICALS). */
export const PUBLISH_AUDIO_VERTICALS: readonly PublishVertical[] = ["music", "podcast", "education"];
export const PUBLISH_VIDEO_VERTICALS: readonly PublishVertical[] = [
  "video", "gaming", "film", "tv", "influencer",
];

export function publishKindForVertical(v: PublishVertical): PublishKind {
  return PUBLISH_AUDIO_VERTICALS.includes(v) ? "track" : "video";
}

export function publishCollectionPath(kind: PublishKind): string {
  return kind === "track" ? PUBLISH_TRACK_PATH : PUBLISH_VIDEO_PATH;
}

export function publishItemPath(item: Pick<PublishItem, "kind" | "id">): string {
  return item.kind === "track" ? publishTrackPath(item.id) : publishVideoPath(item.id);
}

/* ── Profiles (GET /api/creator-profiles) ───────────────────────── */

export interface PublishProfile {
  id: string;
  slug: string;
  displayName: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The profiles response in any of the shapes the rail's own
 * reader accepts (array, { profiles }, or a single object) —
 * rows without an id are dropped, never dressed up.
 */
export function parsePublishProfiles(data: unknown): PublishProfile[] {
  if (!isRecord(data) && !Array.isArray(data)) return [];
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(data["profiles"])
      ? (data["profiles"] as unknown[])
      : typeof data["id"] === "string"
        ? [data]
        : [];
  const out: PublishProfile[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const id = str(raw["id"]);
    if (!id) continue;
    out.push({
      id,
      slug: str(raw["slug"]),
      displayName: strOrNull(raw["display_name"]),
    });
  }
  return out;
}

/* ── Media rows ─────────────────────────────────────────────────── */

export interface PublishItem {
  id: string;
  kind: PublishKind;
  profileId: string;
  title: string;
  mediaUrl: string;
  artworkUrl: string | null;
  isPublished: boolean;
  genre: string | null;
  tags: string[];
  isrc: string | null;
  durationSec: number | null;
  /** Tracks only — the member's own download price for buyers. */
  downloadPriceCents: number | null;
  /** Videos only. */
  description: string | null;
  season: number | null;
  episode: number | null;
  thumbnailAltText: string | null;
}

function tagsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is string => typeof t === "string");
}

function trackOfRow(raw: unknown): PublishItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const mediaUrl = str(raw["audio_url"]);
  if (!id || !mediaUrl) return null;
  return {
    id,
    kind: "track",
    profileId: str(raw["profile_id"]),
    title: str(raw["title"]) || "Untitled",
    mediaUrl,
    artworkUrl: strOrNull(raw["artwork_url"]),
    isPublished: raw["is_published"] === true,
    genre: strOrNull(raw["genre"]),
    tags: tagsOf(raw["tags"]),
    isrc: strOrNull(raw["isrc"]),
    durationSec: numOrNull(raw["duration_sec"]),
    downloadPriceCents: numOrNull(raw["download_price_cents"]),
    description: null,
    season: null,
    episode: null,
    thumbnailAltText: null,
  };
}

function videoOfRow(raw: unknown): PublishItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const mediaUrl = str(raw["video_url"]);
  if (!id || !mediaUrl) return null;
  return {
    id,
    kind: "video",
    profileId: str(raw["profile_id"]),
    title: str(raw["title"]) || "Untitled",
    mediaUrl,
    artworkUrl: strOrNull(raw["thumbnail_url"]),
    isPublished: raw["is_published"] === true,
    genre: null,
    tags: [],
    isrc: null,
    durationSec: numOrNull(raw["duration_sec"]),
    downloadPriceCents: null,
    description: strOrNull(raw["description"]),
    season: numOrNull(raw["season"]),
    episode: numOrNull(raw["episode"]),
    thumbnailAltText:
      typeof raw["thumbnail_alt_text"] === "string" ? (raw["thumbnail_alt_text"] as string) : null,
  };
}

export function parsePublishTracks(data: unknown): PublishItem[] {
  const rows = isRecord(data) ? data["tracks"] : undefined;
  if (!Array.isArray(rows)) return [];
  const out: PublishItem[] = [];
  for (const raw of rows) {
    const item = trackOfRow(raw);
    if (item) out.push(item);
  }
  return out;
}

export function parsePublishVideos(data: unknown): PublishItem[] {
  const rows = isRecord(data) ? data["videos"] : undefined;
  if (!Array.isArray(rows)) return [];
  const out: PublishItem[] = [];
  for (const raw of rows) {
    const item = videoOfRow(raw);
    if (item) out.push(item);
  }
  return out;
}

/** A save's response row — null when the rail's answer carries
 *  no usable row (the desk reads that as failure, not success). */
export function publishItemOfSaveResponse(kind: PublishKind, data: unknown): PublishItem | null {
  if (!isRecord(data)) return null;
  return kind === "track" ? trackOfRow(data["track"]) : videoOfRow(data["video"]);
}

/* ── The composer draft ─────────────────────────────────────────── */

export interface PublishDraft {
  kind: PublishKind;
  /** The category the save stamps (tracks: into tags; the rail
   *  reads it on both kinds). */
  category: PublishVertical;
  title: string;
  /** A hosted media link (from a creation tool, or already
   *  uploaded). A picked file overrides it at save time. */
  mediaUrl: string;
  /** Artwork (track) / thumbnail (video) link, when set by link
   *  rather than by upload. */
  artworkUrl: string;
  genre: string;
  tagsInput: string;
  isrc: string;
  /** The member's download price for buyers, as typed ("4.99");
   *  tracks only, "" / "0" = free download. */
  priceDollars: string;
  description: string;
  season: string;
  episode: string;
  thumbnailAltText: string;
  /** The Live switch: where the saved row lands. */
  publishNow: boolean;
}

export const EMPTY_PUBLISH_DRAFT: PublishDraft = {
  kind: "track",
  category: "music",
  title: "",
  mediaUrl: "",
  artworkUrl: "",
  genre: "",
  tagsInput: "",
  isrc: "",
  priceDollars: "",
  description: "",
  season: "",
  episode: "",
  thumbnailAltText: "",
  publishNow: false,
};

/** Picking a vertical flips the composer's kind the way the
 *  page's picker does — unless the member already chose a kind
 *  by hand for this draft (an edit keeps its row's kind). */
export function draftForVertical(draft: PublishDraft, v: PublishVertical): PublishDraft {
  return { ...draft, category: v, kind: publishKindForVertical(v) };
}

export function draftOfItem(item: PublishItem): PublishDraft {
  const tag0 = item.tags[0];
  const category: PublishVertical =
    tag0 && (PUBLISH_VERTICALS as readonly string[]).includes(tag0)
      ? (tag0 as PublishVertical)
      : item.kind === "track"
        ? "music"
        : "video";
  return {
    kind: item.kind,
    category,
    title: item.title === "Untitled" ? "" : item.title,
    mediaUrl: item.mediaUrl,
    artworkUrl: item.artworkUrl ?? "",
    genre: item.genre ?? "",
    tagsInput: item.tags.join(", "),
    isrc: item.isrc ?? "",
    priceDollars:
      item.downloadPriceCents && item.downloadPriceCents > 0
        ? String(item.downloadPriceCents / 100)
        : "",
    description: item.description ?? "",
    season: item.season ? String(item.season) : "",
    episode: item.episode ? String(item.episode) : "",
    thumbnailAltText: item.thumbnailAltText ?? "",
    publishNow: item.isPublished,
  };
}

export function parseTagsInput(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The member's typed download price → cents, the page's own
 *  math (never negative, non-numbers read as free). */
export function priceCentsOfDollarsInput(input: string): number {
  return Math.round(Math.max(0, Number(input) || 0) * 100);
}

function positiveIntOrUndefined(input: string): number | undefined {
  const n = Number(input);
  if (!input.trim() || !Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

/**
 * The draft's problem, in the rail's own terms — null when the
 * rail would accept the save. Media: a create needs a file or a
 * link; an edit keeps its row's media unless replaced, so media
 * is only demanded when neither a file nor a link is present
 * AND nothing is being edited.
 */
export function publishDraftError(
  draft: PublishDraft,
  opts: { hasFile: boolean; editing: boolean },
): string | null {
  if (!draft.title.trim()) return "Give your content a title.";
  if (draft.title.trim().length > PUBLISH_TITLE_MAX) return "That title is too long.";
  if (!opts.hasFile && !draft.mediaUrl.trim() && !opts.editing) {
    return draft.kind === "track"
      ? "Add your audio file — or paste a link to it."
      : "Add your video file — or paste a link to it.";
  }
  if (draft.mediaUrl.trim() && draft.mediaUrl.trim().length > 2048) {
    return "That media link is too long.";
  }
  if (draft.genre.trim().length > PUBLISH_GENRE_MAX) return "That genre is too long.";
  if (draft.isrc.trim().length > PUBLISH_ISRC_MAX) return "That ISRC is too long.";
  if (parseTagsInput(draft.tagsInput).length > PUBLISH_MAX_TAGS) {
    return `Keep it to ${PUBLISH_MAX_TAGS} tags or fewer.`;
  }
  if (draft.description.length > PUBLISH_DESCRIPTION_MAX) {
    return "That description is too long.";
  }
  if (draft.season.trim() && positiveIntOrUndefined(draft.season) === undefined) {
    return "Season must be a whole number, 1 or more.";
  }
  if (draft.episode.trim() && positiveIntOrUndefined(draft.episode) === undefined) {
    return "Episode must be a whole number, 1 or more.";
  }
  return null;
}

/** The page's exact track save body (create POST and edit PUT
 *  alike). `mediaUrl` / `artworkUrl` are the values that will be
 *  STORED — the caller passes the upload ref (never the signed
 *  URL) or the mirrored link, exactly like the page. */
export function buildTrackPayload(
  draft: PublishDraft,
  profileId: string,
  mediaUrl: string | null,
  artworkUrl: string | null,
  durationSec: number | null,
) {
  return {
    profile_id: profileId,
    title: draft.title.trim(),
    audio_url: mediaUrl,
    artwork_url: artworkUrl,
    genre: draft.genre.trim() || undefined,
    category: draft.category,
    tags: parseTagsInput(draft.tagsInput),
    isrc: draft.isrc.trim() || undefined,
    duration_sec: durationSec ?? undefined,
    download_price_cents: priceCentsOfDollarsInput(draft.priceDollars),
    is_published: draft.publishNow,
  };
}

/** The page's exact video save body. Alt-text semantics are the
 *  rail's: an EDIT sends the field verbatim ("" clears — the
 *  server's CASE distinguishes absent from empty); a CREATE
 *  omits it when blank. */
export function buildVideoPayload(
  draft: PublishDraft,
  profileId: string,
  mediaUrl: string | null,
  artworkUrl: string | null,
  durationSec: number | null,
  isEdit: boolean,
) {
  return {
    profile_id: profileId,
    title: draft.title.trim(),
    video_url: mediaUrl,
    thumbnail_url: artworkUrl,
    category: draft.category,
    duration_sec: durationSec ?? undefined,
    description: draft.description.trim() || undefined,
    is_published: draft.publishNow,
    thumbnail_alt_text: isEdit
      ? draft.thumbnailAltText
      : draft.thumbnailAltText.trim() || undefined,
    season: positiveIntOrUndefined(draft.season),
    episode: positiveIntOrUndefined(draft.episode),
  };
}

/** The publish-state toggle's whole body — the rail's PUT is
 *  COALESCE throughout, so one field changes exactly one field. */
export function buildPublishStateBody(isPublished: boolean) {
  return { is_published: isPublished };
}

/* ── Uploads (POST /api/publish/upload) ─────────────────────────── */

export type PublishUploadKind = "audio" | "video" | "artwork";

/** The rail's own kind derivation from the file's MIME type —
 *  null for a type the rail refuses outright. */
export function publishUploadKindFor(mime: string): PublishUploadKind | null {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "artwork";
  return null;
}

/** Pre-flight in the page's words, against the rail's caps —
 *  the rail refuses the same files with the same meaning, so a
 *  bad pick is stopped here instead of after an 80 MB upload. */
export function publishMediaFileError(
  file: { type: string; size: number },
  kind: PublishKind,
): string | null {
  const isAudio = file.type.startsWith("audio/");
  const isVideo = file.type.startsWith("video/");
  if (kind === "track" && !isAudio) return "Drop an audio file (MP3, WAV, M4A…) for a track.";
  if (kind === "video" && !isVideo) return "Drop a video file (MP4, MOV, WebM) for a video.";
  if (!isAudio && !isVideo) return "That file type isn't supported — use audio or video.";
  if (file.size > PUBLISH_UPLOAD_MAX_BYTES) return "That file is over the 80 MB upload limit.";
  return null;
}

export function publishArtworkFileError(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return "Artwork must be an image file.";
  if (file.size > PUBLISH_ARTWORK_MAX_BYTES) return "Artwork must be 10 MB or smaller.";
  return null;
}

export interface PublishUpload {
  /** Playable (signed) URL — for previews only. */
  url: string;
  /** The permanent storage ref — the value a save stores. */
  ref: string | null;
}

export function publishUploadOfResponse(data: unknown): PublishUpload | null {
  if (!isRecord(data)) return null;
  const url = str(data["url"]);
  if (!url) return null;
  return { url, ref: strOrNull(data["ref"]) };
}

/* ── List helpers ───────────────────────────────────────────────── */

export function withoutPublishItem(items: readonly PublishItem[], id: string): PublishItem[] {
  return items.filter((i) => i.id !== id);
}

export function withPublishItemState(
  items: readonly PublishItem[],
  id: string,
  isPublished: boolean,
): PublishItem[] {
  return items.map((i) => (i.id === id ? { ...i, isPublished } : i));
}

/** "3:07" for list rows; "" when the rail never learned it. */
export function publishDurationLabel(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "";
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The member's download price, for track rows: their price for
 *  their buyers — never a site charge. */
export function publishPriceLabel(cents: number | null): string {
  if (!cents || cents <= 0) return "Free download";
  return `$${(cents / 100).toFixed(2)} download`;
}
