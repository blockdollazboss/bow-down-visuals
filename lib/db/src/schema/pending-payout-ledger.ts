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
 *                    The membership model carries NO fee split column,
 *                    so the split is derived from price_cents at the
 *                    rail's 10% platform fee with the Member
 *                    Dashboard's rounding (membershipNetSql in
 *                    lib/seller-earnings) — gross / fee / net recorded
 *                    on the ledger row exactly as derived. (Before the
 *                    Nov 5, 2026 fix the payable was price_cents gross
 *                    with the fee recorded as 0 — an over-credit.)
 *  - 'shoutout_request' shoutout_requests row whose payment settled
 *                    (paid_at set by the guarded settle flip; migration
 *                    0323). The request row carries no fee-split column,
 *                    so the sync applies the rail's own split rule —
 *                    the flat 5% platform fee (owner ruling 2026-10-27):
 *                    net = round(price_cents × 95 / 100), the same
 *                    per-row figure routes/generate/shoutouts.ts
 *                    netAfterFee shows on the creator dashboard.
 *  - 'tip_jar_tip'   tip_jar_tips 'paid' row (migration 0323). Tips
 *                    carry NO platform fee (owner law: 100% to the
 *                    creator), so net = amount_cents, fee 0.
 *  - 'ugc_brief'     ugc_briefs row whose escrow RELEASED (C-25,
 *                    migration 0324). The brief row carries the
 *                    release stamps (released_amount_cents =
 *                    the held gross that was split, platform_fee_cents,
 *                    creator_payout_cents at the rail's 5%), so the
 *                    sync copies the split the release recorded —
 *                    gross / fee / net exactly as released.
 *  - 'performance_booking' performance_bookings row whose escrow
 *                    RELEASED (stack200 M1, migration 0325). The
 *                    release flip stamps the split on the booking row
 *                    (platform_fee_cents / artist_payout_cents at the
 *                    rail's 15%); the held gross that was split is
 *                    fee + payout (a partial refund before release
 *                    shrinks the release, never the agreed fee), so
 *                    the sync copies the split the release recorded —
 *                    gross / fee / net exactly as released. Before
 *                    this kind existed, a released booking's artist
 *                    net was stranded: the artist was told "You were
 *                    paid" yet the money reached no payout surface.
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
const PENDING_PAYOUT_SOURCE_KINDS = [
  "digital_sale",
  "store_order",
  "shop_event",
  "beat_license",
  "membership",
  "shoutout_request",
  "tip_jar_tip",
  "ugc_brief",
  "performance_booking",
] as const;
type PendingPayoutSourceKind = (typeof PENDING_PAYOUT_SOURCE_KINDS)[number];

const PENDING_PAYOUT_ENTRY_TYPES = ["accrual", "reversal"] as const;
type PendingPayoutEntryType = (typeof PENDING_PAYOUT_ENTRY_TYPES)[number];

const pendingPayoutLedgerTable = pgTable("pending_payout_ledger", {
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
  check("pending_payout_ledger_source_kind_check", sql`${t.sourceKind} IN ('digital_sale','store_order','shop_event','beat_license','membership','shoutout_request','tip_jar_tip','ugc_brief','performance_booking')`),
  check("pending_payout_ledger_entry_type_check", sql`${t.entryType} IN ('accrual','reversal')`),
  uniqueIndex("pending_payout_ledger_source_entry_ux").on(t.sourceKind, t.sourceId, t.entryType),
  index("pending_payout_ledger_seller_idx").on(t.sellerUserId, t.createdAt),
]);

const insertPendingPayoutLedgerSchema = createInsertSchema(pendingPayoutLedgerTable).omit({ id: true, createdAt: true });
