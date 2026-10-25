import { pgTable, uuid, text, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { storeProductsTable } from "./storefront";

/* ── Back-in-stock alerts (Wave 4 #37, migration 0236) ───────────────────
   "Tell me when it's back": a SIGNED-IN fan taps once on a sold-out
   store product (store_products.inventory = 0) and is stored here, one
   row per (user, product). When the product's stock returns (seller
   inventory edit 0 → in-stock, a Shopify-import restock, or a draft
   with stock going live), the row is claimed exactly once — a
   status-guarded flip waiting → notified whose RETURNING set is the
   fan-out list — the fan gets ONE in-app notification (the site's
   notifications rail), plus ONE email through lib/email ONLY when the
   fan is already a confirmed subscriber of the seller's own email
   list. No parallel capture list, no new send path: the alert is an
   account feature, not an email harvest.

   CONSUMED MEANS CONSUMED: a notified row never fires again. If the
   product sells out a second time, only fans who tap again after that
   sell-out are alerted on the next restock — subscribing re-arms the
   same row back to 'waiting' (the unique (user, product) index keeps
   it one row per fan per product, forever).

   The alert is about STOCK only. License-keyed products (#35) mint
   keys at fulfillment; key pools never gate, delay, or duplicate an
   alert — inventory is the whole signal.

   The seller's demand signal is a plain count of 'waiting' rows per
   product (rides the product payloads like the drop captureCount). */

export const STOCK_ALERT_STATUSES = ["waiting", "notified"] as const;
export type StockAlertStatus = (typeof STOCK_ALERT_STATUSES)[number];

export const stockAlertsTable = pgTable("stock_alerts", {
  id:         uuid("id").primaryKey().defaultRandom(),
  /** The fan (an auth user id; users live in Supabase auth, so — like
   *  notifications.user_id — this carries no local FK). */
  userId:     uuid("user_id").notNull(),
  productId:  uuid("product_id").notNull().references(() => storeProductsTable.id, { onDelete: "cascade" }),
  status:     text("status").notNull().default("waiting").$type<StockAlertStatus>(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  /** Stamped by the claiming flip when the restock alert fires. */
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
}, (t) => [
  check("stock_alerts_status_check", sql`${t.status} IN ('waiting', 'notified')`),
  uniqueIndex("stock_alerts_user_product_ux").on(t.userId, t.productId),
  index("stock_alerts_product_status_idx").on(t.productId, t.status),
  index("stock_alerts_user_idx").on(t.userId),
]);

export const insertStockAlertSchema = createInsertSchema(stockAlertsTable).omit({
  id: true, createdAt: true, notifiedAt: true,
});
export type InsertStockAlert = z.infer<typeof insertStockAlertSchema>;
export type StockAlert = typeof stockAlertsTable.$inferSelect;
