import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { tipJarPendingForUser } from "./generate/tip-jar";
import { sellerStoreSales, sellerBeats, sellerMemberships, sellerBrandDeals, readPendingPayoutForSeller } from "../lib/seller-earnings";

/* ─── Unified earnings (Stack 8 #5; payfix store-dashboards) ─────────────
   ONE money picture per creator, read-only over the existing ledgers —
   no money movement, no new tables. Since the payfix lane, every USD
   source below is an adapter over the SINGLE aggregation in
   lib/seller-earnings.ts (sellerStoreSales / sellerBeats /
   sellerMemberships / sellerBrandDeals, composed by
   sellerEarningsSummary) — the same module the
   pending-payout ledger syncs from — so /api/earnings, the store
   dashboards and the pending-payout figure can never tell different
   stories about the same sale again (Oct 26 state check: /store/
   dashboard $0.00 vs /my-shop + /earnings $5.00/$4.75, beat income
   missing here entirely):
     storeSales   digital_sales creator cuts (profile store, status
                  'completed') + store_orders.creator_amount_cents
                  (profile storefront) + shop_events 'sale' net,
                  adjusted for co-seller splits (#36)
     beats        beat_licenses 'completed' net (price − 15%
                  commission) — previously Producer-Dashboard-only
     memberships  fan_members.price_cents for verified paid checkouts
                  (stripe_session_id present — Stack 1's paid marker),
                  refunded memberships excluded
     tips         live_stream_tips.amount_vb actually credited to the
                  creator (creator_credited_at set) — Visual Bucs, kept
                  in its own unit, NEVER folded into the USD total;
                  plus tip-jar intents, which are pending_payment by
                  design (no real charge exists yet) and are reported
                  as pending, never as earnings
     brandDeals   sponsor_payouts.net_cents (escrow released, 15% fee
                  already taken) for this creator

   The pending-payout figure + its ledger rows live at
   GET /api/earnings/pending-payout (readPendingPayoutForSeller in
   lib/seller-earnings.ts — THE LEDGER READ CONTRACT is documented in
   ~/workspace/payfix-reports/store-dashboards.md).

   Honesty contract: a source with no rows reads 0 (status "ok"); a
   source whose query fails reads status "error" with null totals —
   never a fake 0 — and the response carries partial: true. The USD
   total sums only the sources that loaded.

   Deliberately NOT aggregated: money_entries (the manual Money
   Tracker) already receives postings from store sales and wave8
   mark-paid, so counting it here would double-count; and wave8
   pipeline deals are not earnings until paid — their paid postings
   live in the tracker by the creator's own action. */

const router = Router();

type SourceResult =
  | { status: "ok"; totalCents: number; count: number }
  | { status: "error"; totalCents: null; count: null };

const errSource = (): SourceResult => ({ status: "error", totalCents: null, count: null });

/* The four per-source readers are exported for ONE other caller:
   the Cloud Operator's Tier-0 earnings tool (lib/operator-tools),
   which reads the member's own picture through these same builders
   — never a parallel query — and applies the same per-source
   settle discipline the route below does. */

export async function storeSales(userId: string) {
  const s = await sellerStoreSales(userId);
  return {
    status: "ok" as const,
    totalCents: s.totalCents,
    count: s.count,
    breakdown: {
      digitalSalesCents: s.digitalSalesCents,
      digitalSalesCount: s.digitalSalesCount,
      profileStoreCents: s.profileStoreCents,
      profileStoreOrders: s.profileStoreOrders,
      shopSalesCents: s.shopSalesCents,
      shopSales: s.shopSales,
      coSellerSharesPaidOutCents: s.coSellerSharesPaidOutCents,
      coSellerSplitCents: s.coSellerSplitCents,
      coSellerSplitSales: s.coSellerSplitSales,
    },
  };
}

export async function beats(userId: string) {
  const b = await sellerBeats(userId);
  return {
    status: "ok" as const,
    totalCents: b.totalCents,
    count: b.count,
    grossCents: b.grossCents,
    commissionCents: b.commissionCents,
  };
}

export async function memberships(userId: string) {
  const m = await sellerMemberships(userId);
  return { status: "ok" as const, totalCents: m.totalCents, count: m.count };
}

export async function brandDeals(userId: string) {
  const d = await sellerBrandDeals(userId);
  return { status: "ok" as const, totalCents: d.totalCents, count: d.count };
}

export async function tips(userId: string) {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(amount_vb), 0)::int AS vb, COUNT(*)::int AS n
    FROM live_stream_tips
    WHERE creator_user_id = ${userId} AND creator_credited_at IS NOT NULL
  `);
  const row = (r.rows as any[])[0] ?? { vb: 0, n: 0 };
  const pending = tipJarPendingForUser(userId);
  return {
    status: "ok" as const,
    /* Visual Bucs — a different unit from cents; never added to totalCents. */
    streamTipsVb: Number(row.vb),
    streamTipCount: Number(row.n),
    /* Tip-jar intents are pending_payment (no charge exists yet). */
    tipJarPendingCents: pending.totalCents,
    tipJarPendingCount: pending.count,
    tipJarStatus: "pending_payment" as const,
  };
}

router.get("/earnings", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const settle = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      logger.error({ err, userId, source: name }, "[earnings] source failed");
      return null;
    }
  };

  const store = await settle("storeSales", () => storeSales(userId));
  const beat = await settle("beats", () => beats(userId));
  const memb = await settle("memberships", () => memberships(userId));
  const deals = await settle("brandDeals", () => brandDeals(userId));
  const tip = await settle("tips", () => tips(userId));

  const sources = {
    storeSales: store ?? { ...errSource(), breakdown: null },
    beats: beat ?? { ...errSource(), grossCents: null, commissionCents: null },
    memberships: memb ?? errSource(),
    brandDeals: deals ?? errSource(),
    tips: tip ?? {
      status: "error" as const, streamTipsVb: null, streamTipCount: null,
      tipJarPendingCents: null, tipJarPendingCount: null, tipJarStatus: "pending_payment" as const,
    },
  };
  const partial = !store || !beat || !memb || !deals || !tip;
  const totalCents =
    (store?.totalCents ?? 0) + (beat?.totalCents ?? 0) + (memb?.totalCents ?? 0) + (deals?.totalCents ?? 0);

  res.json({
    userId,
    currency: "USD",
    totalCents,
    totalTipsVb: tip?.streamTipsVb ?? null,
    partial,
    sources,
  });
});

/* ── THE LEDGER READ: GET /api/earnings/pending-payout ──────────────────
   The named read every payout surface uses (contract in
   ~/workspace/payfix-reports/store-dashboards.md): syncs the
   pending_payout_ledger for the caller, then returns the pending
   figure + the rows behind it. Honesty: a failure is a 500 with an
   error — never a fake $0.00 (the exact defect this lane fixes). */
router.get("/earnings/pending-payout", requireAuth, async (req, res) => {
  const userId = req.userId!;
  try {
    const read = await readPendingPayoutForSeller(userId);
    res.json(read);
  } catch (err) {
    logger.error({ err, userId }, "[earnings] pending-payout ledger read failed");
    res.status(500).json({ error: "pending_payout_unavailable" });
  }
});

export default router;
