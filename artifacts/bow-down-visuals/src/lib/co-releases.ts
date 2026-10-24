/* ─── Co-releases (Stack-100 #3 Wave 3) — client contract ──────────────────
   One existing release or store product on BOTH creators' profiles,
   with a royalty split BOTH creators approve before it goes live.
   The server (api-server lib/co-releases.ts) owns the consent machine;
   this module mirrors its vocabulary: paths, labels, viewer actions,
   split validation for instant form feedback (the server re-validates
   — this mirror never substitutes for it), and the exact consent copy
   every co-release surface must carry. */

export interface CoReleaseSideSummary {
  profile_id: string;
  user_id: string;
  role: string; // 'author' | 'co_author'
  status: string; // 'pending' | 'accepted' | 'declined' | 'withdrawn'
  share_pct: number;
  agreed_share_pct: number | null;
  accepted_at: string | null;
  display_name: string | null;
  slug: string | null;
  avatar_url: string | null;
  is_verified: boolean;
}

export type CoReleaseState = "pending" | "live" | "live_one_side" | "declined" | "cancelled";

export interface CoReleaseItem {
  id: string;
  item_kind: "release" | "product";
  item_id: string;
  item_title: string;
  is_co_release: boolean;
  co_release_state: CoReleaseState;
  published_at: string | null;
  agreed_shares: Array<{ profileId: string; sharePct: number }> | null;
  sides: CoReleaseSideSummary[];
  viewer_side: { role: string; status: string; profile_id: string } | null;
  created_at: string;
}

/* Consent wording — MUST stay sentence-identical to the API's
   CO_RELEASE_CONSENT_COPY (api-server src/lib/co-releases.ts). */
export const CO_RELEASE_CONSENT_COPY = {
  bothApproveSplit:
    "Both creators must approve the royalty split and the release before a co-release goes live on either profile.",
  feeOutsideSplit:
    "The split divides what the creators earn together. The platform's flat 5% fee is taken by the store rail first and is never part of the split.",
  lockedAtPublish:
    "The split you both approve is locked in when the co-release goes live and can't be changed afterwards.",
  withdraw:
    "Either creator can withdraw their own side at any time: the release leaves their profile, the other creator keeps theirs, and splits already agreed for earnings stay as agreed.",
} as const;

export const CO_RELEASES_PATH = "/api/co-releases";
export const CO_RELEASES_MINE_PATH = "/api/co-releases/mine";

export function coReleaseByProfilePath(profileId: string): string {
  return `/api/co-releases/by-profile/${encodeURIComponent(profileId)}`;
}
export function coReleaseActionPath(id: string, action: "accept" | "decline" | "withdraw" | "amend-split"): string {
  return `/api/co-releases/${encodeURIComponent(id)}/${action}`;
}
export function coReleaseAttributionPath(id: string): string {
  return `/api/co-releases/${encodeURIComponent(id)}/attribution`;
}

export function coReleaseStateLabel(state: string): string {
  switch (state) {
    case "live":
      return "Live on both profiles — split locked";
    case "live_one_side":
      return "Live — one side withdrawn";
    case "pending":
      return "Waiting for split + release approval";
    case "declined":
      return "Declined — never went live";
    case "cancelled":
      return "Withdrawn before it went live";
    default:
      return state;
  }
}

/** Client-side mirror of the server split rule, for instant feedback:
 *  both shares > 0 and < 100, at most 2 decimal places, and the pair
 *  totals 100 (within the rail's 0.01 tolerance). Returns the error
 *  message, or null when the split is valid. The server re-validates
 *  with the identical rule — displays equal rails. */
export function splitValidationError(authorPct: number, coAuthorPct: number): string | null {
  for (const pct of [authorPct, coAuthorPct]) {
    if (typeof pct !== "number" || !Number.isFinite(pct)) return "Each creator's share must be a number.";
    if (pct <= 0 || pct >= 100) return "Each creator's share must be more than 0% and less than 100%.";
    if (Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-9) return "Shares can have at most two decimal places.";
  }
  const total = authorPct + coAuthorPct;
  if (Math.abs(total - 100) > 0.01) return `Royalty shares must total 100% — yours total ${total.toFixed(2)}%.`;
  return null;
}

/** The share a surface must DISPLAY for a side: once published, the
 *  frozen AGREED share (that's the rail); before publish, the proposal. */
export function displaySharePct(item: Pick<CoReleaseItem, "agreed_shares">, side: CoReleaseSideSummary): number {
  const agreed = item.agreed_shares?.find((s) => s.profileId === side.profile_id);
  return agreed ? agreed.sharePct : side.share_pct;
}

export type CoReleaseViewerAction = "accept" | "decline" | "withdraw" | "amend-split";

/** Actions the VIEWER may take, mirroring the server machine: a
 *  pending side may accept/decline; an accepted side may withdraw
 *  (their side only); the initiator may re-propose the split only
 *  while the co-release is still pending. */
export function coReleaseViewerActions(
  item: Pick<CoReleaseItem, "viewer_side" | "co_release_state">,
): CoReleaseViewerAction[] {
  const side = item.viewer_side;
  if (!side) return [];
  const actions: CoReleaseViewerAction[] = [];
  if (side.status === "pending" && item.co_release_state === "pending") actions.push("accept", "decline");
  if (side.status === "accepted") actions.push("withdraw");
  if (side.role === "author" && item.co_release_state === "pending") actions.push("amend-split");
  return actions;
}

/** Sides still standing behind the co-release (accepted only) — a
 *  withdrawn creator is never bylined on it. */
export function standingSides(sides: CoReleaseSideSummary[]): CoReleaseSideSummary[] {
  return sides.filter((s) => s.status === "accepted");
}
