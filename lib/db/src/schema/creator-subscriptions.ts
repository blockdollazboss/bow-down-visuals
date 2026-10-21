import { pgTable, uuid, text, timestamp, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Creator Streaming Platform — tier subscriptions (migration 0092).
 *
 * One row per creator profile: which paid tier the creator is on, synced
 * from Stripe subscription webhooks (see lib/creator-tier-sync.ts).
 * profile_id is UNIQUE — a profile holds exactly one tier row.
 *
 * Tiers: 'free' | 'pro' | 'elite' (canonical; see lib/platform-fees.ts).
 * status mirrors Stripe: active | trialing | past_due | canceled | incomplete.
 * A canceled/past_due row with an expired period still reads as 'free'
 * through the gating helpers — the money is never gated, only pro controls.
 */
export const creatorSubscriptionsTable = pgTable(
  "creator_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .unique()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    tier: text("tier").notNull().default("free"),
    status: text("status").notNull().default("active"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: timestamp("cancel_at_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("creator_subscriptions_tier_check", sql`${t.tier} IN ('free','pro','elite')`),
    index("creator_subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
  ],
);

export type CreatorSubscription = typeof creatorSubscriptionsTable.$inferSelect;
