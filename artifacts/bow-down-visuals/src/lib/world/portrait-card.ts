/**
 * portrait-card.ts — the Portrait Card's pure seam (NATIVE-PLAN §3.4).
 *
 * The Front Row Gallery (Royal Court) is a CUSTOM station whose
 * websitePath is null — it never had a page of its own to transfer
 * to. Its leak was one level down: a portrait click called
 * `onOpenPage("/artist/:slug")` and mounted the creator's whole
 * Grand Stage profile PAGE inside the panel — a pull-up wearing a
 * native frame. The Portrait Card kills it: a portrait click opens
 * this card IN-WORLD, fed by the same public rails the profile page
 * itself reads, and the card carries its OWN transfer — the one
 * quiet "Open on the website ↗" footer pointing at /artist/<slug>.
 *
 * Rails (all existing, no server work):
 *   GET    /api/creator-profiles/:slug            profile + top_tracks/top_videos + counts
 *   GET    /api/discovery/following?ids=<id>      viewer's follow state (FollowButton's rail)
 *   POST   /api/creator-profiles/:id/follow       → { followed, follower_count }
 *   DELETE /api/creator-profiles/:id/unfollow     → { followed, follower_count }
 *          (:id accepts the profile id OR the slug — the server's
 *          getProfileBySlugOrId; the card passes the profile id)
 *   GET    /api/memberships/public/:creatorUserId tiers (summary rows)
 *   GET    /api/creator-profiles/:slug/store-catalog  shop (summary rows)
 *
 * PLAY SEAM (flagged, deliberate): a top track's Play hands the
 * track to the room jukebox — `jukeboxPickId` builds the catalog
 * form (`track:<uuid>`) the jukebox resolver re-verifies, and the
 * card calls the SAME onJukeboxAdd intent the Jukebox panel uses.
 * That is the closest existing in-world playback mechanism wired
 * into StationPanel today. The personal Shelf player is a sibling
 * lane's surface (§3.2) and exposes no hand-off prop yet; when it
 * lands one, Play should prefer it for a private listen and keep
 * the jukebox as "play for the room". See PORTRAIT_PLAY_SEAM.
 */

/* ─── Endpoints ───────────────────────────────────────────────────── */

/** The card's own transfer target: the creator's full Grand Stage
 *  profile — what "Open on the website ↗" is FOR on this card. */
export function portraitWebsitePath(slug: string): string {
  return `/artist/${encodeURIComponent(slug)}`;
}

export function portraitProfilePath(slug: string): string {
  return `/api/creator-profiles/${encodeURIComponent(slug)}`;
}

export function portraitFollowPath(profileId: string): string {
  return `/api/creator-profiles/${encodeURIComponent(profileId)}/follow`;
}

export function portraitUnfollowPath(profileId: string): string {
  return `/api/creator-profiles/${encodeURIComponent(profileId)}/unfollow`;
}

/** Batched follow state, the discovery FollowButton's exact rail. */
export function portraitFollowingPath(profileIds: readonly string[]): string {
  const ids = [...new Set(profileIds)].filter(Boolean).sort().join(",");
  return `/api/discovery/following?ids=${encodeURIComponent(ids)}`;
}

export function portraitMembershipsPath(creatorUserId: string): string {
  return `/api/memberships/public/${encodeURIComponent(creatorUserId)}`;
}

export function portraitStoreCatalogPath(slug: string): string {
  return `/api/creator-profiles/${encodeURIComponent(slug)}/store-catalog`;
}

/** The jukebox catalog id form for a profile track (routes/world.ts:
 *  catalog ids are `track:<uuid>`, re-verified server-side at add). */
export function jukeboxPickId(trackId: string): string {
  return trackId.startsWith("track:") ? trackId : `track:${trackId}`;
}

export const PORTRAIT_PLAY_SEAM =
  "Play rides the room jukebox (onJukeboxAdd with a track:<id> pick) — the only playback hand-off wired into StationPanel today; the sibling Shelf player's personal-play hand-off is the follow-on seam.";

/* ─── Card view model ─────────────────────────────────────────────── */

export interface PortraitTrack {
  id: string;
  title: string;
  artworkUrl: string | null;
  durationSec: number | null;
  plays: number;
}

export interface PortraitCardData {
  profileId: string;
  userId: string;
  slug: string;
  displayName: string;
  bioLine: string;
  avatarUrl: string | null;
  /** The Front Row seat this portrait hangs in (1-based). */
  seat: number;
  followerCount: number;
  topTracks: PortraitTrack[];
  /** The profile's tip-jar switch (Stack-100 #66): the card offers
   *  tipping only when the creator's own profile carries it on —
   *  the same gate the website's profile chrome uses before it
   *  links the tip page. */
  tipJarEnabled: boolean;
}

