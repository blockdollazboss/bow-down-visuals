import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";
import { storeProductsTable } from "./storefront";

/**
 * Gift-This-Product (Wave-4 #45) — a buyer purchases a REAL store
 * product AS A GIFT for another member. This is NOT the stored-value
 * gift-card machine (gift-cards.ts): that sells store credit; this
 * sells the product itself, held for the recipient until they claim it.
 *
 * ⚠️ PROVISIONAL MIGRATION: lib/db/migrations/0259-gift-product.sql —
 * the number is provisional and MUST be renumbered by the integrator
 * at join time. Until it lands, every money path that touches these
 * tables fails closed (503) — never open.
 *
 * Money law (existing rails only, nothing invented):
 *  - The buyer pays with Visual Bucs through lib/credits.ts
 *    chargeCredits (test-mode rail) — gift price in VB equals the
 *    product's real listed price_cents × quantity (the house x100
 *    rule: price_cents IS the Visual Bucs amount; the listed USD
 *    price is unchanged and displayed honestly beside it).
 *  - The store's FLAT 5% platform fee (lib/platform-fees.ts feeSplit,
 *    500 bps) is computed on the full gross at purchase and recorded
 *    on the row — exactly the split the recipient's claim order
 *    carries into store_orders. The fee NEVER changes for gifts and
 *    is never charged twice: the claim writes no second charge.
 *  - Exactly-once: product_gifts.idempotency_key is UNIQUE and the
 *    VB charge carries its own credit_usage idempotency key derived
 *    from the same intent, so a retry/replay can neither create a
 *    second gift nor deduct twice. The append-only ledger below
 *    records each movement once (UNIQUE idempotency_key).
 *  - UNCLAIMED GIFTS: the paid value is HELD on the row as the
 *    recipient's claimable credit (claimable_cents = amount_cents).
 *    It never expires into platform/seller revenue and is never
 *    silently kept: until the recipient claims, the seller split is
 *    NOT settled (no store_orders row exists), and the recipient can
 *    claim at any time from their library / notifications. Claiming
 *    settles the recorded fee/creator split exactly once via the
 *    claim order (stripe_session_id = 'gift:{id}', UNIQUE).
 */

export const PRODUCT_GIFT_STATUSES = ["scheduled", "awaiting_claim", "claimed"] as const;
export type ProductGiftStatus = (typeof PRODUCT_GIFT_STATUSES)[number];

export const productGiftsTable = pgTable("product_gifts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  productId:        uuid("product_id").references(() => storeProductsTable.id, { onDelete: "set null" }),
  profileId:        uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  productTitle:     text("product_title").notNull().default(""),
  productKind:      text("product_kind").notNull().default("digital"),
  buyerUserId:      uuid("buyer_user_id").notNull(),
  /** Resolved at purchase when the recipient's email maps to a member;
   *  null for a recipient who has not joined yet — the email is the
   *  claim capability and matches their account email at claim time. */
  recipientUserId:  uuid("recipient_user_id"),
  recipientEmail:   text("recipient_email").notNull(),
  giftMessage:      text("gift_message"),
  quantity:         integer("quantity").notNull().default(1),
  /** Full gross in cents = the product's real listed price × qty. */
  amountCents:      integer("amount_cents").notNull(),
  /** The same gross in Visual Bucs actually charged (x100 rule: equal). */
  creditsCharged:   integer("credits_charged").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  creatorAmountCents: integer("creator_amount_cents").notNull().default(0),
  /** Value held for the recipient while unclaimed. Equals amount_cents
   *  until claim, then 0 — the held value is settled by the claim order. */
  claimableCents:   integer("claimable_cents").notNull(),
  idempotencyKey:   text("idempotency_key").notNull(),
  status:           text("status").notNull().default("scheduled").$type<ProductGiftStatus>(),
  /** Buyer's chosen delivery moment; a gift is claimable only at/after it. */
  deliveryAt:       timestamp("delivery_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when the delivery notification (bell + email) has gone out. */
  deliveredAt:      timestamp("delivered_at", { withTimezone: true }),
  claimedAt:        timestamp("claimed_at", { withTimezone: true }),
  /** The recipient's store_orders row created by the claim. */
  claimOrderId:     uuid("claim_order_id"),
  resendCount:      integer("resend_count").notNull().default(0),
  lastResentAt:     timestamp("last_resent_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("product_gifts_amount_check", sql`${t.amountCents} > 0`),
  check("product_gifts_credits_check", sql`${t.creditsCharged} > 0`),
  check("product_gifts_claimable_check", sql`${t.claimableCents} >= 0 AND ${t.claimableCents} <= ${t.amountCents}`),
  check("product_gifts_quantity_check", sql`${t.quantity} > 0`),
  check("product_gifts_status_check", sql`${t.status} IN ('scheduled','awaiting_claim','claimed')`),
  uniqueIndex("product_gifts_idem_ux").on(t.idempotencyKey),
  index("product_gifts_recipient_user_idx").on(t.recipientUserId),
  index("product_gifts_recipient_email_idx").on(t.recipientEmail),
  index("product_gifts_buyer_idx").on(t.buyerUserId),
  index("product_gifts_status_delivery_idx").on(t.status, t.deliveryAt),
]);

export const insertProductGiftSchema = createInsertSchema(productGiftsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertProductGift = z.infer<typeof insertProductGiftSchema>;
export type ProductGift = typeof productGiftsTable.$inferSelect;

export const PRODUCT_GIFT_LEDGER_KINDS = ["charge", "claim_settle", "resend"] as const;
export type ProductGiftLedgerKind = (typeof PRODUCT_GIFT_LEDGER_KINDS)[number];

/** Append-only audit for gift money/notification movements. `charge`
 *  and `claim_settle` each land exactly once per gift; `resend` rows
 *  record notification re-sends (amount 0, no money moves). */
export const productGiftLedgerTable = pgTable("product_gift_ledger", {
  id:             uuid("id").primaryKey().defaultRandom(),
  giftId:         uuid("gift_id").notNull().references(() => productGiftsTable.id, { onDelete: "cascade" }),
  kind:           text("kind").notNull().$type<ProductGiftLedgerKind>(),
  amountCents:    integer("amount_cents").notNull().default(0),
  ref:            text("ref"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("product_gift_ledger_kind_check", sql`${t.kind} IN ('charge','claim_settle','resend')`),
  uniqueIndex("product_gift_ledger_idem_ux").on(t.idempotencyKey),
  index("product_gift_ledger_gift_idx").on(t.giftId),
]);

export type ProductGiftLedgerEntry = typeof productGiftLedgerTable.$inferSelect;
