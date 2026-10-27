import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * One Stripe customer per user (payfix upgrade-path lane, Oct 26 2026).
 *
 * Root cause of the Pass-1 double-subscription defect: the creator-tier
 * checkout never passed a `customer` to Stripe, so EVERY checkout minted
 * a brand-new Stripe customer — a Pro purchase and a later Elite
 * "upgrade" landed on two different customers with two live
 * subscriptions ($41/mo billed instead of $29).
 *
 * This table is the durable user → Stripe-customer mapping every
 * subscription checkout consults BEFORE creating anything. user_id is
 * UNIQUE: one user, one customer, forever. Legacy customer ids already
 * recorded on creator_subscriptions / creator_hosting are backfilled
 * into this table on first read (see lib/creator-stripe-customer.ts).
 */
export const userStripeCustomersTable = pgTable(
  "user_stripe_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("user_stripe_customers_customer_uidx").on(t.stripeCustomerId),
  ],
);

export type UserStripeCustomer = typeof userStripeCustomersTable.$inferSelect;
