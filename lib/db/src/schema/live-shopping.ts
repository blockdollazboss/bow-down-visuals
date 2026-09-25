import { pgTable, uuid, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Live Shopping (v1).
   Creators sell products during live streams: a per-user product catalog,
   selling-session records with an optionally pinned overlay product,
   recorded sales (5% platform fee snapshot), and a purchase-alert feed the
   overlay polls for popups.

   Honest v1 boundaries:
   - Platform checkout is NOT processed here — `external_url` is the
     creator's own checkout link; overlay "buy" buttons link out.
   - Sales recorded via the API are test/demo sales until platform checkout
     ships; the dashboard labels them as such. */

/** Platform fee on sales made through the platform: 5% (stored as bps). */
export const LIVE_SHOPPING_FEE_BPS = 500;

/** Whole-cent fee for a sale of `totalCents`. Rounds half-up. */
export function platformFeeCents(totalCents: number): number {
  return Math.round((totalCents * LIVE_SHOPPING_FEE_BPS) / 10000);
}

/** Creator payout for a sale of `totalCents` after the platform fee. */
export function creatorPayoutCents(totalCents: number): number {
  return totalCents - platformFeeCents(totalCents);
}

export const liveShopProductsTable = pgTable(
  "live_shop_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    name: text("name").notNull(),
    price_cents: integer("price_cents").notNull(),
    image_url: text("image_url"),
    external_url: text("external_url"),
    description: text("description"),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("live_shop_products_user_id_idx").on(t.user_id)],
);

export const liveShopStreamsTable = pgTable(
  "live_shop_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("scheduled"),
    pinned_product_id: uuid("pinned_product_id"),
    started_at: timestamp("started_at", { withTimezone: true }),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("live_shop_streams_user_id_idx").on(t.user_id)],
);

export const liveShopSalesTable = pgTable(
  "live_shop_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    stream_id: uuid("stream_id"),
    product_id: uuid("product_id"),
    quantity: integer("quantity").notNull().default(1),
    price_cents: integer("price_cents").notNull(),
    platform_fee_cents: integer("platform_fee_cents").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("live_shop_sales_user_id_idx").on(t.user_id),
    index("live_shop_sales_stream_id_idx").on(t.stream_id),
  ],
);

export const liveShopAlertsTable = pgTable(
  "live_shop_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    stream_id: uuid("stream_id").notNull(),
    product_id: uuid("product_id"),
    buyer_name: text("buyer_name").notNull().default("A viewer"),
    quantity: integer("quantity").notNull().default(1),
    total_cents: integer("total_cents").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("live_shop_alerts_stream_id_idx").on(t.stream_id)],
);

export const insertLiveShopProductSchema = createInsertSchema(liveShopProductsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertLiveShopProduct = z.infer<typeof insertLiveShopProductSchema>;
export type LiveShopProduct = typeof liveShopProductsTable.$inferSelect;

export const insertLiveShopStreamSchema = createInsertSchema(liveShopStreamsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertLiveShopStream = z.infer<typeof insertLiveShopStreamSchema>;
export type LiveShopStream = typeof liveShopStreamsTable.$inferSelect;

export const insertLiveShopSaleSchema = createInsertSchema(liveShopSalesTable).omit({
  id: true,
  created_at: true,
});
export type InsertLiveShopSale = z.infer<typeof insertLiveShopSaleSchema>;
export type LiveShopSale = typeof liveShopSalesTable.$inferSelect;

export const insertLiveShopAlertSchema = createInsertSchema(liveShopAlertsTable).omit({
  id: true,
  created_at: true,
});
export type InsertLiveShopAlert = z.infer<typeof insertLiveShopAlertSchema>;
export type LiveShopAlert = typeof liveShopAlertsTable.$inferSelect;
