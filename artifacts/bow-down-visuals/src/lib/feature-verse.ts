/* ─── Feature Verse Market (Stack-200 N7) — client contract ─────────────
   Buy a FEATURE (a verse / appearance) from a creator: the creator sets
   their OWN price in Visual Bucs, the track splits are WRITTEN into the
   order (publishing-splits shape), BOTH parties sign, the fee is held
   in escrow, and it releases on delivery per the written terms. The
   server (api-server lib/feature-verse.ts) owns the machine; this
   module mirrors its vocabulary: paths, labels, viewer actions, and
   the delivery gate. No price, fee, person, or stat is invented here —
   a creator with no listing is simply not buyable. */

import { writerSplitValidationError } from "./publishing-splits";

export interface FeatureVerseListing {
  id: string;
  creatorUserId: string;
  creatorName: string;
  priceVb: number;
  title: string;
  description: string;
  turnaroundDays: number | null;
  active: boolean;
  isMine: boolean;
}

export interface FeatureVerseSplitRow {
  name: string;
  userId?: string | null;
  sharePct: number;
}

export interface FeatureVerseOrder {
  id: string;
  listingId: string;
  buyerUserId: string;
  creatorUserId: string;
  isBuyer: boolean;
  isCreator: boolean;
  priceVb: number;
  trackContext: string;
  usageTerms: string;
  deadlineAsk: string | null;
  splits: FeatureVerseSplitRow[];
  status: string;
  statusLabel: string;
  escrowStatus: string;
  escrowLabel: string;
  buyerSignedAt: string | null;
  creatorSignedAt: string | null;
  bothSigned: boolean;
  termsFrozen: boolean;
  canDeliver: boolean;
  signBy: string | null;
  deliveryNote: string | null;
  deliveryUrl: string | null;
  disputeReason: string | null;
  termsNotice: string;
}

export const FEATURE_VERSE_NOTICE =
  "No recording starts until both sides sign the written terms. The fee is held in escrow in Visual Bucs and releases only on delivery per those terms — if the creator never signs or declines, no fee is taken, and any held fee refunds in full.";

export const FEATURE_VERSE_LISTINGS_PATH = "/api/feature-verse/listings";
export const FEATURE_VERSE_MY_LISTING_PATH = "/api/feature-verse/listings/mine";
export const FEATURE_VERSE_ORDERS_PATH = "/api/feature-verse/orders";

export function featureVerseListingByCreatorPath(userId: string): string {
  return `/api/feature-verse/listings/by-creator/${encodeURIComponent(userId)}`;
}
export function featureVerseOrderPath(id: string): string {
  return `/api/feature-verse/orders/${encodeURIComponent(id)}`;
}
export function featureVerseActionPath(
  id: string,
  action: "sign" | "decline" | "fund" | "deliver" | "confirm" | "dispute" | "refund" | "terms",
): string {
  return `${featureVerseOrderPath(id)}/${action}`;
}

export function featureVerseStatusLabel(status: string): string {
  switch (status) {
    case "terms_proposed": return "Terms proposed — waiting for both signatures";
    case "signed": return "Both signed — waiting for the buyer to fund escrow";
    case "escrow_held": return "Fee held in escrow — the feature can be recorded and delivered";
    case "delivered": return "Delivered — waiting for the buyer to confirm";
    case "released": return "Released — escrow paid to the creator";
    case "disputed": return "Disputed — fee stays held in escrow while it's resolved";
    case "refunded": return "Refunded — the held fee returned to the buyer in full";
    case "declined": return "Declined by the creator — no fee was taken";
    case "expired_unaccepted": return "Expired unaccepted — the signing window closed with no deal";
    default: return status;
  }
}

export type FeatureVerseAction =
  | "sign" | "decline" | "fund" | "deliver" | "confirm" | "dispute" | "refund";

/** Actions the VIEWER may take, mirroring the server machine.
 *  THE GATE is visible here too: "deliver" appears only for the
 *  creator on an escrow_held order that BOTH parties signed
 *  (the server's canDeliver flag rides the order DTO). */
export function featureVerseViewerActions(order: Pick<
  FeatureVerseOrder,
  "isBuyer" | "isCreator" | "status" | "escrowStatus" | "buyerSignedAt" | "creatorSignedAt" | "canDeliver"
>): FeatureVerseAction[] {
  const actions: FeatureVerseAction[] = [];
  if (order.status === "terms_proposed") {
    if (order.isBuyer && !order.buyerSignedAt) actions.push("sign");
    if (order.isCreator && !order.creatorSignedAt) actions.push("sign");
    if (order.isCreator) actions.push("decline");
  }
  if (order.status === "signed" && order.isBuyer && order.escrowStatus === "none") actions.push("fund");
  if (order.isCreator && order.canDeliver) actions.push("deliver");
  if (order.status === "delivered" && order.escrowStatus === "held") {
    if (order.isBuyer) actions.push("confirm", "dispute", "refund");
    if (order.isCreator) actions.push("refund");
  }
  if ((order.status === "escrow_held" || order.status === "disputed") && order.escrowStatus === "held") {
    actions.push("refund");
  }
  return [...new Set(actions)];
}

/** Client mirror of the split rule for instant form feedback — the
 *  publishing-splits client validator, shared verbatim. The server
 *  re-validates with the identical rail. */
export function featureSplitValidationError(splits: FeatureVerseSplitRow[]): string | null {
  return writerSplitValidationError(splits);
}

/** A fresh client intent key per order attempt (exactly-once create). */
export function newFeatureOrderKey(): string {
  try {
    return `fv-${crypto.randomUUID()}`;
  } catch {
    return `fv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
