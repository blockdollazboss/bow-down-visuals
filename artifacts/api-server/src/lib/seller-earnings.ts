import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { saleSplitAdjustments } from "./sale-splits";

/* ─── Seller earnings: ONE source of truth (payfix store-dashboards) ─────
 *
 * Before this module the seller-money story was told three different
 * ways by three surfaces, and all three disagreed (Oct 26 state check):
 *   - /store/dashboard's pending figure came from pendingPayoutCents
 *     (routes/stripe-connect.ts), which never counted beat income at
 *     all and read $0.00 for a seller whose shop sale was real;
 *   - /earnings aggregated store_orders + shop_events + memberships +
 *     brand deals but NOT digital_sales and NOT beats;
 *   - the Producer Dashboard alone showed beat income.
 *
 * This module is the single aggregation every surface reads:
 *
 *   sellerEarningsSummary(userId)
 *     The earnings story: per-rail net totals over the source sale
 *     tables. /api/earnings, /store/dashboard and /my-shop must all be
 *     able to derive their headline from this one shape, so the same
 *     seller + period tells the same story everywhere.
 *
 *   syncPendingPayoutLedgerForSeller(userId)
 *     Idempotent reconciliation into pending_payout_ledger (schema:
 *     lib/db/src/schema/pending-payout-ledger.ts, provisional migration
 *     9999). Each completed sale on a payable rail accrues its seller
 *     net EXACTLY ONCE ('accrual'); a refunded sale additionally records
 *     EXACTLY ONE 'reversal' of the same amount. Exactly-once is the
 *     UNIQUE (source_kind, source_id, entry_type) key + INSERT … ON
 *     CONFLICT DO NOTHING — the credit-pack clawback discipline. Because
 *     the sync scans source rows (not webhook events), a sale completed
 *     through ANY door accrues once and replays can never double-accrue.
 *
 *   readPendingPayoutForSeller(userId)
 *     THE LEDGER READ (see the contract in
 *     ~/workspace/payfix-reports/store-dashboards.md): syncs, then
 *     returns the pending figure + the ledger rows behind it.
 *
 * Fee math is NOT touched: amounts are copied from the splits the rails
 * already recorded (store 5%, beats 15%). Memberships carry no fee-split
 * column in their model, so their payable stays price_cents — exactly
 * as the 0142 Connect settlement has always counted it — with the fee
 * recorded as 0 rather than inventing a split.
 *
 * Settlement discipline is BULK, mirroring digital_sales/store_orders:
 * creator_payouts rows in active states ('processing' | 'pending' |
 * 'paid') are subtracted by the pending read; a 'failed' payout stops
 * subtracting, so its money becomes payable again with no cleanup.
 * Brand deals are NOT copied into the ledger: sponsor_payouts is
 * already a per-row released-escrow ledger, so the pending read adds
 * its released-and-unsettled total alongside instead of duplicating it.
 */

export const PENDING_PAYOUT_ACTIVE_STATUSES = ["processing", "pending", "paid"] as const;

/* ── Ledger sync ─────────────────────────────────────────────────────────
 * One INSERT … SELECT per rail per entry type. Each statement is
 * idempotent on its own (ON CONFLICT DO NOTHING against the unique
 * (source_kind, source_id, entry_type) key), so the whole sync can run
 * on every read. Returns how many rows were inserted per statement —
 * a second run over unchanged sources inserts 0 everywhere. */

export interface LedgerSyncResult {
  inserted: Record<string, number>;
  totalInserted: number;
}

