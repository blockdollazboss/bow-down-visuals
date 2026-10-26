/* ─── Feature Verse Market (Stack-200 N7) — pure machine ────────────────
   A buyer commissions a FEATURE (a verse / appearance) from a creator.
   TRULY NEW per the dedupe audit: distinct from Open Verse (#176, an
   open call with submissions) and Fan Shoutouts (a personal video).

   Rails REUSED, never duplicated:
   - Splits: the EXISTING publishing-splits validator
     (lib/publishing-splits validateWriterSplits — shares sum to
     exactly 100, 0.01 tolerance, ≤2dp, no duplicate linked account).
   - Escrow: the sponsors-escrow state machine pattern
     (routes/generate/sponsors.ts): escrow_status moves
     none → held → released | refunded, every transition is
     status-guarded, and money moves exactly once.
   - Money: the credits rail (lib/credits chargeCredits /
     refundCredits) in Visual Bucs only — TEST MODE, never real money.
     The hold charges the buyer through chargeCredits with a
     deterministic idempotency key; release/refund credit the other
     party through refundCredits (the rail's add-with-ledger helper).

   THE RULES:
   1. The creator sets their OWN feature price in Visual Bucs. The
      platform invents no price, no default and no fee for this lane.
      A creator with no active listing is simply not buyable.
   2. TERMS BEFORE RECORDING: the track splits are written into the
      order and validated before the row exists. BOTH parties sign
      the written terms (timestamped). Once ANY signature exists the
      terms are frozen. Funding is gated on BOTH signatures, and the
      delivery door is gated on BOTH signatures AND a held escrow —
      no signatures, no delivery door.
   3. Exactly-once escrow: the feature_verse_escrow_ledger row is
      written BEFORE the Visual Bucs move, its idempotency_key is
      UNIQUE (one hold, one release, one refund per order, ever),
      and the credits charge itself carries the same deterministic
      key, so a retry can never double-move money.
   4. Lifecycle honesty: terms_proposed → signed → escrow_held →
      delivered → released, with disputed / refunded / declined /
      expired_unaccepted as plain exits. If the creator never signs
      or declines, no fee was ever taken (funding needs both
      signatures); any fee that IS held when an order refunds or
      expires returns to the buyer IN FULL — never silently kept. */

import { validateWriterSplits, PublishingSplitError } from "./publishing-splits";
import { pgErrorCode, pgErrorText } from "./pg-errors";
import type { FeatureVerseSplit } from "@workspace/db";

/* How long both parties have to sign before an unaccepted order
   expires honestly. A lane rule about TIME, never about money. */
export const FEATURE_VERSE_SIGN_WINDOW_DAYS = 7;

export const FEATURE_VERSE_NOT_READY = {
  error: "feature_verse_not_ready",
  message:
    "The Feature Verse Market isn't switched on yet — listings and orders open as soon as its storage lands.",
} as const;

/** Postgres "undefined table" (42P01) for THIS lane's tables only. */
export function isMissingFeatureVerseTable(err: unknown): boolean {
  if (pgErrorCode(err) === "42P01") return true;
  const text = pgErrorText(err);
  return /feature_verse_/.test(text) && /(does not exist|undefined table|no such table)/i.test(text);
}

export class FeatureVerseError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ── Splits (the publishing-splits rail, re-run server-side) ──────────── */

export function validateFeatureSplits(splits: FeatureVerseSplit[]): FeatureVerseSplit[] {
  try {
    validateWriterSplits(
      (splits ?? []).map((s) => ({ name: s?.name, userId: s?.userId ?? null, sharePct: s?.sharePct })),
    );
  } catch (err) {
    if (err instanceof PublishingSplitError) {
      throw new FeatureVerseError(err.code, err.message, 400);
    }
    throw err;
  }
  return splits.map((s) => ({
    name: s.name.trim(),
    userId: s.userId ?? null,
    sharePct: s.sharePct,
  }));
}

/* ── Listing price (creator-entered only) ─────────────────────────────── */

export function validateListingPrice(priceVb: unknown): number {
  if (typeof priceVb !== "number" || !Number.isInteger(priceVb) || priceVb <= 0) {
    throw new FeatureVerseError(
      "price_invalid",
      "Set your own feature price in Visual Bucs — a whole number above zero. There is no platform default price.",
    );
  }
  return priceVb;
}

/* ── Escrow keys (deterministic, one per order per kind, ever) ────────── */

