import { pgTable, uuid, text, integer, numeric, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Co-seller revenue splits (Wave 4 #36, migration 0235) ──────────────
   Two creators sell one store/shop product together; the sale divides
   automatically instead of one collecting everything and paying the
   other by hand.

   The SETTING lives on the product rows (store_products.splits /
   shop_products.splits, jsonb): a list of { userId, sharePct } whose
   shares sum to exactly 100 — the publishing-splits sum-to-100 machine
   (lib/publishing-splits.ts rules, re-run server-side in
   lib/sale-splits.ts). The product's owner is one row of the list with
   their own share; the sellers set every percentage — the platform
   invents none. Null/absent = no co-sellers, product sells as before.

   The DIVISION lands here, one row per seller per product line of a
   fulfilled sale, written at fulfillment on the existing rails:
     - storefront verify / gift-card checkout / upsell accept
       (sale_kind 'store_order', the order's recorded creator net);
     - the marketplace paid flip + free/gift-full direct records
       (sale_kind 'shop_event', the line's amount − platform fee).
   FEE ORDER (the affiliate rail's precedent): the flat 5% platform
   fee comes off the top FIRST — it is already out of the parent rows'
   creator net — and the split divides what remains. The parent sale
   rows keep their historic meaning (the FULL seller net); earnings
   and pending-payout sums subtract co-seller rows from the owner and
   add them to the co-seller, in the bulk-ledger discipline of
   digital_sales / store_orders (no per-row settlement stamps: the
   payout subtraction in pendingPayoutCents settles them in bulk).

   REFUNDS: payment-reversals flips the parent sale and every entry on
   it to 'reversed' in the same pass — both sellers lose the sale
   symmetrically, exactly once (the flip is status-guarded). Partial
   refunds keep entries 'earned', mirroring the engine's rule that
   seller ledgers reverse only on a full refund / lost dispute. */

export const SALE_SPLIT_SURFACES = ["store_product", "shop_product"] as const;
export type SaleSplitSurface = (typeof SALE_SPLIT_SURFACES)[number];

export const SALE_SPLIT_KINDS = ["store_order", "shop_event"] as const;
export type SaleSplitKind = (typeof SALE_SPLIT_KINDS)[number];

export const SALE_SPLIT_ROLES = ["owner", "co_seller"] as const;
export type SaleSplitRole = (typeof SALE_SPLIT_ROLES)[number];

export const SALE_SPLIT_STATUSES = ["earned", "reversed"] as const;
export type SaleSplitStatus = (typeof SALE_SPLIT_STATUSES)[number];

/** One seller's share of a product, as stored on the product row. */
export interface ProductSplit {
  userId: string;
  sharePct: number;
}

export const saleSplitEntriesTable = pgTable("sale_split_entries", {
  id:               uuid("id").primaryKey().defaultRandom(),
  saleKind:         text("sale_kind").notNull().$type<SaleSplitKind>(),
  saleId:           uuid("sale_id").notNull(),
  surface:          text("surface").notNull().$type<SaleSplitSurface>(),
  productId:        uuid("product_id").notNull(),
  productTitle:     text("product_title").notNull().default(""),
  ownerUserId:      uuid("owner_user_id").notNull(),
  sellerUserId:     uuid("seller_user_id").notNull(),
  sellerProfileId:  uuid("seller_profile_id"),
  role:             text("role").notNull().default("co_seller").$type<SaleSplitRole>(),
  sharePct:         numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
  grossCents:       integer("gross_cents").notNull().default(0),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  amountCents:      integer("amount_cents").notNull().default(0),
  status:           text("status").notNull().default("earned").$type<SaleSplitStatus>(),
  stripeSessionId:  text("stripe_session_id"),
  reversedAt:       timestamp("reversed_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("sale_split_entries_kind_check", sql`${t.saleKind} IN ('store_order', 'shop_event')`),
  check("sale_split_entries_surface_check", sql`${t.surface} IN ('store_product', 'shop_product')`),
  check("sale_split_entries_role_check", sql`${t.role} IN ('owner', 'co_seller')`),
  check("sale_split_entries_status_check", sql`${t.status} IN ('earned', 'reversed')`),
  check("sale_split_entries_share_check", sql`${t.sharePct} > 0 AND ${t.sharePct} <= 100`),
  check("sale_split_entries_amount_check", sql`${t.amountCents} >= 0`),
  uniqueIndex("sale_split_entries_sale_seller_ux").on(t.saleKind, t.saleId, t.productId, t.sellerUserId),
  index("sale_split_entries_seller_idx").on(t.sellerUserId, t.status),
  index("sale_split_entries_owner_idx").on(t.ownerUserId, t.status),
  index("sale_split_entries_sale_idx").on(t.saleKind, t.saleId),
]);

export const insertSaleSplitEntrySchema = createInsertSchema(saleSplitEntriesTable).omit({
  id: true, createdAt: true,
});
export type InsertSaleSplitEntry = z.infer<typeof insertSaleSplitEntrySchema>;
export type SaleSplitEntry = typeof saleSplitEntriesTable.$inferSelect;
