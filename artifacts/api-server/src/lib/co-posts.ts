/* ─── Co-posts (Stack-100 #3, #24) — pure consent state machine ─────────────
   A co-post is ONE Feed post (one row in `posts`, one set of likes /
   comments / reactions) with TWO author sides recorded in
   `post_co_authors` (migration 0205, held in .lane/MIGRATION-NEEDED.md).

   Consent discipline — the hard rules this module is the single source for:
   1. BOTH sides approve before the post goes live. The initiator's side
      is accepted at creation (they wrote it); the invited co-author's
      side starts `pending`. Nothing is visible anywhere public while
      any side is pending.
   2. Either side can withdraw THEIR side at any time after accepting.
      Withdrawal touches only that side: the post leaves the withdrawn
      creator's profile, and the other creator KEEPS theirs — the post
      stays live for the remaining side with the same single engagement
      counts.
   3. Engagement is never double-counted: there is exactly one post row,
      so likes/comments/reactions exist once. Per-profile reads DEDUPE
      by post id — a post can never appear twice in one list, and no
      surface ever sums counts across authors.

   A side records `acceptedAt` the moment it accepts (null while it has
   never accepted). That is what makes "was published, then one side
   withdrew" distinguishable from "never published": published ⇔ EVERY
   side has an acceptedAt. A decline is only possible before publishing
   and ends the co-post (it never quietly becomes a solo post — the
   initiator can post solo through the normal composer if they want). */

export const CO_POST_ROLES = ["author", "co_author"] as const;
export type CoPostRole = (typeof CO_POST_ROLES)[number];

export const CO_POST_SIDE_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export type CoPostSideStatus = (typeof CO_POST_SIDE_STATUSES)[number];

export interface CoPostSide {
  profileId: string;
  userId: string;
  role: CoPostRole;
  status: CoPostSideStatus;
  /* ISO string / Date / null — set when the side accepted, kept after a
     later withdrawal (the historical fact that consent was given). */
  acceptedAt: string | Date | null;
}

export interface CoPost {
  postId: string;
  sides: CoPostSide[];
}

export type CoPostState =
  | "pending" // waiting on at least one side; not live anywhere public
  | "live" // both sides accepted; on both profiles, one engagement set
  | "live_one_side" // was live; one side withdrew — remaining side keeps it
  | "declined" // a side declined before going live; never published
  | "cancelled"; // a side withdrew before going live; never published

export class CoPostError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** The two sides a new co-post starts with: initiator accepted (they
 *  authored it), invited co-author pending their approval. */
export function initialCoPost(
  postId: string,
  author: { profileId: string; userId: string },
  coAuthor: { profileId: string; userId: string },
  now: Date = new Date(),
): CoPost {
  if (author.profileId === coAuthor.profileId || author.userId === coAuthor.userId) {
    throw new CoPostError("same_creator", "A co-post needs two different creators.");
  }
  return {
    postId,
    sides: [
      { profileId: author.profileId, userId: author.userId, role: "author", status: "accepted", acceptedAt: now },
      { profileId: coAuthor.profileId, userId: coAuthor.userId, role: "co_author", status: "pending", acceptedAt: null },
    ],
  };
}

function hasAccepted(side: CoPostSide): boolean {
  return side.acceptedAt !== null && side.acceptedAt !== undefined;
}

/** True once EVERY side has accepted at some point — the publish moment.
 *  Stays true after a withdrawal (withdrawal is not un-consent of the
 *  other side; it only removes the withdrawing side). */
export function coPostWasPublished(co: CoPost): boolean {
  return co.sides.length >= 2 && co.sides.every(hasAccepted);
}

export function deriveCoPostState(co: CoPost): CoPostState {
  if (coPostWasPublished(co)) {
    const stillOn = co.sides.filter((s) => s.status === "accepted").length;
    return stillOn >= 2 ? "live" : "live_one_side";
  }
  if (co.sides.some((s) => s.status === "declined")) return "declined";
  if (co.sides.some((s) => s.status === "withdrawn")) return "cancelled";
  return "pending";
}

export function sideFor(co: CoPost, profileId: string): CoPostSide | null {
  return co.sides.find((s) => s.profileId === profileId) ?? null;
}

export function sideForUser(co: CoPost, userId: string): CoPostSide | null {
  return co.sides.find((s) => s.userId === userId) ?? null;
}

/** Visible in the public Feed ⇔ it went live and at least one author
 *  still stands behind it. (Both sides withdrew → nobody keeps it →
 *  it leaves the Feed too.) */
