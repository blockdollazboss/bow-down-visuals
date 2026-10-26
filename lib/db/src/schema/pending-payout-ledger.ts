import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Pending-payout ledger (payfix store-dashboards lane, provisional
 * migration 9999). ONE ledger every seller-money surface reads:
 *
 * Each completed sale on a payable rail accrues the seller's net
 * EXACTLY ONCE as an 'accrual' row, and a refund of that sale records
 * EXACTLY ONE 'reversal' row of the same amount. Exactly-once is the
 * UNIQUE (source_kind, source_id, entry_type) key + INSERT … ON
 * CONFLICT DO NOTHING — the same discipline as the credit-pack
 * clawback (payment_reversals' UNIQUE stripe_charge_id claim).
 *
 * Rows are materialized by the idempotent reconciliation in
 * api-server lib/seller-earnings.ts (syncPendingPayoutLedgerForSeller),
 * which scans the source sale tables — so a sale completed through
 * ANY door (webhook, verify endpoint, POS, replay) accrues once, and
 * duplicate/replayed events can never double-accrue.
 *
 * source_kind:
 *  - 'digital_sale'  digital_sales row (profile store, 5% fee already
 *                    split into platform_fee_cents/creator_amount_cents)
 *  - 'store_order'   store_orders row (profile storefront, 5%)
 *  - 'shop_event'    shop_events 'sale' line (marketplace shop, 5%;
 *                    net = amount_cents − platform_fee_cents)
 *  - 'beat_license'  beat_licenses 'completed' row (15% commission in
 *                    commission_cents; net = price − commission)
 *  - 'membership'    fan_members paid row (stripe_session_id present).
 *                    The membership model carries NO fee split column —
 *                    the payable amount is price_cents, exactly as the
 *                    0142 Connect settlement has always counted it;
 *                    platform_fee_cents is recorded as 0 rather than
 *                    inventing a split the model does not carry.
 *
 * Brand deals are deliberately NOT copied here: sponsor_payouts is
 * already a per-row released-escrow ledger; the unified pending read
 * (lib/seller-earnings readPendingPayoutForSeller) adds its released
 * total alongside this ledger instead of duplicating its rows.
 *
 * Settlement discipline is BULK, mirroring digital_sales/store_orders:
 * creator_payouts rows in active states ('processing' | 'pending' |
 * 'paid') are subtracted by the pending read; a 'failed' payout stops
 * subtracting, so its money becomes payable again with no cleanup.
 */
export const PENDING_PAYOUT_SOURCE_KINDS = [
  "digital_sale",
  "store_order",
  "shop_event",
  "beat_license",
  "membership",
] as const;
export type PendingPayoutSourceKind = (typeof PENDING_PAYOUT_SOURCE_KINDS)[number];

export const PENDING_PAYOUT_ENTRY_TYPES = ["accrual", "reversal"] as const;
export type PendingPayoutEntryType = (typeof PENDING_PAYOUT_ENTRY_TYPES)[number];

export const pendingPayoutLedgerTable = pgTable("pending_payout_ledger", {
  id:               uuid("id").primaryKey().defaultRandom(),
  sellerUserId:     uuid("seller_user_id").notNull(),
  sellerProfileId:  uuid("seller_profile_id"),
  sourceKind:       text("source_kind").notNull().$type<PendingPayoutSourceKind>(),
  sourceId:         uuid("source_id").notNull(),
  entryType:        text("entry_type").notNull().$type<PendingPayoutEntryType>(),
  grossCents:       integer("gross_cents").notNull().default(0),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  netCents:         integer("net_cents").notNull().default(0),
  stripeSessionId:  text("stripe_session_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("pending_payout_ledger_source_kind_check", sql`${t.sourceKind} IN ('digital_sale','store_order','shop_event','beat_license','membership')`),
  check("pending_payout_ledger_entry_type_check", sql`${t.entryType} IN ('accrual','reversal')`),
  uniqueIndex("pending_payout_ledger_source_entry_ux").on(t.sourceKind, t.sourceId, t.entryType),
  index("pending_payout_ledger_seller_idx").on(t.sellerUserId, t.createdAt),
]);

export const insertPendingPayoutLedgerSchema = createInsertSchema(pendingPayoutLedgerTable).omit({ id: true, createdAt: true });
export type InsertPendingPayoutLedger = z.infer<typeof insertPendingPayoutLedgerSchema>;
export type PendingPayoutLedgerEntry = typeof pendingPayoutLedgerTable.$inferSelect;