export function escrowLedgerKey(orderId: string, kind: "hold" | "release" | "refund"): string {
  return `feature-verse:${orderId}:${kind}`;
}
export function holdChargeKey(orderId: string): string {
  return escrowLedgerKey(orderId, "hold");
}
export function releaseCreditKey(orderId: string): string {
  return escrowLedgerKey(orderId, "release");
}
export function refundCreditKey(orderId: string): string {
  return escrowLedgerKey(orderId, "refund");
}

/* ── Order shape the machine reasons about ─────────────────────────────── */

export interface FeatureVerseOrderLike {
  status: string;
  escrowStatus: string;
  buyerSignedAt: string | Date | null;
  creatorSignedAt: string | Date | null;
  signBy: string | Date;
}

export function bothSigned(o: Pick<FeatureVerseOrderLike, "buyerSignedAt" | "creatorSignedAt">): boolean {
  return !!o.buyerSignedAt && !!o.creatorSignedAt;
}

/** Terms freeze the moment ANY signature exists. */
export function termsFrozen(o: Pick<FeatureVerseOrderLike, "buyerSignedAt" | "creatorSignedAt">): boolean {
  return !!o.buyerSignedAt || !!o.creatorSignedAt;
}

/** Funding (the escrow hold) requires BOTH signatures and an
 *  unsigned-state escrow — the sponsors-escrow status guard. */
export function canFund(o: FeatureVerseOrderLike): boolean {
  return o.status === "signed" && bothSigned(o) && o.escrowStatus === "none";
}

/** THE DELIVERY GATE, pinned by tests: delivery is possible only when
 *  BOTH parties have signed AND the fee is held in escrow AND the
 *  order is in the escrow_held state. Anything less — no door. */
export function canDeliver(o: FeatureVerseOrderLike): boolean {
  return bothSigned(o) && o.escrowStatus === "held" && o.status === "escrow_held";
}

export function canConfirmRelease(o: FeatureVerseOrderLike): boolean {
  return o.status === "delivered" && o.escrowStatus === "held";
}

export function canDispute(o: FeatureVerseOrderLike): boolean {
  return o.status === "delivered" && o.escrowStatus === "held";
}

/** A full refund is owed whenever a held fee exists and the order is
 *  leaving the happy path (dispute resolution, cancellation of a held
 *  order, expiry with a hold). The amount is ALWAYS the full held fee. */
export function refundOwed(o: Pick<FeatureVerseOrderLike, "escrowStatus">): boolean {
  return o.escrowStatus === "held";
}

export function isExpired(o: Pick<FeatureVerseOrderLike, "status" | "signBy">, now: Date = new Date()): boolean {
  if (o.status !== "terms_proposed") return false;
  const by = o.signBy instanceof Date ? o.signBy : new Date(o.signBy);
  return !Number.isNaN(by.getTime()) && now.getTime() > by.getTime();
}

export function signByFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + FEATURE_VERSE_SIGN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/* ── Lifecycle labels (plain words, shown to both parties) ─────────────── */

export const FEATURE_VERSE_STATUS_LABELS: Record<string, string> = {
  terms_proposed: "Terms proposed — waiting for both signatures",
  signed: "Both signed — waiting for the buyer to fund escrow",
  escrow_held: "Fee held in escrow — the feature can be recorded and delivered",
  delivered: "Delivered — waiting for the buyer to confirm",
  released: "Released — escrow paid to the creator",
  disputed: "Disputed — fee stays held in escrow while it's resolved",
  refunded: "Refunded — the held fee returned to the buyer in full",
  declined: "Declined by the creator — no fee was taken",
  expired_unaccepted: "Expired unaccepted — the signing window closed with no deal",
};

export function featureVerseStatusLabel(status: string): string {
  return FEATURE_VERSE_STATUS_LABELS[status] ?? status;
}

export const FEATURE_VERSE_ESCROW_LABELS: Record<string, string> = {
  none: "No fee held",
  held: "Fee held in escrow",
  released: "Escrow released to the creator",
  refunded: "Escrow refunded to the buyer in full",
};

export function featureVerseEscrowLabel(status: string): string {
  return FEATURE_VERSE_ESCROW_LABELS[status] ?? status;
}

/** The honest one-liner every surface carries. */
export const FEATURE_VERSE_TERMS_NOTICE =
  "No recording starts until both sides sign the written terms. The fee is held in escrow in Visual Bucs and releases only on delivery per those terms — if the creator never signs or declines, no fee is taken, and any held fee refunds in full.";
