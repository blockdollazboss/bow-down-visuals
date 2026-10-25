import { eq } from "drizzle-orm";
import { db, closeFriendsTable } from "@workspace/db";
import {
  effectiveFanMemberStatus,
  evaluateTierGate,
  fanMembershipAdmits,
  fanTierRank,
  type FanMemberLike,
  type FanTierLike,
  type TierGateEvaluation,
} from "./fan-tier-gate";

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
  /** Members-only posts (Wave 4 #33): per-author fan-club gate data,
   *  keyed by author USER id. Loaded lazily by the serving surface for
   *  exactly the authors of the members posts in its batch (see
   *  loadMemberGates in routes/social.ts). An author ABSENT from this
   *  map has not been loaded — the members predicate fails CLOSED for
   *  them, so a surface that forgets to load can never leak. */
  memberGates: Map<string, MemberGateData>;
}

/** Everything a members-post gate decision needs for one author: the
 *  author's fan-club ladder (lowest first) and the viewer's membership
 *  rows with that author (empty for non-members / anonymous). */
export interface MemberGateData {
  tiers: FanTierLike[];
  members: FanMemberLike[];
}

export function audienceVisible(
  audience: Audience,
  author: { userId: string; profileId: string },
  ctx: AudienceContext,
  opts?: { minTierId?: string | null },
): boolean {
  if (ctx.viewerProfileId && author.profileId === ctx.viewerProfileId) return true; // own content
  if (ctx.viewerUserId && author.userId === ctx.viewerUserId) return true;
  if (audience === "close_friends") {
    return !!ctx.viewerUserId && ctx.circleAuthorUserIds.has(author.userId);
  }
  if (audience === "followers") {
    return ctx.followedProfileIds.has(author.profileId);
  }
  if (audience === "members") {
    /* Fail closed when the surface never loaded this author's gate
       data — an unloaded gate is a locked gate, never an open one. */
    const gate = ctx.memberGates.get(author.userId);
    if (!gate) return false;
    return evaluateMemberPost(gate, opts?.minTierId ?? null).hasAccess;
  }
  return true; // public (and any legacy value) — visible
}

/* ── Members-only posts (Wave 4 #33) ───────────────────────────────────
   A post with audience='members' speaks to the author's fan club only.
   The entitlement semantics are the fan-tier-gate's, NOT re-invented:
   the ladder is the author's own fan_tiers (sort_order order), access
   admits only effective "active" / "trialing" memberships, and a
   minimum tier means "that tier and up". minTierId NULL is the one
   case the channel gate never has (its NULL means ungated) — here it
   means ANY admitting member of the author, so it is evaluated here
   rather than through evaluateTierGate's ungated branch. */

export type MemberPostEvaluation = TierGateEvaluation;

export function evaluateMemberPost(
  gate: MemberGateData,
  minTierId: string | null,
  now: Date = new Date(),
): MemberPostEvaluation {
  if (minTierId) {
    return evaluateTierGate({
      orderedTiers: gate.tiers,
      gateTierId: minTierId,
      members: gate.members,
      isStaff: false,
      now,
    });
  }
  /* Any member of the author, whatever their tier. */
  let best: { rank: number; tier: FanTierLike } | null = null;
  let heldAny = false;
  let heldPaused = false;
  for (const m of gate.members) {
    heldAny = true;
    if (!fanMembershipAdmits(m, now)) {
      /* A resting member (#39) is told they're paused, not that their
         membership "ended" — it hasn't. */
      if (effectiveFanMemberStatus(m, now) === "paused") heldPaused = true;
      continue;
    }
    const rank = fanTierRank(gate.tiers, m.tier_id);
    if (rank < 0) continue; // a tier outside this author's ladder (defensive; rows are creator-scoped)
    if (!best || rank > best.rank) best = { rank, tier: gate.tiers[rank]! };
  }
  const viewerTier = best ? { id: best.tier.id, name: best.tier.name } : null;
  if (best) {
    return { gated: true, hasAccess: true, viewerStatus: null, requiredTier: null, viewerTier };
  }
  return {
    gated: true,
    hasAccess: false,
    viewerStatus: heldPaused ? "paused" : heldAny ? "lapsed" : "not_member",
    requiredTier: null,
    viewerTier,
  };
}

/* ── The locked teaser ─────────────────────────────────────────────────
 * A viewer who doesn't qualify for a members post never receives its
 * body or media — on ANY surface. What they receive instead is honest:
 * the post exists, it is members-only, which tier opens it, and the
 * one-tap path in — the existing fan-club join door
 * (/memberships?creator=<creatorUserId>), linked here, never rebuilt.
 * Same knock-door discipline as the tier-gated channels. */

export interface MemberPostLock {
  required_tier: { id: string; name: string } | null;
  creator_user_id: string;
  /** The existing membership join door for the author's fan club. */
  join_url: string;
  viewer_status: "not_member" | "below_tier" | "lapsed" | "paused";
  viewer_tier: { id: string; name: string } | null;
  message: string;
}

export function buildMemberPostLock(opts: {
  authorUserId: string;
  authorDisplayName: string | null;
  evaluation: MemberPostEvaluation;
}): MemberPostLock {
  const { evaluation } = opts;
  const name = opts.authorDisplayName ?? "this creator";
  const tierName = evaluation.requiredTier?.name;
  let message: string;
  if (evaluation.viewerStatus === "paused") {
    message = "Your membership is paused right now, so this post is asleep for you too. Resume your membership and you're straight back in.";
  } else if (evaluation.viewerStatus === "lapsed") {
    message = tierName
      ? `Your membership has ended, so this post is closed for now. Rejoin at the ${tierName} tier or above and you're straight back in.`
      : "Your membership has ended, so this post is closed for now. Rejoin the fan club and you're straight back in.";
  } else if (evaluation.viewerStatus === "below_tier") {
    message = `Your membership is on the ${evaluation.viewerTier?.name ?? "a lower"} tier — this post opens at the ${tierName ?? "a higher"} tier and up. Upgrade your tier to read it.`;
  } else if (tierName) {
    message = `This post is for members only — open to ${name}'s fan members on the ${tierName} tier and up. Join the fan club to read it.`;
  } else {
    message = `This post is for members only. Join ${name}'s fan club to read it.`;
  }
  return {
    required_tier: evaluation.requiredTier,
    creator_user_id: opts.authorUserId,
    join_url: `/memberships?creator=${opts.authorUserId}`,
    viewer_status: evaluation.viewerStatus ?? "not_member",
    viewer_tier: evaluation.viewerTier,
    message,
  };
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
