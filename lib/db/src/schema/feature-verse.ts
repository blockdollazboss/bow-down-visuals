import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Feature Verse Market (Stack-200 N7, migration 9999 PROVISIONAL).
 *
 * A buyer commissions a FEATURE (a verse / appearance) from a creator.
 * This is a PURCHASE of a commissioned feature — distinct from Open
 * Verse (#176, an open call with submissions) and from Fan Shoutouts
 * (a fan buying a personal video).
 *
 * THE RULES (lib/feature-verse.ts is the single source):
 *  1. The creator sets their OWN feature price in Visual Bucs. The
 *     platform invents no price, no default, and no fee for this lane.
 *     A creator with no active listing simply does not appear buyable.
 *  2. TERMS BEFORE RECORDING: the splits for the resulting track are
 *     written into the order and validated by the EXISTING publishing
 *     splits validator (lib/publishing-splits validateWriterSplits —
 *     sum to exactly 100, 0.01 tolerance). BOTH parties sign the
 *     written terms (timestamps on the order row). Once any signature
 *     exists the terms are frozen. The delivery door is gated on BOTH
 *     signatures AND a held escrow — no signature, no delivery door.
 *  3. ESCROW follows the sponsors-escrow state machine
 *     (routes/generate/sponsors.ts): escrow_status moves
 *     none → held → released | refunded, every transition is
 *     status-guarded, and money moves exactly once — the escrow
 *     ledger's idempotency_key is UNIQUE and a ledger row is written
 *     BEFORE the Visual Bucs move, so a retry can never double-move.
 *     Visual Bucs only (credits rail) — never real money.
 *  4. LIFECYCLE: terms_proposed → signed → escrow_held → delivered →
 *     released, with disputed / refunded / declined /
 *     expired_unaccepted as honest exits. If the creator never signs
 *     or declines, no fee was ever taken (funding is gated on both
 *     signatures) — and any held fee on an expiring/refunded order
 *     returns to the buyer IN FULL.
 */

export const FEATURE_VERSE_ORDER_STATUSES = [
  "terms_proposed",
  "signed",
  "escrow_held",
  "delivered",
  "released",
  "disputed",
  "refunded",
  "declined",
  "expired_unaccepted",
] as const;
export type FeatureVerseOrderStatus = (typeof FEATURE_VERSE_ORDER_STATUSES)[number];

export const FEATURE_VERSE_ESCROW_STATUSES = ["none", "held", "released", "refunded"] as const;
export type FeatureVerseEscrowStatus = (typeof FEATURE_VERSE_ESCROW_STATUSES)[number];

export const FEATURE_VERSE_LEDGER_KINDS = ["hold", "release", "refund"] as const;
export type FeatureVerseLedgerKind = (typeof FEATURE_VERSE_LEDGER_KINDS)[number];

/** One written split row, as validated by the publishing-splits rail. */
export interface FeatureVerseSplit {
  name: string;
  userId?: string | null;
  sharePct: number;
}

export const featureVerseListingsTable = pgTable("feature_verse_listings", {
  id:             uuid("id").primaryKey().defaultRandom(),
  creatorUserId:  uuid("creator_user_id").notNull(),
  creatorName:    text("creator_name").notNull().default("Creator"),
  /* Creator-entered price in Visual Bucs. Never a platform default. */
  priceVb:        integer("price_vb").notNull(),
  title:          text("title").notNull().default("Feature verse"),
  description:    text("description").notNull().default(""),
  turnaroundDays: integer("turnaround_days"),
  active:         boolean("active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("feature_verse_listings_creator_key").on(t.creatorUserId),
  check("feature_verse_listings_price_positive", sql`${t.priceVb} > 0`),
]);

export const featureVerseOrdersTable = pgTable("feature_verse_orders", {
  id:             uuid("id").primaryKey().defaultRandom(),
  listingId:      uuid("listing_id").notNull(),
  buyerUserId:    uuid("buyer_user_id").notNull(),
  creatorUserId:  uuid("creator_user_id").notNull(),
  /* Snapshot of the listing price at order time — later listing edits
     never rewrite an order's agreed fee. */
  priceVb:        integer("price_vb").notNull(),
  trackContext:   text("track_context").notNull().default(""),
  usageTerms:     text("usage_terms").notNull().default(""),
  deadlineAsk:    text("deadline_ask"),
  /* The written splits for the resulting track (publishing-splits
     shape), validated before the row is written. Frozen once signed. */
  splits:         jsonb("splits").notNull(),
  status:         text("status").notNull().default("terms_proposed"),
  escrowStatus:   text("escrow_status").notNull().default("none"),
  buyerSignedAt:  timestamp("buyer_signed_at", { withTimezone: true }),
  creatorSignedAt: timestamp("creator_signed_at", { withTimezone: true }),
  signBy:         timestamp("sign_by", { withTimezone: true }).notNull(),
  escrowHeldAt:   timestamp("escrow_held_at", { withTimezone: true }),
  deliveryNote:   text("delivery_note"),
  deliveryUrl:    text("delivery_url"),
  deliveredAt:    timestamp("delivered_at", { withTimezone: true }),
  disputeReason:  text("dispute_reason"),
  disputedAt:     timestamp("disputed_at", { withTimezone: true }),
  releasedAt:     timestamp("released_at", { withTimezone: true }),
  refundedAt:     timestamp("refunded_at", { withTimezone: true }),
  /* One order per (buyer, client intent) — the fleet exactly-once
     pattern; a retried create returns the original order. */
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("feature_verse_orders_idempotency_key").on(t.idempotencyKey),
  index("feature_verse_orders_buyer_idx").on(t.buyerUserId),
  index("feature_verse_orders_creator_idx").on(t.creatorUserId),
  check("feature_verse_orders_price_positive", sql`${t.priceVb} > 0`),
]);

export const featureVerseEscrowLedgerTable = pgTable("feature_verse_escrow_ledger", {
  id:             uuid("id").primaryKey().defaultRandom(),
  orderId:        uuid("order_id").notNull(),
  kind:           text("kind").notNull(),
  amountVb:       integer("amount_vb").notNull(),
  /* UNIQUE: one hold, one release, one refund per order, ever. */
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("feature_verse_escrow_ledger_key").on(t.idempotencyKey),
  index("feature_verse_escrow_ledger_order_idx").on(t.orderId),
  check("feature_verse_escrow_ledger_amount_positive", sql`${t.amountVb} > 0`),
]);
