import { pgTable, uuid, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Merch Designer (v1) — AI-designed merch for creators, dropship model.
   Creators generate design mockups (3 credits per batch), list products
   with their own retail price, and see their profit margin. The site never
   touches inventory: manufacturers ship directly. Checkout/payment is
   honestly "coming soon" — order intents are recorded but never charged.
   A future platform commission (MERCH_COMMISSION_PCT) applies when
   payments ship; the dashboard shows the net figure so creators price
   with eyes open. */

export const merchDesignsTable = pgTable(
  "merch_designs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    /* Creator-facing title, e.g. "Shark King Tour Tee". */
    title: text("title").notNull(),
    /* Product type: t-shirt | hoodie | cap | poster */
    product: text("product").notNull(),
    /* Style preset: streetwear | minimal | vintage | luxury-gold */
    style: text("style").notNull(),
    /* The design description the creator typed. */
    prompt: text("prompt"),
    /* Generated mockup image (re-hosted in our bucket). */
    image_url: text("image_url").notNull(),
    image_path: text("image_path"),
    /* Retail price in cents, set by the creator. Null = not priced yet. */
    price_cents: integer("price_cents"),
    /* Print-on-demand base cost in cents, snapshot at design time. */
    base_cost_cents: integer("base_cost_cents").notNull(),
    /* draft | listed — only listed items show in the creator's store. */
    status: text("status").notNull().default("draft"),
    /* Honest dropship flag: payments are not live yet. */
    payments_live: boolean("payments_live").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merch_designs_user_id_idx").on(t.user_id)],
);

export const insertMerchDesignSchema = createInsertSchema(merchDesignsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertMerchDesign = z.infer<typeof insertMerchDesignSchema>;
export type MerchDesign = typeof merchDesignsTable.$inferSelect;
