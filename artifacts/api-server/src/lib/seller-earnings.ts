import { sql, type SQL } from "drizzle-orm";
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
 * Fee math is NOT re-invented: amounts are copied from the splits the
 * rails already recorded (store 5%, beats 15%). Memberships carry no
 * fee-split column in their model, so their split is DERIVED from
 * price_cents at the rail's ratified 10% with the Member Dashboard's
 * own rounding (see the membership fee split block below). Before the
 * Nov 5, 2026 fix this module credited memberships GROSS — the
 * dashboard showed $4.50 net on a $5.00 membership while Earnings
 * credited the full $5.00 and pending payout read $31.50 vs the true
 * $31.00 — the exact defect the block below now prevents.
 *
 * Two rails joined later (migration 0323, Nov 5 live proof): paid
 * SHOUTOUTS and paid TIP-JAR TIPS settled for real but had no rail here
 * at all — a $10.00 shoutout's $9.50 keep showed on the shoutout
 * dashboard yet never reached Earnings or the pending figure, and a
 * $5.00 tip updated the jar totals only. Shoutouts carry no fee-split
 * column either, so the sync applies the rail's own split rule (flat
 * 5%, per-row round — the dashboard's netAfterFee formula); tips carry
 * no fee at all (100% to the creator), so their fee is honestly 0.
 *
 * One more rail (C-25, migration 0324): UGC BRIEFS. A priced brief's
 * escrow release stamps its own split on the brief row
 * (released_amount_cents = the held gross that was split,
 * platform_fee_cents / creator_payout_cents at the rail's 5%), so the
 * sync copies the recorded split exactly — the amounts the creator
 * was told are the amounts that accrue. Settled truth is the release
 * stamp itself (escrow_status 'released'); a release later reversed
 * (escrow_status 'refunded' with release stamps present) accrues AND
 * reverses, like every other rail.
 *
 * Settlement discipline is BULK, mirroring digital_sales/store_orders:
 * creator_payouts rows in active states ('processing' | 'pending' |
 * 'paid') are subtracted by the pending read; a 'failed' payout stops
 * subtracting, so its money becomes payable again with no cleanup.
 * Brand deals are NOT copied into the ledger: sponsor_payouts is
 * already a per-row released-escrow ledger, so the pending read adds
 * its released-and-unsettled total alongside instead of duplicating it.
 */


/* ── Membership fee split ────────────────────────────────────────────────
 * The memberships rail charges a 10% platform fee
 * (MEMBERSHIPS_PLATFORM_FEE_PCT in routes/generate/memberships.ts), and
 * the Member Dashboard shows creators the net via that module's
 * netAfterFee: net = round(price × 90%), fee = price − net, so fee +
 * net always reconciles to the price to the cent. fan_members records
 * NO split columns, so every earnings / payout read derives the split
 * from price_cents with exactly that rounding — what a creator is
 * shown is what they are credited. membershipNetSql / membershipFeeSql
 * are the SQL twins of the TS helpers: integer half-up rounding —
 * (price × 90 + 50) / 100 under truncating integer division —
 * identical to Math.round for price_cents >= 0. */
export const MEMBERSHIP_FEE_PCT = 10;

export function membershipNetCents(priceCents: number): number {
  const price = Math.max(0, Math.round(priceCents));
  return Math.round((price * (100 - MEMBERSHIP_FEE_PCT)) / 100);
}

export function membershipFeeCents(priceCents: number): number {
  const price = Math.max(0, Math.round(priceCents));
  return price - membershipNetCents(price);
}

/** SQL expression for the creator net of a membership price column. */
export function membershipNetSql(priceColumn: string): SQL {
  return sql.raw(`((${priceColumn} * ${100 - MEMBERSHIP_FEE_PCT} + 50) / 100)`);
}

/** SQL expression for the platform fee of a membership price column. */
export function membershipFeeSql(priceColumn: string): SQL {
  return sql.raw(`(${priceColumn} - ((${priceColumn} * ${100 - MEMBERSHIP_FEE_PCT} + 50) / 100))`);
}

/* ── Ledger sync ─────────────────────────────────────────────────────────
 * One INSERT … SELECT per rail per entry type. Each statement is
 * idempotent on its own (ON CONFLICT DO NOTHING against the unique
 * (source_kind, source_id, entry_type) key), so the whole sync can run
 * on every read. Returns how many rows were inserted per statement —
 * a second run over unchanged sources inserts 0 everywhere. */

interface LedgerSyncResult {
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
     No fee split is recorded on the row: gross / fee / net are derived
     from price_cents at the rail's 10% (membershipNetSql above). */
  await run("membership:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT fm.user_id, NULL, 'membership', fm.id, 'accrual',
           fm.price_cents, ${membershipFeeSql("fm.price_cents")}, ${membershipNetSql("fm.price_cents")}, fm.stripe_session_id
    FROM fan_members fm
    WHERE fm.user_id = ${userId} AND fm.stripe_session_id IS NOT NULL
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("membership:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT fm.user_id, NULL, 'membership', fm.id, 'reversal',
           fm.price_cents, ${membershipFeeSql("fm.price_cents")}, ${membershipNetSql("fm.price_cents")}, fm.stripe_session_id
    FROM fan_members fm
    WHERE fm.user_id = ${userId} AND fm.stripe_session_id IS NOT NULL
      AND fm.status = 'refunded'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  /* shoutout_requests — fan shoutouts (flat 5% platform fee, owner
     ruling 2026-10-27). Settled truth is paid_at: the guarded settle
     flip (routes/generate/shoutouts.ts markShoutoutPaid, run by the
     Stripe webhook AND the fan's return-verify) writes it exactly
     once, so a request with paid_at set is money that really moved —
     whatever lifecycle status it has since reached (accepted /
     in_progress / delivered / refunded). The request row carries no
     fee-split column, so the split applied is the rail's own rule —
     the same per-row figure the creator dashboard's "what you'd
     keep" uses (netAfterFee: round(price × 95 / 100); written here
     in integer arithmetic as (price × 95 + 50) / 100 — the identical
     round-half-up for non-negative prices — and fee = price − net,
     so gross always reconciles). Live-proven missing before
     migration 0323: a settled $10.00 shoutout (net $9.50) never
     reached Earnings or this ledger. */
  await run("shoutout_request:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT sr.creator_user_id, NULL, 'shoutout_request', sr.id, 'accrual',
           sr.price_cents,
           sr.price_cents - ((sr.price_cents * 95 + 50) / 100),
           ((sr.price_cents * 95 + 50) / 100),
           sr.stripe_session_id
    FROM shoutout_requests sr
    WHERE sr.creator_user_id = ${userId} AND sr.paid_at IS NOT NULL
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("shoutout_request:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT sr.creator_user_id, NULL, 'shoutout_request', sr.id, 'reversal',
           sr.price_cents,
           sr.price_cents - ((sr.price_cents * 95 + 50) / 100),
           ((sr.price_cents * 95 + 50) / 100),
           sr.stripe_session_id
    FROM shoutout_requests sr
    WHERE sr.creator_user_id = ${userId} AND sr.paid_at IS NOT NULL
      AND sr.status = 'refunded'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  /* tip_jar_tips — paid tip-jar tips (NO platform fee: tips go 100%
     to the creator, so net = amount_cents, fee recorded as 0).
     Settled truth is the durable row's status: 'paid' is written
     exactly once by the guarded settle flip (settleTipBySessionId /
     verify); the reversal engine flips a refunded or charged-back
     tip to 'refunded'. The in-memory tip INTENTS are a different,
     unpaid record (real checkouts never write intents) and never
     accrue. Live-proven missing before migration 0323: a settled
     $5.00 tip updated the jar totals but never reached Earnings or
     this ledger. */
  await run("tip_jar_tip:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT t.page_user_id, NULL, 'tip_jar_tip', t.id, 'accrual',
           t.amount_cents, 0, t.amount_cents, t.stripe_session_id
    FROM tip_jar_tips t
    WHERE t.page_user_id = ${userId} AND t.status IN ('paid', 'refunded')
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("tip_jar_tip:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT t.page_user_id, NULL, 'tip_jar_tip', t.id, 'reversal',
           t.amount_cents, 0, t.amount_cents, t.stripe_session_id
    FROM tip_jar_tips t
    WHERE t.page_user_id = ${userId} AND t.status = 'refunded'
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);

  /* ugc_briefs — UGC Briefs Board escrow (5% fee, split recorded on
     the row at release: released_amount_cents is the HELD gross that
     was split, never the nominal price — a partial refund before
     approval shrinks the release and these figures with it).
     claimed_by_user_id is the seller (the creator who did the work).
     Only a brief that actually RELEASED accrues; a brief refunded
     before release carries no release stamps and never appears. */
  await run("ugc_brief:accrual", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT ub.claimed_by_user_id, NULL, 'ugc_brief', ub.id, 'accrual',
           ub.released_amount_cents, ub.platform_fee_cents, ub.creator_payout_cents,
           ub.stripe_session_id
    FROM ugc_briefs ub
    WHERE ub.claimed_by_user_id = ${userId}
      AND ub.escrow_status IN ('released', 'refunded')
      AND ub.released_amount_cents IS NOT NULL
    ON CONFLICT (source_kind, source_id, entry_type) DO NOTHING
  `);
  await run("ugc_brief:reversal", sql`
    INSERT INTO pending_payout_ledger
      (seller_user_id, seller_profile_id, source_kind, source_id, entry_type,
       gross_cents, platform_fee_cents, net_cents, stripe_session_id)
    SELECT ub.claimed_by_user_id, NULL, 'ugc_brief', ub.id, 'reversal',
           ub.released_amount_cents, ub.platform_fee_cents, ub.creator_payout_cents,
           ub.stripe_session_id
    FROM ugc_briefs ub
    WHERE ub.claimed_by_user_id = ${userId}
      AND ub.escrow_status = 'refunded'
      AND ub.released_amount_cents IS NOT NULL
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

interface PendingPayoutLedgerRow {
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
 * copied from the source rows' own splits (memberships derive theirs
 * from price_cents at the rail's 10% — membershipNetSql above) — the
 * same amounts the ledger accrues — so the earnings story and the pending-payout story
 * can never drift apart: for any completed sale, its net here equals
 * its ledger accrual net there. Refunded sales are excluded everywhere
 * (their money is not earnings; the ledger shows accrual + reversal). */

interface SellerEarningsSummary {
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
  shoutouts: {
    totalCents: number;
    grossCents: number;
    feeCents: number;
    count: number;
  };
  tipJar: { totalCents: number; count: number };
  ugcBriefs: {
    totalCents: number;
    grossCents: number;
    feeCents: number;
    count: number;
  };
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
    SELECT COALESCE(SUM(${membershipNetSql("price_cents")}), 0)::int AS cents, COUNT(*)::int AS n
    FROM fan_members
    WHERE user_id = ${userId} AND stripe_session_id IS NOT NULL AND status <> 'refunded'
  `);
  const m = (memb.rows as any[])[0] ?? { cents: 0, n: 0 };
  return { totalCents: Number(m.cents), count: Number(m.n) };
}

/* Paid shoutouts: settled = paid_at set (the settle flip's record),
   refunded excluded (their money is not earnings — the ledger shows
   accrual + reversal). Net is summed PER ROW with the rail's flat-5%
   formula, so the summary net equals the ledger accrual net row for
   row; fee = gross − net by construction. */
export async function sellerShoutouts(userId: string): Promise<SellerEarningsSummary["shoutouts"]> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM((price_cents * 95 + 50) / 100), 0)::int AS net,
           COALESCE(SUM(price_cents), 0)::int AS gross,
           COUNT(*)::int AS n
    FROM shoutout_requests
    WHERE creator_user_id = ${userId} AND paid_at IS NOT NULL AND status <> 'refunded'
  `);
  const r = (res.rows as any[])[0] ?? { net: 0, gross: 0, n: 0 };
  const grossCents = Number(r.gross);
  const totalCents = Number(r.net);
  return { totalCents, grossCents, feeCents: grossCents - totalCents, count: Number(r.n) };
}

/* Paid tip-jar tips: the durable settled rows (status 'paid'), full
   amount — tips carry no platform fee. 'refunded' rows are excluded
   here and reversed in the ledger; 'pending_payment' rows are not
   earnings (no charge settled). */
export async function sellerTipJar(userId: string): Promise<SellerEarningsSummary["tipJar"]> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0)::int AS cents, COUNT(*)::int AS n
    FROM tip_jar_tips
    WHERE page_user_id = ${userId} AND status = 'paid'
  `);
  const r = (res.rows as any[])[0] ?? { cents: 0, n: 0 };
  return { totalCents: Number(r.cents), count: Number(r.n) };
}

/* Released UGC briefs (C-25): settled = the escrow release landed
   (escrow_status 'released'); the figures are the release stamps
   themselves — net is what the release split, gross is the held
   amount it split, so the summary net equals the ledger accrual net
   row for row. A brief refunded after release reads 'refunded' and
   is excluded here (the ledger shows accrual + reversal). */
export async function sellerUgcBriefs(userId: string): Promise<SellerEarningsSummary["ugcBriefs"]> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(creator_payout_cents), 0)::int AS net,
           COALESCE(SUM(released_amount_cents), 0)::int AS gross,
           COALESCE(SUM(platform_fee_cents), 0)::int AS fee,
           COUNT(*)::int AS n
    FROM ugc_briefs
    WHERE claimed_by_user_id = ${userId} AND escrow_status = 'released'
  `);
  const r = (res.rows as any[])[0] ?? { net: 0, gross: 0, fee: 0, n: 0 };
  return {
    totalCents: Number(r.net),
    grossCents: Number(r.gross),
    feeCents: Number(r.fee),
    count: Number(r.n),
  };
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
  const shoutouts = await sellerShoutouts(userId);
  const tipJar = await sellerTipJar(userId);
  const ugcBriefs = await sellerUgcBriefs(userId);
  return {
    sellerUserId: userId,
    currency: "USD",
    totalCents:
      storeSales.totalCents + beats.totalCents + memberships.totalCents +
      brandDeals.totalCents + shoutouts.totalCents + tipJar.totalCents +
      ugcBriefs.totalCents,
    storeSales,
    beats,
    memberships,
    brandDeals,
    shoutouts,
    tipJar,
    ugcBriefs,
  };
}

/* Best-effort sync hook for sale-completion callers: never let a ledger
 * hiccup break a checkout/verify response — the read path re-syncs. */
