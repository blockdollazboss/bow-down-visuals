import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Payment reversals — the refund / chargeback clawback trail
 * (migration 0182, payments defect D1).
 *
 * One row per Stripe CHARGE, claimed insert-first by the webhook's
 * reversal engine (api-server lib/payment-reversals.ts) BEFORE any
 * money moves — the same discipline as stripe_payments claiming.
 * The row is both the idempotency claim (UNIQUE stripe_charge_id;
 * credits_clawed is cumulative so partial refunds and Stripe retries
 * resume, never double-claw) and the admin-visible audit trail
 * (GET /api/admin/payment-reversals).
 *
 * status:
 *  - 'processing'          a worker owns the reversal right now
 *  - 'completed'           everything the payment granted was reversed
 *  - 'partial_shortfall'   reversed what the balance could cover; the
 *                          unrecoverable remainder is shortfall_credits
 *  - 'failed'              a step threw; a Stripe retry reclaims the row
 *  - 'needs_manual_review' identified-but-not-auto-reversible (branding
 *                          orders already fulfilled, subscription
 *                          charges, released sponsor escrow) or not
 *                          identifiable at all — a human work item
 */
export const PAYMENT_REVERSAL_RAILS = [
  "credit_pack",
  "membership",
  "beat_license",
  "digital_sale",
  "marketplace_shop",
  "storefront_order",
  "live_shop_sale",
  "tip_jar_tip",
  "shoutout_request",
  "sponsor_deal",
  "branding_order",
  "subscription",
  "unidentified",
] as const;
export type PaymentReversalRail = (typeof PAYMENT_REVERSAL_RAILS)[number];

export const PAYMENT_REVERSAL_STATUSES = [
  "processing",
  "completed",
  "partial_shortfall",
  "failed",
  "needs_manual_review",
] as const;
export type PaymentReversalStatus = (typeof PAYMENT_REVERSAL_STATUSES)[number];

export const paymentReversalsTable = pgTable("payment_reversals", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  stripeEventId:        text("stripe_event_id"),
  stripeChargeId:       text("stripe_charge_id").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  trigger:              text("trigger").notNull(),
  rail:                 text("rail").notNull(),
  userId:               uuid("user_id"),
  sessionId:            text("session_id"),
  grantedCredits:       integer("granted_credits").notNull().default(0),
  creditsClawed:        integer("credits_clawed").notNull().default(0),
  referralCreditsClawed: integer("referral_credits_clawed").notNull().default(0),
  refundedCentsSeen:    integer("refunded_cents_seen").notNull().default(0),
  chargeAmountCents:    integer("charge_amount_cents"),
  disputeLost:          boolean("dispute_lost").notNull().default(false),
  entitlementRevoked:   boolean("entitlement_revoked").notNull().default(false),
  sellerReversed:       boolean("seller_reversed").notNull().default(false),
  shortfallCredits:     integer("shortfall_credits").notNull().default(0),
  status:               text("status").notNull().default("processing"),
  details:              jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("payment_reversals_charge_ux").on(t.stripeChargeId),
  index("payment_reversals_status_idx").on(t.status, t.createdAt),
  index("payment_reversals_user_idx").on(t.userId, t.createdAt),
]);

export const insertPaymentReversalSchema = createInsertSchema(paymentReversalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaymentReversal = z.infer<typeof insertPaymentReversalSchema>;
export type PaymentReversal = typeof paymentReversalsTable.$inferSelect;
