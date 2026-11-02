import { pgTable, uuid, text, integer, timestamp, index, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Tip jar paid tips (migration 0142, DE-14). The tip jar's v1 storage is
   in-memory INTENT records (routes/generate/tip-jar.ts) that sit at
   pending_payment forever — no charge exists there by design. This table
   is the durable half of the real checkout: one row per Checkout session
   (stripe_session_id UNIQUE — a session can only ever record one tip),
   flipped to 'paid' exactly once by the verify endpoint. */
export const tipJarTipsTable = pgTable(
  "tip_jar_tips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The creator whose tip page received the tip. */
    page_user_id: uuid("page_user_id").notNull(),
    handle: text("handle").notNull(),
    fan_name: text("fan_name").notNull().default(""),
    message: text("message").notNull().default(""),
    amount_cents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    /** pending_payment | paid */
    status: text("status").notNull().default("pending_payment"),
    stripe_session_id: text("stripe_session_id").unique(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paid_at: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [index("tip_jar_tips_page_user_idx").on(t.page_user_id)],
);

const insertTipJarTipSchema = createInsertSchema(tipJarTipsTable).omit({
  id: true,
  created_at: true,
});

export const selectTipJarTipSchema = createSelectSchema(tipJarTipsTable);

/* ─── Tip pages (migration 0316) ─────────────────────────────────────
   The tip PAGE itself: one row per account (user_id PK — the jar is
   per-account; an account's several artist profiles share it, and the
   handle is the public identity). Until 0316 the settings lived ONLY
   in a process-memory map in routes/generate/tip-jar.ts, so any
   service restart or redeploy wiped every tip page on the site while
   the paid tips in tip_jar_tips survived — Gate #5, Nov 2: a jar
   created in the morning, with two paid tips on it, answered "Tip
   page not found" by 11:12 after an env-save redeploy. This table is
   the store of record; the route keeps a read-through cache only. */
export const tipPagesTable = pgTable(
  "tip_pages",
  {
    /** The account that owns the jar (auth user id). */
    user_id: uuid("user_id").primaryKey(),
    /** The public handle — /tips/:handle. Globally unique. */
    handle: text("handle").notNull().unique(),
    display_name: text("display_name").notNull(),
    message: text("message").notNull().default(""),
    suggested_amounts: jsonb("suggested_amounts").$type<number[]>().notNull().default([]),
    /** Funding-goal mirror fields (dollars), kept for existing readers. */
    goal_amount: doublePrecision("goal_amount"),
    goal_label: text("goal_label").notNull().default(""),
    funding_goal: jsonb("funding_goal").$type<{
      id: string;
      targetAmount: number;
      label: string;
      startedAt: string;
    } | null>(),
    goal_history: jsonb("goal_history").$type<
      Array<{
        id: string;
        label: string;
        targetAmount: number;
        raisedAmount: number;
        startedAt: string;
        reachedAt: string;
      }>
    >().notNull().default([]),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tip_pages_handle_idx").on(t.handle)],
);

export const insertTipPageSchema = createInsertSchema(tipPagesTable);
export const selectTipPageSchema = createSelectSchema(tipPagesTable);

