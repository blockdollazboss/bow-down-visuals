import { pgTable, uuid, text, integer, boolean, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Creator Product Affiliates (#16, migration 0205) ────────────────────
   A creator enables affiliates on a store/storefront product and sets the
   commission % themselves. A fan gets a per-product share code; a sale
   through that code records the commission owed in affiliate_sales.

   Money discipline (standing):
   - The commission comes out of the SELLER's net (gross − platform fee).
     The platform fee stays the flat 5% (PLATFORM_FEE_BPS) and the buyer's
     price never changes. Commission is a % of the seller's net, in bps,
     snapshotted onto the ledger row at sale time.
   - This ledger RECORDS a liability; it never moves money. status starts
     'owed'; only the existing creator-payout settlement rails may mark a
     row 'paid'. No new payout mechanism lives here.
   - The platform referral program (schema/referrals.ts) is a DIFFERENT
     program: it pays Visual Bucs on a referee's CREDIT purchases only.
     Affiliate rows are written only from product-sale funnels, so the two
     programs can never pay twice for one sale.

   The per-product settings live on the product rows themselves:
   store_products.affiliate_enabled / affiliate_commission_bps and
   shop_products.affiliate_enabled / affiliate_commission_bps (0205). */

export const AFFILIATE_SURFACES = ["store_product", "shop_product"] as const;
export type AffiliateSurface = (typeof AFFILIATE_SURFACES)[number];

export const AFFILIATE_SALE_STATUSES = ["owed", "paid", "void"] as const;
export type AffiliateSaleStatus = (typeof AFFILIATE_SALE_STATUSES)[number];

export const affiliateCodesTable = pgTable("affiliate_codes", {
  id:              uuid("id").primaryKey().defaultRandom(),
  /** Share code as presented in links (?ref=CODE). Stored uppercase. */
  code:            text("code").notNull(),
  affiliateUserId: uuid("affiliate_user_id").notNull(),
  sellerUserId:    uuid("seller_user_id").notNull(),
  surface:         text("surface").notNull().$type<AffiliateSurface>(),
  productId:       uuid("product_id").notNull(),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("affiliate_codes_surface_check", sql`${t.surface} IN ('store_product','shop_product')`),
  uniqueIndex("affiliate_codes_code_ux").on(sql`UPPER(${t.code})`),
  uniqueIndex("affiliate_codes_affiliate_product_ux").on(t.affiliateUserId, t.surface, t.productId),
  index("affiliate_codes_seller_idx").on(t.sellerUserId),
  index("affiliate_codes_product_idx").on(t.surface, t.productId),
]);

export const insertAffiliateCodeSchema = createInsertSchema(affiliateCodesTable).omit({
  id: true, createdAt: true,
});
export type InsertAffiliateCode = z.infer<typeof insertAffiliateCodeSchema>;
export type AffiliateCode = typeof affiliateCodesTable.$inferSelect;

export const affiliateSalesTable = pgTable("affiliate_sales", {
  id:               uuid("id").primaryKey().defaultRandom(),
  affiliateCodeId:  uuid("affiliate_code_id").notNull().references(() => affiliateCodesTable.id, { onDelete: "cascade" }),
  affiliateUserId:  uuid("affiliate_user_id").notNull(),
  sellerUserId:     uuid("seller_user_id").notNull(),
  surface:          text("surface").notNull().$type<AffiliateSurface>(),
  productId:        uuid("product_id"),
  productTitle:     text("product_title").notNull().default(""),
  /** Exactly-once key with (surface, productId): the Stripe checkout
   *  session id on the storefront rail, the checkout_group_id on the
   *  shops rail (one ledger row per product line of the cart). */
  orderRef:         text("order_ref").notNull(),
  buyerUserId:      uuid("buyer_user_id"),
  buyerEmail:       text("buyer_email"),
  grossCents:       integer("gross_cents").notNull().default(0),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  /** Seller's net BEFORE the affiliate commission is taken out of it. */
  sellerNetCents:   integer("seller_net_cents").notNull().default(0),
  /** Creator-set rate snapshotted at sale time (bps of the seller net). */
  commissionBps:    integer("commission_bps").notNull(),
  commissionCents:  integer("commission_cents").notNull().default(0),
  status:           text("status").notNull().default("owed").$type<AffiliateSaleStatus>(),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt:           timestamp("paid_at", { withTimezone: true }),
}, (t) => [
  check("affiliate_sales_surface_check", sql`${t.surface} IN ('store_product','shop_product')`),
  check("affiliate_sales_status_check", sql`${t.status} IN ('owed','paid','void')`),
  uniqueIndex("affiliate_sales_once_ux").on(t.surface, t.orderRef, t.productId),
  index("affiliate_sales_seller_idx").on(t.sellerUserId, t.createdAt),
  index("affiliate_sales_affiliate_idx").on(t.affiliateUserId, t.createdAt),
  index("affiliate_sales_code_idx").on(t.affiliateCodeId),
]);

export const insertAffiliateSaleSchema = createInsertSchema(affiliateSalesTable).omit({
  id: true, createdAt: true,
});
export type InsertAffiliateSale = z.infer<typeof insertAffiliateSaleSchema>;
export type AffiliateSale = typeof affiliateSalesTable.$inferSelect;
