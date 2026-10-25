/* ─── fan-tier-gate.ts — tier-gated community channels (Stack-100 #3, #19). Pure.
 *
 * A forum channel inside a group can carry a fan-tier gate: "open to
 * members of tier X and up", where the tiers are the GROUP OWNER's fan
 * club tiers (fan_tiers, owned by the creator behind the group's owner
 * profile). The ladder is the creator's own: fan_tiers ordered by
 * sort_order ASC, created_at ASC — the exact order the memberships
 * routes use to list tiers (routes/generate/memberships.ts).
 *
 * Entitlement semantics are NOT re-invented here: they mirror
 * effectiveMemberStatus in routes/generate/memberships.ts — a trial
 * past its end is expired, a paid period that ran out without renewal
 * is expired — and, per the fan-memberships schema header, access
 * checks admit only "trialing" / "active". Everything else
 * (past_due, canceled, expired, refunded) is a LAPSED membership:
 * the room closes, cleanly, but nothing the member posted is ever
 * deleted or de-attributed — the gate is evaluated at read/post time
 * against the membership rows only, never against their content.
 */

import { pausedEffectiveStatus } from "./membership-pause";

export interface FanTierLike {
  id: string;
  name: string;
  sort_order: number;
  created_at: Date | string | null;
}

export interface FanMemberLike {
  tier_id: string;
  status: string;
  fan_user_id: string | null;
  trial_ends_at: Date | string | null;
  current_period_end: Date | string | null;
  /* Membership pause (wave-4 #39): optional so partial-row callers
     stay safe — a paused row without its window reads as resting
     (access asleep), never as admitted. */
  paused_at?: Date | string | null;
  paused_until?: Date | string | null;
}

/** The status a member is REALLY in right now — a read-time mirror of
 *  effectiveMemberStatus (routes/generate/memberships.ts). Stored rows
 *  are never rewritten by the gate. */
export function effectiveFanMemberStatus(m: FanMemberLike, now: Date = new Date()): string {
  /* Paused (#39): the shared pause mirror decides — resting seats
     admit nowhere; a seat whose stated resume date has arrived reads
     active again on its pause-shifted period. */
  const paused = pausedEffectiveStatus(
    {
      status: m.status,
      fan_user_id: m.fan_user_id,
      trial_ends_at: m.trial_ends_at,
      current_period_end: m.current_period_end,
      paused_at: m.paused_at ?? null,
      paused_until: m.paused_until ?? null,
    },
    now,
  );
  if (paused !== null) return paused;
  if (m.status === "trialing" && m.trial_ends_at && new Date(m.trial_ends_at) <= now) {
    return "expired";
  }
  if (
    m.status === "active" &&
    m.fan_user_id &&
    m.current_period_end &&
    new Date(m.current_period_end) <= now
  ) {
    return "expired";
  }
  return m.status;
}

/** Access checks admit only these effective statuses (fan-memberships
 *  schema header: "access checks admit only trialing / active"). */
export const FAN_GATE_ADMITTING_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

export function fanMembershipAdmits(m: FanMemberLike, now: Date = new Date()): boolean {
  return FAN_GATE_ADMITTING_STATUSES.has(effectiveFanMemberStatus(m, now));
}

/** The creator's tier ladder, lowest first. Input order is not
 *  trusted — this sorts by (sort_order, created_at, id) exactly the
 *  way the tiers are listed to fans. */
