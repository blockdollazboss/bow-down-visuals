import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
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

export const insertTipJarTipSchema = createInsertSchema(tipJarTipsTable).omit({
  id: true,
  created_at: true,
});

export const selectTipJarTipSchema = createSelectSchema(tipJarTipsTable);

export type TipJarTipRow = typeof tipJarTipsTable.$inferSelect;
export type InsertTipJarTip = z.infer<typeof insertTipJarTipSchema>;
