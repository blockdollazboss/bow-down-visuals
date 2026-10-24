import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Creator Streaming Platform — Sell Everything storefront (migration 0099).
 *
 * One unified store per creator profile: downloads, merch, digital goods,
 * services/bookings, and event tickets — sold from the public /artist/:slug
 * page via <StorefrontSection />. Worker 5 owns digital_sales (music
 * downloads); this is the separate "sell everything" catalog. Worker 9 owns
 * events — store_products.event_id → events.id; ticket purchases create
 * event_rsvps.
 *
 * Money rules (standing): SALES = real money via Stripe; Visual Bucs = AI
 * credits. The two economies are NEVER mixed in UI copy or accounting.
 * Platform fee (default 5%, STOREFRONT_PLATFORM_FEE_BPS) comes out of the
 * SELLER's cut — the buyer pays the listed price. Creator payouts need
 * Stripe Connect — NOT built here; creator_amount_cents is a pending balance.
 *
 * Merch boundary: physical fulfillment lives in the existing merch system
 * (merch_designs + print/dropship pipeline). A kind='merch' product LINKS to
 * it — this module never rebuilds fulfillment.
 */

export const STORE_PRODUCT_KINDS = ["download", "merch", "digital", "service", "ticket"] as const;
export type StoreProductKind = (typeof STORE_PRODUCT_KINDS)[number];

/** Link-graph item: the track, video, drop page, or event a product relates to. */
export interface RelatedLink {
  label: string;
  url: string;
}

/** One weekly availability window (wall-clock in the creator's timezone).
 *  weekday: 0 = Sunday … 6 = Saturday (JS Date convention). */
