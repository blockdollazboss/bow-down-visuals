import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Wishlists + price-drop alerts (migration 0237, Wave 4 #38) ────────
   A fan saves a product for later; if its price drops, the fan hears
   about it exactly once per drop through the in-app notifications rail.
   The undecided-money list every storefront platform has (Gumroad,
   Stan, Amazon) — absent here until now.

   The two product catalogs a fan can buy from:
   - 'store_product' → store_products.id (creator storefronts, sold from
     /artist/:slug and /storefront/product/:id)
   - 'shop_product'  → shop_products.id (customer shops, /shop/:handle)

   Price law (the whole feature in one paragraph): price_at_add_cents
   records the price when the fan saved the item. lowest_cents is the
   lowest price seen since the save AND since the last alert — it only
   ever moves DOWN. A price edit alerts iff the new price is strictly
   below lowest_cents; the alert claims the row by moving lowest_cents
   to the new price in the same guarded UPDATE, so a drop can never
   alert twice and a further drop (below the new floor) can alert
   again. Rises never alert and never raise the floor.

   Privacy: a wishlist row belongs to the fan. Sellers never see who
   saved their product — no read path exposes another user's rows. */

export const WISHLIST_ITEM_KINDS = ["store_product", "shop_product"] as const;
export type WishlistItemKind = (typeof WISHLIST_ITEM_KINDS)[number];

export const wishlistsTable = pgTable("wishlists", {
  id:              uuid("id").primaryKey().defaultRandom(),
  userId:          uuid("user_id").notNull(),
  itemKind:        text("item_kind").notNull().$type<WishlistItemKind>(),
  itemId:          uuid("item_id").notNull(),
  /** The product's price (integer cents) when the fan saved it. */
  priceAtAddCents: integer("price_at_add_cents").notNull(),
  /** Lowest price since the save / since the last alert. The alert
   *  baseline: a drop is a new price strictly below this. */
  lowestCents:     integer("lowest_cents").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("wishlists_item_kind_check", sql`${t.itemKind} IN ('store_product', 'shop_product')`),
  check("wishlists_price_at_add_nonneg", sql`${t.priceAtAddCents} >= 0`),
  check("wishlists_lowest_nonneg", sql`${t.lowestCents} >= 0`),
  uniqueIndex("wishlists_user_item_unique").on(t.userId, t.itemKind, t.itemId),
  index("wishlists_user_idx").on(t.userId),
  index("wishlists_item_idx").on(t.itemKind, t.itemId),
]);

export const insertWishlistSchema = createInsertSchema(wishlistsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertWishlist = z.infer<typeof insertWishlistSchema>;
export type Wishlist = typeof wishlistsTable.$inferSelect;
