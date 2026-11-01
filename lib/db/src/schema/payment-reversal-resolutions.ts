import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { paymentReversalsTable } from "./payment-reversals";

/**
 * Payment reversal resolutions — the human's decision on a parked
 * reversal row (migration 0308, stack1100 Lane Y2).
 *
 * The reversal engine (api-server lib/payment-reversals.ts) parks
 * charges it must not reverse on its own at 'needs_manual_review'.
 * Until this table, the queue had no write verb at all: a parked row
 * could never be resolved. POST /api/admin/payment-reversals/:id/resolve
 * is that verb, and this table is its audit trail — one row per
 * resolution (UNIQUE reversal_id is the exactly-once claim the verb
 * inserts BEFORE it acts), recording who decided, when, which way,
 * and the admin's note.
 *
 * decision:
 *  - 'complete'  run the engine's own completion path for the parked
 *                row (its entitlement/seller legs), landing the row
 *                at 'completed'
 *  - 'dismiss'   reviewed, no reversal — the row lands at 'dismissed'
 *                and NO money moves
 */
export const PAYMENT_REVERSAL_RESOLUTION_DECISIONS = ["complete", "dismiss"] as const;
export type PaymentReversalResolutionDecision =
  (typeof PAYMENT_REVERSAL_RESOLUTION_DECISIONS)[number];

export const paymentReversalResolutionsTable = pgTable("payment_reversal_resolutions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  reversalId:     uuid("reversal_id").notNull().references(() => paymentReversalsTable.id, { onDelete: "cascade" }),
  stripeChargeId: text("stripe_charge_id").notNull(),
  decision:       text("decision").notNull(),
  adminUserId:    uuid("admin_user_id"),
  adminEmail:     text("admin_email"),
  note:           text("note").notNull().default(""),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("payment_reversal_resolutions_reversal_ux").on(t.reversalId),
  index("payment_reversal_resolutions_created_idx").on(t.createdAt),
]);

export const insertPaymentReversalResolutionSchema = createInsertSchema(paymentReversalResolutionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPaymentReversalResolution = z.infer<typeof insertPaymentReversalResolutionSchema>;
export type PaymentReversalResolution = typeof paymentReversalResolutionsTable.$inferSelect;
