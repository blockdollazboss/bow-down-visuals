import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Customer shops ──────────────────────────────────────────────────────
   Bow Down Visuals as a platform: every customer gets their OWN storefront.
   A shop is user-scoped; its public storefront lives at /shop/:handle
   (custom domains are a marked coming-soon — v1 never fakes them).

   Products belong to shops. Prices are stored in integer cents to avoid
   float rounding. Images are AI-generated (OpenAI image model) or uploaded
   by the owner; the storage object is never deleted by row deletes
   (PR #27 lesson — removePhoto() clears state, never the object). */

export const shopsTable = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull(),
  /** URL-safe storefront slug, globally unique, lowercase. */
  handle: text("handle").notNull().unique(),
  tagline: text("tagline"),
  /** AI-written "about this shop" blurb (1 credit via /api/shops/ai/shop-description). */
  description: text("description"),
  /** Hex colors for the storefront theme; gold/black luxury is the default. */
  banner_color: text("banner_color").notNull().default("#0a0a0a"),
  accent_color: text("accent_color").notNull().default("#d4af37"),
  /** Optional banner image URL (uploaded by owner). */
  banner_image_url: text("banner_image_url"),
  /** Custom domain (e.g. shop.artist.com). Null = platform subdomain only. */
  custom_domain: text("custom_domain"),
  /** True once the TXT verification challenge passes. */
  domain_verified: boolean("domain_verified").notNull().default(false),
  /** TXT token the owner must publish at bdv-verify.<domain>. */
  domain_verification_token: text("domain_verification_token"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shopProductsTable = pgTable("shop_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  shop_id: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull(),
  /** Integer cents — never floats. */
  price_cents: integer("price_cents").notNull().default(0),
  description: text("description"),
  /** Public URL of the product image (AI-generated or uploaded). */
  image_url: text("image_url"),
  /** Supabase storage reference for the image file (if uploaded). */
  image_path: text("image_path"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShopSchema = createInsertSchema(shopsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectShopSchema = createSelectSchema(shopsTable);

export const insertShopProductSchema = createInsertSchema(shopProductsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectShopProductSchema = createSelectSchema(shopProductsTable);

/* ── Shop events (analytics) ─────────────────────────────────────────────
   Append-only event log powering per-shop analytics. Views are recorded on
   public storefront loads (deduped per IP+shop per hour at write time).
   Sales are recorded at checkout: gross in cents, the Bow Down Visuals
   platform fee in cents, and the seller's net — all integers, never floats. */

export const shopEventsTable = pgTable("shop_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  shop_id: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull(),
  /** 'view' | 'sale' */
  event_type: text("event_type").notNull(),
  product_id: uuid("product_id"),
  /** Gross sale amount, integer cents. 0 for views. */
  amount_cents: integer("amount_cents").notNull().default(0),
  /** Bow Down Visuals platform fee, integer cents. 0 for views. */
  platform_fee_cents: integer("platform_fee_cents").notNull().default(0),
  /** Buyer email for sale events (order follow-up). */
  buyer_email: text("buyer_email"),
  /** Hashed client IP for view dedup — never a raw IP. */
  ip_hash: text("ip_hash"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShopEventSchema = createInsertSchema(shopEventsTable).omit({
  id: true,
  created_at: true,
});

export const selectShopEventSchema = createSelectSchema(shopEventsTable);

export type Shop = typeof shopsTable.$inferSelect;
export type ShopProduct = typeof shopProductsTable.$inferSelect;
export type ShopEvent = typeof shopEventsTable.$inferSelect;