export function orderFanTiers<T extends FanTierLike>(tiers: readonly T[]): T[] {
  return [...tiers].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Rank of a tier on the ladder (0 = lowest), or -1 when absent. */
export function fanTierRank(orderedTiers: readonly FanTierLike[], tierId: string): number {
  return orderedTiers.findIndex((t) => t.id === tierId);
}

export type TierGateViewerStatus = "not_member" | "below_tier" | "lapsed" | "paused";

export interface TierGateEvaluation {
  /** A gate is configured on the channel at all. */
  gated: boolean;
  /** The viewer may read and post in the channel. */
  hasAccess: boolean;
  /** Why a gated-out viewer is out — drives the knock-door copy.
   *  Null when ungated or when the viewer has access. */
  viewerStatus: TierGateViewerStatus | null;
  /** The gate tier ("X" in "tier X and up"), when it still exists. */
  requiredTier: { id: string; name: string } | null;
  /** The viewer's best ADMITTING tier, when they hold one. */
  viewerTier: { id: string; name: string } | null;
}

/**
 * Evaluate one viewer against one channel gate.
 *
 * - Ungated channel (gateTierId null) → everyone the group's own
 *   rules admit has access; this function is not the group gate.
 * - Group staff (owner/admin/moderator on the group's ladder) are
 *   exempt: they run the room — moderation, pin/lock and the gate
 *   setting itself must keep working for the crew even though the
 *   creator can never join their own fan club. The caller computes
 *   `isStaff` from the group role (canGroupAction(role, "deletePost")).
 * - A gate tier that no longer exists (deleted after the gate was
 *   set; the FK is ON DELETE SET NULL once the held migration lands,
 *   but a stale id must still behave honestly) fails CLOSED for
 *   non-staff: the room was members-only, and opening it to everyone
 *   because the tier vanished would silently break the creator's
 *   promise to their members. Staff can clear the gate.
 */
export function evaluateTierGate(opts: {
  orderedTiers: readonly FanTierLike[];
  gateTierId: string | null;
  members: readonly FanMemberLike[];
  isStaff: boolean;
  now?: Date;
}): TierGateEvaluation {
  const { orderedTiers, gateTierId, isStaff } = opts;
  const now = opts.now ?? new Date();
  if (!gateTierId) {
    return { gated: false, hasAccess: true, viewerStatus: null, requiredTier: null, viewerTier: null };
  }
  const gateRank = fanTierRank(orderedTiers, gateTierId);
  const requiredTierRow = gateRank >= 0 ? orderedTiers[gateRank] : undefined;
  const requiredTier = requiredTierRow ? { id: requiredTierRow.id, name: requiredTierRow.name } : null;

  let bestAdmitting: { rank: number; tier: FanTierLike } | null = null;
  let heldQualifying = false; // a non-admitting row at/above the gate — they HAD the room
  let heldPausedQualifying = false; // a resting (#39) row at/above the gate — the room sleeps, honestly labelled
  let heldAny = false;
  for (const m of opts.members) {
    heldAny = true;
    const rank = fanTierRank(orderedTiers, m.tier_id);
    if (rank < 0) continue; // a tier outside this creator's ladder (defensive; rows are creator-scoped)
    if (fanMembershipAdmits(m, now)) {
      if (!bestAdmitting || rank > bestAdmitting.rank) {
        const tier = orderedTiers[rank]!;
        bestAdmitting = { rank, tier };
      }
    } else if (gateRank >= 0 && rank >= gateRank) {
      heldQualifying = true;
      if (effectiveFanMemberStatus(m, now) === "paused") heldPausedQualifying = true;
    }
  }
  const viewerTier = bestAdmitting ? { id: bestAdmitting.tier.id, name: bestAdmitting.tier.name } : null;

  if (isStaff) {
    return { gated: true, hasAccess: true, viewerStatus: null, requiredTier, viewerTier };
  }
  if (gateRank < 0) {
    // Gate tier vanished — fail closed (see header).
    return { gated: true, hasAccess: false, viewerStatus: heldAny ? "lapsed" : "not_member", requiredTier: null, viewerTier };
  }
  if (bestAdmitting && bestAdmitting.rank >= gateRank) {
    return { gated: true, hasAccess: true, viewerStatus: null, requiredTier, viewerTier };
  }
  if (heldPausedQualifying) {
    return { gated: true, hasAccess: false, viewerStatus: "paused", requiredTier, viewerTier };
  }
  if (heldQualifying || (!bestAdmitting && heldAny)) {
    return { gated: true, hasAccess: false, viewerStatus: "lapsed", requiredTier, viewerTier };
  }
  if (bestAdmitting) {
    return { gated: true, hasAccess: false, viewerStatus: "below_tier", requiredTier, viewerTier };
  }
  return { gated: true, hasAccess: false, viewerStatus: "not_member", requiredTier, viewerTier };
}

/* ─── The knock door ──────────────────────────────────────────────────
 * A non-qualifying viewer who reaches a gated channel never gets a
 * bare error: they see WHAT the room is, WHICH tier opens it, and the
 * one-tap path in — the existing fan-club join door
 * (/memberships?creator=<creatorUserId>, the FanClubJoin view), linked
 * here, never rebuilt. For a lapsed member the copy says the honest
 * thing out loud: rejoining restores the room, and everything they
 * posted while a member is still there, under their name. */

export interface TierGateKnock {
  channel: { id: string; name: string; description: string };
  group: { slug: string; name: string };
  required_tier: { id: string; name: string } | null;
  creator_user_id: string | null;
  /** The existing membership join door for the group owner's fan club. */
  join_url: string | null;
  viewer_status: TierGateViewerStatus;
  viewer_tier: { id: string; name: string } | null;
  message: string;
  history_note: string;
}

export const TIER_GATE_HISTORY_NOTE =
  "Your posts are never deleted when a membership ends — your threads and replies stay in the room, under your name.";

export function buildTierGateKnock(opts: {
  channel: { id: string; name: string; description: string };
  group: { slug: string; name: string };
  evaluation: TierGateEvaluation;
  creatorUserId: string | null;
}): TierGateKnock {
  const { evaluation } = opts;
  const tierName = evaluation.requiredTier?.name ?? "a fan membership tier";
  let message: string;
  if (evaluation.viewerStatus === "paused") {
    message = `Your membership is paused right now, so this room is asleep for you too. Resume your membership and you're straight back in — everything you posted is still here.`;
  } else if (evaluation.viewerStatus === "lapsed") {
    message = evaluation.requiredTier
      ? `Your membership has ended, so this room is closed for now. Rejoin at the ${tierName} tier or above and you're straight back in.`
      : "Your membership has ended, so this room is closed for now. Rejoin the fan club and you're straight back in.";
  } else if (evaluation.viewerStatus === "below_tier") {
    message = `Your membership is on the ${evaluation.viewerTier?.name ?? "a lower"} tier — “${opts.channel.name}” opens at the ${tierName} tier and up. Upgrade your tier to step inside.`;
  } else {
    message = `“${opts.channel.name}” is a members-only room — open to fan members on the ${tierName} tier and up. Join the fan club to step inside.`;
  }
  return {
    channel: opts.channel,
    group: opts.group,
    required_tier: evaluation.requiredTier,
    creator_user_id: opts.creatorUserId,
    join_url: opts.creatorUserId ? `/memberships?creator=${opts.creatorUserId}` : null,
    viewer_status: evaluation.viewerStatus ?? "not_member",
    viewer_tier: evaluation.viewerTier,
    message,
    history_note: TIER_GATE_HISTORY_NOTE,
  };
}
