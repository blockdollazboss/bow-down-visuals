import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";

/* Fan Shoutouts: creators sell personalized video shoutouts to fans.
   v1 honesty contract: setup + request tracking are real. Actual payment
   processing is "coming soon" — requests are recorded with status
   "pending_payment" and no money moves until payment integration ships.
   The UI and API never fake a transaction (status is never "paid" or
   "completed" in v1). A 10% platform fee is recorded as intent only.
   See migrations/0020_fan_shoutouts.sql — the schema here must stay in
   sync with it so boot-time `drizzle-kit push` matches the migration. */

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

export type ShoutoutSettings = typeof shoutoutSettingsTable.$inferSelect;

/* Request lifecycle in v1:
   pending_payment → accepted → in_progress → delivered
                                 ↘ declined
   "pending_payment" is the only money-adjacent state and it is honest:
   no charge has happened (payments coming soon). */
export type ShoutoutRequestStatus =
  | "pending_payment"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "declined";

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
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    delivered_at: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("shoutout_requests_creator_idx").on(t.creator_user_id),
    index("shoutout_requests_status_idx").on(t.status),
  ],
);

export type ShoutoutRequest = typeof shoutoutRequestsTable.$inferSelect;
