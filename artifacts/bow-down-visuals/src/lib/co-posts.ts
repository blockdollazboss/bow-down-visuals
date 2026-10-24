/* ─── Co-posts (Stack-100 #3, #24) — client contract ────────────────────────
   One Feed post, BOTH creators' profiles, one shared set of likes and
   comments. The server (api-server lib/co-posts.ts) owns the consent
   state machine; this module is the client's mirror of its vocabulary:
   paths, state labels, the actions a viewer may take, and the exact
   consent copy every co-post surface must carry. */

export interface CoAuthorSummary {
  profile_id: string;
  user_id: string;
  role: string; // 'author' | 'co_author'
  status: string; // 'pending' | 'accepted' | 'declined' | 'withdrawn'
  accepted_at: string | null;
  display_name: string | null;
  slug: string | null;
  avatar_url: string | null;
  is_verified: boolean;
}

export type CoPostState = "pending" | "live" | "live_one_side" | "declined" | "cancelled";

export interface CoPostItem {
  id: string;
  body: string;
  media_urls: Array<{ kind: string; url?: string; [k: string]: unknown }>;
  audience: string;
  created_at: string;
  is_co_post: boolean;
  co_post_state: CoPostState;
  engagement: { like_count: number; reply_count: number; repost_count: number };
  like_count: number;
  reply_count: number;
  repost_count: number;
  authors: CoAuthorSummary[];
  viewer_side: { role: string; status: string; profile_id: string } | null;
}

/* The consent wording — MUST stay sentence-identical to the API's
   CO_POST_CONSENT_COPY (api-server src/lib/co-posts.ts); the test in
   co-posts.test.ts pins these strings on this side. */
export const CO_POST_CONSENT_COPY = {
  bothApprove: "Both creators must approve before a co-post goes live.",
  sharedCounts:
    "A co-post is one post on both profiles, with one shared set of likes and comments — never counted twice.",
  withdraw:
    "Either creator can withdraw their own side at any time: the post leaves their profile, and the other creator keeps theirs.",
} as const;

export const CO_POSTS_PATH = "/api/co-posts";
export const CO_POSTS_MINE_PATH = "/api/co-posts/mine";

export function coPostByProfilePath(profileId: string): string {
  return `/api/co-posts/by-profile/${encodeURIComponent(profileId)}`;
}

export function coPostActionPath(postId: string, action: "accept" | "decline" | "withdraw"): string {
  return `/api/co-posts/${encodeURIComponent(postId)}/${action}`;
}

export function coPostStateLabel(state: string): string {
  switch (state) {
    case "live":
      return "Live on both profiles";
    case "live_one_side":
      return "Live — one side withdrawn";
    case "pending":
      return "Waiting for approval";
    case "declined":
      return "Declined — never went live";
    case "cancelled":
      return "Withdrawn before it went live";
    default:
      return state;
  }
}

/** The author sides still standing behind the post (accepted only).
 *  A withdrawn creator is never bylined — their side is gone. */
export function standingAuthors(authors: CoAuthorSummary[]): CoAuthorSummary[] {
  return authors.filter((a) => a.status === "accepted");
}

/** "A × B" byline names for a live co-post: initiator first, then the
 *  co-author — only sides still standing. Fewer than two standing
 *  sides means the card renders as an ordinary solo post. */
export function coBylineNames(authors: CoAuthorSummary[]): string[] {
  return standingAuthors(authors).map((a) => a.display_name ?? "Creator");
}

export type CoPostViewerAction = "accept" | "decline" | "withdraw";

/** Which actions the VIEWER may take on a co-post, mirroring the
 *  server machine: a pending side may accept/decline; an accepted side
 *  may withdraw (their side only); everyone else just watches. */
export function coPostViewerActions(item: Pick<CoPostItem, "viewer_side" | "co_post_state">): CoPostViewerAction[] {
  const side = item.viewer_side;
  if (!side) return [];
  if (side.status === "pending" && item.co_post_state === "pending") return ["accept", "decline"];
  if (side.status === "accepted") return ["withdraw"];
  return [];
}

/** The partner to pre-select when arriving from an accepted collab:
 *  the OTHER side of the item, as a user id the create form accepts. */
export function otherAuthorUserId(item: Pick<CoPostItem, "authors" | "viewer_side">, viewerProfileId: string): string | null {
  const other = item.authors.find((a) => a.profile_id !== viewerProfileId);
  return other?.user_id ?? null;
}
