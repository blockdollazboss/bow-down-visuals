import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/* Fan Memberships: creators launch fan clubs with paid tiers.
   Payment processing (migration 0132): fans join through a Stripe TEST-mode
   checkout; a membership becomes paid/active only after the checkout
   session is verified as paid — never on intent alone. Manual member
   tracking from v1 still exists alongside (fan_user_id null = manual).
   Platform fee is 10% of membership revenue.
   See migrations/0016_fan_memberships.sql + 0132_membership_payments.sql —
   the schema here must stay in sync with the migrations. */

export const fanTiersTable = pgTable(
  "fan_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    name: text("name").notNull(),
    /* Price in integer cents per month. 0 = free tier. */
    price_cents: integer("price_cents").notNull().default(0),
    description: text("description"),
    /* Perks as a JSON array of strings, e.g. ["Early access to videos", "Monthly Q&A"]. */
    perks: jsonb("perks").$type<string[]>().notNull().default([]),
    /* Display order in the fan club page. */
    sort_order: integer("sort_order").notNull().default(0),
    /* Creator-enabled 7-day free trial on join (migration 0132). */
    trial_enabled: boolean("trial_enabled").notNull().default(false),
    /* Membership pause offer (migration 0239, wave-4 #39): creators
       can disable the fan's Pause (1–3 months) offer per tier. Rows
       default to offered — pause is the churn-save that costs the
       creator nothing, so it is on unless they turn it off. */
    pause_enabled: boolean("pause_enabled").notNull().default(true),
    /* Creator-set discount (0–90%) for fans who pay annually. */
    annual_discount_pct: integer("annual_discount_pct").notNull().default(0),
    is_active: text("is_active").notNull().default("true"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fan_tiers_user_id_idx").on(t.user_id),
  ],
);

export type FanTier = typeof fanTiersTable.$inferSelect;

/* "refunded" (migration 0183, defect D1): the payment behind the join
   was refunded or lost to a chargeback — the clawback engine sets it
   and the entitlement is dead (access checks admit only trialing /
   active; payout sums exclude refunded rows explicitly). */
/* "paused" (migration 0239, wave-4 #39): the fan chose to rest for
   1–3 months instead of cancelling. Access sleeps everywhere (every
   gate admits only trialing / active effective statuses) and the
   paid-period clock freezes — on resume the period end shifts by the
   time spent paused, so no paid time ever burns while resting. */
export type FanMemberStatus = "trialing" | "active" | "past_due" | "canceled" | "expired" | "refunded" | "paused";

/* Members join two ways: paid/trial joins through checkout (fan_user_id set,
   real period + expiry) and legacy manual tracking by the creator
   (fan_user_id null, fan_label free-form). `external_ref` holds the Stripe
   checkout session id for paid joins; stripe_session_id mirrors it as the
   idempotency key (unique — a session can only ever create one membership). */
export const fanMembersTable = pgTable(
  "fan_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(), /* the creator who owns this fan club */
    tier_id: uuid("tier_id").notNull(),
    /* Fan identity — free-form for manual adds (email or handle); paid
       joins also set fan_user_id to the fan's real account id. */
    fan_label: text("fan_label").notNull(),
    fan_user_id: uuid("fan_user_id"),
    status: text("status").notNull().default("active").$type<FanMemberStatus>(),
    /* Price locked at join time (integer cents), so tier price
       changes don't rewrite history. For annual joins this is the
       discounted ANNUAL total that was actually charged. */
    price_cents: integer("price_cents").notNull().default(0),
    external_ref: text("external_ref"),
    /* Billing period the member paid for: "monthly" | "annual". */
    billing_period: text("billing_period").notNull().default("monthly"),
    current_period_start: timestamp("current_period_start", { withTimezone: true }),
    current_period_end: timestamp("current_period_end", { withTimezone: true }),
    /* Set while status = "trialing"; the trial converts only via a real
       paid checkout, otherwise the membership reads as expired. */
    trial_ends_at: timestamp("trial_ends_at", { withTimezone: true }),
    stripe_session_id: text("stripe_session_id"),
    /* Connect settlement (migration 0142, DE-14): the creator_payouts row
       that paid this membership out. Null = not yet settled. A linked
       payout in 'failed' status does not settle (see pendingPayoutCents). */
    settled_payout_id: uuid("settled_payout_id"),
    settled_at: timestamp("settled_at", { withTimezone: true }),
    /* Gifted memberships: another user paid for this fan's seat. */
    is_gift: boolean("is_gift").notNull().default(false),
    gifted_by_user_id: uuid("gifted_by_user_id"),
    joined_at: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    canceled_at: timestamp("canceled_at", { withTimezone: true }),
    /* Membership pause (migration 0239): set while status = "paused".
       paused_at = when the rest began; paused_until = the resume date
       stated to the fan before they confirmed. Both clear on resume /
       cancel / reactivation. The elapsed pause shifts
       current_period_end forward on resume (billing skip). */
    paused_at: timestamp("paused_at", { withTimezone: true }),
    paused_until: timestamp("paused_until", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fan_members_user_id_idx").on(t.user_id),
    index("fan_members_tier_id_idx").on(t.tier_id),
    index("fan_members_fan_user_id_idx").on(t.fan_user_id),
    /* One fan label per tier per creator — prevents duplicate manual adds. */
    uniqueIndex("fan_members_tier_fan_ux").on(t.tier_id, t.fan_label),
    /* Idempotency: one verified checkout session → at most one membership. */
    uniqueIndex("fan_members_stripe_session_ux").on(t.stripe_session_id),
  ],
);

export type FanMember = typeof fanMembersTable.$inferSelect;

/* Gifted memberships (migration 0132): one row per gift purchase, so both
   the purchaser and the recipient can see an honest gift state. The actual
   entitlement lives on fan_members (is_gift = true); this row tracks the
   purchase itself, keyed idempotently by the checkout session. */
export const fanMembershipGiftsTable = pgTable(
  "fan_membership_gifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tier_id: uuid("tier_id").notNull(),
    creator_user_id: uuid("creator_user_id").notNull(),
    purchaser_user_id: uuid("purchaser_user_id").notNull(),
    recipient_user_id: uuid("recipient_user_id").notNull(),
    member_id: uuid("member_id"),
    stripe_session_id: text("stripe_session_id"),
    amount_cents: integer("amount_cents").notNull().default(0),
    billing_period: text("billing_period").notNull().default("monthly"),
    /* pending_payment → active (verified paid) — never active before payment. */
    status: text("status").notNull().default("pending_payment"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fan_membership_gifts_purchaser_idx").on(t.purchaser_user_id),
    index("fan_membership_gifts_recipient_idx").on(t.recipient_user_id),
    uniqueIndex("fan_membership_gifts_session_ux").on(t.stripe_session_id),
  ],
);

export type FanMembershipGift = typeof fanMembershipGiftsTable.$inferSelect;
