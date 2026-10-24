import { pgTable, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";

/**
 * Theme pack purchases (migration 0220). Premium theme packs are a
 * one-time 1,000 VB purchase, owned forever (owner pricing ruling
 * 2026-10-24). One row per (user, pack) — the primary key is the
 * exactly-once anchor for the purchase rail in routes/theme-packs.ts.
 * Creator Elite entitlement is NOT stored here: it is resolved live
 * from creator_subscriptions, so a lapse ends Elite access while rows
 * here (outright purchases) keep their packs.
 */
export const themePackPurchasesTable = pgTable(
  "theme_pack_purchases",
  {
    userId: text("user_id").notNull(),
    packId: text("pack_id").notNull(),
    priceVb: integer("price_vb").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.packId] })],
);

export type ThemePackPurchase = typeof themePackPurchasesTable.$inferSelect;