async function ledgerCountFor(userId: string, kind: string, entryType: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM pending_payout_ledger
    WHERE seller_user_id = ${userId} AND source_kind = ${kind} AND entry_type = ${entryType}
  `);
  return Number(((r.rows as any[])[0] ?? { n: 0 }).n);
}

export async function syncPendingPayoutLedgerForSeller(userId: string): Promise<LedgerSyncResult> {
  const inserted: Record<string, number> = {};
  /* Inserted counts are measured as row-count deltas around each
     statement — exact on real Postgres and on the pg-mem test harness
     (whose RETURNING over-reports rows skipped by ON CONFLICT). */
  const run = async (key: string, stmt: ReturnType<typeof sql>) => {
    const [kind, entryType] = key.split(":");
    const before = await ledgerCountFor(userId, kind!, entryType!);
    await db.execute(stmt);
    inserted[key] = (await ledgerCountFor(userId, kind!, entryType!)) - before;
  };

  /* digital_sales — profile store (5% split already on the row).
     Seller resolves through the owning creator profile. */
  await run("digital_sale:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT cp.user_id, ds.profile_id, 'digital_sale', ds.id, 'accrual',
           ds.amount_cents, ds.platform_fee_cents, ds.creator_amount_cents, ds.stripe_session_id
    FROM digital_sales ds
    JOIN creator_profiles cp ON cp.id = ds.profile_id
    WHERE cp.user_id = ${userId} AND ds.status IN ('completed', 'refunded')
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("digital_sale:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT cp.user_id, ds.profile_id, 'digital_sale', ds.id, 'reversal',
           ds.amount_cents, ds.platform_fee_cents, ds.creator_amount_cents, ds.stripe_session_id
    FROM digital_sales ds
    JOIN creator_profiles cp ON cp.id = ds.profile_id
    WHERE cp.user_id = ${userId} AND ds.status = 'refunded'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  /* store_orders — profile storefront (5% split already on the row). */
  await run("store_order:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT cp.user_id, o.profile_id, 'store_order', o.id, 'accrual',
           o.amount_cents, o.platform_fee_cents, o.creator_amount_cents, o.stripe_session_id
    FROM store_orders o
    JOIN creator_profiles cp ON cp.id = o.profile_id
    WHERE cp.user_id = ${userId} AND o.status IN ('completed', 'refunded')
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("store_order:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT cp.user_id, o.profile_id, 'store_order', o.id, 'reversal',
           o.amount_cents, o.platform_fee_cents, o.creator_amount_cents, o.stripe_session_id
    FROM store_orders o
    JOIN creator_profiles cp ON cp.id = o.profile_id
    WHERE cp.user_id = ${userId} AND o.status = 'refunded'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  /* shop_events — marketplace shop (5%; net = amount − fee on the row).
     Paid truth is event_type='sale' (0144 flip); the refund clawback
     flips paid lines to 'refunded_sale' (payment-reversals), amounts
     intact — those rows accrue AND reverse. 'pending_sale' never
     accrues: no money exists yet. */
  await run("shop_event:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT se.user_id, NULL, 'shop_event', se.id, 'accrual',
           se.amount_cents, se.platform_fee_cents, se.amount_cents - se.platform_fee_cents,
           se.stripe_session_id
    FROM shop_events se
    WHERE se.user_id = ${userId} AND se.event_type IN ('sale', 'refunded_sale')
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("shop_event:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT se.user_id, NULL, 'shop_event', se.id, 'reversal',
           se.amount_cents, se.platform_fee_cents, se.amount_cents - se.platform_fee_cents,
           se.stripe_session_id
    FROM shop_events se
    WHERE se.user_id = ${userId} AND se.event_type = 'refunded_sale'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  /* beat_licenses — producer rail (15% commission already on the row;
     net = price − commission). producer_id is the seller's USER id.
     This is the rail the legacy pending figure never counted. */
  await run("beat_license:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT bl.producer_id, NULL, 'beat_license', bl.id, 'accrual',
           bl.price_cents, bl.commission_cents, bl.price_cents - bl.commission_cents,
           bl.stripe_session_id
    FROM beat_licenses bl
    WHERE bl.producer_id = ${userId} AND bl.status IN ('completed', 'refunded')
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("beat_license:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT bl.producer_id, NULL, 'beat_license', bl.id, 'reversal',
           bl.price_cents, bl.commission_cents, bl.price_cents - bl.commission_cents,
           bl.stripe_session_id
    FROM beat_licenses bl
    WHERE bl.producer_id = ${userId} AND bl.status = 'refunded'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  /* fan_members — paid memberships (stripe_session_id present = a real
     charge happened, the same paid marker routes/earnings.ts uses).
     No fee split exists in this model: net = price_cents, fee 0. */
  await run("membership:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT fm.user_id, NULL, 'membership', fm.id, 'accrual',
           fm.price_cents, 0, fm.price_cents, fm.stripe_session_id
    FROM fan_members fm
    WHERE fm.user_id = ${userId} AND fm.stripe_session_id IS NOT NULL
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("membership:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT fm.user_id, NULL, 'membership', fm.id, 'reversal',
           fm.price_cents, 0, fm.price_cents, fm.stripe_session_id
    FROM fan_members fm
    WHERE fm.user_id = ${userId} AND fm.stripe_session_id IS NOT NULL
      AND fm.status = 'refunded'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  const totalInserted = Object.values(inserted).reduce((a, b) => a + b, 0);
  return { inserted, totalInserted };
}

/* ── The ledger read ─────────────────────────────────────────────────────
 * pendingCents =
 *     Σ ledger accruals − Σ ledger reversals
 *   + sponsor_payouts released-and-unsettled net (its own ledger,
 *     added alongside — never copied into pending_payout_ledger)
 *   − Σ creator_payouts in active states for the seller's profiles
 *     (bulk settlement; a 'failed' payout stops subtracting)
 *   ± co-seller split adjustments (the ledger rails carry the FULL
 *     seller net of a split sale, exactly like the source tables, so
 *     the same adjustment routes/earnings.ts applies applies here)
 * floored at 0. Rows are the seller's ledger entries, newest first. */

export interface PendingPayoutLedgerRow {
  id: string;
  sourceKind: string;
  sourceId: string;
  entryType: "accrual" | "reversal";
  grossCents: number;
  platformFeeCents: number;
  netCents: number;
  stripeSessionId: string | null;
  createdAt: string;
}

export interface PendingPayoutRead {
  sellerUserId: string;
  currency: "USD";
  pendingCents: number;
  accruedCents: number;
  reversedCents: number;
  sponsorReleasedCents: number;
  settledCents: number;
  coSellerAdjustCents: number;
  accrualCount: number;
  reversalCount: number;
  rows: PendingPayoutLedgerRow[];
}

export async function readPendingPayoutForSeller(
  userId: string,
  opts: { rowLimit?: number } = {},
): Promise<PendingPayoutRead> {
  await syncPendingPayoutLedgerForSeller(userId);
  const rowLimit = opts.rowLimit ?? 100;

  const sums = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'accrual' THEN net_cents ELSE 0 END), 0)::int AS accrued,
      COALESCE(SUM(CASE WHEN entry_type = 'reversal' THEN net_cents ELSE 0 END), 0)::int AS reversed,
      COALESCE(SUM(CASE WHEN entry_type = 'accrual' THEN 1 ELSE 0 END), 0)::int AS accrual_n,
      COALESCE(SUM(CASE WHEN entry_type = 'reversal' THEN 1 ELSE 0 END), 0)::int AS reversal_n
    FROM pending_payout_ledger
    WHERE seller_user_id = ${userId}
  `);
  const s = (sums.rows as any[])[0] ?? { accrued: 0, reversed: 0, accrual_n: 0, reversal_n: 0 };

  /* Brand deals ride alongside, from their own released-escrow ledger:
     released rows not claimed by an active payout (0142 unsettled
     predicate, same as routes/stripe-connect.ts). */
  const sponsor = await db.execute(sql`
    SELECT COALESCE(SUM(sp.net_cents), 0)::int AS cents
    FROM sponsor_payouts sp
    WHERE sp.creator_user_id = ${userId}::text
      AND sp.status = 'released'
      AND (sp.settled_payout_id IS NULL
           OR sp.settled_payout_id NOT IN (
             SELECT id FROM creator_payouts WHERE status IN ('processing', 'pending', 'paid')
           ))
  `);
  const sponsorReleasedCents = Number(((sponsor.rows as any[])[0] ?? { cents: 0 }).cents);

  const settled = await db.execute(sql`
    SELECT COALESCE(SUM(cp.amount_cents), 0)::int AS cents
    FROM creator_payouts cp
    JOIN creator_profiles prof ON prof.id = cp.profile_id
    WHERE prof.user_id = ${userId} AND cp.status IN ('processing', 'pending', 'paid')
  `);
  const settledCents = Number(((settled.rows as any[])[0] ?? { cents: 0 }).cents);

  const splits = await saleSplitAdjustments(userId);
  const coSellerAdjustCents = splits.addCents - splits.subtractCents;

  const rowsRes = await db.execute(sql`
    SELECT id, source_kind, source_id, entry_type, gross_cents, platform_fee_cents,
           net_cents, stripe_session_id, created_at
    FROM pending_payout_ledger
    WHERE seller_user_id = ${userId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${rowLimit}
  `);
  const rows: PendingPayoutLedgerRow[] = (rowsRes.rows as any[]).map((r) => ({
    id: String(r.id),
    sourceKind: String(r.source_kind),
    sourceId: String(r.source_id),
    entryType: r.entry_type as "accrual" | "reversal",
    grossCents: Number(r.gross_cents),
    platformFeeCents: Number(r.platform_fee_cents),
    netCents: Number(r.net_cents),
    stripeSessionId: r.stripe_session_id == null ? null : String(r.stripe_session_id),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));

  const accruedCents = Number(s.accrued);
  const reversedCents = Number(s.reversed);
  const pendingCents = Math.max(
    0,
    accruedCents - reversedCents + sponsorReleasedCents - settledCents + coSellerAdjustCents,
  );

  return {
    sellerUserId: userId,
    currency: "USD",
    pendingCents,
    accruedCents,
    reversedCents,
    sponsorReleasedCents,
    settledCents,
    coSellerAdjustCents,
    accrualCount: Number(s.accrual_n),
    reversalCount: Number(s.reversal_n),
    rows,
  };
}