interface WireTrack {
  id?: unknown;
  title?: unknown;
  artwork_url?: unknown;
  duration_sec?: unknown;
  play_count?: unknown;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Build the card from a gallery member + the public profile wire
 *  (GET /api/creator-profiles/:slug → { profile, top_tracks, … }).
 *  The gallery member supplies the seat and the fallback identity —
 *  if the profile fetch fails the caller keeps the honest error
 *  state instead of a half-card, so this only runs on real data. */
export function portraitCardFromWire(
  member: { profileId: string; slug: string; displayName: string; avatarUrl: string | null; position: number },
  wire: unknown,
): PortraitCardData {
  const w = (wire ?? {}) as {
    profile?: {
      id?: unknown;
      user_id?: unknown;
      slug?: unknown;
      display_name?: unknown;
      bio?: unknown;
      avatar_url?: unknown;
      follower_count?: unknown;
      tip_jar_enabled?: unknown;
    };
    top_tracks?: unknown;
  };
  const p = w.profile ?? {};
  const tracks: PortraitTrack[] = [];
  if (Array.isArray(w.top_tracks)) {
    for (const raw of w.top_tracks as WireTrack[]) {
      if (!raw || typeof raw.id !== "string" || !raw.id) continue;
      tracks.push({
        id: raw.id,
        title: typeof raw.title === "string" && raw.title ? raw.title : "Untitled track",
        artworkUrl: strOrNull(raw.artwork_url),
        durationSec: typeof raw.duration_sec === "number" ? raw.duration_sec : null,
        plays: numOr(raw.play_count, 0),
      });
    }
  }
  const bio = typeof p.bio === "string" ? p.bio.trim() : "";
  return {
    profileId: typeof p.id === "string" && p.id ? p.id : member.profileId,
    userId: typeof p.user_id === "string" ? p.user_id : "",
    slug: typeof p.slug === "string" && p.slug ? p.slug : member.slug,
    displayName:
      typeof p.display_name === "string" && p.display_name ? p.display_name : member.displayName,
    bioLine: bio.split("\n")[0]?.slice(0, 140) ?? "",
    avatarUrl: strOrNull(p.avatar_url) ?? member.avatarUrl,
    seat: member.position,
    followerCount: numOr(p.follower_count, 0),
    topTracks: tracks.slice(0, 5),
    tipJarEnabled: p.tip_jar_enabled === true,
  };
}

/** Follow button math: after a confirmed toggle the count moves
 *  with the state (the server's follower_count wins when present —
 *  the component prefers it; this is the optimistic fallback). */
export function nextFollowerCount(current: number, following: boolean): number {
  return Math.max(0, current + (following ? 1 : -1));
}

/* ─── Membership / shop summary rows ────────────────────────────────
   The card SUMMARISES these (Join/Buy themselves belong to the Shop
   Stand patterns, §3.3 — the card's rows + its website transfer are
   the v1 hand-off, per the lane brief; no shop is rebuilt here). */

export interface PortraitSummaryRow {
  label: string;
  detail: string;
}

/** Membership summary from GET /api/memberships/public/:userId —
 *  active tiers only (profile-website.ts membershipsViewState's
 *  rule: inactive tiers never render for anyone). */
export function membershipSummaryRows(payload: unknown): PortraitSummaryRow[] {
  const tiers = (payload as { tiers?: unknown })?.tiers;
  if (!Array.isArray(tiers)) return [];
  return tiers
    .filter(
      (t): t is { name: string; priceDollars?: unknown; priceCents?: unknown; isActive?: unknown } =>
        !!t && typeof t === "object" && (t as { isActive?: unknown }).isActive === true,
    )
    .slice(0, 3)
    .map((t) => ({
      label: typeof t.name === "string" && t.name ? t.name : "Membership",
      detail:
        typeof t.priceCents === "number" && t.priceCents > 0
          ? `$${String(t.priceDollars ?? "")} / month`
          : "Free",
    }));
}

/** Shop summary from GET /api/creator-profiles/:slug/store-catalog —
 *  the catalog's own items, priced exactly as the catalog prices
 *  them (its `price` string rides end to end). */
export function shopSummaryRows(payload: unknown): PortraitSummaryRow[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (i): i is { title?: unknown; price?: unknown } =>
        !!i && typeof i === "object" && typeof (i as { title?: unknown }).title === "string",
    )
    .slice(0, 3)
    .map((i) => ({
      label: String(i.title),
      detail: typeof i.price === "string" && i.price ? i.price : "",
    }));
}
