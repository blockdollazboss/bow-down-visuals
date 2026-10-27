import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Visible subscription receipt/history rows (payfix upgrade-path lane).
 *
 * Pass 1 (Oct 26) found NO receipt or history row anywhere for a paid
 * tier subscription. Every creator-tier lifecycle event (subscribed,
 * tier changed, renewed, payment failed, canceled) writes exactly one
 * row here — idempotency_key is UNIQUE and writers use
 * ON CONFLICT DO NOTHING, so a replayed Stripe webhook can never
 * duplicate a receipt. Surfaced by GET /creator-tiers/history.
 */
export const creatorSubscriptionReceiptsTable = pgTable(
  "creator_subscription_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    tier: text("tier"),
    status: text("status"),
    amountCents: integer("amount_cents"),
    currency: text("currency"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeObjectId: text("stripe_object_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("creator_subscription_receipts_profile_idx").on(t.profileId, t.createdAt),
  ],
);

export type CreatorSubscriptionReceipt = typeof creatorSubscriptionReceiptsTable.$inferSelect;