export interface BookingWindow {
  weekday: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

/** Per-date override: replaces the weekly windows for that creator-local
 *  date; windows: null closes the day entirely. */
export interface BookingDayOverride {
  date: string; // "YYYY-MM-DD", creator-local
  windows: Array<{ start: string; end: string }> | null;
}

/** Native booking availability for a service product. Slot math lives in
 *  the api-server (lib/booking-slots.ts); slots are stored as UTC
 *  instants on the order (fulfillment_note codec, lib/booking-note.ts). */
export interface BookingAvailability {
  /** The creator's IANA timezone — weekly windows are wall-clock here. */
  timezone: string;
  weekly: BookingWindow[];
  overrides?: BookingDayOverride[];
  /** Minutes between slot starts; default = duration + buffer. */
  slot_step_min?: number;
  /** Breathing room kept around every booking; default 0. */
  buffer_min?: number;
  /** Slots must start at least this many minutes from now; default 0. */
  min_notice_min?: number;
  /** How far ahead slots are offered; default 60. */
  max_advance_days?: number;
}

/** service_details shape for kind='service'. Native calendar booking is
 *  REAL (booking_enabled + availability): buyers pick an open slot and
 *  pay through storefront checkout. booking_calendar_link survives as an
 *  optional external link only — two-way sync with external calendars
 *  (Google/Apple) is still a later build. */
export interface ServiceDetails {
  duration_min?: number;
  location?: string;
  booking_calendar_link?: string;
  notes?: string;
  /** Turn native calendar booking on for this service. */
  booking_enabled?: boolean;
  availability?: BookingAvailability;
}

export const storeProductsTable = pgTable("store_products", {
  id:             uuid("id").primaryKey().defaultRandom(),
  profileId:      uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  kind:           text("kind").notNull().$type<StoreProductKind>(),
  title:          text("title").notNull(),
  description:    text("description").notNull().default(""),
  priceCents:     integer("price_cents").notNull(),
  compareAtCents: integer("compare_at_cents"),
  /** -1 = unlimited / digital. 0 = sold out (blocks checkout). */
  inventory:      integer("inventory").notNull().default(-1),
  mediaUrls:      jsonb("media_urls").$type<string[]>().notNull().default([]),
  serviceDetails: jsonb("service_details").$type<ServiceDetails | null>(),
  eventId:        uuid("event_id"),
  relatedLinks:   jsonb("related_links").$type<RelatedLink[]>().notNull().default([]),
  /* Order bump (Stack-100 #3 #13, migration 0206): the ONE add-on product
     attached to this product + the seller-set % off its price (0 = list). */
  bumpProductId:  uuid("bump_product_id"),
  bumpPercentOff: integer("bump_percent_off").notNull().default(0),
  isActive:       boolean("is_active").notNull().default(true),
  /* Creator Product Affiliates (#16, migration 0205): the creator turns
     affiliates on per product and sets the commission themselves. The
     commission is a % of the SELLER's net (bps, 1..10000), never of the
     platform fee and never added to the buyer's price. Null = not set;
     checkout attribution reads these at sale time (schema/affiliates.ts). */
  affiliateEnabled:      boolean("affiliate_enabled").notNull().default(false),
  affiliateCommissionBps: integer("affiliate_commission_bps"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("store_products_kind_check", sql`${t.kind} IN ('download','merch','digital','service','ticket')`),
  /* >= 0 (migration 0190): $0 is a lead magnet — claimed by email via
     POST /api/storefront/claim, never run through Stripe checkout. */
  check("store_products_price_check", sql`${t.priceCents} >= 0`),
  check("store_products_bump_percent_off_range", sql`${t.bumpPercentOff} >= 0 AND ${t.bumpPercentOff} <= 90`),
  index("store_products_profile_idx").on(t.profileId),
  index("store_products_profile_active_idx").on(t.profileId, t.isActive),
]);

export const insertStoreProductSchema = createInsertSchema(storeProductsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertStoreProduct = z.infer<typeof insertStoreProductSchema>;
export type StoreProduct = typeof storeProductsTable.$inferSelect;

export const storeOrdersTable = pgTable("store_orders", {
  id:                uuid("id").primaryKey().defaultRandom(),
  buyerUserId:       uuid("buyer_user_id"),
  profileId:         uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  productId:         uuid("product_id").references(() => storeProductsTable.id, { onDelete: "set null" }),
  productTitle:      text("product_title").notNull().default(""),
  productKind:       text("product_kind").notNull().default("digital"),
  quantity:          integer("quantity").notNull().default(1),
  amountCents:       integer("amount_cents").notNull(),
  discountCode:      text("discount_code"),
  platformFeeCents:  integer("platform_fee_cents").notNull().default(0),
  creatorAmountCents: integer("creator_amount_cents").notNull().default(0),
  stripeSessionId:   text("stripe_session_id"),
  /* Order bump line (migration 0206): the purchased add-on rides THIS row;
     amount/fee/creator columns stay session totals. */
  bumpProductId:        uuid("bump_product_id"),
  bumpTitle:            text("bump_title"),
  bumpAmountCents:      integer("bump_amount_cents"),
  bumpPlatformFeeCents: integer("bump_platform_fee_cents"),
  bumpCreatorAmountCents: integer("bump_creator_amount_cents"),
  status:            text("status").notNull().default("completed"),
  fulfillmentNote:   text("fulfillment_note"),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("store_orders_profile_idx").on(t.profileId),
  index("store_orders_buyer_idx").on(t.buyerUserId),
  index("store_orders_product_idx").on(t.productId),
  index("store_orders_created_idx").on(t.createdAt),
  uniqueIndex("store_orders_session_ux").on(t.stripeSessionId),
]);

export const insertStoreOrderSchema = createInsertSchema(storeOrdersTable).omit({ id: true, createdAt: true });
export type InsertStoreOrder = z.infer<typeof insertStoreOrderSchema>;
export type StoreOrder = typeof storeOrdersTable.$inferSelect;

export const discountCodesTable = pgTable("discount_codes", {
  id:         uuid("id").primaryKey().defaultRandom(),
  profileId:  uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  code:       text("code").notNull(),
  percentOff: integer("percent_off").notNull(),
  /** -1 = unlimited uses. */
  maxUses:    integer("max_uses").notNull().default(-1),
  usedCount:  integer("used_count").notNull().default(0),
  expiresAt:  timestamp("expires_at", { withTimezone: true }),
  isActive:   boolean("is_active").notNull().default(true),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("discount_codes_percent_check", sql`${t.percentOff} BETWEEN 1 AND 90`),
  uniqueIndex("discount_codes_profile_code_ux").on(t.profileId, t.code),
  index("discount_codes_profile_idx").on(t.profileId),
]);

export const insertDiscountCodeSchema = createInsertSchema(discountCodesTable).omit({ id: true, createdAt: true, usedCount: true });
export type InsertDiscountCode = z.infer<typeof insertDiscountCodeSchema>;
export type DiscountCode = typeof discountCodesTable.$inferSelect;

export const storeDeliveryTokensTable = pgTable("store_delivery_tokens", {
  token:     text("token").primaryKey(),
  orderId:   uuid("order_id").notNull().references(() => storeOrdersTable.id, { onDelete: "cascade" }),
  fileUrl:   text("file_url").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedCount: integer("used_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("store_delivery_tokens_order_idx").on(t.orderId),
]);

export type StoreDeliveryToken = typeof storeDeliveryTokensTable.$inferSelect;
