import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";
import { storeProductsTable } from "./storefront";

/**
 * Gift Cards — stored value for a seller's whole store
 * (Stack-100 #3 item 26). ⚠️ PENDING-MIGRATION: this is the drafted
 * source-of-truth; the migration SQL is held in
 * .lane/MIGRATION-NEEDED.md and NO number is claimed by this lane
 * (numbering is assigned at join). Until it lands, every money path
 * that touches these tables fails closed.
 *
 * Money law:
 *  - A gift card is a LIABILITY, not revenue: initial_cents is money
 *    owed to the holder until redeemed or refunded. No platform fee is
 *    taken at issuance and the seller is NOT credited at issuance —
 *    the platform fee is charged exactly once, at redemption, when
 *    the real sale happens, on the sale's full gross (the existing
 *    rails' feeSplit law: a gift card is a payment tender, not a
 *    discount — discounts reduce the gross before the fee; tender
 *    does not).
 *  - Codes are never stored in plaintext: code_hash is SHA-256 of the
 *    normalized code; code_last4 is display-only.
 *  - balance_cents never goes below zero: reserve/redeem UPDATEs are
 *    conditional on available balance, and the ledger is append-only
 *    with a UNIQUE idempotency_key per money movement.
 */

export const GIFT_CARD_STATUSES = ["active", "depleted", "refunded", "void"] as const;
export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];

export const giftCardsTable = pgTable("gift_cards", {
  id:              uuid("id").primaryKey().defaultRandom(),
  codeHash:        text("code_hash").notNull(),
  codeLast4:       text("code_last4").notNull(),
  profileId:       uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  productId:       uuid("product_id").references(() => storeProductsTable.id, { onDelete: "set null" }),
  buyerUserId:     uuid("buyer_user_id"),
  recipientEmail:  text("recipient_email").notNull(),
  recipientName:   text("recipient_name"),
  message:         text("message"),
  initialCents:    integer("initial_cents").notNull(),
  balanceCents:    integer("balance_cents").notNull(),
  /** Cents held by in-flight checkouts (reserved, not yet redeemed). */
  reservedCents:   integer("reserved_cents").notNull().default(0),
  status:          text("status").notNull().default("active").$type<GiftCardStatus>(),
  stripeSessionId: text("stripe_session_id"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("gift_cards_initial_check", sql`${t.initialCents} > 0`),
  check("gift_cards_balance_check", sql`${t.balanceCents} >= 0`),
  check("gift_cards_reserved_check", sql`${t.reservedCents} >= 0 AND ${t.reservedCents} <= ${t.balanceCents}`),
  check("gift_cards_status_check", sql`${t.status} IN ('active','depleted','refunded','void')`),
  uniqueIndex("gift_cards_code_hash_ux").on(t.codeHash),
  uniqueIndex("gift_cards_session_ux").on(t.stripeSessionId),
  index("gift_cards_profile_idx").on(t.profileId),
  index("gift_cards_buyer_idx").on(t.buyerUserId),
  index("gift_cards_recipient_idx").on(t.recipientEmail),
]);

export const insertGiftCardSchema = createInsertSchema(giftCardsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertGiftCard = z.infer<typeof insertGiftCardSchema>;
export type GiftCard = typeof giftCardsTable.$inferSelect;

export const GIFT_CARD_LEDGER_KINDS = ["issue", "redeem", "refund_clawback"] as const;
export type GiftCardLedgerKind = (typeof GIFT_CARD_LEDGER_KINDS)[number];

/** Append-only money ledger: every issuance, redemption and refund
 *  clawback lands exactly once (UNIQUE idempotency_key) with the
 *  balance it left behind, so issue − redeem − clawback ≡ balance. */
export const giftCardLedgerTable = pgTable("gift_card_ledger", {
  id:                uuid("id").primaryKey().defaultRandom(),
  giftCardId:        uuid("gift_card_id").notNull().references(() => giftCardsTable.id, { onDelete: "cascade" }),
  kind:              text("kind").notNull().$type<GiftCardLedgerKind>(),
  /** Positive cents moved by this entry. */
  amountCents:       integer("amount_cents").notNull(),
  balanceAfterCents: integer("balance_after_cents").notNull(),
  /** The rail-side record this movement belongs to (order id, sale id,
   *  checkout session/group id, or the issuance session id). */
  ref:               text("ref"),
  idempotencyKey:    text("idempotency_key").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("gift_card_ledger_kind_check", sql`${t.kind} IN ('issue','redeem','refund_clawback')`),
  check("gift_card_ledger_balance_check", sql`${t.balanceAfterCents} >= 0`),
  uniqueIndex("gift_card_ledger_idem_ux").on(t.idempotencyKey),
  index("gift_card_ledger_card_idx").on(t.giftCardId),
]);

export type GiftCardLedgerEntry = typeof giftCardLedgerTable.$inferSelect;

export const GIFT_CARD_RESERVATION_STATUSES = ["reserved", "redeemed", "released"] as const;
export type GiftCardReservationStatus = (typeof GIFT_CARD_RESERVATION_STATUSES)[number];

/** A hold placed at checkout creation and settled at verify: redeemed
 *  when the sale records, released when the checkout dies/expires.
 *  UNIQUE(rail, ref) makes one checkout hold at most one tender. */
export const giftCardReservationsTable = pgTable("gift_card_reservations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  giftCardId:  uuid("gift_card_id").notNull().references(() => giftCardsTable.id, { onDelete: "cascade" }),
  rail:        text("rail").notNull(),
  ref:         text("ref").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status:      text("status").notNull().default("reserved").$type<GiftCardReservationStatus>(),
  expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("gift_card_reservations_amount_check", sql`${t.amountCents} > 0`),
  check("gift_card_reservations_status_check", sql`${t.status} IN ('reserved','redeemed','released')`),
  uniqueIndex("gift_card_reservations_rail_ref_ux").on(t.rail, t.ref),
  index("gift_card_reservations_card_idx").on(t.giftCardId),
  index("gift_card_reservations_expiry_idx").on(t.status, t.expiresAt),
]);

export type GiftCardReservation = typeof giftCardReservationsTable.$inferSelect;