/* ── Unified earnings summary ────────────────────────────────────────────
 * The ONE earnings aggregation. Every figure is a seller NET in cents
 * copied from the source rows' own splits — the same amounts the
 * ledger accrues — so the earnings story and the pending-payout story
 * can never drift apart: for any completed sale, its net here equals
 * its ledger accrual net there. Refunded sales are excluded everywhere
 * (their money is not earnings; the ledger shows accrual + reversal). */

export interface SellerEarningsSummary {
  sellerUserId: string;
  currency: "USD";
  totalCents: number;
  storeSales: {
    totalCents: number;
    count: number;
    digitalSalesCents: number;
    digitalSalesCount: number;
    profileStoreCents: number;
    profileStoreOrders: number;
    shopSalesCents: number;
    shopSales: number;
    coSellerSharesPaidOutCents: number;
    coSellerSplitCents: number;
    coSellerSplitSales: number;
  };
  beats: {
    totalCents: number;
    grossCents: number;
    commissionCents: number;
    count: number;
  };
  memberships: { totalCents: number; count: number };
  brandDeals: { totalCents: number; count: number };
}

/* Per-rail readers — the summary composes these, and routes/earnings
 * calls them individually so one rail's failure degrades only its own
 * source card (the route's pinned honesty contract), while the math
 * itself lives in exactly one place. */

