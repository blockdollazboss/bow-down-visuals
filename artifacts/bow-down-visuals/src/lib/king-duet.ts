/**
 * king-duet.ts — payload guard + rail seam for Duet the King (N3).
 *
 * The server side is finished and verified (routes/shorts.ts):
 *   GET    /api/shorts/king-duet        public rail: the King's open
 *                                       clips + the featured picks.
 *   POST   /api/videos/:id/king-feature house-only (the caller must own
 *                                       an official profile); stamps
 *                                       king_featured_at on a published
 *                                       duet of an official clip and
 *                                       notifies the fan. NO CHARGE —
 *                                       the rail carries no credits
 *                                       call anywhere; featuring is free.
 *   DELETE /api/videos/:id/king-feature house-only; clears the stamp.
 *   GET    /api/videos/:id/duets        published duets of one clip,
 *                                       each row carrying its own
 *                                       king_featured_at — the pick
 *                                       candidates the house control
 *                                       reads its truth from.
 *
 * Same normalizer pattern as lib/shorts-data.ts: the panel used to cast
 * the rail response inline, so a partial payload put `undefined` in
 * state. Rows that cannot render honestly (no id / no video) drop;
 * everything else coerces to the full shape.
 */

export interface KingDuetCreator {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
}

export interface KingOpenClip {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  duet_count: number;
  duets_enabled: boolean;
  creator: KingDuetCreator | null;
}

export interface KingFeaturedPick {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  king_featured_at: string | null;
  pick_kind: string;
  creator: KingDuetCreator | null;
  duet_parent: { id: string; title: string | null; creator_slug: string | null; creator_name: string | null } | null;
}

export interface KingDuetRail {
  king: { id: string; slug: string; display_name: string; avatar_url: string | null } | null;
  open_clips: KingOpenClip[];
  featured: KingFeaturedPick[];
}

/** One published duet of an open clip — a pick candidate. */
export interface KingDuetCandidate {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  king_featured_at: string | null;
  creator: KingDuetCreator | null;
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

/* The rail's creator rows are snake_case; the duets-children rows come
   from a DB select and carry camelCase displayName/avatarUrl. Accept
   both — the wire is the wire, the render shape is ours. */
function creatorOf(raw: unknown): KingDuetCreator | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const slug = str(raw.slug);
  const name = str(raw.display_name) ?? str(raw.displayName);
  if (!id || !slug || !name) return null;
  return { id, slug, display_name: name, avatar_url: str(raw.avatar_url) ?? str(raw.avatarUrl) };
}

export function normalizeKingDuetRail(payload: unknown): KingDuetRail {
  if (!isRecord(payload)) return { king: null, open_clips: [], featured: [] };
  const kingRaw = isRecord(payload.king) ? payload.king : null;
  const king = kingRaw && str(kingRaw.id) && str(kingRaw.slug) && str(kingRaw.display_name)
    ? {
        id: str(kingRaw.id)!,
        slug: str(kingRaw.slug)!,
        display_name: str(kingRaw.display_name)!,
        avatar_url: str(kingRaw.avatar_url),
      }
    : null;
  const open_clips = (Array.isArray(payload.open_clips) ? payload.open_clips : [])
    .filter(isRecord)
    .map((r): KingOpenClip | null => {
      const id = str(r.id);
      const video_url = str(r.video_url);
      if (!id || !video_url) return null;
      return {
        id,
        title: str(r.title) ?? "",
        video_url,
        thumbnail_url: str(r.thumbnail_url),
        view_count: num(r.view_count),
        like_count: num(r.like_count),
        duet_count: num(r.duet_count),
        /* Same rule as the feed: only an explicit false closes the door. */
        duets_enabled: r.duets_enabled !== false,
        creator: creatorOf(r.creator),
      };
    })
    .filter((x): x is KingOpenClip => x !== null);
  const featured = (Array.isArray(payload.featured) ? payload.featured : [])
    .filter(isRecord)
    .map((r): KingFeaturedPick | null => {
      const id = str(r.id);
      const video_url = str(r.video_url);
      if (!id || !video_url) return null;
      const parent = isRecord(r.duet_parent) && str(r.duet_parent.id)
        ? {
            id: str(r.duet_parent.id)!,
            title: str(r.duet_parent.title),
            creator_slug: str(r.duet_parent.creator_slug),
            creator_name: str(r.duet_parent.creator_name),
          }
        : null;
      return {
        id,
        title: str(r.title) ?? "",
        video_url,
        thumbnail_url: str(r.thumbnail_url),
        view_count: num(r.view_count),
        like_count: num(r.like_count),
        king_featured_at: str(r.king_featured_at),
        pick_kind: str(r.pick_kind) ?? "house_pick",
        creator: creatorOf(r.creator),
        duet_parent: parent,
      };
    })
    .filter((x): x is KingFeaturedPick => x !== null);
  return { king, open_clips, featured };
}

export function normalizeKingDuetCandidates(payload: unknown): KingDuetCandidate[] {
  if (!isRecord(payload)) return [];
  const rows = Array.isArray(payload.items) ? payload.items : [];
  return rows
    .filter(isRecord)
    .map((r): KingDuetCandidate | null => {
      const id = str(r.id);
      const video_url = str(r.video_url);
      if (!id || !video_url) return null;
      return {
        id,
        title: str(r.title) ?? "",
        video_url,
        thumbnail_url: str(r.thumbnail_url),
        view_count: num(r.view_count),
        like_count: num(r.like_count),
        king_featured_at: str(r.king_featured_at),
        creator: creatorOf(r.creator),
      };
    })
    .filter((x): x is KingDuetCandidate => x !== null);
}

/** The pick stamp is the whole truth: a row IS a King's pick iff the
 *  server stamped it. No client-side pick state exists anywhere else. */
export function isKingFeatured(row: { king_featured_at: string | null }): boolean {
  return typeof row.king_featured_at === "string" && row.king_featured_at.length > 0;
}

/** The write rail: POST features, DELETE unfeatures — same path. */
export function kingFeaturePath(videoId: string): string {
  return `/api/videos/${encodeURIComponent(videoId)}/king-feature`;
}

export function kingFeatureRequest(videoId: string, feature: boolean): { path: string; method: "POST" | "DELETE" } {
  return { path: kingFeaturePath(videoId), method: feature ? "POST" : "DELETE" };
}

/** Where a clip's duet candidates are read from (the children rail). */
export function clipDuetsPath(clipId: string): string {
  return `/api/videos/${encodeURIComponent(clipId)}/duets`;
}

/**
 * Fold a confirmed write result into a row list: the stamped row takes
 * the server's own king_featured_at from the POST response (or null
 * from the DELETE response). Applied ONLY on a successful response —
 * a failed write leaves the list exactly as the server last told it,
 * so the UI can never show a pick the rail didn't make.
 */
export function withKingFeaturedAt<T extends { id: string; king_featured_at: string | null }>(
  rows: readonly T[],
  videoId: string,
  kingFeaturedAt: string | null,
): T[] {
  return rows.map((r) => (r.id === videoId ? { ...r, king_featured_at: kingFeaturedAt } : r));
}
