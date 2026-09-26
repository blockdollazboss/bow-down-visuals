<<<<<<< HEAD
import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Branding shop orders (dropship model). v1 honesty contract: statuses are
   only "received" and "pending_fulfillment" — there is NO "shipped" /
   "delivered" / tracking-number concept until a real dropship partner
   integration exists. Never fabricate fulfillment state. */
=======
import { pgTable, uuid, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Branding shop orders (dropship model).
   Fulfillment statuses are only ever set from the provider (Printful live
   or the clearly-labeled mock sandbox) — never fabricated. */
>>>>>>> feature/branding-shop
export const brandingOrdersTable = pgTable("branding_orders", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    text("user_id").notNull(),
  items:     jsonb("items").notNull(),
  totalCents: integer("total_cents").notNull(),
  name:      text("name").notNull(),
  email:     text("email").notNull(),
  address:   text("address").notNull(),
  city:      text("city").notNull(),
  state:     text("state").notNull(),
  zip:       text("zip").notNull(),
  status:    text("status").notNull().default("received"),
<<<<<<< HEAD
=======
  /* Fulfillment (Printful integration): */
  provider:        text("provider").notNull().default("mock"), // 'printful' | 'mock'
  providerOrderId: text("provider_order_id"),
  trackingNumber:  text("tracking_number"),
  trackingUrl:     text("tracking_url"),
  paid:            boolean("paid").notNull().default(false),
  stripeSessionId: text("stripe_session_id"),
>>>>>>> feature/branding-shop
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertBrandingOrderSchema = createInsertSchema(brandingOrdersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBrandingOrder = z.infer<typeof insertBrandingOrderSchema>;
export type BrandingOrder = typeof brandingOrdersTable.$inferSelect;

<<<<<<< HEAD
export const BRANDING_ORDER_STATUSES = ["received", "pending_fulfillment"] as const;
=======
export const BRANDING_ORDER_STATUSES = [
  "received",
  "pending_fulfillment",
  "in_production",
  "shipped",
  "delivered",
  "canceled",
  "failed",
] as const;
>>>>>>> feature/branding-shop
export type BrandingOrderStatus = (typeof BRANDING_ORDER_STATUSES)[number];
