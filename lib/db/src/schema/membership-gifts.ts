import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Membership gifts — one signed-in member gifts a Pro/Elite period to
 * another member (payfix lane: gift-membership, provisional migration
 * 9999). One row per PAID gift: the row is born at fulfillment (the
 * Stripe checkout.session.completed webhook claims it exactly once on
 * the UNIQUE stripe_session_id), so the row doubles as the SENDER's
 * receipt and the RECIPIENT's entitlement record.
 *
 * Lifecycle truth: a gift is a one-time payment, NOT a Stripe
 * subscription. Nothing renews and nobody's card is charged again —
 * the recipient holds the gifted tier for [periodStart, periodEnd) and
 * then glides back to whatever their own subscription says (Free if
 * they have none). The tier resolver (middlewares/require-tier.ts)
 * reads the time window directly, so glide-back needs no cron: an
 * expired window simply stops counting. `status` stays 'active' as
 * bookkeeping; the window is the truth (display code computes
 * 'expired' from periodEnd).
 *
 * Collision rule: gifts QUEUE behind an already-active gift (a second
 * gift's period starts when the current gift window ends, extending
 * coverage), and run CONCURRENTLY with the recipient's own paid
 * subscription — the effective tier is the higher of the two, so a
 * gift can never downgrade anyone.
 */
export const membershipGiftsTable = pgTable(
  "membership_gifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderUserId: uuid("sender_user_id").notNull(),
    recipientUserId: uuid("recipient_user_id").notNull(),
    recipientProfileId: uuid("recipient_profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    months: integer("months").notNull().default(1),
    status: text("status").notNull().default("active"),
    stripeSessionId: text("stripe_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    amountCents: integer("amount_cents"),
    currency: text("currency"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("membership_gifts_tier_check", sql`${t.tier} IN ('pro','elite')`),
    check("membership_gifts_status_check", sql`${t.status} IN ('active','refunded')`),
    check("membership_gifts_months_check", sql`${t.months} >= 1 AND ${t.months} <= 12`),
    uniqueIndex("membership_gifts_stripe_session_uidx").on(t.stripeSessionId),
    index("membership_gifts_recipient_profile_idx").on(t.recipientProfileId),
    index("membership_gifts_sender_idx").on(t.senderUserId),
    index("membership_gifts_recipient_idx").on(t.recipientUserId),
  ],
);

export type MembershipGift = typeof membershipGiftsTable.$inferSelect;