export async function sellerStoreSales(userId: string): Promise<SellerEarningsSummary["storeSales"]> {
  const digital = await db.execute(sql`
    SELECT COALESCE(SUM(ds.creator_amount_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM digital_sales ds
    JOIN creator_profiles cp ON cp.id = ds.profile_id
    WHERE cp.user_id = ${userId} AND ds.status = 'completed'
  `);
  const orders = await db.execute(sql`
    SELECT COALESCE(SUM(o.creator_amount_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM store_orders o
    JOIN creator_profiles cp ON cp.id = o.profile_id
    WHERE cp.user_id = ${userId} AND o.status = 'completed'
  `);
  const shop = await db.execute(sql`
    SELECT COALESCE(SUM(amount_cents - platform_fee_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM shop_events
    WHERE user_id = ${userId} AND event_type = 'sale'
  `);
  const d = (digital.rows as any[])[0] ?? { cents: 0, n: 0 };
  const o = (orders.rows as any[])[0] ?? { cents: 0, n: 0 };
  const sh = (shop.rows as any[])[0] ?? { cents: 0, n: 0 };
  const splits = await saleSplitAdjustments(userId);
  return {
    totalCents: Number(d.cents) + Number(o.cents) + Number(sh.cents) - splits.subtractCents + splits.addCents,
    count: Number(d.n) + Number(o.n) + Number(sh.n) + splits.addCount,
    digitalSalesCents: Number(d.cents),
    digitalSalesCount: Number(d.n),
    profileStoreCents: Number(o.cents),
    profileStoreOrders: Number(o.n),
    shopSalesCents: Number(sh.cents),
    shopSales: Number(sh.n),
    coSellerSharesPaidOutCents: splits.subtractCents,
    coSellerSplitCents: splits.addCents,
    coSellerSplitSales: splits.addCount,
  };
}

