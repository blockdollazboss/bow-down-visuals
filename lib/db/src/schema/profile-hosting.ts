import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Profile Hosting plan entitlements (migration 0134, Stack 3 item 8).
 *
 * One row per creator profile: whether the Hosting plan (custom domain +
 * clean branding + the profile page, sold as one plan on the
 * creator-tiers chassis) is active for that profile. Synced from Stripe
 * subscription webhooks (TEST mode only) — see
 * lib/creator-tier-sync.ts (kind === "creator_hosting").
 *
 * status mirrors Stripe: active | trialing | past_due | canceled |
 * incomplete. Only active/trialing counts as entitled — the paid-state
 * check behind the free-tier branding rule reads this table together
 * with creator_subscriptions.
 */
export const creatorHostingTable = pgTable(
  "creator_hosting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: timestamp("cancel_at_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("creator_hosting_profile_ux").on(t.profileId),
    index("creator_hosting_stripe_sub_idx").on(t.stripeSubscriptionId),
    index("creator_hosting_stripe_customer_idx").on(t.stripeCustomerId),
  ],
);

export type CreatorHosting = typeof creatorHostingTable.$inferSelect;
export type NewCreatorHosting = typeof creatorHostingTable.$inferInsert;
