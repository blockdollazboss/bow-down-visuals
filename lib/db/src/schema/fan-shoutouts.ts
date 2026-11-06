import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";

/* Fan Shoutouts: creators sell personalized video shoutouts to fans.
   Honesty contract: setup + request tracking are real, and payment
   processing is real (0142): a priced request gets a Stripe Checkout
   session and the guarded settle flip records paid_at exactly once
   when the charge settles. The UI and API never fake a transaction —
   an unpaid request stays "pending_payment" and is never reported as
   paid. The platform fee is the flat 5% law (owner ruling 2026-10-27;
   the v1 10% constant is retired). Paid shoutouts accrue to the
   creator's Earnings + pending payout via lib/seller-earnings.ts
   (migration 0323). See migrations/0020_fan_shoutouts.sql — the schema
   here must stay in sync with it so boot-time `drizzle-kit push`
   matches the migration. */

export const shoutoutSettingsTable = pgTable(
  "shoutout_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    /* Public name fans see, e.g. "Shark King". Defaults to "Creator". */
    display_name: text("display_name").notNull().default("Creator"),
    /* Price per shoutout in integer cents. 0 = free shoutouts. */
    price_cents: integer("price_cents").notNull().default(0),
    /* Promised turnaround in days. */
    turnaround_days: integer("turnaround_days").notNull().default(7),
    /* What the creator will / won't do (content boundaries, length, etc). */
    guidelines: text("guidelines"),
    /* "true" = listed publicly and accepting requests. */
    accepting: text("accepting").notNull().default("false"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shoutout_settings_user_id_ux").on(t.user_id),
    index("shoutout_settings_accepting_idx").on(t.accepting),
  ],
);


/* Request lifecycle:
   pending_payment → accepted → in_progress → delivered
                                 ↘ declined
   "pending_payment" means no charge has settled yet; the settle flip
   (paid_at set) is what moves a priced request to "accepted". */
export type ShoutoutRequestStatus =
  | "pending_payment"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "declined"
  /* The paying charge was refunded / lost to a chargeback — set by
     the clawback engine (migration 0183, defect D1), or by the
     decline rail when a creator declines a paid request and the fan
     is refunded in full automatically (stack1400 #15); the request
     is no longer owed. */
  | "refunded";

export const shoutoutRequestsTable = pgTable(
  "shoutout_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /* The creator who receives this request. */
    creator_user_id: uuid("creator_user_id").notNull(),
    /* Fan identity — free-form in v1 (no fan accounts yet). */
    fan_name: text("fan_name").notNull(),
    fan_email: text("fan_email"),
    /* What the shoutout is for: birthday, anniversary, hype-up, etc. */
    occasion: text("occasion").notNull(),
    /* The message the fan wants delivered. */
    message: text("message").notNull(),
    status: text("status").notNull().default("pending_payment").$type<ShoutoutRequestStatus>(),
    /* Price locked at request time (integer cents). */
    price_cents: integer("price_cents").notNull().default(0),
    /* Where the finished shoutout video lives (Supabase URL), set by creator. */
    delivery_url: text("delivery_url"),
    /* Checkout (migration 0142, DE-14): the Stripe Checkout session that
       pays for this request (UNIQUE — one session pays one request) and
       when payment was verified. Null = unpaid (or a free request). */
    stripe_session_id: text("stripe_session_id"),
    paid_at: timestamp("paid_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    delivered_at: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("shoutout_requests_creator_idx").on(t.creator_user_id),
    index("shoutout_requests_status_idx").on(t.status),
    /* Idempotency (migration 0142): one checkout session pays one request. */
    uniqueIndex("shoutout_requests_stripe_session_ux").on(t.stripe_session_id),
  ],
);

export type ShoutoutRequest = typeof shoutoutRequestsTable.$inferSelect;