export function isCoPostVisibleInFeed(co: CoPost): boolean {
  return coPostWasPublished(co) && co.sides.some((s) => s.status === "accepted");
}

/** Visible on ONE creator's profile ⇔ it went live AND that creator's
 *  own side is still accepted. This is the withdraw rule, exactly:
 *  your withdrawal removes it from YOUR profile only. */
export function isCoPostVisibleOnProfile(co: CoPost, profileId: string): boolean {
  if (!coPostWasPublished(co)) return false;
  const side = sideFor(co, profileId);
  return !!side && side.status === "accepted";
}

export type CoPostAction = "accept" | "decline" | "withdraw";

/** Apply one side's action. Pure: returns a NEW CoPost; throws
 *  CoPostError on any transition the consent rules forbid. Only the
 *  acting side's row ever changes — the other side is returned
 *  object-identical. */
export function applyCoPostAction(
  co: CoPost,
  actorProfileId: string,
  action: CoPostAction,
  now: Date = new Date(),
): CoPost {
  const side = sideFor(co, actorProfileId);
  if (!side) {
    throw new CoPostError("not_a_co_author", "Only the two creators on this co-post can do that.");
  }
  const next: CoPost = { postId: co.postId, sides: co.sides.map((s) => ({ ...s })) };
  const mine = sideFor(next, actorProfileId)!;

  if (action === "accept") {
    if (mine.status !== "pending") {
      throw new CoPostError("not_pending", "This co-post isn't waiting on your approval.");
    }
    /* A side that ended the co-post before it went live (withdrawn /
       declined) cannot be overridden by a late accept from the other
       side: consent was withdrawn BEFORE publish, so nothing publishes.
       Starting a fresh co-post is the only way back. */
    if (co.sides.some((s) => s.profileId !== actorProfileId && (s.status === "withdrawn" || s.status === "declined"))) {
      throw new CoPostError("co_post_ended", "This co-post ended before it went live — start a new one instead.");
    }
    mine.status = "accepted";
    mine.acceptedAt = now;
    return next;
  }

  if (action === "decline") {
    /* Decline is the pre-live "no". After the post is live there is no
       decline — the honest action then is withdraw (your side only). */
    if (coPostWasPublished(co)) {
      throw new CoPostError("already_live", "This co-post is already live — withdraw your side instead.");
    }
    if (mine.status !== "pending") {
      throw new CoPostError("not_pending", "This co-post isn't waiting on your approval.");
    }
    mine.status = "declined";
    return next;
  }

  /* withdraw — MY side only, and only a side that actually accepted
     (a pending invitee declines; they have nothing to withdraw). */
  if (mine.status !== "accepted") {
    throw new CoPostError("not_accepted", "Only a creator whose side is live on this co-post can withdraw it.");
  }
  mine.status = "withdrawn";
  return next;
}

/** The ONE engagement record for a co-post: the post row's own counts.
 *  Surfaces must use this (or the post row directly) — never a sum over
 *  authors. Two profiles showing the same post show the SAME numbers. */
export function sharedEngagement(post: {
  likeCount: number;
  replyCount: number;
  repostCount: number;
}): { like_count: number; reply_count: number; repost_count: number } {
  return {
    like_count: post.likeCount,
    reply_count: post.replyCount,
    repost_count: post.repostCount,
  };
}

/** Merge post lists (e.g. two creators' profile lists, or a feed page)
 *  without ever showing one post twice. First occurrence wins. */
export function dedupePostsById<T extends { id: string }>(lists: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Postgres "undefined table" (42P01) — the post_co_authors table only
 *  exists once the held migration 0205 lands. Routes use this to answer
 *  an honest 503 instead of a 500, and read paths use it to behave
 *  exactly as before (no co-posts exist yet) until then. */
export function isMissingCoPostTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.code === "42P01") return true;
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return /post_co_authors/.test(msg) && /(does not exist|undefined table|no such table)/i.test(msg);
}

export const CO_POST_NOT_READY = {
  error: "co_post_not_ready",
  message:
    "Co-posts are almost ready — the final setup step hasn't landed yet, so nothing was posted. Your collaborator hasn't been notified.",
} as const;

/** The exact consent wording the UI must carry (collabs page + feed
 *  card tooltip copy is tested against these sentences). */
export const CO_POST_CONSENT_COPY = {
  bothApprove: "Both creators must approve before a co-post goes live.",
  sharedCounts:
    "A co-post is one post on both profiles, with one shared set of likes and comments — never counted twice.",
  withdraw:
    "Either creator can withdraw their own side at any time: the post leaves their profile, and the other creator keeps theirs.",
} as const;
