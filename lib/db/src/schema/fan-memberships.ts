import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/* Fan Memberships: creators launch fan clubs with paid tiers.
   v1 honesty contract: tier setup + member tracking are real. Actual payment
   processing is "coming soon" — the members table tracks manual/imported
   subscribers until Stripe billing lands. Never fake a transaction.
   Platform fee (10%) is recorded as intent on tiers; no money moves in v1.
   See migrations/0014_fan_memberships.sql — the schema here must stay in
   sync with it so boot-time `drizzle-kit push` matches the migration. */

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
    is_active: text("is_active").notNull().default("true"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fan_tiers_user_id_idx").on(t.user_id),
  ],
);

export type FanTier = typeof fanTiersTable.$inferSelect;

export type FanMemberStatus = "active" | "past_due" | "canceled";

/* Members are tracked manually in v1 (payment processing coming soon).
   `external_ref` holds the future Stripe subscription id; null until then. */
export const fanMembersTable = pgTable(
  "fan_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(), /* the creator who owns this fan club */
    tier_id: uuid("tier_id").notNull(),
    /* Fan identity — free-form in v1 (email or handle); a real auth link
       comes with payment processing. */
    fan_label: text("fan_label").notNull(),
    status: text("status").notNull().default("active").$type<FanMemberStatus>(),
    /* Monthly price locked at join time (integer cents), so tier price
       changes don't rewrite history. */
    price_cents: integer("price_cents").notNull().default(0),
    external_ref: text("external_ref"),
    joined_at: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    canceled_at: timestamp("canceled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fan_members_user_id_idx").on(t.user_id),
    index("fan_members_tier_id_idx").on(t.tier_id),
    /* One fan label per tier per creator — prevents duplicate manual adds. */
    uniqueIndex("fan_members_tier_fan_ux").on(t.tier_id, t.fan_label),
  ],
);

export type FanMember = typeof fanMembersTable.$inferSelect;
