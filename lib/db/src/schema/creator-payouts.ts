import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

/* creator_payouts: ledger of Stripe Connect (Express) transfers to creators.
 * Earnings accrue as pending balances (digital_sales + store_orders);
 * each payout row settles part of that balance. status: processing ->
 * pending (transfer created) | failed. "paid" is set once Stripe confirms
 * the transfer (transfer.updated webhook — future build). */
export const creatorPayoutsTable = pgTable("creator_payouts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  profileId:        uuid("profile_id").notNull(),
  amountCents:      integer("amount_cents").notNull(),
  stripeTransferId: text("stripe_transfer_id"),
  status:           text("status").notNull().default("pending"),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("creator_payouts_profile_idx").on(t.profileId),
]);

export const insertCreatorPayoutSchema = createInsertSchema(creatorPayoutsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCreatorPayout = z.infer<typeof insertCreatorPayoutSchema>;
export type CreatorPayout = typeof creatorPayoutsTable.$inferSelect;
