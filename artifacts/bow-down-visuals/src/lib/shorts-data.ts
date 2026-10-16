/**
 * shorts-data.ts — payload guard for the Shorts feed (Lane V4 item 1).
 *
 * Same normalizer pattern as lib/explore-data.ts / lib/destination-keys.ts:
 * the feed page used to cast the /api/shorts/feed response straight to
 * FeedResponse, so a partial payload (missing `items`) put `undefined`
 * in state and the render's .map tripped the route error boundary —
 * even though the page has honest loading/error/empty states. Rows
 * that cannot render an honest slide (no id, no video, no creator
 * identity) are dropped; everything else is coerced to the full shape
 * so render reads are always safe. A non-object payload normalizes to
 * the empty feed (the page's designed empty state), never a crash.
 */
import type { ShortItem } from "@/pages/shorts";

export interface ShortsFeed {
  items: ShortItem[];
  next_cursor: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function normalizeShortItem(raw: unknown): ShortItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const videoUrl = str(raw.video_url);
  if (!id || !videoUrl) return null;
  const creator = isRecord(raw.creator) ? raw.creator : null;
  const creatorId = creator ? str(creator.id) : null;
  const creatorSlug = creator ? str(creator.slug) : null;
  const creatorName = creator ? str(creator.display_name) : null;
  if (!creatorId || !creatorSlug || !creatorName) return null;

  const sound = isRecord(raw.sound)
    ? {
        id: str(raw.sound.id) ?? "",
        title: str(raw.sound.title),
        url: str(raw.sound.url),
        use_count: num(raw.sound.use_count),
      }
    : null;
  const parent = (v: unknown) =>
    isRecord(v) && str(v.id)
      ? { id: str(v.id)!, title: str(v.title), creator_slug: str(v.creator_slug) }
      : null;
  const challenges = Array.isArray(raw.challenges)
    ? raw.challenges
        .filter(isRecord)
        .map((c) => ({ slug: str(c.slug) ?? "", title: str(c.title) ?? "", hashtag: str(c.hashtag) ?? "" }))
        .filter((c) => c.slug !== "")
    : [];

  return {
    id,
    profile_id: str(raw.profile_id) ?? "",
    title: str(raw.title) ?? "",
    video_url: videoUrl,
    thumbnail_url: str(raw.thumbnail_url),
    description: str(raw.description) ?? "",
    tags: strList(raw.tags),
    duration_sec: num(raw.duration_sec),
    view_count: num(raw.view_count),
    like_count: num(raw.like_count),
    repost_count: num(raw.repost_count),
    comment_count: num(raw.comment_count),
    download_price_cents: num(raw.download_price_cents),
    duet_with: str(raw.duet_with),
    stitch_with: str(raw.stitch_with),
    sound,
    score: num(raw.score),
    creator: {
      id: creatorId,
      slug: creatorSlug,
      display_name: creatorName,
      avatar_url: creator ? str(creator.avatar_url) : null,
    },
    duet_parent: parent(raw.duet_parent),
    stitch_parent: parent(raw.stitch_parent),
    duet_count: num(raw.duet_count),
    stitch_count: num(raw.stitch_count),
    challenges,
    viewer_liked: raw.viewer_liked === true,
    viewer_following: raw.viewer_following === true,
    created_at: str(raw.created_at) ?? "",
  };
}

export function normalizeShortsFeed(payload: unknown): ShortsFeed {
  if (!isRecord(payload)) return { items: [], next_cursor: null };
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems
    .map(normalizeShortItem)
    .filter((x): x is ShortItem => x !== null);
  return { items, next_cursor: str(payload.next_cursor) };
}
