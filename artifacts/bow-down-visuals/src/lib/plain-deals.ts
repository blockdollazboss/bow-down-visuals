/* ─── Plain-Words Deals — FE mirror (Stack-200 upgrade #164) ─────────────
   The client half of the deals rail docked into the Contracts page:
   two creators write a collab agreement in plain words (what each
   does / gets), sign it in the app, and — at full signature — the
   agreed split is wired into the rails that already move money
   (co-release for a release, sale-splits for a product). The DTO
   shapes here mirror artifacts/api-server/src/routes/plain-deals.ts
   exactly; the action logic mirrors the server machine so the buttons
   a viewer sees are the buttons the server will honor. */

export type PlainDealState =
  | "draft"
  | "awaiting_signature"
  | "signed"
  | "declined"
  | "withdrawn";

export type PlainDealItemKind = "general" | "release" | "store_product" | "shop_product";

export interface PlainDealSideSummary {
  id: string;
  plain_deal_id: string;
  profile_id: string;
  user_id: string;
  role: "author" | "partner";
  status: "signed" | "pending" | "declined" | "withdrawn";
  does_text: string;
  gets_text: string;
  share_pct: number;
  signed_name: string | null;
  signed_at: string | null;
  is_viewer: boolean;
  name: string | null;
  slug: string | null;
  avatar_url: string | null;
}

export interface PlainDealItem {
  id: string;
  title: string;
  item_kind: PlainDealItemKind;
  item_id: string | null;
  item_title: string | null;
  agreed_shares: Array<{ profileId: string; userId: string; sharePct: number }> | null;
  signed_text: string | null;
  signed_at: string | null;
  split_attach: { rail: "co_release" | "sale_splits"; refId: string; at: string } | null;
  created_at: string;
  updated_at: string;
  deal_state: PlainDealState;
  plain_text: string;
  sides: PlainDealSideSummary[];
  viewer_side: PlainDealSideSummary | null;
}

export const PLAIN_DEALS_PATH = "/api/plain-deals";
export const PLAIN_DEALS_MINE_PATH = "/api/plain-deals/mine";

export function plainDealActionPath(
  id: string,
  action: "sign" | "decline" | "withdraw" | "amend",
): string {
  return `${PLAIN_DEALS_PATH}/${id}/${action}`;
}

export const PLAIN_DEAL_COPY = {
  heading: "Plain-Words Deals",
  intro:
    "Skip the legalese. Write what each of you does and gets, in your own words, sign it here — and when you both sign, the split you agreed is wired straight into the release or product, exactly as written.",
  consent:
    "Nothing is agreed until both of you sign the same words. Change the words and the other side has to sign again. A signed deal can't be edited — write a new one instead. This is your agreement in plain words, not legal advice.",
  attachCoRelease:
    "Wired up: this split is live on the co-release — earnings follow it exactly as agreed.",
  attachSaleSplits:
    "Wired up: this split is on the product now — every sale follows it exactly as agreed.",
  signedNoAttach:
    "Signed and on record. This deal names no release or product, so the split stands as your agreement.",
} as const;

export function plainDealStateLabel(state: string): string {
  switch (state) {
    case "signed":
      return "Signed by both";
    case "awaiting_signature":
      return "Waiting for a signature";
    case "declined":
      return "Declined";
    case "withdrawn":
      return "Withdrawn";
    default:
      return "Draft";
  }
}

export type PlainDealViewerAction = "sign" | "decline" | "withdraw" | "amend";

/** The actions the viewer may take on a deal right now — mirrors the
 *  server machine: the invited side signs or declines a live draft;
 *  either side can withdraw a deal that's still open; only the author
 *  can amend, and only before both signatures land. */
export function plainDealViewerActions(item: PlainDealItem): PlainDealViewerAction[] {
  const viewer = item.viewer_side;
  if (!viewer) return [];
  const actions: PlainDealViewerAction[] = [];
  if (item.deal_state === "awaiting_signature") {
    if (viewer.status === "pending") actions.push("sign", "decline");
    actions.push("withdraw");
    if (viewer.role === "author") actions.push("amend");
  }
  return actions;
}

/** The two shares must total 100 — the same rule the server enforces
 *  (via the co-releases split machine). Returns an error line or null. */
export function dealSplitError(authorPct: number, partnerPct: number): string | null {
  if (!Number.isFinite(authorPct) || !Number.isFinite(partnerPct)) return "Enter both shares.";
  if (authorPct <= 0 || partnerPct <= 0) return "Each side's share must be more than 0%.";
  if (Math.round((authorPct + partnerPct) * 100) / 100 !== 100) {
    return `Shares must add up to 100% — right now they add up to ${authorPct + partnerPct}%.`;
  }
  return null;
}
