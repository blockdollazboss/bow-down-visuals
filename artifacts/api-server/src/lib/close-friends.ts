import { eq } from "drizzle-orm";
import { db, closeFriendsTable } from "@workspace/db";

/* ── Close-friends audience enforcement (Stack 9 #7) ────────────────────
   THE rule: audience is enforced at READ time, on every surface that
   serves a post or story. A row with audience='close_friends' is
   visible ONLY to (a) its author, and (b) users in the author's
   circle. Everything else — followers, the public, anonymous —
   must not receive it, on ANY surface: feed, single post, replies,
   hashtag pages, saved posts, story feed, per-profile stories.

   Surfaces batch: they load the viewer's circle-author set ONCE
   (the authors whose circle includes the viewer) and then filter
   with the pure predicate below, so enforcement can't drift between
   a query someone remembered to scope and one they didn't. */

export type Audience = "public" | "followers" | "close_friends" | string;

export interface AudienceContext {
  viewerUserId: string | null;
  viewerProfileId: string | null;
  /** Profile ids the viewer follows. */
  followedProfileIds: Set<string>;
  /** Author USER ids whose close-friends circle includes the viewer. */
  circleAuthorUserIds: Set<string>;
}

export function audienceVisible(
  audience: Audience,
  author: { userId: string; profileId: string },
  ctx: AudienceContext,
): boolean {
  if (ctx.viewerProfileId && author.profileId === ctx.viewerProfileId) return true; // own content
  if (ctx.viewerUserId && author.userId === ctx.viewerUserId) return true;
  if (audience === "close_friends") {
    return !!ctx.viewerUserId && ctx.circleAuthorUserIds.has(author.userId);
  }
  if (audience === "followers") {
    return ctx.followedProfileIds.has(author.profileId);
  }
  return true; // public (and any legacy value) — visible
}

/** Author user ids whose circle includes this viewer. */
export async function circleAuthorIdsFor(viewerUserId: string | null): Promise<Set<string>> {
  if (!viewerUserId) return new Set();
  const rows = await db
    .select({ owner: closeFriendsTable.owner_user_id })
    .from(closeFriendsTable)
    .where(eq(closeFriendsTable.friend_user_id, viewerUserId));
  return new Set(rows.map((r) => r.owner));
}

/** Is `friendUserId` in `ownerUserId`'s circle? */
export async function isInCircle(ownerUserId: string, friendUserId: string): Promise<boolean> {
  if (ownerUserId === friendUserId) return true;
  const rows = await db
    .select({ f: closeFriendsTable.friend_user_id })
    .from(closeFriendsTable)
    .where(eq(closeFriendsTable.owner_user_id, ownerUserId));
  return rows.some((r) => r.f === friendUserId);
}
