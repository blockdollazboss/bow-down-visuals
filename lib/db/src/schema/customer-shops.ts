import { pgTable, uuid, text, timestamp, integer, boolean, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  /** Listing state (migration 0176): 'active' | 'paused'. Mirrors the
      status vocabulary of creator_subscriptions / fan_memberships /
      sponsor_deals (text, NOT NULL, default 'active') — every product
      is live unless its seller pauses it. Buyers only ever see
      'active' rows; 'paused' rows stay in the seller's own management
      views and are refused at checkout. */
  status: text("status").notNull().default("active").$type<ShopProductStatus>(),
  /** The finished UGC ad pinned to this product (migration 0178),
      or null. One column = the cardinality rule: at most one pinned
      ad per product; pinning another ad replaces the pin. The pin
      verb lives on the ad record (routes/ugc-ads.ts); buyer reads
      surface the ad's video only while the product is 'active' and
      the ad is still 'ready'. Plain UUID by design (no FK), exactly
      like ugc_ads.shop_product_id — the rails validate ownership at
      write time and reads tolerate a dangling id as "no pin". */
  pinned_ugc_ad_id: uuid("pinned_ugc_ad_id"),
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
   Event log powering per-shop analytics. Views are recorded on
   public storefront loads (deduped per IP+shop per hour at write time).
   Sales carry gross in cents, the Bow Down Visuals platform fee in cents,
   and the seller's net — all integers, never floats. Since migration
   0144 a card checkout first lands as event_type='pending_sale' and is
   flipped to 'sale' only when its Stripe session is confirmed paid, so
   'sale' rows are always paid truth (legacy pre-0144 rows were recorded
   at click time and keep their historical meaning). */

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
  /** Marketplace card checkout (migration 0144): the Stripe Checkout
      session that pays for this row. One session can cover several cart
      lines — one row per line, all sharing the session id (index, not
      unique; idempotency is the guarded pending_sale -> sale flip). */
  stripe_session_id: text("stripe_session_id"),
  /** 'pending' | 'paid' | 'no_payment_required' | 'expired'. Null on
      views and on legacy sale rows recorded before 0144. A row only
      counts as a sale (analytics / earnings) once event_type='sale',
      which happens exclusively through the paid flip. */
  payment_status: text("payment_status"),
  /** When the paid flip landed (server truth for "this was paid"). */
  paid_at: timestamp("paid_at", { withTimezone: true }),
  /** Units bought on this line (migration 0144). */
  quantity: integer("quantity").notNull().default(1),
  /** Groups the lines of one checkout (migration 0144). */
  checkout_group_id: text("checkout_group_id"),
  /** The shop discount code this line was priced with (migration 0190),
      carried from the pending rows through the paid flip so the code's
      use is counted exactly once, when the sale is recorded — the
      storefront's redemption discipline. Null = no code. */
  discount_code: text("discount_code"),
  /** Connect settlement (migration 0142, DE-14): the creator_payouts row
      that paid this sale out. Null = not yet settled. A linked payout in
      'failed' status does not settle (see pendingPayoutCents). */
  settled_payout_id: uuid("settled_payout_id"),
  settled_at: timestamp("settled_at", { withTimezone: true }),
  /** Hashed client IP for view dedup — never a raw IP. */
  ip_hash: text("ip_hash"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Shop discount codes (migration 0190) ─────────────────────────────
   The profile storefront's discount_codes model (0099) copied
   field-for-field for marketplace shops, keyed by shop instead of
   creator profile: percent off 1..90, max_uses (-1 = unlimited),
   used_count counted at sale time, optional expiry, active flag, one
   code name per shop. Validation/redemption discipline lives in
   routes/generate/shops.ts, mirroring routes/storefront.ts. */

export const shopDiscountCodesTable = pgTable("shop_discount_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  shop_id: uuid("shop_id")
    .notNull()
    .references(() => shopsTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  percent_off: integer("percent_off").notNull(),
  /** -1 = unlimited uses. */
  max_uses: integer("max_uses").notNull().default(-1),
  used_count: integer("used_count").notNull().default(0),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("shop_discount_codes_percent_check", sql`${t.percent_off} BETWEEN 1 AND 90`),
  uniqueIndex("shop_discount_codes_shop_code_ux").on(t.shop_id, t.code),
  index("shop_discount_codes_shop_idx").on(t.shop_id),
]);

export const insertShopDiscountCodeSchema = createInsertSchema(shopDiscountCodesTable).omit({
  id: true,
  created_at: true,
  used_count: true,
});

export const selectShopDiscountCodeSchema = createSelectSchema(shopDiscountCodesTable);

export type ShopDiscountCode = typeof shopDiscountCodesTable.$inferSelect;

export const insertShopEventSchema = createInsertSchema(shopEventsTable).omit({
  id: true,
  created_at: true,
});

export const selectShopEventSchema = createSelectSchema(shopEventsTable);

/** Shop product listing state (migration 0176). */
export type ShopProductStatus = "active" | "paused";

export type Shop = typeof shopsTable.$inferSelect;
export type ShopProduct = typeof shopProductsTable.$inferSelect;
export type ShopEvent = typeof shopEventsTable.$inferSelect;
