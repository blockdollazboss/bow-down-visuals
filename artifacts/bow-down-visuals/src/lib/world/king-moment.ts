/**
 * The King's daily moment — the pure client words for it (Ring 3).
 *
 * The moment itself is server truth: the hall's `kingMoment` state
 * (lib/world/world-client.ts) says whether court stands, when the
 * window closes, and whether THIS member already claimed. This
 * module only turns that state into the words the hall card and the
 * objective strip show, so the phrasing is unit-testable without a
 * DOM. The gift amount is never restated here: the server's own
 * announcement and the witnessed claim lines carry the number.
 */

import type { WorldKingMomentState } from "./world-client";

/** Is the moment's window still open at `nowMs`? A state past its
 *  deadline is stale truth (the room sweeps it) — render nothing. */
export function isKingMomentLive(moment: WorldKingMomentState | null, nowMs: number): boolean {
  return moment !== null && nowMs <= moment.claimDeadlineMs;
}

/** The claim control's state for one viewer:
 *  - "guest":   sign in first — guests witness the moment only.
 *  - "claimed": today's gift is already in hand.
 *  - "open":    the gift can be claimed now. */
export type KingClaimView = "guest" | "claimed" | "open";

export function kingClaimView(
  moment: WorldKingMomentState,
  isGuest: boolean,
): KingClaimView {
  if (isGuest) return "guest";
  if (moment.claimed) return "claimed";
  return "open";
}

/** The hall card's headline while court stands. */
export function kingMomentHeadline(moment: WorldKingMomentState, isGuest: boolean): string {
  const view = kingClaimView(moment, isGuest);
  if (view === "claimed") return "The King held court — your gift is claimed";
  return "The King holds court";
}

/** The hall card's supporting line — the rules in one breath: the
 *  gift is drawn from the week's quest pool, one per member a day,
 *  and only while the window stands. */
export function kingMomentLine(moment: WorldKingMomentState, isGuest: boolean): string {
  const view = kingClaimView(moment, isGuest);
  if (view === "guest") {
    return "The King's daily gift is for members standing in the hall — sign in to stand at court.";
  }
  if (view === "claimed") {
    return "Today's audience gift is yours. Court opens again at the next day-turn.";
  }
  return "Claim today's audience gift while the window stands — one per member, drawn from the week's quest pool.";
}

/** The objective strip's line while court stands in the hall —
 *  null when no live moment exists (the strip stays silent). */
export function kingStripLine(
  moment: WorldKingMomentState | null,
  nowMs: number,
  isGuest: boolean,
): string | null {
  if (!isKingMomentLive(moment, nowMs)) return null;
  const view = kingClaimView(moment!, isGuest);
  if (view === "guest") return "The King holds court in the Throne Hall — members claim a daily gift";
  if (view === "claimed") return "The King holds court — your gift is claimed for today";
  return "The King holds court in the Throne Hall — claim today's gift";
}

/** The witnessed-claim line (the say log): who stood at court and
 *  what the gift was — the claim frame's numbers are server truth. */
export function kingClaimedLine(claim: { name: string; amountVb: number }): string {
  return `${claim.name} claimed the King's gift — ${claim.amountVb} VB.`;
}

/** Why a claim was refused, in the member's words. Unknown reasons
 *  fall back to the generic line — never a raw server token. */
export function kingDeniedLine(reason: string): string {
  switch (reason) {
    case "guests":
      return "The King's gifts are for members — sign in to stand at court.";
    case "no-moment":
      return "No moment stands right now — court opens at the day-turn.";
    case "closed":
      return "The claim window has closed — court opens again at the next day-turn.";
    case "already":
      return "You've claimed today's gift already.";
    case "pool":
      return "This week's quest pool is spent — the King's gift draws from the same pool as quest rewards.";
    default:
      return "That claim didn't land — try again while the window stands.";
  }
}