export async function sellerBeats(userId: string): Promise<SellerEarningsSummary["beats"]> {
  const beatsRes = await db.execute(sql`
    SELECT COALESCE(SUM(price_cents - commission_cents), 0)::int AS net,
           COALESCE(SUM(price_cents), 0)::int AS gross,
           COALESCE(SUM(commission_cents), 0)::int AS commission,
           COUNT(*)::int AS n
    FROM beat_licenses
    WHERE producer_id = ${userId} AND status = 'completed'
  `);
  const b = (beatsRes.rows as any[])[0] ?? { net: 0, gross: 0, commission: 0, n: 0 };
  return {
    totalCents: Number(b.net),
    grossCents: Number(b.gross),
    commissionCents: Number(b.commission),
    count: Number(b.n),
  };
}

export async function sellerMemberships(userId: string): Promise<SellerEarningsSummary["memberships"]> {
  const memb = await db.execute(sql`
    SELECT COALESCE(SUM(price_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM fan_members
    WHERE user_id = ${userId} AND stripe_session_id IS NOT NULL AND status <> 'refunded'
  `);
  const m = (memb.rows as any[])[0] ?? { cents: 0, n: 0 };
  return { totalCents: Number(m.cents), count: Number(m.n) };
}

export async function sellerBrandDeals(userId: string): Promise<SellerEarningsSummary["brandDeals"]> {
  const deals = await db.execute(sql`
    SELECT COALESCE(SUM(net_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM sponsor_payouts
    WHERE creator_user_id = ${userId}::text AND status = 'released'
  `);
  const dl = (deals.rows as any[])[0] ?? { cents: 0, n: 0 };
  return { totalCents: Number(dl.cents), count: Number(dl.n) };
}

export async function sellerEarningsSummary(userId: string): Promise<SellerEarningsSummary> {
  const storeSales = await sellerStoreSales(userId);
  const beats = await sellerBeats(userId);
  const memberships = await sellerMemberships(userId);
  const brandDeals = await sellerBrandDeals(userId);
  return {
    sellerUserId: userId,
    currency: "USD",
    totalCents: storeSales.totalCents + beats.totalCents + memberships.totalCents + brandDeals.totalCents,
    storeSales,
    beats,
    memberships,
    brandDeals,
  };
}

/* Best-effort sync hook for sale-completion callers: never let a ledger
 * hiccup break a checkout/verify response — the read path re-syncs. */
export async function syncPendingPayoutLedgerQuietly(userId: string): Promise<void> {
  try {
    await syncPendingPayoutLedgerForSeller(userId);
  } catch (err) {
    logger.warn({ err, userId }, "[seller-earnings] ledger sync failed (read path re-syncs)");
  }
}
